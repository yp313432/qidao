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

type Msg = { role: "user" | "assistant"; text: string };

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

function buildPrompt(ctx: WakeContext): { system: string; user: string } {
  const t = nowInTz(ctx.tz);
  const me = ctx.displayName || "他";
  const who = ctx.persona ? `\n【你是谁】\n${ctx.persona}\n` : "";

  const system = `你是${ctx.aiName}。现在是 ${t.stamp}（${t.weekday}）。
${who}
${me}刚刚没有在跟你说话。这是**你主动找他**的时刻 —— 由你自己决定：现在要不要给他发一句话、说什么。

规矩：
- 只说你自己要说的那句话，**最多两句**，像平时聊天那样自然
- 不要解释你在做什么、不要提"定时""提醒""系统"这类字眼
- 不要用引号把话包起来，不要写"${ctx.aiName}："这种前缀
- **接得上**你们刚才聊的（或他最近正挂在心上的事），别凭空起个不相干的话头
- ${timeFlavor(t.hour)}
- 如果你觉得现在没什么好说的（刚聊过、会打扰他、没话找话），**只回一个词**：SKIP`;

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
       * ③ 后台那段 JS 来要一句话。
       *
       * 返回：
       *   · `{ ok:true, text:"…" }`  → 弹通知
       *   · `{ ok:true, text:"" }`   → 他觉得没什么可说的（模型回了 SKIP），**不弹**
       *   · `{ ok:false, why:"…" }`  → 出问题了；后台会退回"第 N 次醒来"的调试通知，
       *                                让"他没说话"和"这条路坏了"分得开
       */
      GET: async () => {
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

        const { system, user } = buildPrompt(ctx);

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
          return json({ ok: false, why: `问不到上游：${(err as Error).message}` }, 200);
        } finally {
          clearTimeout(timer);
        }

        if (status < 200 || status >= 300) {
          // ⚠️ 只带状态码 + 上游正文前 160 字，**绝不带请求头/key**
          return json({ ok: false, why: `上游返回 ${status}：${upstreamText.slice(0, 160)}` }, 200);
        }

        let text = "";
        try {
          const data = JSON.parse(upstreamText) as {
            choices?: { message?: { content?: string } }[];
          };
          text = (data.choices?.[0]?.message?.content ?? "").trim();
        } catch {
          return json({ ok: false, why: "上游返回的不是 JSON（可能是中转的错误页）" }, 200);
        }

        if (!text) return json({ ok: false, why: "上游返回了空内容" }, 200);

        // 他自己决定"现在不说"
        if (/^skip\b/i.test(text) || text === "SKIP") {
          return json({ ok: true, text: "", skipped: true });
        }

        // 兜底：模型偶尔会把话包在引号里 / 带个前缀，清一下（不改变原意，只是别让通知里出现引号）
        // ⚠️ 中文引号也要清：`「」『』` 是模型很爱用的（实测第一版只清了 ASCII 和 “”，漏了「」）
        const cleaned = text
          .replace(/^["“”「」『』'']+|["“”「」『』'']+$/g, "")
          .replace(new RegExp(`^${ctx.aiName}\\s*[:：]\\s*`), "")
          .trim();

        return json({ ok: true, text: cleaned.slice(0, 200), at: Date.now() });
      },
    },
  },
});
