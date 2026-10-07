import { resolveAiName } from "@/lib/branding";
import { useApp } from "@/lib/store";

/**
 * **「主动找你」的 App 侧** —— 把上下文和规矩同步给 Worker，并提供一个通道自检。
 *
 * 用户拍板的方案是「乙」：**AI 的调用发生在 Worker 上**，手机上那段跑在网页外面的
 * 后台 JS（`public/runners/wake.js`）只负责请求 Worker、把他返回的那句话弹成通知。
 *
 * 这个文件做两件事：
 *   ① **同步**：把人设/名字/最近对话/上游配置/两个规矩 POST 给 `/api/wake`
 *      （甲方案：连 key 一起给 —— 用户在 Cloudflare 上零设置）
 *   ② **自检**：GET 一下，看这条路通不通（地址对不对、口令对不对、Worker 部署了没）
 *
 * ⚠️ **绝对不要在这里调插件的 `dispatchEvent`** —— 那个方法在安卓侧用 `runBlocking`
 * 挡住主线程、再无限期等后台 JS 回调，会**让整个 App 卡死**（真机踩过：
 * "一直写着正在叫他，然后卡住不动了"）。要验通道就老老实实 fetch Worker。
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
  const url = wakeUrl();
  if (!url) {
    return { ok: false, message: "还没配地址（打包时没注入，App 里也没手填）——「主动找你」现在是关着的。" };
  }

  const s = useApp.getState().settings;
  const baseUrl = (s.customBaseUrl ?? "").trim().replace(/\/+$/, "");
  const apiKey = (s.customApiKey ?? "").trim();
  const model = (s.upstreamModel ?? "").trim();

  /**
   * ⚠️ 手机版必须用自己的上游（网页版那个服务端内置上游在 APK 里不存在）。
   * 缺哪样就如实说缺哪样 —— 别同步一份跑不起来的配置过去，
   * 那样后台每 15 分钟都会失败一次，还看不出去哪儿查。
   */
  if (!baseUrl || !apiKey) {
    return { ok: false, message: "还没配自定义上游（地址 + 密钥）——「主动找你」需要它才能问 AI。" };
  }
  if (!model) {
    return { ok: false, message: "还没填模型名（「我的 → 自定义上游」里的模型）—— 后台不知道用哪个模型。" };
  }

  const payload = {
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
  };

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
      return {
        ok: false,
        message: `同步失败（HTTP ${res.status}）：${data?.why ?? text.slice(0, 120)}`,
      };
    }
    return { ok: true, message: `同步好了（带上了最近 ${data.saved?.recent ?? 0} 条对话）。` };
  } catch (err) {
    return { ok: false, message: `连不上 Worker：${(err as Error).message}` };
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
  const url = wakeUrl();
  if (!url) {
    return { ok: false, message: "还没配地址（打包时没注入，App 里也没手填）。" };
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
