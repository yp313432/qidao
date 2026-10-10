import { registerPlugin } from "@capacitor/core";
import { isNativeApp } from "@/lib/platform";

/**
 * **「配置抽屉」的 JS 侧** —— 跟 `android/app/src/main/java/.../WakeBridgePlugin.java` 配对。
 *
 * 为什么需要它（用户问过："不是 app 问哎吗"）：
 *   **问 AI 的是后台那段 JS**（系统叫醒它，App 关着也在）。
 *   但安卓不允许"网页那边"直接往"后台那段 JS 的存储"里写东西 —— 所以要这个抽屉：
 *   前台把东西放进去，后台醒来自己拿。
 *
 * ⚠️ 抽屉的名字（`com.yanping.qidao.wake`）在两边都要对：
 *   · Java 那边：`WakeBridgePlugin.PREFS`
 *   · 后台那边：`capacitor.config.ts` 的 `plugins.BackgroundRunner.label`
 *   写错一个字母两边就谁也见不到谁，而且**不报错**（契约脚本盯着这条）。
 *
 * ⚠️ **不要用插件的 `dispatchEvent` 代替它** —— 那个方法在安卓侧挡主线程再无限期等回调，
 * 会让**整个 App 卡死**（真机踩过："一直写着正在叫他，然后卡住不动了"）。
 */

type WakeBridgeApi = {
  put: (o: { data: Record<string, string> }) => Promise<{ ok?: boolean }>;
  get: () => Promise<Record<string, string>>;
  clear: () => Promise<{ ok?: boolean }>;
};

const WakeBridge = registerPlugin<WakeBridgeApi>("WakeBridge");

/** 抽屉里那批键的名字（后台那段 JS 按同样的键去读） */
export const WAKE_KEYS = {
  baseUrl: "cfg_base_url",
  apiKey: "cfg_api_key",
  model: "cfg_model",
  aiName: "cfg_ai_name",
  enabled: "cfg_enabled",
  quietStart: "cfg_quiet_start",
  quietEnd: "cfg_quiet_end",
  /**
   * 两段指令（用户最后定的规矩：叫不叫他 50%、说不说 50%、没中就下次必定）：
   *   · `normal` —— 平时那段：允许他回 SKIP
   *   · `force`  —— "上次没说 → 这次必定说"那段：不许 SKIP
   */
  promptNormal: "cfg_prompt_normal",
  promptForce: "cfg_prompt_force",
  /**
   * ── 主动说话的三个新旋钮（2026-11）────────────────────────────
   *   · `busyUntil` —— 他说了「我在忙」到什么时候（毫秒时间戳，0 = 不忙）。
   *     由用户在设置页那个按钮写；后台醒来先看它，命中就**彻底不打扰**。
   *   · `minGapMin` / `dailyMax` —— 最短间隔（分钟）/ 每天最多几条。
   *     ⚠️ 后台读不到这两格时会用**默认值**（40 / 8），不会退化成"想发就发"。
   *   · `mood` —— 他此刻的心情快照（App 从最近一笔情绪上报里取）。
   *     醒来的那一刻**后台读不到网页层的 store**，所以只能靠这份快照 ——
   *     这也是为什么只放"慢变量"（情绪基调），不放"这一秒的表情"。
   */
  busyUntil: "cfg_busy_until",
  minGapMin: "cfg_min_gap_min",
  dailyMax: "cfg_daily_max",
  mood: "cfg_mood",
  /**
   * **后台交给前台的"他说了一句"**（键名跟 `public/runners/wake.js` 的 `markPending` 一字不差）。
   *
   * 为什么要有它们：通知和会话原来是**两套存储** —— 后台只会弹通知、把话截成 40 字写进
   * `wake_log`，而会话在 IndexedDB 里、只有 webview 能写。于是用户真机上看到的正是
   * "我能收到弹窗通知，但是那个通知不在上下文里"。这四个键就是那条缺的通道。
   */
  pendingText: "wake_pending_text",
  /** 他说话的时间（本地时间字符串，给人看） */
  pendingAt: "wake_pending_at",
  /** 同一个时间的机器可读版本（排序 / 判重用） */
  pendingAtMs: "wake_pending_at_ms",
  /** 程度（可选小标记） */
  pendingUrge: "wake_pending_urge",
  /** 前台把这句话收进会话之后写的"已收下"标记（本地时间）—— 给人看的书签 */
  pendingConsumedAt: "wake_pending_consumed_at",
  /** 同上，但机器可读：`<时间戳>|<正文>`，用来**逐字判重**（跨重启也认得） */
  pendingConsumedKey: "wake_pending_consumed_key",
} as const;

