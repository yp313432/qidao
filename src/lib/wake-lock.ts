/**
 * 通话时**别让屏幕自己锁掉**。
 *
 * 为什么需要：语音通话是"一直开着麦克风、听 → 说 → 听"的长过程，
 * 中途没有任何点击。系统到了息屏时间就把屏幕关了 —— 在安卓 WebView 里
 * 那通常意味着整页被挂起，通话就断在半句上（用户的原话："把锁屏不断也加上吧"）。
 *
 * 用什么：Screen Wake Lock API（`navigator.wakeLock.request("screen")`）。
 * 它不是"锁屏后继续跑"，而是**让屏幕不自动锁** —— 对"说着说着黑屏了"这个
 * 最常见的场景，这才是对的办法（不折腾系统、不需要前台服务）。
 *
 * ⚠️ 两个真实的坑，这里都处理了：
 *   ① **切到后台时浏览器会自动释放**这个锁（规范如此）。所以切回来要重新申请，
 *      否则用户看一眼别的 App 再回来，屏幕就又会被锁。
 *   ② **它需要页面可见**，且用户没在省电模式里禁掉；拿不到就安静放弃 ——
 *      绝不能因为"申请不到"就把通话流程卡住（宁可没有这个功能，也不能打不了电话）。
 *
 * 还是不够的部分（**如实说明**）：手动按电源键锁屏 / 切到别的 App 之后继续通话，
 * 那要安卓前台服务（`FOREGROUND_SERVICE_MICROPHONE` + `mediaPlayback`），
 * 属于原生代码，得在真机上验。
 */

type Sentinel = {
  released?: boolean;
  release?: () => Promise<void>;
  addEventListener?: (type: string, fn: () => void) => void;
};

type WakeLockApi = {
  request: (type: "screen") => Promise<Sentinel>;
};

export type WakeLockHandle = {
  /** 当前是不是真的握着锁（给界面显示"通话中不会自动息屏"用） */
  active: () => boolean;
  /** 环境支不支持（不支持时上面的 active 恒为 false） */
  supported: boolean;
  release: () => void;
};

const NOOP: WakeLockHandle = { active: () => false, supported: false, release: () => undefined };

export async function keepScreenAwake(): Promise<WakeLockHandle> {
  if (typeof navigator === "undefined" || typeof document === "undefined") return NOOP;
  const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
  if (!api?.request) return NOOP;

  let sentinel: Sentinel | null = null;
  let stopped = false;

  async function acquire(): Promise<void> {
    if (stopped || sentinel) return;
    try {
      sentinel = await api.request("screen");
      // 被系统/浏览器收走时清掉引用，下次可见时再申请
      sentinel.addEventListener?.("release", () => {
        sentinel = null;
      });
    } catch {
      // 省电模式、权限策略、非可见页面……都会抛。安静放弃，别影响通话。
      sentinel = null;
    }
  }

  function onVisibility() {
    if (document.visibilityState === "visible") void acquire();
  }

  document.addEventListener("visibilitychange", onVisibility);
  await acquire();

  return {
    active: () => Boolean(sentinel),
    supported: true,
    release: () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const s = sentinel;
      sentinel = null;
      try {
        void s?.release?.();
      } catch {
        /* 已经放了 */
      }
    },
  };
}
