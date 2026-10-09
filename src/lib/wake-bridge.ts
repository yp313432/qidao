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
} as const;

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
