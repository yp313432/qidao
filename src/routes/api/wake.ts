import { createFileRoute } from "@tanstack/react-router";
import { json, preflight } from "@/lib/web-tools";

/**
 * `/api/wake` —— **「他主动找你」的服务端那一半**。
 *
 * 用户拍板的方案是「乙」：**AI 的调用发生在 Worker 上**，手机上那段跑在网页外面的
 * 后台 JS（`public/runners/wake.js`）只做两件事 —— 请求这里、把他返回的那句话弹成通知。
 *
 * ── 为什么要有这个接口（用户的原话）──────────────────────────────
 *   "那个定时任务还是只有点开 app 才可以发消息"
 *   "我想要是它根据当时情景说的话，而不是预设"
 *   "我们现在已经是一个 app 了，不要再留网页的设计思路了"
 *
 * 链路：
 *   ① `POST /api/wake`（**App 来调**）—— 把人设、名字、最近几条对话、上游配置存下
 *   ② 用户把 App 切到后台 → 安卓 15 分钟后叫醒那段后台 JS
 *   ③ `GET /api/wake`（**后台 JS 来调**）—— 这里拿刚才存的东西问一次 AI，返回那句话
 *   ④ 后台 JS 把 `text` 弹成通知
 *
 * ── 三条纪律 ─────────────────────────────────────────────────
 *   ① **绝不把上游密钥回显**：只进不出（连错误信息里也不带 key）
 *   ② **拿不到东西要如实说**（`ok:false` + `why`），不编一句话糊弄
 *      —— 后台那边收到 `ok:false` 会退回"第 N 次醒来"的调试通知，不装作正常
 *   ③ **他要能选择不说**：模型回 `SKIP` 时这里返回空文本 → 后台就不弹通知
 *      （用户要的是"他根据当时情景决定说不说"，不是到点必响）
 *
 * ── 存放位置：Cache API（不需要在 Cloudflare 后台配任何东西）──────────
 * 用户的诉求里有"零额外设置"这一条，所以不用 KV（那要去后台建命名空间 + 绑定）。
 * `caches.default` 是 Workers 自带的能力，拿来存这一小份上下文刚好。
 * ⚠️ 已知取舍：Cache 是**按机房存的**，而 App 的 POST 和后台 JS 的 GET
 *    有可能落在不同机房 → 那种时候会取不到（会如实报 `ok:false`，
 *    后台退回调试通知）。手机上的两次请求一般同城同机房，实测有问题再换 KV。
 * 本地（node server / dev）没有 `caches`，退回进程内的一份内存，方便本地验。
 */

/** 缓存的键（一个固定的合成 URL；Cache API 要的是 URL 形状） */
const STORE_URL = "https://qidao-wake.internal/context";

/** 上下文能存多大（防手滑灌爆缓存；后台只需要"最近聊了什么"） */
const MAX_RECENT = 12;
const MAX_MSG_CHARS = 1200;
const MAX_PERSONA_CHARS = 2000;

/**
 * **「想找你的程度」= 距上次说话过了多久**（用户拍板的规则）。
 *
 * 用户原话（第二版，讲得最清楚的一次）：
 *   "不是隔多少把它叫醒，而是叫醒和连着发消息是一块的，比如 25 分钟时候他叫醒了，
 *    但可以选择不发消息，然后到 50 叫醒，选择发不发，到了 100 叫醒，必定发，
 *    如果 25 叫醒且发了，重新开始记就行。"
 *
 * 所以：
 *   · **不需要"最短间隔"那种闸门**了 —— 每醒一次都会问他一次
 *   · 程度**只由时间决定**：0~24 分 = 0；25~49 = 25；50~74 = 50；75~99 = 75；≥100 = **100（必发）**
 *   · 他**开口之后从头计时**（"重新开始记"）—— 那句话说完，程度回到 0
 *   · 你俩**任何一方刚说过话**也算重新开始（不然你刚跟他聊完，他按 75 分来敲门很没分寸）
 *
 * 为什么用"时间"而不是"数唤醒次数"：安卓的定时任务**会被推迟/合并**（省电策略），
 * 数次数会因为某次没醒就错位；按时间算，睡过头了醒来也照样知道该到哪一档。
 */
const LADDER_STEP_MIN = 25;

