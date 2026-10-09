import { resolveAiName } from "@/lib/branding";
import { useApp } from "@/lib/store";
import { WAKE_KEYS, pushWakeConfig, readWakeConfig } from "@/lib/wake-bridge";
import { buildAllWakePrompts, wakePromptInput } from "@/lib/wake-prompt";

/**
 * **「主动找你」的 App 侧** —— 两条路都在这儿（哪条能用用哪条）：
 *
 *   ① **抽屉（甲，主路）**：把人设/最近对话/上游配置/**五段指令**写进原生抽屉
 *      （`lib/wake-bridge.ts`）。后台那段 JS 醒来时自己读，**直接问你的 AI** ——
 *      国内上游不用梯、不用域名、不用 Worker。
 *   ② **Worker（乙，备路）**：把上下文 POST 给 `/api/wake`。
 *      只有配了地址才有意义（worker 域名被污染时需要梯，所以现在默认不用）。
 *
 * ⚠️ **绝对不要在这里调插件的 `dispatchEvent`** —— 那个方法在安卓侧用 `runBlocking`
 * 挡住主线程、再无限期等后台 JS 回调，会**让整个 App 卡死**（真机踩过：
 * "一直写着正在叫他，然后卡住不动了"）。要递东西就用那个抽屉。
 */

/** 后台那段 JS 需要的地址：优先用 App 里手填的，其次用打包时注入的 */
export function wakeUrl(): string {
  const manual = (useApp.getState().settings.wakeUrl ?? "").trim();
  if (manual) return manual;
  const injected = String(import.meta.env.VITE_QIDAO_WAKE_URL ?? "").trim();
  return injected;
}

/** 地址是从哪儿来的（界面上要说清，免得"我明明填了/明明没填"互相怀疑） */
export function wakeUrlSource(): "manual" | "build" | "none" {
  if ((useApp.getState().settings.wakeUrl ?? "").trim()) return "manual";
  if (String(import.meta.env.VITE_QIDAO_WAKE_URL ?? "").trim()) return "build";
  return "none";
}

export type WakeSyncResult = { ok: boolean; message: string };

/** 最近几条对话（老的在前）—— 只取有内容的，最多 12 条 */
function recentMessages(): { role: "user" | "assistant"; text: string }[] {
  const st = useApp.getState();
  const conv = st.conversations.find((c) => c.id === st.activeId);
  if (!conv) return [];
  return conv.messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
    .slice(-12)
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      text: m.content.trim().slice(0, 1200),
    }));
}

/** 上一次真人说话/他回话的时间 —— 让 Worker 判断"刚聊完就别来敲门" */
function lastChatAt(): number | undefined {
  const st = useApp.getState();
  const conv = st.conversations.find((c) => c.id === st.activeId);
  const last = conv?.messages.filter((m) => m.content.trim()).at(-1);
  return last?.createdAt;
}

/** Worker 那边两个接口的返回形状 */
type SyncReply = { ok?: boolean; why?: string; saved?: { recent?: number } };
type PingReply = {
  ok?: boolean;
  action?: string;
  why?: string;
  text?: string;
  urge?: number;
};

/**
 * 把人设、最近对话、上游配置、两个规矩同步给 Worker。
 *
 * ⚠️ **这条路不影响聊天**：失败就当没发生（不弹错、不阻塞）。
 * 真要排查，用下面的"通道自检"按钮 —— 那才把原因说出来。
 */
export async function syncWakeContext(): Promise<WakeSyncResult> {
  const s = useApp.getState().settings;
  const baseUrl = (s.customBaseUrl ?? "").trim().replace(/\/+$/, "");
  const apiKey = (s.customApiKey ?? "").trim();
  const model = (s.upstreamModel ?? "").trim();
  const notes: string[] = [];

  /* ── ① 抽屉（甲，主路）：后台醒来直接问你的 AI —— 不用梯、不用域名、不用 Worker ── */
  if (!baseUrl || !apiKey) {
    notes.push("还没配自定义上游（地址 + 密钥）—— 他没法问 AI");
  } else if (!model) {
    notes.push("还没填模型名（「我的 → 自定义上游」）");
  } else {
    const input = wakePromptInput();
    const prompts = buildAllWakePrompts(input);
    const data: Record<string, string> = {
      [WAKE_KEYS.baseUrl]: baseUrl,
      [WAKE_KEYS.apiKey]: apiKey,
      [WAKE_KEYS.model]: model,
      [WAKE_KEYS.aiName]: input.aiName,
      [WAKE_KEYS.enabled]: (s.wakeEnabled ?? true) ? "1" : "0",
      [WAKE_KEYS.quietStart]: String(s.wakeQuietStart ?? 1),
      [WAKE_KEYS.quietEnd]: String(s.wakeQuietEnd ?? 8),
      [WAKE_KEYS.promptNormal]: prompts.normal,
      [WAKE_KEYS.promptForce]: prompts.force,
    };

    const pushed = await pushWakeConfig(data);
    notes.push(
      pushed
        ? `已交给他（两段指令 + 最近 ${input.recent.length} 条对话）`
        : "这台上交不进去（网页版没有后台；或者这个包还没带上那个抽屉插件）",
    );
  }

  /* ── ② Worker（乙，备路）：只有配了地址才推（域名被污染时需要梯，所以现在默认不用）── */
  const url = wakeUrl();
  if (url && baseUrl && apiKey && model) {
    notes.push(
      (await postToWorker(url, {
        aiName: resolveAiName(s.aiName),
        displayName: s.displayName,
        persona: s.persona ?? "",
        baseUrl,
        apiKey,
        model,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
        recent: recentMessages(),
        policy: {
          enabled: s.wakeEnabled ?? true,
          quietStart: s.wakeQuietStart ?? 1,
          quietEnd: s.wakeQuietEnd ?? 8,
        },
        lastChatAt: lastChatAt(),
      })) ?? "",
    );
  }

  return { ok: !notes.some((n) => /还没|交不进去/.test(n)), message: notes.filter(Boolean).join("；") };
}

