import { resolveAiName } from "@/lib/branding";
import { isNativeApp } from "@/lib/platform";
import { useApp } from "@/lib/store";
import { waitHydrated } from "@/lib/store-ready";
import {
  WAKE_KEYS,
  clearWakeConfig,
  clearWakePending,
  pushWakeConfig,
  readWakeConfig,
} from "@/lib/wake-bridge";
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

/**
 * **清空重来**（用户原话："你把他清空，重新来"）。
 *
 * 顺序不能反：先 `clear()` 把抽屉清空（醒来次数、`wake_log`、上次说话时间、
 * 静音标记、交给后台的那份配置 —— 全在同一个 SharedPreferences 里），
 * 再 `syncWakeContext()` **立刻交一份新的**过去；不然后台下次醒来看到的是空抽屉。
 *
 * 网页版没有抽屉 → `clearWakeConfig()` 会如实说"这台上没有抽屉"，
 * 这里就**不去假装**重新交过了（也不编一句"已清空并重新交给他"）。
 */
export async function resetWake(): Promise<WakeSyncResult> {
  const cleared = await clearWakeConfig();
  if (!cleared.ok) return { ok: false, message: cleared.message };

  const synced = await syncWakeContext();
  return {
    ok: synced.ok,
    message: synced.ok
      ? `已清空并重新交给他：${synced.message}`
      : `已清空，但重新交的时候有问题：${synced.message}`,
  };
}

/**
 * **读后台那份日志**（设置页"后台记录"那一小块用）。
 *
 * `wake_log` 是一段多行字符串，后台每次醒来往**最前面**插一行（带本地时间），
 * 所以最近的在最上面。只读展示 —— 用户手机上现在这一块是黑盒，看不到后台到底干了什么。
 *
 * 返回 `null` = 这台上根本没有抽屉（网页版）；返回 `[]` = 有抽屉但还没记录过。
 * ⚠️ 抽屉里的 key 被原生打码成「已设置」，日志里也从不写 key（`maskSecrets`）。
 */