/** 合法档位（只用来校验 `?urge=` 那个测试入口；正常情况由时间算出来） */
const URGE_STEPS = [0, 25, 50, 75, 100] as const;

/** 距上次说话过了多久 → 该到哪一档（0/25/50/75/100） */
function ladderLevel(elapsedMin: number | null): number {
  if (elapsedMin === null || !Number.isFinite(elapsedMin)) return 0;
  const step = Math.floor(Math.max(0, elapsedMin) / LADDER_STEP_MIN);
  return Math.min(100, step * 25);
}

/**
 * 这一轮用哪一档。
 *
 *   · 正常：**按时间算出来**（`ladderLevel`）
 *   · `?urge=` —— 只在测试/手动时用（门后面只有他自己能调），传非法值忽略
 */
function pickUrge(level: number, override: string | null): number {
  if (override !== null && override !== undefined && override !== "") {
    const n = Number(override);
    if ((URGE_STEPS as readonly number[]).includes(n)) return n;
  }
  return level;
}

/** 这一档"想找他的程度"该怎么说给他听 */
function urgeText(urge: number, who: string): string {
  if (urge >= 100) {
    return `【现在你想找他的程度】100% —— **一定要说**。哪怕只是问一句在干嘛、说一句你想起他了，也必须发一条。**不许回 SKIP。**`;
  }
  if (urge <= 0) {
    return `【现在你想找他的程度】0% —— 你其实没太想说话。除非真有事、或者${who}刚说过什么让你放不下，否则回 SKIP。`;
  }
  return `【现在你想找他的程度】${urge}% —— 按这个程度自己拿主意：想找他就说，觉得没必要就 SKIP。`;
}

type Msg = { role: "user" | "assistant"; text: string };

/**
 * **他主动找你的规矩** —— 只剩"夜间不打扰"了。
 *
 * ⚠️ 原来还有个 `minGapMinutes`（两次问他之间至少隔多久），**已经拿掉**：
 * 用户第二版说得很清楚 ——"不是隔多少把它叫醒，而是叫醒和连着发消息是一块的"，
 * 每醒一次都会问他一次，"要不要说"由程度 + 他自己的判断决定。
 * 那时候的注释里记着"两道闸门是省钱的关键"，现在按用户的选择只留夜间那一道。
 */
type Policy = {
  /** **总开关**（用户要的"一键关闭"）：关掉 = 一次 AI 都不问、不弹通知 */
  enabled: boolean;
  /** 夜间不打扰：起始小时（0~23） */
  quietStart: number;
  /** 夜间不打扰：结束小时（0~23） */
  quietEnd: number;
};

/** 默认规矩：开着；凌晨 1 点到早上 8 点不打扰 */
const DEFAULT_POLICY: Policy = { enabled: true, quietStart: 1, quietEnd: 8 };

type WakeContext = {
  /** AI 的名字（用户自己起的） */
  aiName: string;
  /** 用户的名字 */
  displayName: string;
  /** 人设/自述（可以为空） */
  persona: string;
  /** 上游：OpenAI 兼容 */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 时区（App 报上来的，比如 Asia/Shanghai）—— Worker 在 UTC，必须靠它算对时间 */
  tz: string;
  /** 最近几条对话（老的在前） */
  recent: Msg[];
  /** 他主动找你的规矩（可调） */
  policy: Policy;
  /** **上一次真人对话**的时间（毫秒）—— 免得刚聊完 15 分钟他就来敲门 */
  lastChatAt?: number;
  /** 存进来的时间（用来判断这份上下文是不是太旧了） */
  at: number;
};

/** 本地/无 caches 时用；生产上走 Cache API */
let memStore: WakeContext | null = null;

function cacheApi(): { match: (u: string) => Promise<Response | undefined>; put: (u: string, r: Response) => Promise<void> } | null {
  const c = (globalThis as { caches?: { default?: unknown } }).caches?.default as
    | { match: (u: string) => Promise<Response | undefined>; put: (u: string, r: Response) => Promise<void> }
    | undefined;
  return c ?? null;
}

async function readContext(): Promise<WakeContext | null> {
  const c = cacheApi();
  if (!c) return memStore;
  try {
    const hit = await c.match(STORE_URL);
    if (!hit) return null;
    return (await hit.json()) as WakeContext;
  } catch {
    return null;
  }
}