/** 后台交给前台的那几个键（置空时要一起置空） */
export const WAKE_PENDING_KEYS = [
  WAKE_KEYS.pendingText,
  WAKE_KEYS.pendingAt,
  WAKE_KEYS.pendingAtMs,
  WAKE_KEYS.pendingUrge,
] as const;

/** 把配置写进抽屉（只在真机上有用；网页版静默跳过） */
export async function pushWakeConfig(data: Record<string, string>): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    await WakeBridge.put({ data });
    return true;
  } catch {
    // 抽屉写不进去不该影响别的（比如这个包还没带上新插件）
    return false;
  }
}

/** 读回抽屉里的东西（自检用：能看出"到底写进去了没有"） */
export async function readWakeConfig(): Promise<Record<string, string> | null> {
  if (!isNativeApp()) return null;
  try {
    return await WakeBridge.get();
  } catch {
    return null;
  }
}

/**
 * **把"他说了一句"的交接键置空**（前台落进会话之后立刻调）。
 *
 * ⚠️ 为什么不用 `clear()`：那会把**整个抽屉**清掉 —— 上游配置、两段指令、`wake_log`
 *    一起没，后台下次醒来就瞎了（那是 `resetWake`/"清空重来"该干的事，不是这里）。
 * ⚠️ 为什么不给原生插件加一个"按 key 删"的方法：那要**重新打一次 APK**才生效；
 *    而 `put` 本来就在，**置空（`""`）跟删掉在后台那边完全等价** ——
 *    后台读抽屉用的是 `cfg()`（`CapacitorKV.get(k).value || ""`），空串照样是假值。
 *    所以这里选**置空**：一台已经装着老包的手机，只要界面更新了就生效，不用等重打包。
 */
export async function clearWakePending(consumedAt?: string, consumedKey?: string): Promise<boolean> {
  const data: Record<string, string> = {};
  for (const key of WAKE_PENDING_KEYS) data[key] = "";
  /** 顺手留两个书签：人看的本地时间 + 机器判重用的身份串 */
  if (consumedAt) data[WAKE_KEYS.pendingConsumedAt] = consumedAt;
  if (consumedKey) data[WAKE_KEYS.pendingConsumedKey] = consumedKey;
  return pushWakeConfig(data);
}

/** 「清空重来」的结果 —— 成功/失败都要有话说（**不吞错误**） */
export type ClearWakeResult = { ok: boolean; message: string };

/**
 * **清空抽屉**（设置页那个「清空后台状态，重新来」按钮）。
 *
 * 原生那边 `WakeBridgePlugin.clear()` 一把清掉整个 SharedPreferences：
 * 醒来次数、`wake_log`、上次说话时间、静音标记、交给后台的那份配置，全没。
 * 清完还要**立刻重新交一份**（见 `lib/wake-sync.ts` 的 `resetWake`），
 * 否则后台下次醒来只会看到空抽屉、什么都不做。
 *
 * ⚠️ 网页版没有抽屉（也没有后台任务）→ **优雅跳过**，并且如实说"这台上没有抽屉"，
 * 不许假装清过了。
 */
export async function clearWakeConfig(): Promise<ClearWakeResult> {
  if (!isNativeApp()) {
    return {
      ok: false,
      message: "这台上没有抽屉（网页版没有后台任务）—— 后台那份配置不在这个浏览器里，没得清。",
    };
  }
  try {
    await WakeBridge.clear();
    return { ok: true, message: "后台那份配置和记录已经清空" };
  } catch (err) {
    return { ok: false, message: `清空失败：${(err as Error).message || "未知错误"}` };
  }
}
