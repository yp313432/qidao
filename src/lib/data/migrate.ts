/**
 * **旧大 JSON → 新表** 的迁移映射（PH2，纯函数部分）。
 *
 * ⚠️ 这里**不碰浏览器 API**（不建 Blob、不开库）—— 只做"搬运计划"，
 * 所以它是**纯函数、可单测**：`verify-data-layer.mjs` 会拿它做**往返守恒**断言。
 * 真正落库在 `db.ts`（PH3 才切换，用户点头前不动现有数据）。
 *
 * 设计依据：`qidao-docs/数据架构-①设计.md` §1.4 映射表。
 *
 * ── 两条硬要求 ───────────────────────────────────────────────
 * ① **一条都不许丢**：认不出的字段不扔，塞进 `extra` 原样带着（宁可多带，不可丢）
 * ② **要能验证**：`roundTrip()` 能把新表**拼回旧形状** —— 跟原来逐字节一致才算搬对
 *    （"迁移守恒"，见设计文档 §2 验收第 1 条）
 */
import {
  canonical,
  checksum,
  newId,
  type ConversationRecord,
  type EmotionRecord,
  type LogRecord,
  type MemoryRecord,
  type MessageRecord,
  type RecordKeys,
  type ScheduleRecord,
  type StatRecord,
  type WritingRecord,
} from "./schema";

/** 旧存档里那些"认不出也要原样带着"的东西 */
type Loose = Record<string, unknown>;

/** 旧存档的形状（就是 `qidao-store/kv/"aster-app"` 里 `state` 那一坨；字段都宽松） */
export type LegacyState = {
  settings?: Loose;
  conversations?: Loose[];
  memories?: Loose[];
  worldBook?: Loose[];
  diary?: Loose[];
  moments?: Loose[];
  letters?: Loose[];
  docs?: Loose[];
  todos?: Loose[];
  dates?: Loose[];
  emotionEvents?: Loose[];
  reminders?: Loose[];
  tasks?: Loose[];
  actionLog?: Loose[];
  requestLog?: Loose[];
  gameStats?: Loose;
  learnStats?: Loose;
  stickerLib?: Loose[];
  stickerGroups?: string[];
  model?: unknown;
  quota?: unknown;
  mcp?: unknown;
  httpTools?: unknown;
  chatDrafts?: unknown;
  activeId?: unknown;
  currentEmbedId?: unknown;
  musicEmbeds?: Loose[];
  customWords?: unknown;
  thinkingArchive?: Loose[];
  [k: string]: unknown;
};

/* ────────────────────────── 取字段的小工具 ────────────────────────── */

/** 时间：`at` / `createdAt` / `updatedAt` / `time` 里第一个数得出来的 */
export function pickTime(o: Loose, fallback = 0): number {
  for (const k of ["at", "createdAt", "updatedAt", "time", "ts", "date"]) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const t = Date.parse(v);
      if (Number.isFinite(t)) return t;
    }
  }
  return fallback;
}

/**
 * **修改时间**：必须单独取。
 *
 * ⚠️ 2026-10 踩过：直接拿 `pickTime()` 当"修改时间"会取到 `createdAt`（因为它在键序里靠前），
 * 于是搬完的对话/记忆 `updatedAt` 全变成创建时间 —— 往返守恒断言当场抓住（`b7d8291c` vs `faa6bdfb`）。
 */
export function pickUpdatedAt(o: Loose, fallback = 0): number {
  const v = o.updatedAt;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return pickTime(o, fallback);
}

/** 正文：`text` / `content` / `body` / `note` 里第一个字符串 */
export function pickText(o: Loose): string {
  for (const k of ["text", "content", "body", "note", "summary"]) {
    const v = o[k];
    if (typeof v === "string") return v;
  }
  return "";
}

