/**
 * **键盘弹起来时，输入框被盖住** —— 把"键盘占了多高"变成一条 CSS 变量。
 *
 * ── 真机现场（2026-10 用户截图 + 描述，报过两次）────────────────────
 * "键盘打字的时候，对话框依旧不弹出，被掩盖住，看不到打的字。"
 *
 * ── 为什么会这样（两条一起看，不是猜）──────────────────────────────
 *   1. 原生为了"背景铺到状态栏/导航栏"，开了 **edge-to-edge**
 *      （`WindowCompat.setDecorFitsSystemWindows(window, false)`）；
 *      安卓官方口径：这个模式下**系统不再按键盘顶小窗口**
 *      （`windowSoftInputMode="adjustResize"` 失效），键盘是"盖"上来的，
 *      IME 内衬得由 App 自己处理。
 *   2. 于是**只能原生来读**：第一版这里用网页的 `visualViewport` 自己算，
 *      真机上没生效 —— 因为这种模式下可视视口**不会跟着变小**，算出来恒为 0。
 *      （参考 Android 官方《Understand window insets in WebView》）
 *
 * ── 现在的分工（两个变量，谁有值用谁）──────────────────────────────
 *   · `--q-ime-bottom-native`：**原生**推的键盘高度（安卓 APK，主路径，
 *     见 `ShellBridgePlugin.pushImeInset`）
 *   · `--q-ime-bottom-web`：**网页**自己算的兜底（浏览器 / iOS，本文件）
 *   · 消费点在 `app-shell.tsx`：`max(两者)` —— 两边不会互相覆盖。
 *
 * 网页这份的算式：
 *     键盘高度 = innerHeight − visualViewport.height − visualViewport.offsetTop
 * `offsetTop` 那一项是 iOS 上页面被顶上去时的情况；安卓一般是 0。
 * 它**自带纠错**：某台机器真把窗口缩了 → 两个高度一起变小 → 算出 0，不重复让位。
 */

export type ViewportMetrics = {
  /** 布局视口高度（`window.innerHeight`） */
  innerHeight: number;
  /** 可视视口高度（`visualViewport.height`）—— 键盘弹起时会变小 */
  vvHeight: number;
  /** 可视视口顶端相对布局视口的偏移（iOS 上会被顶起来） */
  vvTop: number;
};

/**
 * 键盘占了多高（像素）。
 *
 * 纯函数，方便单测/验收：负数、NaN 一律归 0（宁可不让位，也不许把输入框顶出屏幕）。
 */
export function imeInsetOf(m: ViewportMetrics): number {
  const raw = m.innerHeight - m.vvHeight - m.vvTop;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.round(raw);
}

/**
 * 超过这个高度才认为"键盘真的弹了"。
 *
 * 为什么要一个门槛：手机浏览器/WebView 的可视视口会因为地址栏收起、手势条等
 * 抖几像素 —— 那些不该触发"让位"（会让界面一跳一跳）。
 */
const IME_MIN_PX = 80;

/** 网页兜底写的是这个变量（原生那个是 `--q-ime-bottom-native`，互不覆盖） */
export const WEB_IME_VAR = "--q-ime-bottom-web";

/**
 * 挂上监听，把键盘高度写进 `--q-ime-bottom-web`（**兜底那一路**）。
 *
 * 返回一个卸载函数（组件卸载时调到，别留监听）。
 */
export function installKeyboardInset(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  const root = document.documentElement;
  const vv = window.visualViewport ?? null;
  let last = -1;

  const apply = () => {
    const ime = imeInsetOf({
      innerHeight: window.innerHeight,
      vvHeight: vv?.height ?? window.innerHeight,
      vvTop: vv?.offsetTop ?? 0,
    });
    const settled = ime >= IME_MIN_PX ? ime : 0;
    if (settled === last) return;
    last = settled;
    root.style.setProperty(WEB_IME_VAR, `${settled}px`);
  };

  apply();
  vv?.addEventListener("resize", apply);
  vv?.addEventListener("scroll", apply);
  // 有些 WebView 只在 window 上发 resize（可视视口那条事件不来）
  window.addEventListener("resize", apply);
  return () => {
    vv?.removeEventListener("resize", apply);
    vv?.removeEventListener("scroll", apply);
    window.removeEventListener("resize", apply);
    root.style.removeProperty(WEB_IME_VAR);
  };
}
