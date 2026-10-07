import { isNativeApp } from "@/lib/platform";

/**
 * **后台唤醒**的 App 侧开关 —— 跟 `public/runners/wake.js` 配对。
 *
 * 为什么要有这个文件：网页（电脑上调试）里没有"后台任务"这回事，
 * 插件也不能在浏览器里 import（会报错）—— 所以全部走**动态 import + 平台判断**，
 * 电脑上静默不用，手机上才真的调。
 *
 * ⚠️ 这一版是**最小验证**：只证明"App 关着时，系统到底会不会把它叫醒"。
 * 叫醒之后干什么（问 AI、生成那句话、弹通知）等这一步验过了再接。
 */

/** 跟 capacitor.config.ts 里那两行**必须一致**（写错了调用就石沉大海） */
export const WAKE_LABEL = "com.yanping.qidao.wake";
export const WAKE_EVENT = "qidaoWake";

type Runner = {
  checkPermissions: () => Promise<{ notifications?: string }>;
  requestPermissions: (o: { apis: string[] }) => Promise<unknown>;
  dispatchEvent: (o: {
    label: string;
    event: string;
    details?: Record<string, unknown>;
  }) => Promise<unknown>;
};

async function getRunner(): Promise<Runner | null> {
  if (!isNativeApp()) return null;
  try {
    const mod = (await import("@capacitor/background-runner")) as unknown as {
      BackgroundRunner: Runner;
    };
    return mod.BackgroundRunner;
  } catch {
    return null;
  }
}

export type WakeTestResult = { ok: boolean; message: string };

/**
 * **立刻试一次**（不用等 15 分钟）。
 *
 * 为什么要这个按钮：一次真机验证要等 15~30 分钟，而且失败时分不清是
 * "后台没被叫醒"还是"叫醒了但这段 JS 写错了"。分两步试：
 *   ① 点一下 → 立刻手动触发一次 → 通知来了 = **JS 和通知这条路是通的**
 *   ② 关掉 App 等半小时 → 通知来了 = **系统真的会叫醒它**
 * 两步分开，失败在哪一步一眼就知道。
 */
export async function wakeTestOnce(): Promise<WakeTestResult> {
  const runner = await getRunner();
  if (!runner) {
    return { ok: false, message: "这条只有装成 App 之后才有用（网页里没有后台任务）。" };
  }
  try {
    /** 安卓 13+ 通知要先授权（跟闹钟用的是同一个权限） */
    const before = await runner.checkPermissions().catch(() => ({ notifications: "prompt" }));
    if (before?.notifications !== "granted") {
      await runner.requestPermissions({ apis: ["notifications"] }).catch(() => undefined);
    }
    await runner.dispatchEvent({ label: WAKE_LABEL, event: WAKE_EVENT, details: { from: "manual" } });
    return {
      ok: true,
      message: "已经手动叫了他一次 —— 应该马上会弹一条通知（第 N 次醒来）。没弹就是通知权限被关了。",
    };
  } catch (err) {
    return {
      ok: false,
      message: `叫不动他：${(err as Error).message || "未知错误"}。可能这个包还没带上后台任务，或者配置没对上。`,
    };
  }
}

/** 这台设备支不支持后台唤醒（网页版永远不支持） */
export function wakeSupported(): boolean {
  return isNativeApp();
}