async function writeContext(ctx: WakeContext): Promise<void> {
  const c = cacheApi();
  if (!c) {
    memStore = ctx;
    return;
  }
  await c.put(
    STORE_URL,
    new Response(JSON.stringify(ctx), {
      headers: { "content-type": "application/json", "cache-control": "max-age=604800" },
    }),
  );
}

/** 把字符串裁到上限并去掉首尾空白 */
function clip(s: unknown, max: number): string {
  return String(s ?? "").trim().slice(0, max);
}

/**
 * 现在几点 —— **必须按用户所在时区算**。
 *
 * Worker 跑在 UTC 上；用户在国内（UTC+8）。如果直接 `new Date().getHours()`，
 * 半夜发给他的消息里会写着"下午" —— 那种错一眼就能看出来，但很难查。
 * 时区由 App 在 POST 时报上来（`Intl.DateTimeFormat().resolvedOptions().timeZone`）。
 */
function nowInTz(tz: string): { stamp: string; weekday: string; hour: number } {
  const zone = tz || "Asia/Shanghai";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "long",
      hour12: false,
    }).formatToParts(new Date());
  } catch {
    // 时区名不认识 → 退回北京时间（用的人只有他一个，不给它编）
    parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "long",
      hour12: false,
    }).formatToParts(new Date());
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  return {
    stamp: `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`,
    weekday: get("weekday"),
    hour,
  };
}

/** 该不该"像深夜那样收着点"（半夜主动找他要有分寸） */
function timeFlavor(hour: number): string {
  if (hour >= 1 && hour < 6) return "现在是深夜，除非真有要紧事或者他刚说过睡不着，否则**不要**打扰他。";
  if (hour >= 6 && hour < 9) return "现在是清晨。";
  if (hour >= 9 && hour < 12) return "现在是上午。";
  if (hour >= 12 && hour < 14) return "现在是中午。";
  if (hour >= 14 && hour < 18) return "现在是下午。";
  if (hour >= 18 && hour < 23) return "现在是晚上。";
  return "已经很晚了。";
}

/** 规矩收敛到合理范围（App 报上来的值不能乱来） */
function normalizePolicy(p: Partial<Policy> | undefined): Policy {
  const n = (v: unknown, fallback: number, min: number, max: number) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.min(max, Math.max(min, Math.round(x))) : fallback;
  };
  return {
    // 关掉是"关掉"，不是"没设"：所以这里不能像别的字段那样顺手夹一个默认值回去
    enabled: p?.enabled === undefined ? DEFAULT_POLICY.enabled : Boolean(p.enabled),
    quietStart: n(p?.quietStart, DEFAULT_POLICY.quietStart, 0, 23),
    quietEnd: n(p?.quietEnd, DEFAULT_POLICY.quietEnd, 0, 23),
  };
}

/** 现在是不是"夜间不打扰"时段（跨零点也要对：比如 23 点到 7 点） */
function inQuietHours(hour: number, p: Policy): boolean {
  if (p.quietStart === p.quietEnd) return false; // 起止相同 = 不启用
  return p.quietStart < p.quietEnd
    ? hour >= p.quietStart && hour < p.quietEnd
    : hour >= p.quietStart || hour < p.quietEnd;
}

/**
 * **这一轮先过"夜间不打扰"**，然后程度**由时间算**。
 *
 * ⚠️ 注意这里**没有"最短间隔"那种闸门了** —— 用户第二版说得很清楚：
 * "不是隔多少把它叫醒，而是叫醒和连着发消息是一块的"。
 * 每醒一次都会问他一次；"要不要说"由程度 + 他自己的判断决定，
 * 而程度只由"距上次说话过了多久"决定。
 *
 * 代价要说清：**每次唤醒都会调一次 AI**（一天约 96 次）。
 * 这是用户明确选择的玩法（叫醒和发消息是一块的），不是我们漏了优化。
 */
