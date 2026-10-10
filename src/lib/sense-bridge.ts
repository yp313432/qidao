import { registerPlugin } from "@capacitor/core";
import { isNativeApp } from "@/lib/platform";

/**
 * **「看一眼系统状态」的 JS 侧** —— 跟
 * `android/app/src/main/java/com/yanping/qidao/SenseBridgePlugin.java` 配对。
 *
 * 用户的原话："我给开他那么多权限，其实是希望他**主动的去用**。"
 * 这里的四个方法就是那几项权限的**入口**（谁来调：`lib/sense.ts`，由 AI 的动作触发）：
 *   · `device()`        电量 / 充电 / 网络类型（不需要权限）
 *   · `screen()`        屏幕亮没亮、锁没锁（不需要权限）
 *   · `notifications()` 最近几条通知（要系统「通知使用权」）
 *   · `foreground()`    当前前台 App（要系统「使用情况访问」）
 *
 * ⚠️ 三条纪律（都是这一层最容易犯的错）：
 *
 * 1. **网页版必须优雅失败**：`registerPlugin` 在网页里返回的是一个"调用就抛
 *    not implemented on web"的代理 —— 所以每个调用方都要先过 `nativeSense()`，
 *    拿不到就**如实说"网页版没有这个能力"**，不许假装读过、也不许崩。
 *
 * 2. ⚠️ **不要直接 return 插件对象**：Capacitor 的插件对象是 thenable（带 `then`），
 *    从 async 函数里直接 return，JS 会把它当成 Promise 去调 `.then()` ——
 *    当场抛 `"SenseBridge.then()" is not implemented on web`。
 *    所以这里包一层 `{ api }` 返回（`lib/notify.ts` 踩过同一个坑）。
 *
 * 3. **原生报错不许吞**：插件那边已经把"没权限"和"读失败"分开了
 *    （`granted:false` + `settingsPath`），这里原样往上送，别自己编一句
 *    "失败了" —— 用户要知道去开哪个开关。
 */

/** 原生插件返回的形状（跟 Java 那边一字不差）。 */
export type SenseBridgeApi = {
  device: () => Promise<{
    battery?: number | null;
    charging?: boolean | null;
    network?: string;
    online?: boolean | null;
  }>;
  screen: () => Promise<{ interactive?: boolean; locked?: boolean }>;
  notifications: () => Promise<{
    granted?: boolean;
    items?: { app?: string; title?: string; text?: string; minutesAgo?: number }[];
    reason?: string;
  }>;
  foreground: () => Promise<{
    granted?: boolean;
    app?: string;
    package?: string;
    reason?: string;
  }>;
};

const SenseBridge = registerPlugin<SenseBridgeApi>("SenseBridge");

/** 拿到原生插件；网页版/老包（没有这个插件）一律返回 null。 */
export async function nativeSense(): Promise<{ api: SenseBridgeApi } | null> {
  if (!isNativeApp()) return null;
  try {
    // ⚠️ 包一层（见文件头纪律 2）
    return { api: SenseBridge };
  } catch {
    return null;
  }
}
