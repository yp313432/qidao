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
export function planMigration(old: LegacyState, now = 0): MigrationPlan {
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
  for (const w of old.worldBook ?? [])
    memories.push({
      id: typeof w.id === "string" ? w.id : newId("wb"),
      kind: "worldbook",
      text: pickText(w),
      ...(Array.isArray(w.tags) ? { tags: w.tags as string[] } : {}),
      createdAt: pickTime(w, now),
      updatedAt: pickUpdatedAt(w, pickTime(w, now)),
    } as MemoryRecord);

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
          ...(titleKey && pickTitle(it) ? { title: titleKey } : {}),
        },
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

  /* ── 定时类（提醒/任务）── */
  const schedules: ScheduleRecord[] = [];
  for (const r of old.reminders ?? [])
    schedules.push({
      id: typeof r.id === "string" ? r.id : newId("rem"),
      kind: "reminder",
      ...(pickTitle(r) ? { title: pickTitle(r) } : {}),
      text: pickText(r),
      nextAt: pickTime(r, now),
      ...(rest(r, ["id", "title", "name", "label", "text", "content", "body", "note", "summary", "at", "createdAt", "updatedAt", "time", "ts", "date"])
        ? { extra: rest(r, ["id", "title", "name", "label", "text", "content", "body", "note", "summary", "at", "createdAt", "updatedAt", "time", "ts", "date"]) }
        : {}),
    } as ScheduleRecord);
  for (const t of old.tasks ?? [])
    schedules.push({
      id: typeof t.id === "string" ? t.id : newId("task"),
      kind: "task",
      ...(pickTitle(t) ? { title: pickTitle(t) } : {}),
      text: pickText(t),
      nextAt: pickTime(t, now),
      ...(t.done === true ? { done: true } : {}),
      ...(rest(t, ["id", "title", "name", "label", "text", "content", "body", "note", "summary", "at", "createdAt", "updatedAt", "time", "ts", "date", "done"])
        ? { extra: rest(t, ["id", "title", "name", "label", "text", "content", "body", "note", "summary", "at", "createdAt", "updatedAt", "time", "ts", "date", "done"]) }
        : {}),
    } as ScheduleRecord);

  /* ── 统计 ── */
  const stats: StatRecord[] = [];
  for (const k of ["gameStats", "learnStats"] as const)
    stats.push({ key: k, value: old[k] ?? null, updatedAt: now });

  /* ── 运行记录（可丢，上限见 retention.ts）── */
  const logs: LogRecord[] = [];
  for (const a of old.actionLog ?? [])
    logs.push({ id: newId("log"), kind: "action", at: pickTime(a, now), payload: a });
  for (const r of old.requestLog ?? [])
    logs.push({ id: newId("log"), kind: "request", at: pickTime(r, now), payload: r });

  /* ── 那些"小而关键"的配置：全进 settings（含上游地址/密钥/模型）── */
  for (const k of ["model", "quota", "mcp", "httpTools", "chatDrafts", "activeId", "currentEmbedId", "customWords", "musicEmbeds", "stickerGroups", "stickers"] as const)
    if (old[k] !== undefined) settings[k] = old[k];

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
  plan.report = buildReport(old, plan);
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
    /** ⚠️ 隐藏对话（incognito）是**故意不搬**的 —— 对比时两边都要排除，否则假报警 */
    ["对话内容", (old.conversations ?? []).filter((c) => c.incognito !== true), back.conversations ?? []],
    ["消息内容", legacyMsgs, (back.conversations ?? []).flatMap((c: Loose) => (c.messages as Loose[]) ?? [])],
    ["记忆内容", old.memories ?? [], back.memories ?? []],
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
    case "对话内容":
      return { before: nonIncognito, after: back.conversations ?? [] };
    case "消息内容":
      return {
        before: nonIncognito.flatMap((c) => (c.messages as unknown[]) ?? []),
        after: (back.conversations ?? []).flatMap((c) => (c.messages as unknown[]) ?? []),
      };
    case "记忆内容":
      return { before: old.memories ?? [], after: back.memories ?? [] };
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
  const worldBook = plan.memories.filter((m) => m.kind === "worldbook").map((m) => ({
    id: m.id,
    text: m.text,
    ...(m.tags ? { tags: m.tags } : {}),
  }));
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
        o[w.keys?.text ?? "text"] = w.text;
        o[w.keys?.time ?? "at"] = w.at;
        return { ...o, ...(w.extra ?? {}) };
      });
  const emotions = plan.emotions.map((e) => ({
    id: e.id,
    kind: e.kind,
    at: e.at,
    ...(e.note ? { note: e.note } : {}),
  }));
  const reminders = plan.schedules
    .filter((s) => s.kind === "reminder")
    .map((s) => ({ id: s.id, text: s.text ?? "", ...(s.extra ?? {}), at: s.nextAt ?? 0 }));
  const tasks = plan.schedules
    .filter((s) => s.kind === "task")
    .map((s) => ({
      id: s.id,
      text: s.text ?? "",
      ...(s.done ? { done: true } : {}),
      ...(s.extra ?? {}),
      at: s.nextAt ?? 0,
    }));
  const first = <T,>(arr: T[]): T[] | undefined => (arr.length > 0 ? arr : undefined);
  return {
    ...out,
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
  };
}