/** 标题 */
export function pickTitle(o: Loose): string | undefined {
  for (const k of ["title", "name", "label"]) {
    const v = o[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/** 把已经"归一化"过的字段从原对象里刨掉，剩下的原样带走（宁可多带，不可丢） */
function rest(o: Loose, used: string[]): Loose | undefined {
  const out: Loose = {};
  for (const [k, v] of Object.entries(o)) if (!used.includes(k)) out[k] = v;
  return Object.keys(out).length > 0 ? out : undefined;
}

/* ────────────────────────── 搬运计划 ────────────────────────── */

export type BlobPlan = {
  id: string;
  kind: "image" | "sticker" | "audio" | "photo" | "avatar" | "other";
  mime: string;
  size: number;
  at: number;
  /** dataURL（落库那一步再转成 Blob；纯函数这一层不动二进制） */
  dataUrl: string;
};

export type MigrationPlan = {
  settings: Loose;
  conversations: ConversationRecord[];
  messages: MessageRecord[];
  blobs: BlobPlan[];
  memories: MemoryRecord[];
  writings: WritingRecord[];
  emotions: EmotionRecord[];
  schedules: ScheduleRecord[];
  stats: StatRecord[];
  logs: LogRecord[];
  /** 搬了什么、有多少（给用户看 + 给验收断言用） */
  report: MigrationReport;
};

export type MigrationReport = {
  from: string;
  counts: Record<string, { before: number; after: number; ok: boolean }>;
  checksums: Record<string, { before: string; after: string; ok: boolean }>;
  /** 有没有哪个类别对不上（true = 不许切换） */
  anyMismatch: boolean;
  notes: string[];
};

/** 旧存档 → 各表行（**纯函数**：同样的输入永远同样的输出） */
/**
 * **那些"小而关键"、原本在顶层的键** —— 新存储把它们塞进 `settings` 那一行。
 *
 * ⚠️ 这份名单是"搬进 / 拆出"两个方向的**唯一依据**：加一个顶层小键只改这一处。
 * 漏了会怎样见 `splitSettingsBag` 的注释（那是一次真机数据事故）。
 */
export const SETTINGS_SMALL_KEYS = [
  "model",
  "quota",
  "mcp",
  "httpTools",
  "chatDrafts",
  "activeId",
  "currentEmbedId",
  "customWords",
  "musicEmbeds",
  "stickerGroups",
  /** ⚠️ 表情库（`stickerLib`）**必须在这**：2026-10 的"整份 state 往返"测试抓到它没被搬，
   *  换到新存储之后表情库会静默变空（页面照常、只是你的表情一张不剩）。 */
  "stickerLib",
  "stickers",
] as const;

/**
 * 把 `settings` 袋拆成"设置本体 + 那些原本在顶层的键"。
 *
 * ── 这个函数是为一次**真机数据事故**补的（2026-10，用户："为啥每次更新背景和设置全没了"）──
 *
 * 起因：新存储把 29 项数据分表存，其中"设置"是**一整行** `settings`，
 * 而那些本来在顶层的键（model/mcp/quota/…）**也塞进了这一行**。
 * 读档时 `roundTrip()` 却**没有把 `settings` 拼回来**（只把袋子展开到顶层）——
 * 于是交给 App 的状态里**根本没有 `settings`**：
 *   ① App 用默认值顶上 → 主题/背景/密钥/模型**全变默认**（对话却还在，因为它拼回来了）；
 *   ② App 随后把这份"默认值"**又写回库** → 库里那份真设置被覆盖 → **真的没了**（备份也救不回）。
 *
 * 现在两个方向共用这一份名单，谁也别想再漏。
 * `verify-data-layer.mjs` 里那条"整份 state 往返"就是盯着它的（29 项逐个对账）。
 */
export function splitSettingsBag(bag: Loose | undefined): { settings: Loose; top: Loose } {
  const settings: Loose = { ...(bag ?? {}) };
  const top: Loose = {};
  for (const k of SETTINGS_SMALL_KEYS) {
    if (k in settings) {
      top[k] = settings[k];
      delete settings[k];
    }
  }
  return { settings, top };
}

/**
 * 把"整块状态"拆成各表的行。
 *
 * ⚠️ **`opts.report === false` 是给"平时保存"用的**（2026-10，真机卡死 6.8 秒的修复）。
 *
 * 起因（真机现场，`verify-breadcrumbs` 记下来的）：
 *   用户报"报情绪就卡退"，痕迹里是
 *     `long 主线程堵了 6788ms（当时：执行动作 emotion_report）`、`久 809ms（emotion_lexicon）`，
 *     而堆内存只有 10MB —— 不是内存，是**主线程被占住**。
 *   量下来：**每存一次档，整份状态要走三遍**（序列化 → 解析 → 搬家）**外加一遍守恒报告**
 *   （`roundTrip` + 每个类别的内容校验和）**再加逐行校验和**。
 *   数据小的时候是 15~35ms；用户那份（背景图 / 表情包都是 base64，几 MB）在手机上就是**秒级**。
 *
 * 守恒报告是给"**切换存储 / 自检**"用的（判"能不能安全切过去"），
 * **平时的自动保存根本不需要它** —— 所以平时跳过，省掉一整遍全量遍历 + 全量校验和。
 * 别的调用方（`parseToPlan`、搬家、自检）不传这个参数 → 照旧有报告。
 */
export function planMigration(
  old: LegacyState,
  now = 0,
  opts: { report?: boolean } = {},
): MigrationPlan {
  const notes: string[] = [];
  const settings: Loose = { ...(old.settings ?? {}) };

  /* ── 对话 + 消息 + 附件（拆成三张表：这才是"一条消息一次写"的前提）── */
  const conversations: ConversationRecord[] = [];
  const messages: MessageRecord[] = [];
  const blobs: BlobPlan[] = [];
  for (const c of old.conversations ?? []) {
    if (c.incognito === true) continue; // 隐藏对话本来就不入库（跟旧 persist 一致）
    const id = typeof c.id === "string" ? c.id : newId("conv");
    const rawMsgs = Array.isArray(c.messages) ? (c.messages as Loose[]) : [];
    const convMsgs: MessageRecord[] = [];
    for (const m of rawMsgs) {
      const mid = typeof m.id === "string" ? m.id : newId("msg");
      /** 附件：正文（dataUrl）搬去 blobs 表，消息里只留引用 */
      const atts: MessageRecord["attachments"] = [];
      for (const a of Array.isArray(m.attachments) ? (m.attachments as Loose[]) : []) {
        const aid = typeof a.id === "string" ? a.id : newId("att");
        const dataUrl = typeof a.dataUrl === "string" ? a.dataUrl : "";
        let blobId: string | undefined;
        if (dataUrl.startsWith("data:")) {
          const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? "application/octet-stream";
          const size = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
          blobs.push({
            id: aid,
            kind: (a.kind as BlobPlan["kind"]) ?? "other",
            mime,
            size,
            at: pickTime(a, pickTime(m, now)),
            dataUrl,
          });
          blobId = aid;
        }
        atts.push({
          id: aid,
          kind: (a.kind as "image" | "file" | "sticker" | "audio") ?? "file",
          name: typeof a.name === "string" ? a.name : "",
          mime: typeof a.mime === "string" ? a.mime : "",
          size: typeof a.size === "number" ? a.size : 0,
          ...(blobId ? { blobId } : {}),
          ...(typeof a.text === "string" ? { text: a.text } : {}),
          ...(a.truncated === true ? { truncated: true } : {}),
          ...(typeof a.durationMs === "number" ? { durationMs: a.durationMs } : {}),
          ...(() => {
            /** 附件上没建模的字段也原样带走（同 extra 的道理） */
            const x = rest(a, ["id", "kind", "name", "mime", "size", "dataUrl", "text", "truncated", "durationMs"]);
            return x ? { extra: x } : {};
          })(),
        });
      }
      /** 消息上没建模的字段原样带走 */
      const msgExtra = rest(m, [
        "id",
        "role",
        "content",
        "thinking",
        "thinkingDurationMs",
        "createdAt",
        "at",
        "time",
        "ts",
        "date",
        "attachments",
        "parts",
        "origin",
      ]);
      /**
       * ⚠️ 一律按「**原本有没有这个键**」搬，不按「值真不真」。
       *
       * 真机切换时守恒校验没过，原因就是这个：真实数据里 `thinking: ""`、
       * `attachments: []`、`parts: []` 到处都是，只认真值会把这些键丢掉 →
       * 拼回来时就少了几个键（条数全对、内容校验和对不上）。
       */
      const hasKey = (k: string) => Object.prototype.hasOwnProperty.call(m, k);
      const timeKey = ["at", "createdAt", "updatedAt", "time", "ts", "date"].find((k) => hasKey(k));
      const present: string[] = [];
      if (hasKey("thinking")) present.push("thinking");
      if (hasKey("thinkingDurationMs")) present.push("thinkingDurationMs");
      if (hasKey("attachments")) present.push("attachments");
      if (hasKey("parts")) present.push("parts");
      if (hasKey("origin")) present.push("origin");
      convMsgs.push({
        id: mid,
        convId: id,
        role: (m.role as MessageRecord["role"]) ?? "user",
        content: typeof m.content === "string" ? m.content : "",
        ...(hasKey("thinking") ? { thinking: typeof m.thinking === "string" ? m.thinking : "" } : {}),
        ...(hasKey("thinkingDurationMs") ? { thinkingMs: Number(m.thinkingDurationMs) || 0 } : {}),
        at: pickTime(m, now),
        ...(hasKey("attachments") ? { attachments: atts } : {}),
        ...(hasKey("parts") ? { parts: (m.parts as string[]) ?? [] } : {}),
        ...(hasKey("origin") ? { origin: String(m.origin ?? "") } : {}),
        ...(msgExtra ? { extra: msgExtra } : {}),
        keys: { ...(timeKey ? { time: timeKey } : {}) },
        present,
      });
    }
    messages.push(...convMsgs);
    const times = convMsgs.map((m) => m.at).filter((t) => t > 0);
    /** 对话上没建模的字段原样带走（`incognito` 等也在里面 —— 它不该被"顺手丢掉"） */
    const convExtra = rest(c, [
      "id",
      "title",
      "name",
      "label",
      "createdAt",
      "updatedAt",
      "at",
      "time",
      "ts",
      "date",
      "summary",
      "messages",
    ]);
    conversations.push({
      id,
      title: typeof c.title === "string" ? c.title : "新对话",
      createdAt: pickTime(c, times[0] ?? now),
      /**
       * ⚠️ **原件有 updatedAt 就原样保留**（不许用"消息最大时间"覆盖它）——
       * 真机守恒校验抓到的：覆盖之后往返值变了（条数对、内容对不上）。
       * 没有才用消息最大时间兜底。
       */
      updatedAt: pickUpdatedAt(c, Math.max(0, ...times)),
      ...(Object.prototype.hasOwnProperty.call(c, "summary") ? { summary: String(c.summary ?? "") } : {}),
      msgCount: convMsgs.length,
      ...(times.length > 0 ? { lastAt: Math.max(...times) } : {}),
      /**
       * ⚠️ **必须带上**：对话上没建模的字段（真机上是 `pinned` / `incognito`）——
       * 2026-10 真机第三次报错就是这句："对话内容 → chat_xxx：原始多了 pinned/incognito"。
       * （上一轮我"恢复干净状态"时把这段一起回退了，所以它一直是缺的。）
       */
      ...(convExtra ? { extra: convExtra } : {}),
    });
  }

  /* ── 记忆 + 世界书（同一张表，用 kind 分）── */
  const memories: MemoryRecord[] = [];
  for (const m of old.memories ?? []) {
    /** ⚠️ 记住原字段名（有的记忆用 `at`、有的用 `createdAt`；正文有的叫 `content`）—— 往返守恒要拼回原名 */
    const usedKeys = ["id", "text", "content", "body", "note", "summary", "tags", "createdAt", "updatedAt", "at", "time", "ts", "date"];
    const memTextKey = ["text", "content", "body", "note", "summary"].find((k) => typeof m[k] === "string");
    const memCreatedKey = ["createdAt", "at", "time", "ts", "date"].find((k) => m[k] !== undefined);
    const memUpdatedKey = m.updatedAt !== undefined ? "updatedAt" : undefined;
    memories.push({
      id: typeof m.id === "string" ? m.id : newId("mem"),
      kind: "memory",
      text: pickText(m),
      ...(Object.prototype.hasOwnProperty.call(m, "tags") ? { tags: (m.tags as string[]) ?? [] } : {}),
      createdAt: pickTime(m, now),
      updatedAt: pickUpdatedAt(m, pickTime(m, now)),
      ...(rest(m, usedKeys) ? { extra: rest(m, usedKeys) } : {}),
      keys: {
        ...(memTextKey ? { text: memTextKey } : {}),
        ...(memCreatedKey ? { createdAt: memCreatedKey } : {}),
        ...(memUpdatedKey ? { updatedAt: memUpdatedKey } : {}),
      },
    } as MemoryRecord);
  }
  /**
   * ── 世界书 ────────────────────────────────────────────────────────────
   *
   * ⚠️ **2026-10 真机红屏的根因就在这一段**。用户截图：
   * "AI 概览 →「怎么和你相处」点进去 = Something went wrong /
   *  Cannot read properties of undefined (reading 'length')"。
   *
   * 原来这里只搬 `id / text / tags / 时间`：`keywords` / `position` / `enabled` / `title`
   * 被当成"不认识的键"整块丢掉，于是有两个后果 —— 一个看得见、一个看不见：
   *   1. **看得见**：「世界书」那一页读 `e.keywords.length` → 整页红屏；
   *   2. **看不见**（更严重）：`pickWorldEntries()` 要求 `enabled && content` 才注入，
   *      这两个也没了 → **他手里那几条规矩静默失效**，提示词里一条都不进。
   *
   * 现在跟"用户写的东西"同一个待遇：不认识的键进 `extra`、原字段名记进 `keys`，
   * 往返一个字不差。`buildReport` 也把「世界书内容」加进校验和了 —— 下次再丢当场报红。
   */
  for (const w of old.worldBook ?? []) {
    const usedKeys = [
      "id", "title", "name", "label", "text", "content", "body", "note", "summary",
      "tags", "createdAt", "updatedAt", "at", "time", "ts", "date",
    ];
    const wbTextKey = ["text", "content", "body", "note", "summary"].find((k) => typeof w[k] === "string");
    const wbTitleKey = ["title", "name", "label"].find((k) => typeof w[k] === "string");
    const wbCreatedKey = ["createdAt", "at", "time", "ts", "date"].find((k) => w[k] !== undefined);
    const wbExtra = rest(w, usedKeys);
    memories.push({
      id: typeof w.id === "string" ? w.id : newId("wb"),
      kind: "worldbook",
      ...(pickTitle(w) ? { title: pickTitle(w) } : {}),
      text: pickText(w),
      ...(Array.isArray(w.tags) ? { tags: w.tags as string[] } : {}),
      createdAt: pickTime(w, now),
      updatedAt: pickUpdatedAt(w, pickTime(w, now)),
      ...(wbExtra ? { extra: wbExtra } : {}),
      keys: {
        ...(wbTextKey ? { text: wbTextKey } : {}),
        ...(wbTitleKey && pickTitle(w) ? { title: wbTitleKey } : {}),
        ...(wbCreatedKey ? { createdAt: wbCreatedKey } : {}),
        ...(w.updatedAt !== undefined ? { updatedAt: "updatedAt" } : {}),
      },
    } as MemoryRecord);
  }

  /* ── 用户写的东西（日记/动态/信/文档/待办/日子 → 一张表 + kind）── */
  const writings: WritingRecord[] = [];
  const writingKinds: { key: keyof LegacyState; kind: WritingRecord["kind"] }[] = [
    { key: "diary", kind: "diary" },
    { key: "moments", kind: "moment" },
    { key: "letters", kind: "letter" },
    { key: "docs", kind: "doc" },
    { key: "todos", kind: "todo" },
    { key: "dates", kind: "date" },
  ];
  for (const { key, kind } of writingKinds) {
    const arr = Array.isArray(old[key]) ? (old[key] as Loose[]) : [];
    for (const it of arr) {
      const used = ["id", "title", "name", "label", "text", "content", "body", "note", "summary", "at", "createdAt", "updatedAt", "time", "ts", "date"];
      /**
       * **记住原来的字段名**：App 里日记正文叫 `body`、文档叫 `content`、时间叫 `createdAt`。
       * 搬家时统一成 `text`/`at`（为了"同一张表"），但**原名要留着** ——
       * 否则往返拼不回原样，切回老存储时日记/文档就读不出来了。
       * （2026-10 真跑切换时，守恒断言当场抓到这一点。）
       */
      const textKey = ["text", "content", "body", "note", "summary"].find((k) => typeof it[k] === "string");
      const timeKey = ["at", "createdAt", "updatedAt", "time", "ts", "date"].find(
        (k) => typeof it[k] === "number" || typeof it[k] === "string",
      );
      const titleKey = ["title", "name", "label"].find((k) => typeof it[k] === "string");
      writings.push({
        id: typeof it.id === "string" ? it.id : newId(kind),
        kind,
        ...(pickTitle(it) ? { title: pickTitle(it) } : {}),
        text: pickText(it),
        ...(rest(it, used) ? { extra: rest(it, used) } : {}),
        at: pickTime(it, now),
        keys: {
          ...(textKey ? { text: textKey } : {}),
          ...(timeKey ? { time: timeKey } : {}),
          ...(titleKey && pickTitle(it) ? { title: titleKey } : {}),        },
      });
    }
  }

  /* ── 情绪 ── */
  const emotions: EmotionRecord[] = (old.emotionEvents ?? []).map((e) => ({
    id: typeof e.id === "string" ? e.id : newId("emo"),
    kind: typeof e.kind === "string" ? e.kind : String(e.emotion ?? "unknown"),
    at: pickTime(e, now),
    ...(typeof e.note === "string" ? { note: e.note } : {}),
  }));

  /* ── 定时类（提醒 / 任务）──
   *
   * ⚠️ **`time` 不能当成"时间字段"吃掉**（2026-10 的整份往返测试抓到的）：
   * 任务里的 `time` 是 "08:00" 这种**每天几点**的字符串，而 `nextAt` 要的是时间戳 ——
   * 原来把 `time` 列进了"已消费"的键里 → 它既没进 extra、也没按原样拼回来，
   * 结果**定时任务的时间在换存储之后就没了**（任务还在，但不按点了）。
   * 现在：`time` 留给 extra 原样带走；只把真正的"时间戳类"键算进 nextAt，
   * 并且记下原件到底有没有那个键（没有就不许凭空补 `at`）。
   */
  const schedules: ScheduleRecord[] = [];
  const AT_KEYS = ["at", "createdAt", "updatedAt", "ts", "date"] as const;
  const schedUsed = [
    "id", "title", "name", "label", "text", "content", "body", "note", "summary",
    "at", "createdAt", "updatedAt", "ts", "date",
  ];
  for (const r of old.reminders ?? []) {
    const atKey = AT_KEYS.find((k) => r[k] !== undefined);
    const hasText = ["text", "content", "body", "note", "summary"].some((k) => typeof r[k] === "string");
    const extra = rest(r, schedUsed);
    schedules.push({
      id: typeof r.id === "string" ? r.id : newId("rem"),
      kind: "reminder",
      ...(pickTitle(r) ? { title: pickTitle(r) } : {}),
      text: pickText(r),
      nextAt: pickTime(r, now),
      ...(extra ? { extra } : {}),
      present: [...(atKey ? [atKey] : []), ...(hasText ? ["text"] : [])],
    } as ScheduleRecord);
  }
  for (const t of old.tasks ?? []) {
    const atKey = AT_KEYS.find((k) => t[k] !== undefined);
    const hasText = ["text", "content", "body", "note", "summary"].some((k) => typeof t[k] === "string");
    const extra = rest(t, [...schedUsed, "done"]);
    schedules.push({
      id: typeof t.id === "string" ? t.id : newId("task"),
      kind: "task",
      ...(pickTitle(t) ? { title: pickTitle(t) } : {}),
      text: pickText(t),
      nextAt: pickTime(t, now),
      ...(t.done === true ? { done: true } : {}),
      ...(extra ? { extra } : {}),
      present: [...(atKey ? [atKey] : []), ...(hasText ? ["text"] : [])],
    } as ScheduleRecord);
  }

  /* ── 统计：三样"顶层小数据"都放这张 key-value 表 ──
   * ⚠️ `thinkingArchive`（他过去的推理记录）以前**根本没搬**（顶层没它的位置，
   * settings 那张"小而关键"的表也不该塞它）→ 换了新存储之后它会**静默变空**。
   * 现在跟统计一样走 `stats` 一行，读档时原样拼回顶层。
   */
  const stats: StatRecord[] = [];
  for (const k of ["gameStats", "learnStats", "thinkingArchive"] as const)
    stats.push({ key: k, value: old[k] ?? null, updatedAt: now });

  /* ── 运行记录（可丢，上限见 retention.ts）── */
  const logs: LogRecord[] = [];
  for (const a of old.actionLog ?? [])
    logs.push({ id: newId("log"), kind: "action", at: pickTime(a, now), payload: a });
  for (const r of old.requestLog ?? [])
    logs.push({ id: newId("log"), kind: "request", at: pickTime(r, now), payload: r });

/* ── 把顶层那些"小而关键"的键搬进 settings 袋（名单见 SETTINGS_SMALL_KEYS）── */
for (const k of SETTINGS_SMALL_KEYS) if (old[k] !== undefined) settings[k] = old[k];

  const plan: MigrationPlan = {
    settings,
    conversations,
    messages,
    blobs,
    memories,
    writings,
    emotions,
    schedules,
    stats,
    logs,
    report: {
      from: `legacy/${checksum(old.conversations ?? [])}`,
      counts: {},
      checksums: {},
      anyMismatch: false,
      notes,
    },
  };
  /** 平时保存跳过守恒报告（见 `planMigration` 上面那段说明）；要报告就照旧算 */
  if (opts.report !== false) plan.report = buildReport(old, plan);
  return plan;
}

/**
 * 守恒报告：每个类别的"搬之前几条 / 搬之后几条" + 内容校验和。
 *
 * 判据故意用**能对得上的东西**（条数 + 校验和），不用"我觉得搬对了"。
 */
export function buildReport(old: LegacyState, plan: MigrationPlan): MigrationReport {
  const counts: MigrationReport["counts"] = {};
  const checksums: MigrationReport["checksums"] = {};
  const notes: string[] = [];

  const legacyMsgs = (old.conversations ?? [])
    .filter((c) => c.incognito !== true)
    .flatMap((c) => (Array.isArray(c.messages) ? (c.messages as Loose[]) : []));
  const legacyAtts = legacyMsgs.flatMap((m) =>
    Array.isArray(m.attachments) ? (m.attachments as Loose[]) : [],
  );
  counts["对话"] = { before: (old.conversations ?? []).filter((c) => c.incognito !== true).length, after: plan.conversations.length, ok: false };
  counts["消息"] = { before: legacyMsgs.length, after: plan.messages.length, ok: false };
  counts["附件"] = { before: legacyAtts.length, after: plan.messages.flatMap((m) => m.attachments ?? []).length, ok: false };
  counts["二进制(dataUrl)"] = {
    before: legacyAtts.filter((a) => typeof a.dataUrl === "string" && a.dataUrl.startsWith("data:")).length,
    after: plan.blobs.length,
    ok: false,
  };
  counts["记忆+世界书"] = {
    before: (old.memories ?? []).length + (old.worldBook ?? []).length,
    after: plan.memories.length,
    ok: false,
  };
  counts["日记/动态/信/文档/待办/日子"] = {
    before: (["diary", "moments", "letters", "docs", "todos", "dates"] as const).reduce(
      (n, k) => n + ((old[k] as Loose[] | undefined)?.length ?? 0),
      0,
    ),
    after: plan.writings.length,
    ok: false,
  };
  counts["情绪"] = { before: (old.emotionEvents ?? []).length, after: plan.emotions.length, ok: false };
  counts["提醒+任务"] = {
    before: (old.reminders ?? []).length + (old.tasks ?? []).length,
    after: plan.schedules.length,
    ok: false,
  };
  counts["运行记录"] = {
    before: (old.actionLog ?? []).length + (old.requestLog ?? []).length,
    after: plan.logs.length,
    ok: false,
  };
  for (const k of Object.keys(counts)) counts[k].ok = counts[k].before === counts[k].after;

  /** 内容校验和：把"搬完的样子"拼回旧形状再算一遍（roundTrip） */
  const back = roundTrip(plan);
  for (const [label, before, after] of [
    /**
     * ⚠️ **设置必须单独对账**（2026-10 补的，一次真机事故换来的）。
     *
     * 读档曾经**根本没把 `settings` 拼回来** → App 用默认值顶上、又把默认值写回库 →
     * 库里那份真设置（背景/密钥/模型）**被覆盖没了**，而且备份也救不回。
     * 之前这里没有任何"设置"的校验和，所以"搬丢了"没人发现 —— 条数对不对跟设置没关系。
     */
    ["设置内容", old.settings ?? {}, back.settings ?? {}],
    /** ⚠️ 隐藏对话（incognito）是**故意不搬**的 —— 对比时两边都要排除，否则假报警 */
    ["对话内容", (old.conversations ?? []).filter((c) => c.incognito !== true), back.conversations ?? []],
    ["消息内容", legacyMsgs, (back.conversations ?? []).flatMap((c: Loose) => (c.messages as Loose[]) ?? [])],
    ["记忆内容", old.memories ?? [], back.memories ?? []],
    /**
     * ⚠️ **世界书必须单独对账**（2026-10 补的）。
     *
     * 之前它只算在「记忆+世界书」的**条数**里 —— 所以"条数对、字段全丢"
     * （keywords/position/enabled 被吃掉 → 那一页红屏 + 规矩静默失效）**一直没被发现**。
     * 条数不是守恒，内容才是。
     */
    ["世界书内容", old.worldBook ?? [], back.worldBook ?? []],
    ["日记内容", old.diary ?? [], back.diary ?? []],
    ["情绪内容", old.emotionEvents ?? [], back.emotionEvents ?? []],
  ] as [string, unknown, unknown][]) {
    const b = checksum(before);
    const a = checksum(after);
    checksums[label] = { before: b, after: a, ok: b === a };
  }

  const anyMismatch =
    Object.values(counts).some((c) => !c.ok) || Object.values(checksums).some((c) => !c.ok);
  if (anyMismatch) {
    const badCounts = Object.entries(counts)
      .filter(([, v]) => !v.ok)
      .map(([k, v]) => `${k}(${v.before}→${v.after})`);
    /**
     * ⚠️ 光说"校验和不对"**没法修** —— 2026-10 真机连着两轮都栽在这句笼统的报错上。
     * 所以这里把**对不上的字段名**列出来：下一张截图就能直接定位，不用再猜。
     */
    const badSums = Object.entries(checksums)
      .filter(([, v]) => !v.ok)
      .map(([k]) => `${k} → ${firstDiff(groupsFor(k, old, back))}`);
    notes.push(
      `对不上的是：${[...badCounts, ...badSums].join("；")}（按规矩**不许切换**，见 §12.0 铁律 3）`,
    );
  }
  return { from: `legacy/${checksum(old).slice(0, 8)}`, counts, checksums, anyMismatch, notes };
}

/** 每类校验和对应的"原始数组 / 往返数组" */
function groupsFor(
  label: string,
  old: LegacyState,
  back: LegacyState,
): { before: unknown[]; after: unknown[] } {
  const nonIncognito = (old.conversations ?? []).filter((c) => c.incognito !== true);
  switch (label) {
    case "设置内容":
      return { before: [old.settings ?? {}], after: [back.settings ?? {}] };
    case "对话内容":
      return { before: nonIncognito, after: back.conversations ?? [] };
    case "消息内容":
      return {
        before: nonIncognito.flatMap((c) => (c.messages as unknown[]) ?? []),
        after: (back.conversations ?? []).flatMap((c) => (c.messages as unknown[]) ?? []),
      };
    case "记忆内容":
      return { before: old.memories ?? [], after: back.memories ?? [] };
    case "世界书内容":
      return { before: old.worldBook ?? [], after: back.worldBook ?? [] };
    case "日记内容":
      return { before: old.diary ?? [], after: back.diary ?? [] };
    case "情绪内容":
      return { before: old.emotionEvents ?? [], after: back.emotionEvents ?? [] };
    default:
      return { before: [], after: [] };
  }
}

/**
 * 找出**第一处不同**并说清"差在哪个字段"。
 *
 * 这就是这次真机上唯一能自救的东西：报错直接写出
 * `消息内容 → 第 4 条：原始有 at、往返没有` 这种话，而不是只给一个校验和。
 */
function firstDiff({ before, after }: { before: unknown[]; after: unknown[] }): string {
  const n = Math.max(before.length, after.length);
  for (let i = 0; i < n; i += 1) {
    if (canonical(before[i]) === canonical(after[i])) continue;
    const a = (before[i] ?? {}) as Record<string, unknown>;
    const b = (after[i] ?? {}) as Record<string, unknown>;
    const onlyA = Object.keys(a).filter((k) => !(k in b));
    const onlyB = Object.keys(b).filter((k) => !(k in a));
    const changed = Object.keys(a).filter((k) => k in b && canonical(a[k]) !== canonical(b[k]));
    const id = (a.id ?? b.id ?? `第 ${i + 1} 条`) as string;
    const bits = [
      onlyA.length ? `原始多了 ${onlyA.join("/")}` : "",
      onlyB.length ? `往返多了 ${onlyB.join("/")}` : "",
      changed.length ? `值不同 ${changed.join("/")}` : "",
    ].filter(Boolean);
    return `${id}：${bits.join("，") || "（内容不同但字段一致）"}`;
  }
  return "（顺序不同）";
}

/**
 * 把新表**拼回旧形状** —— 用来做"往返守恒"断言。
 *
 * ⚠️ 这是**故意写的**：只有"搬过去再拼回来跟原来一样"，才能证明没丢东西。
 * （附件正文从 blobs 拼回 `dataUrl`；`extra` 展开回原字段。）
 */
export function roundTrip(plan: MigrationPlan): LegacyState {
  const byConv = new Map<string, MessageRecord[]>();
  for (const m of plan.messages) {
    const arr = byConv.get(m.convId) ?? [];
    arr.push(m);
    byConv.set(m.convId, arr);
  }
  const blobById = new Map(plan.blobs.map((b) => [b.id, b]));
  const conversations = plan.conversations.map((c) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    ...(c.summary ? { summary: c.summary } : {}),
    /** ⚠️ 对话上没建模的字段原样还回去（真机上是 pinned / incognito） */
    ...((c as ConversationRecord & { extra?: Loose }).extra ?? {}),
    messages: (byConv.get(c.id) ?? [])
      .slice()
      .sort((a, b) => a.at - b.at)
      .map((m) => {
        /**
         * ⚠️ 按"**原本有没有这个键**"（`present`）+ 原时间字段名（`keys.time`）还原。
         * 真机切换时守恒校验没过就是因为这里：`thinking: ""` / `attachments: []` / `parts: []`
         * 这类"键在值是空"的字段被丢，以及有的消息时间叫 `at`、有的叫 `createdAt`。
         */
        const present = new Set((m as MessageRecord & { present?: string[] }).present ?? []);
        const timeKeyName = (m as MessageRecord & { keys?: RecordKeys }).keys?.time ?? "createdAt";
        return {
          id: m.id,
          role: m.role,
          content: m.content,
          ...(present.has("thinking") ? { thinking: m.thinking ?? "" } : {}),
          ...(present.has("thinkingDurationMs") ? { thinkingDurationMs: m.thinkingMs ?? 0 } : {}),
          [timeKeyName]: m.at,
          ...(present.has("attachments") && m.attachments
            ? {
                attachments: m.attachments.map((a) => {
                  const blob = a.blobId ? blobById.get(a.blobId) : undefined;
                  return {
                    id: a.id,
                    kind: a.kind,
                    name: a.name,
                    mime: a.mime,
                    size: a.size,
                    ...(blob ? { dataUrl: blob.dataUrl } : {}),
                    ...(a.text !== undefined ? { text: a.text } : {}),
                    ...(a.truncated !== undefined ? { truncated: a.truncated } : {}),
                    ...(a.durationMs !== undefined ? { durationMs: a.durationMs } : {}),
                  };
                }),
              }
            : {}),
          ...(present.has("parts") ? { parts: m.parts ?? [] } : {}),
          ...(present.has("origin") ? { origin: m.origin ?? "" } : {}),
          ...((m as MessageRecord & { extra?: Loose }).extra ?? {}),
        };
      }),
  }));

  const out: LegacyState = { conversations };
  const memories = plan.memories.filter((m) => m.kind === "memory").map((m) => ({
    id: m.id,
    [(m as MemoryRecord & { keys?: RecordKeys }).keys?.text ?? "text"]: m.text,
    ...((m as MemoryRecord & { keys?: RecordKeys }).keys?.title ? { [(m as MemoryRecord & { keys?: RecordKeys }).keys!.title as string]: (m as MemoryRecord & { title?: string }).title } : {}),
    ...(m.tags ? { tags: m.tags } : {}),
    [(m as MemoryRecord & { keys?: RecordKeys }).keys?.createdAt ?? "createdAt"]: m.createdAt,
    /** ⚠️ 原件没有 `updatedAt` 就**不许凭空补**（真机守恒校验抓到的：凭空补也算"变了"） */
    ...((m as MemoryRecord & { keys?: RecordKeys }).keys?.updatedAt
      ? { [(m as MemoryRecord & { keys?: RecordKeys }).keys!.updatedAt as string]: m.updatedAt }
      : {}),
    ...((m as MemoryRecord & { extra?: Loose }).extra ?? {}),
  }));
  /**
   * ⚠️ 世界书**必须按原字段名 + extra 拼回去**（跟上面记忆、下面"用户写的东西"同一条规矩）。
   *
   * 原来这里只拼 `{id, text, tags}` —— `keywords / position / enabled / title / content`
   * 全在这一句里被吃掉，这就是"世界书那一页红屏 + 那些规矩静默失效"的另一半原因。
   */
  const worldBook = plan.memories
    .filter((m) => m.kind === "worldbook")
    .map((m) => {
      const rec = m as MemoryRecord & { keys?: RecordKeys; extra?: Loose };
      const title = (m as MemoryRecord & { title?: string }).title;
      const o: Record<string, unknown> = { id: m.id };
      if (rec.keys?.title && title) o[rec.keys.title] = title;
      o[rec.keys?.text ?? "text"] = m.text;
      if (m.tags) o.tags = m.tags;
      // ⚠️ 原件**没有**这个时间键就不许补（凭空补也算"变了"，真机守恒校验抓过）
      if (rec.keys?.createdAt) o[rec.keys.createdAt] = m.createdAt;
      if (rec.keys?.updatedAt) o[rec.keys.updatedAt] = m.updatedAt;
      return { ...o, ...(rec.extra ?? {}) };
    });
  const toLegacy = (kind: WritingRecord["kind"]) =>
    plan.writings
      .filter((w) => w.kind === kind)
      .map((w) => {
        /**
         * ⚠️ 按**原字段名**还原：App 里日记正文叫 `body`、文档叫 `content`、时间叫 `createdAt`。
         * 搬家时统一成 `text`/`at` 是为了"同一张表"，但拼回旧形状必须用原名 ——
         * 否则切回老存储时 App 读不到日记/文档的正文（2026-10 守恒断言抓到的）。
         */
        const o: Record<string, unknown> = { id: w.id };
        if (w.title) o[w.keys?.title ?? "title"] = w.title;
        /**
         * ⚠️ **原件没有"正文"那个键就不许补**（跟世界书那边同一条纪律）：
         * 「重要日子」只有 `title` + `at`，凭空补一个 `text: ""` 会让往返对不上 ——
         * 多出来的空键跟丢掉键一样，都算"内容变了"。
         */
        if (w.keys?.text) o[w.keys.text] = w.text;
        else if (w.text) o.text = w.text;
        o[w.keys?.time ?? "at"] = w.at;
        return { ...o, ...(w.extra ?? {}) };
      });
  const emotions = plan.emotions.map((e) => ({
    id: e.id,
    kind: e.kind,
    at: e.at,
    ...(e.note ? { note: e.note } : {}),
  }));
  /**
   * ⚠️ 定时类：**原位有没有那个时间键，才决定拼不拼 `at`**
   * （没有就不许凭空补 —— 凭空补一个 `at: 0` 会让"一次性任务"看起来像 1970 年就该响）。
   * `time`（每天几点）走 extra 原样回来，这里不碰。
   */
  const schedHasAt = (s: ScheduleRecord) => ((s as ScheduleRecord & { present?: string[] }).present ?? []).length > 0;
  /**
   * ⚠️ `text` 也只在"原件确实有正文键"时才拼（跟用户写的那些东西同一条纪律）：
   * 任务的内容字段叫 `prompt`、日子叫 `title` —— 凭空补一个 `text: ""` 就是"内容变了"。
   */
  const schedHasText = (s: ScheduleRecord) =>
    ((s as ScheduleRecord & { present?: string[] }).present ?? []).includes("text");
  const reminders = plan.schedules
    .filter((s) => s.kind === "reminder")
    .map((s) => ({
      id: s.id,
      ...(schedHasText(s) ? { text: s.text ?? "" } : {}),
      ...(s.extra ?? {}),
      ...(schedHasAt(s) ? { at: s.nextAt ?? 0 } : {}),
    }));
  const tasks = plan.schedules
    .filter((s) => s.kind === "task")
    .map((s) => ({
      id: s.id,
      ...(schedHasText(s) ? { text: s.text ?? "" } : {}),
      ...(s.done ? { done: true } : {}),
      ...(s.extra ?? {}),
      ...(schedHasAt(s) ? { at: s.nextAt ?? 0 } : {}),
    }));
  /**
   * ⚠️ 运行记录（动作 / 请求）**也在这里拼回来**（2026-10 补）。
   * 以前只有适配层在读完整块形状时顺手补上，`roundTrip` 自己不管 ——
   * 于是"整份 state 往返"这条测试一对账就发现它俩根本不在，谁也不敢改适配层。
   * 现在一处负责：`payload` 就是原件，原样还回去。
   */
  const actionLog = plan.logs.filter((l) => l.kind === "action").map((l) => (l.payload ?? {}) as Loose);
  const requestLog = plan.logs.filter((l) => l.kind === "request").map((l) => (l.payload ?? {}) as Loose);
  const settingsBag = splitSettingsBag(plan.settings);
  const first = <T,>(arr: T[]): T[] | undefined => (arr.length > 0 ? arr : undefined);
  const statValue = (key: string): unknown => plan.stats.find((s) => s.key === key)?.value;
  return {
    ...out,
    /**
     * ⚠️ **设置本体必须显式拼回来**（2026-10 真机事故的根因，见 `splitSettingsBag`）。
     * 少了这一行：App 读到的是"没有 settings" → 全变默认 → 再把默认写回库 → 真设置没了。
     */
    settings: settingsBag.settings,
    /** 那些原本在顶层的键（model/mcp/quota/…）—— 同一份名单，进出对称 */
    ...settingsBag.top,
    /** 统计与推理档案（以前只有"搬"没有"拼回来"）：null 就不写，让 App 用默认值 */
    ...(statValue("gameStats") ? { gameStats: statValue("gameStats") as Loose } : {}),
    ...(statValue("learnStats") ? { learnStats: statValue("learnStats") as Loose } : {}),
    ...(Array.isArray(statValue("thinkingArchive")) && (statValue("thinkingArchive") as unknown[]).length > 0
      ? { thinkingArchive: statValue("thinkingArchive") as unknown as Loose[] }
      : {}),
    ...(memories.length ? { memories } : {}),
    ...(worldBook.length ? { worldBook } : {}),
    ...(first(toLegacy("diary")) ? { diary: toLegacy("diary") } : {}),
    ...(first(toLegacy("moment")) ? { moments: toLegacy("moment") } : {}),
    ...(first(toLegacy("letter")) ? { letters: toLegacy("letter") } : {}),
    ...(first(toLegacy("doc")) ? { docs: toLegacy("doc") } : {}),
    ...(first(toLegacy("todo")) ? { todos: toLegacy("todo") } : {}),
    ...(first(toLegacy("date")) ? { dates: toLegacy("date") } : {}),
    ...(emotions.length ? { emotionEvents: emotions } : {}),
    ...(reminders.length ? { reminders } : {}),
    ...(tasks.length ? { tasks } : {}),
    ...(actionLog.length ? { actionLog } : {}),
    ...(requestLog.length ? { requestLog } : {}),
  };
}