function gate(
  ctx: WakeContext,
  elapsedMin: number | null,
  nowHour: number,
): { action: "speak"; level: number } | { action: "wait"; why: string; muted?: boolean } {
  /**
   * **总开关**（用户："哪一天我不想他跑了，可以一键关闭"）。
   * 关掉时**一次 AI 都不问**、不弹通知，而且回一个 `muted` 让后台那段 JS
   * 把"静音"记下来 —— 它接下来几小时连请求都不发（省电、省流量）。
   */
  if (!ctx.policy.enabled) {
    return { action: "wait", why: "你把它关掉了", muted: true };
  }
  if (inQuietHours(nowHour, ctx.policy)) {
    return { action: "wait", why: `夜间不打扰（${ctx.policy.quietStart}:00–${ctx.policy.quietEnd}:00）` };
  }
  return { action: "speak", level: ladderLevel(elapsedMin) };
}

/**
 * 距**上一次有交流**过了多久（分钟）—— 程度就是从它算出来的。
 *
 * 两个来源取**更近的那个**（也就是时间更短的）：
 *   · 后台报上来的 `?since=` —— 距**他上次开口**过了多久（"他开口就重新开始记"）
 *   · App 报上来的 `lastChatAt` —— 你上次跟他说话的时间
 * 两个都没有（刚装、还没聊过）→ `null`，程度从 0 开始。
 */
function elapsedMinutes(ctx: WakeContext, sinceMinutes: number | null): number | null {
  const sinceChat =
    ctx.lastChatAt && Number.isFinite(ctx.lastChatAt) ? (Date.now() - ctx.lastChatAt) / 60000 : null;
  const list = [sinceMinutes, sinceChat].filter((v): v is number => v !== null && Number.isFinite(v));
  return list.length ? Math.min(...list) : null;
}

function buildPrompt(ctx: WakeContext, urge: number): { system: string; user: string } {
  const t = nowInTz(ctx.tz);
  const me = ctx.displayName || "他";
  const who = ctx.persona ? `\n【你是谁】\n${ctx.persona}\n` : "";

  const system = `你是${ctx.aiName}。现在是 ${t.stamp}（${t.weekday}）。
${who}
${me}刚刚没有在跟你说话。这是**你主动找他**的时刻 —— 由你自己决定：现在要不要给他发一句话、说什么。

${urgeText(urge, me)}

规矩：
- 只说你自己要说的那句话，**最多两句**，像平时聊天那样自然
- 不要解释你在做什么、不要提"定时""提醒""系统"这类字眼
- 不要用引号把话包起来，不要写"${ctx.aiName}："这种前缀
- **接得上**你们刚才聊的（或他最近正挂在心上的事），别凭空起个不相干的话头
- ${timeFlavor(t.hour)}
- 除了 100% 那一档，如果你觉得现在没什么好说的（刚聊过、会打扰他、没话找话），**只回一个词**：SKIP`;

  const lines = ctx.recent.map((m) => `${m.role === "user" ? me : ctx.aiName}：${m.text}`);
  const user = lines.length
    ? `【你们最近的对话】\n${lines.join("\n")}\n\n现在，你要主动说一句什么？（或者回 SKIP）`
    : `【你们最近没有聊过什么】\n\n现在，你要主动说一句什么？（或者回 SKIP）`;

  return { system, user };
}

