import { isNativeApp } from "@/lib/platform";

/**
 * **后台唤醒**的 App 侧说明 —— 跟 `public/runners/wake.js` 配对。
 *
 * ⚠️⚠️ 这里**故意没有**「手动触发一次」的函数 —— 这是一个踩过的坑，别再加回来：
 *
 * 插件的 `dispatchEvent` 在安卓侧是这样实现的（`BackgroundRunnerPlugin.kt`）：
 *
 *     runBlocking(Dispatchers.IO) {              // ← 插件方法跑在**主线程**，这句把主线程挡住
 *         impl.execute(...)                     // ← 里面 future.conditionalAwait { it != null }
 *     }                                         //    **无限期等**，没有超时
 *
 * 也就是：主线程被挡住等 JS 回调，而 JS 引擎要跑又得用主线程 → **死锁**。
 * 实测后果（用户真机反馈）：点一下之后"一直写着正在叫他"，**整个 App 卡住不动**，通知也没有。
 *
 * 所以规矩是：**App 侧永远不要调 `dispatchEvent`**。
 * 真正管用的是**系统定时任务**那条路（WorkManager → `RunnerWorker`）——
 * 它跑在后台线程上，不碰主线程，也就没有这个死锁（`verify-background-wake.mjs` 盯着这条）。
 *
 * 代价：没法规避 15 分钟的等待 —— 想验只能把 App 切到后台、等。
 */

/** 跟 capacitor.config.ts 里那两行**必须一致**（写错了后台任务就是哑的） */
export const WAKE_LABEL = "com.yanping.qidao.wake";
export const WAKE_EVENT = "qidaoWake";

/** 这台设备支不支持后台唤醒（网页版永远不支持） */
export function wakeSupported(): boolean {
  return isNativeApp();
}