/** 把上下文 POST 给 Worker（备路；失败只留一句话，不抛） */
async function postToWorker(url: string, payload: unknown): Promise<string> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data: SyncReply | null = null;
    try {
      data = JSON.parse(text) as SyncReply;
    } catch {
      data = null;
    }
    if (!res.ok || !data?.ok) {
      return `Worker 那条没推上（HTTP ${res.status}）：${data?.why ?? text.slice(0, 80)}`;
    }
    return `Worker 那条也推上了（最近 ${data.saved?.recent ?? 0} 条）`;
  } catch (err) {
    return `Worker 那条连不上：${(err as Error).message}`;
  }
}

/**
 * **通道自检**：不改任何状态，只问一句"这条路通不通"。
 *
 * 为什么要有它：一次真机验证要等 15 分钟，而失败可能是
 * "地址错 / 口令错 / Worker 没部署 / 上游没配"四种之一。
 * 点一下就能把前三种分开 —— 剩下那种（上游）Worker 会明说。
 */
export async function pingWake(): Promise<WakeSyncResult> {
  const s = useApp.getState().settings;
  /**
   * ⚠️ **必须用 App 里这份真 key，不能用抽屉里读回来的那份**（踩过）：
   * 抽屉插件的 `get()` 出于安全把 key 打码成中文「已设置」（`WakeBridgePlugin.java:79`），
   * 拿它去拼 `Bearer` 会直接抛
   *   `Failed to read the 'headers' property from 'RequestInit': String contains non ISO-8859-1 code point`
   * —— 用户真机上看到的就是这条（而且它长得像"网络问题"，很有误导性）。
   * 所以：**抽屉只用来判断"后台到底拿到配置没有"**，真正的 key/地址/模型从设置里取。
   */
  const baseUrl = (s.customBaseUrl ?? "").trim().replace(/\/+$/, "");
  const apiKey = (s.customApiKey ?? "").trim();
  const model = (s.upstreamModel ?? "").trim();
  const cfg = await readWakeConfig();
  const pushedToBackground = Boolean(cfg && cfg[WAKE_KEYS.baseUrl] && cfg[WAKE_KEYS.apiKey]);

  if (baseUrl && apiKey && model) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "只回两个字：在的" }],
          max_tokens: 20,
          stream: false,
        }),
      });
      const ms = Date.now() - t0;
      const text = await res.text();
      if (!res.ok) {
        return { ok: false, message: `你的上游回了 HTTP ${res.status}（${ms}ms）：${text.slice(0, 120)}` };
      }
      let said = "";
      try {
        said = (JSON.parse(text) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message
          ?.content ?? "";
      } catch {
        /* 不是 JSON 也照样算通 */
      }
      return {
        ok: true,
        message:
          `这条是通的 ✅ 你的上游 ${ms}ms 就回了${said ? `「${said.trim().slice(0, 20)}」` : ""}。他已经能问到他了。` +
          (pushedToBackground
            ? "（后台也已经拿到同一份配置。）"
            : "⚠️ 但这台还没把配置交给后台 —— 打开一次 App、切到后台才算交上去。"),
      };
    } catch (err) {
      /**
       * ⚠️ 这里不要写死"地址或网络的问题" —— 用户真机上那条报错其实是
       * **header 里塞了非 ISO-8859-1 字符**（我们把打码后的中文 key 当 key 用了），
       * 长得却像网络故障。所以：**把原始原因原样带出来**，别替他下结论。
       */
      return { ok: false, message: `连不上你的上游：${(err as Error).message}` };
    }
  }

  /* 抽屉里没有 / 设置不全 → 退回"Worker 那条路"的自检（配了地址才有意义） */
  const url = wakeUrl();
  if (!url) {
    return {
      ok: false,
      message: "还没交给他任何配置（要在「自定义上游」里填好地址 + 密钥 + 模型；装成 App 之后我会自动交过去）。",
    };
  }

  const full = url + (url.includes("?") ? "&" : "?") + "since=";
  try {
    const res = await fetch(full, { headers: { Accept: "application/json" } });
    const text = await res.text();
    let data: PingReply | null = null;
    try {
      data = JSON.parse(text) as PingReply;
    } catch {
      data = null;
    }

    /** 口令不对时 Worker 会回 401 JSON（或那张登录页）—— 这是最常见的坑，单独说清 */
    if (res.status === 401) {
      return { ok: false, message: "口令不对（Worker 说 unauthorized）—— 检查地址里 pass= 后面那串。" };
    }
    if (!data) {
      return {
        ok: false,
        message: `拿回来的不是 JSON（HTTP ${res.status}）：${text.slice(0, 100)}—— 多半是地址写错了。`,
      };
    }

    if (data.ok === false) {
      return { ok: true, message: `通道通了 ✅ 但它还没法说话：${data.why ?? "未知原因"}` };
    }
    if (data.action === "speak" && data.text) {
      return { ok: true, message: `通道全通 ✅ 他这会儿想说的是：「${data.text}」（想找你的程度 ${data.urge}%）` };
    }
    return { ok: true, message: `通道通了 ✅ 他现在选择不说：${data.why ?? "（夜间或还没到间隔）"}` };
  } catch (err) {
    return { ok: false, message: `连不上：${(err as Error).message}` };
  }
}