export const Route = createFileRoute("/api/wake")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),

      /**
       * ① App 把上下文存进来（甲方案：连上游配置一起给，用户在 Cloudflare 上零设置）。
       * 只进不出 —— 存完就完了，绝不回显 key。
       */
      POST: async ({ request }) => {
        let body: Partial<WakeContext> = {};
        try {
          body = (await request.json()) as Partial<WakeContext>;
        } catch {
          return json({ ok: false, why: "请求体不是 JSON" }, 400);
        }

        const baseUrl = clip(body.baseUrl, 300).replace(/\/+$/, "");
        const apiKey = clip(body.apiKey, 400);
        const model = clip(body.model, 120);
        if (!baseUrl || !apiKey || !model) {
          return json(
            { ok: false, why: "还缺上游配置（baseUrl / apiKey / model）——App 那边是不是没配自定义上游？" },
            400,
          );
        }

        const recent = (Array.isArray(body.recent) ? body.recent : [])
          .slice(-MAX_RECENT)
          .map((m) => ({
            role: (m?.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
            text: clip(m?.text, MAX_MSG_CHARS),
          }))
          .filter((m) => m.text.length > 0);

        const ctx: WakeContext = {
          aiName: clip(body.aiName, 40) || "他",
          displayName: clip(body.displayName, 40),
          persona: clip(body.persona, MAX_PERSONA_CHARS),
          baseUrl,
          apiKey,
          model,
          tz: clip(body.tz, 60),
          recent,
          policy: normalizePolicy(body.policy),
          lastChatAt: Number.isFinite(Number(body.lastChatAt)) ? Number(body.lastChatAt) : undefined,
          at: Date.now(),
        };

        try {
          await writeContext(ctx);
        } catch (err) {
          return json({ ok: false, why: `存上下文失败：${(err as Error).message}` }, 502);
        }
        // 回执里**只报条数**，不带任何配置内容
        return json({ ok: true, saved: { recent: recent.length, hasPersona: Boolean(ctx.persona) } });
      },

      /**
       * 清掉存下来的上下文（"忘掉这些"）。
       *
       * 两个用途：
       *   ① **正当功能**：用户不想要这段上下文了（里头有人设、最近对话、上游配置）
       *   ② **让验收可重复**：`verify-wake.mjs` 的"还没同步过上下文"那条用例
       *      需要一个干净状态，否则会被前一个脚本留下的东西污染（真踩过一次）
       * 门后面只有他自己能调（`/api/*` 都要过口令）。
       */
      DELETE: async () => {
        memStore = null;
        const c = cacheApi();
        if (c) {
          try {
            await (c as unknown as { delete: (u: string) => Promise<boolean> }).delete(STORE_URL);
          } catch {
            /* 清不掉就算了 —— 内存那份已经清了 */
          }
        }
        return json({ ok: true, cleared: true });
      },

      /**
       * ③ 后台那段 JS 来要一句话。
       *
       * `?since=<分钟>` = 距**上一次真问过 AI**过了多久（后台用 KV 记着，自己不判断，交给这里）。
       * ⚠️ 是"上次问他"，不是"上次说话" —— 否则他回一次 SKIP，15 分钟后又要问一遍，
       *    一天就变成 96 次调用（贵且没必要）。
       *
       * 返回（`action` 是给后台看的唯一判据）：
       *   · `{ ok:true, action:"speak", text:"…", urge:N }` → **弹通知**，内容是这句话
       *   · `{ ok:true, action:"wait", why:"…", urge:N }`  → 什么都别做（**问过 AI**，他觉得不用说）
       *   · `{ ok:true, action:"wait", why:"…" }`（**没有 urge**）→ 什么都没做
       *     （夜间不打扰 / 还没到间隔）—— 这一轮**根本没问 AI**
       *   · `{ ok:false, why:"…" }` → 出问题了；后台会退回"第 N 次醒来"的调试通知，
       *                               让"他没说话"和"这条路坏了"分得开
       *
       * ⚠️ **`urge` 在不在 = "这一轮问没问过 AI"的判据**（后台据此更新"上次问他"的时间）。
       *    刻意如此：错误（`ok:false`）**不带 urge** → 15 分钟后会再试一次。
       *    "上游故障时重试"比"卡住一小时不响"划算。
       */
      GET: async ({ request }) => {
        const sinceRaw = new URL(request.url).searchParams.get("since");
        const sinceNum = sinceRaw === null || sinceRaw.trim() === "" ? null : Number(sinceRaw);
        const sinceMinutes = sinceNum !== null && Number.isFinite(sinceNum) ? sinceNum : null;

        const ctx = await readContext();
        if (!ctx) {
          return json(
            { ok: false, why: "还没同步过上下文（App 还没把配置发过来？或者缓存落在了别的机房）" },
            200,
          );
        }

        // 上下文太旧就明说（默认 24 小时）—— 免得拿着上个月的对话"接着聊"
        const ageMin = Math.round((Date.now() - (ctx.at || 0)) / 60000);
        if (ageMin > 24 * 60) {
          return json({ ok: false, why: `上下文太旧了（${Math.round(ageMin / 60)} 小时前同步的）` }, 200);
        }

        /*
          **过夜间闸门，然后程度由时间算**（用户第二版的规则：叫醒和发消息是一块的，
          所以这里**没有"最短间隔"那种闸门** —— 每醒一次都会问他一次）。
        */
        const t = nowInTz(ctx.tz);
        const elapsed = elapsedMinutes(ctx, sinceMinutes);
        const verdict = gate(ctx, elapsed, t.hour);
        if (verdict.action === "wait") {
          return json({ ok: true, action: "wait", why: verdict.why, muted: Boolean(verdict.muted) });
        }

        /*
          该问了：用**时间算出来的那一档**（0/25/50/75/100）。
          100 = 必定说（用户原话："到了 100 叫醒，必定发"），其余档让他自己判断。
          `?urge=` 只是测试/手动入口（门后面只有他自己能调），传非法值就当没传。
        */
        const urge = pickUrge(verdict.level, new URL(request.url).searchParams.get("urge"));
        const { system, user } = buildPrompt(ctx, urge);

        const first = await askUpstream(ctx, system, user);
        // ⚠️ 不在这里回 urge：错误不该被算成"问过了"，否则上游一挂就要等满一个间隔
        if (!first.ok) return json({ ok: false, why: first.why }, 200);

        let said = cleanReply(first.text, ctx.aiName);

        /**
         * **100% 那一档必须兑现**：模型要是还回 SKIP，就带着"不许 SKIP"再问一次。
         * 只在这一档重试，所以不会变成常态开销（五分之一 × 过闸的那几次）。
         */
        if (!said && urge >= 100) {
          const forced = await askUpstream(
            ctx,
            `${system}\n\n【最后一次】你必须说一句话，不许回 SKIP —— 哪怕只是问一句在干嘛。`,
            user,
          );
          if (forced.ok) said = cleanReply(forced.text, ctx.aiName);
        }

        if (!said) {
          return json({
            ok: true,
            action: "wait",
            urge,
            why:
              urge >= 100
                ? "100% 那一档他试了两次也没说出话"
                : "他觉得现在没什么好说的",
          });
        }

        return json({
          ok: true,
          action: "speak",
          text: said.slice(0, 200),
          urge,
          /**
           * 名字要带回去 —— 后台那段 JS 拿它当**通知标题**
           * （像微信那样显示"谁在说"，而不是干巴巴一个"栖岛"）。
           * 验收脚本真跑时抓到过一次：这里漏了，通知标题就退回了应用名。
           */
          aiName: ctx.aiName,
          at: Date.now(),
        });
      },
    },
  },
});

