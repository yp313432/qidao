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
  /** 五段指令：程度 0/25/50/75/100 各一段 */
  prompt: (i: number) => `cfg_prompt_${i}`,
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