export async function readWakeLog(limit = 6): Promise<string[] | null> {
  const cfg = await readWakeConfig();
  if (!cfg) return null;
  return String(cfg.wake_log ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

/**
 * **把后台那句"他自己说的"落进会话** —— 用户真机上缺的就是这一步。
 *
 * 原来的样子（用户原话）：
 *   "那个定时唤醒成功了。我能收到弹窗通知，但是那个通知**不在上下文里**……
 *    这样如果我想回他那句消息的话，进对话里的 AI 是不知道这回事的。"
 *
 * 为什么原来接不上：后台那段 JS（`public/runners/wake.js`）跑在 webview **外面**，
 * 它只能弹通知 + 往抽屉里写日志（还被截成 40 字）；而**会话存在 IndexedDB 里，只有 webview 会写**。
 * 现在后台在"他说了"那一刻把**完整那句话**写进抽屉（`markPending`），
 * 前台一到前台/被点通知就读出来、**走既有的"他主动说一条"那条路**（`beginScheduledReply`）
 * 落进当前会话，然后把交接键置空。
 *
 * ⚠️ **不另造一套消息写入**：用 `beginScheduledReply()` + `finalizeAssistant()`，
 *    跟 `task-daemon.tsx` 里定时任务说的是同一条路径（时间、`scheduled` 标记、气泡样式都一致）。
 * ⚠️ 网页版没有抽屉 → **什么都不做、也不报错**（`readWakeConfig` 返回 null）。
 */
export type WakeFlushResult = {
  /** 这一趟本身没出错（**不代表**一定有话要落） */
  ok: boolean;
  /** 真的落进会话了一条 */
  landed: boolean;
  /** 这条之前已经落过了（防重复挡下的） */
  already?: boolean;
  conversationId?: string;
  messageId?: string;
  /** 落进去的那句话 */
  text?: string;
  /** 他说话的时间（本地时间字符串，来自 `wake_pending_at`） */
  at?: string;
  /** 出问题时的原因（落库失败 / 抽屉没清干净） */
  message?: string;
};

/** 同一条在这一趟会话里只落一次 —— 见下面两道防线 */
let landedKey = "";
/** 正在落的那一趟（三个时机可能同时打过来，不能让同一句话插两遍） */
let flushing: Promise<WakeFlushResult> | null = null;

export function flushPendingWake(): Promise<WakeFlushResult> {
  if (!isNativeApp()) {
    return Promise.resolve({ ok: true, landed: false, message: "网页版没有抽屉 —— 跳过" });
  }
  if (flushing) return flushing;
  flushing = doFlushPendingWake().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function doFlushPendingWake(): Promise<WakeFlushResult> {
  try {
    const cfg = await readWakeConfig();
    /** null = 这台上根本没有抽屉（网页版），或者抽屉读不出来 —— 静默跳过 */
    if (!cfg) return { ok: true, landed: false, message: "这台上没有抽屉" };

    /**
     * ⚠️ 只读 `wake_pending_text`；**绝不回写 key**（抽屉插件把 `cfg_api_key` 打码成
     * 「已设置」，拿回来往别处写会把真 key 抹掉 —— `pingWake` 上面记着这个坑）。
     */
    const text = String(cfg[WAKE_KEYS.pendingText] ?? "").trim();
    if (!text) return { ok: true, landed: false };

    const stamp = String(cfg[WAKE_KEYS.pendingAt] ?? "").trim();
    const atMs = Number(String(cfg[WAKE_KEYS.pendingAtMs] ?? "").trim()) || 0;
    const key = `${atMs}|${text}`;

    /**
     * 防线 ②：同一条（同一时刻 + 同一句）只落一次。
     *
     * 两道都留着，管的是两件不同的事：
     *   · `landedKey`（内存）—— 三个时机（打开 / 回前台 / 点通知）**同时**打过来的竞态
     *   · `wake_pending_consumed_key`（抽屉）—— **跨一次重启/重载**也认得出
     *     "就是刚才那条"（内存那份会没，这条不会）
     */
    const consumedKey = String(cfg[WAKE_KEYS.pendingConsumedKey] ?? "").trim();
    if (key === landedKey || (consumedKey && key === consumedKey)) {
      await clearWakePending(stamp, key);
      return { ok: true, landed: false, already: true, message: "这条已经落过了，不重复插" };
    }

    /**
     * ⚠️ 必须等 store 从 IndexedDB 恢复完再写 —— 否则先写进内存、随后被恢复出来的旧快照
     * 整个覆盖，表现就是"通知点了、话却没进会话"（`store-ready.ts` 记着同一个坑）。
     *
     * ⚠️ `waitHydrated()` 有 4 秒兜底（它不能永远等着）—— 所以**恢复没完成就必须不写**：
     * 写进一个马上要被覆盖的 store，不但这条消息会没，抽屉里的交接键还会被清掉，
     * **那句话就永远丢了**。宁可这一趟不落，留给下一次时机（回前台 / 点通知 / 下次打开）。
     */
    await waitHydrated();
    if (!useApp.getState().hydrated) {
      return {
        ok: false,
        landed: false,
        message: "会话还在从本地恢复（这次没等完）—— 这句话先留在抽屉里，等下一次时机再落",
      };
    }

    /** **走既有的那条路**：跟他"主动说一条"完全一样（`scheduled` 标记也一并带上） */
    const started = useApp.getState().beginScheduledReply(text);
    /** 会话还没准备好（理论上不会）：**交接键留着**，下一次进前台再试 —— 不丢他这句话 */
    if (!started) return { ok: false, landed: false, message: "会话还没准备好，这句话先留在抽屉里" };
    useApp.getState().finalizeAssistant(started.conversationId, started.messageId, {
      content: text,
      thinking: "",
      thinkingDurationMs: 0,
      /**
       * 来源标记：这条路是**主动唤醒**（后台那段 JS 醒来找他），
       * 跟 `task-daemon.tsx` 的定时任务共用 `scheduled`，但界面上要分开说 ——
       * 带 `origin:"wake"` 才显示「他主动说的」（见 `chat-view.tsx`）。
       */
      origin: "wake",
      /** 时间用**他说话的那一刻**，不是"我收下它的那一刻"（不然时间对不上） */
      createdAt: atMs > 0 ? atMs : Date.now(),
    });
    landedKey = key;

    /**
     * 防线 ①（最主要的一道）：**落完立刻把交接键置空**。
     * 置空之后，下一次 flush 读到的就是空串 → 自然不会再插一遍。
     */
    const cleared = await clearWakePending(stamp, key);
    return {
      ok: true,
      landed: true,
      conversationId: started.conversationId,
      messageId: started.messageId,
      text,
      at: stamp,
      message: cleared ? "" : "话已经落进会话了，但抽屉里的交接键没清干净（下次可能重复）",
    };
  } catch (err) {
    /** 落库失败**不能吞**：交接键留着，下一次进前台再试一遍 */
    return { ok: false, landed: false, message: `落进会话时出错：${(err as Error).message}` };
  }
}

/**
 * 「他说了一句」那条通知的身份标记（跟 `public/runners/wake.js` 的 `WAKE_NOTIFY_ACTION` 对齐）。
 * 点通知时原生把它传回来，前台据此知道"该跳到那条消息"。
 */
export const WAKE_NOTIFY_ACTION = "qidao-wake-said";

/**
 * 点通知时原生传回来的东西。
 *
 * `source` 是**谁弹的那条通知**（两个原生通道分开），用来决定"要不要跳页"：
 *   · `"wake"`  —— 后台那段 JS 弹的（"他说了一句"就在这里）→ 落库 **+ 跳到那条**
 *   · `"local"` —— App 自己弹的（闹钟 / 定时任务）→ **只落库，不跳页**
 *     （用户点的是"该吃药了"，不该被甩到对话里去）
 */
export type WakeNotificationTap = {
  source: "wake" | "local";
  actionTypeId?: string;
  notificationId?: number;
};

/**
 * **接"通知被点了"那一下**（③ 点通知直达那条）。
 *
 * 两条路都接上，各管各的（都不是猜的，是读插件源码读出来的）：
 *
 *  ① `CapacitorBackgroundRunner` → `backgroundRunnerNotificationReceived`
 *     —— **就是后台那段 JS 弹的通知**（`wake.js` 里那个 `notify()`）。安卓侧插件在
 *     `handleOnNewIntent()` 里认 `.NOTIFICATION_CLICKED` 这个 intent，把 App 拉到前台，
 *     再 `notifyListeners(..., true)`（**保留着**，所以 JS 注册得晚一点也收得到）。
 *     ⚠️ 那个 intent 要能落到 `MainActivity`，靠 `AndroidManifest.xml` 里那条
 *     `.NOTIFICATION_CLICKED` 的 intent-filter（没有它，点通知根本进不来）。
 *  ② `LocalNotifications` → `localNotificationActionPerformed`
 *     —— App 自己弹的那些（闹钟 / 定时任务）被点时也顺手落一下，**只落库、不跳页**。
 *
 * 网页版没有这些事件 → 返回一个空的"取消订阅"函数，**什么都不做、也不报错**。
 */
export function watchWakeNotificationTap(cb: (tap: WakeNotificationTap) => void): () => void {
  const disposers: (() => void)[] = [];
  if (!isNativeApp()) return () => undefined;

  void (async () => {
    try {
      const mod = await import("@capacitor/background-runner");
      const handle = await mod.BackgroundRunner.addListener(
        "backgroundRunnerNotificationReceived",
        (e: { actionTypeId?: string; notificationId?: number } | undefined) =>
          cb({ source: "wake", actionTypeId: e?.actionTypeId, notificationId: e?.notificationId }),
      );
      disposers.push(() => void handle.remove());
    } catch {
      /* 这个包还没带上那个插件（或者事件名变了）→ 静默：还有"回到前台就落"那条路兜着 */
    }
  })();

  void (async () => {
    try {
      const mod = await import("@capacitor/local-notifications");
      const handle = await mod.LocalNotifications.addListener("localNotificationActionPerformed", () =>
        cb({ source: "local" }),
      );
      disposers.push(() => void handle.remove());
    } catch {
      /* 同上 */
    }
  })();

  return () => {
    for (const dispose of disposers) dispose();
    disposers.length = 0;
  };
}

/** 把上下文 POST 给 Worker（备路；失败只留一句话，不抛） */async function postToWorker(url: string, payload: unknown): Promise<string> {
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