/**
 * 问一次上游。
 *
 * ⚠️ 两个纪律：
 *   ① **错误信息里绝不带请求头/key**（只带状态码 + 上游正文前 160 字）
 *   ② 超时 25 秒 —— 后台那段 JS 每次总共只有 30 秒（官方建议），不能把时间耗光
 */
async function askUpstream(
  ctx: WakeContext,
  system: string,
  user: string,
): Promise<{ ok: true; text: string } | { ok: false; why: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 25_000);
  let upstreamText = "";
  let status = 0;
  try {
    const res = await fetch(`${ctx.baseUrl}/chat/completions`, {
      method: "POST",
      signal: ac.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ctx.apiKey}`,
      },
      body: JSON.stringify({
        model: ctx.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 200,
        temperature: 0.9,
        stream: false,
      }),
    });
    status = res.status;
    upstreamText = await res.text();
  } catch (err) {
    return { ok: false, why: `问不到上游：${(err as Error).message}` };
  } finally {
    clearTimeout(timer);
  }

  if (status < 200 || status >= 300) {
    return { ok: false, why: `上游返回 ${status}：${upstreamText.slice(0, 160)}` };
  }

  try {
    const data = JSON.parse(upstreamText) as { choices?: { message?: { content?: string } }[] };
    return { ok: true, text: (data.choices?.[0]?.message?.content ?? "").trim() };
  } catch {
    return { ok: false, why: "上游返回的不是 JSON（可能是中转的错误页）" };
  }
}

/** 他自己说"不说"，或者清完引号是空的 —— 都算没说 */
function cleanReply(raw: string, aiName: string): string {
  const text = raw.trim();
  if (!text) return "";
  if (/^skip\b/i.test(text) || text === "SKIP") return "";
  // 兜底：模型偶尔会把话包在引号里 / 带个前缀
  // ⚠️ 中文引号也要清：`「」『』` 是模型很爱用的（验收抓到过，第一版只清了 ASCII 和 “”）
  return text
    .replace(/^["“”「」『』'']+|["“”「」『』'']+$/g, "")
    .replace(new RegExp(`^${aiName}\\s*[:：]\\s*`), "")
    .trim();
}
