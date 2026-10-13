/**
 * **键盘弹起来时，输入框被盖住** —— 把"键盘占了多高"变成一条 CSS 变量。
 *
 * ── 真机现场（2026-10 用户截图 + 描述）─────────────────────────────
 * "键盘打字的时候，对话框依旧不弹出，被掩盖住，看不到打的字。"
 * 截图里：消息区一直到键盘上沿，键盘（带它自己那排工具条）把整个输入框卡片盖住了。
 *
 * ── 为什么会这样（两条一起看，不是猜）──────────────────────────────
 *   1. 原生为了"背景铺到状态栏/导航栏"，开了 **edge-to-edge**
 *      （`WindowCompat.setDecorFitsSystemWindows(window, false)`，见 ShellBridgePlugin）；
 *      这样一来 **`windowSoftInputMode="adjustResize"` 就管不了键盘了** ——
 *      窗口不再被键盘顶小，键盘是"盖"在页面上的（安卓 11+/15 的规矩）。
 *   2. 原生只把**系统栏**的高度推给了网页（`--q-inset-top/-bottom`），
 *      **从来没推过键盘**；而 `src/` 里搜不到任何 `visualViewport` 的用法
 *      （已核实：全仓 0 处）→ 页面完全不知道键盘弹了，输入框自然被盖住。
 *
 * ── 修法：用 `visualViewport` 自己算（不依赖原生、不用改 Java）────────
 * 键盘弹起时，**可视视口**（visualViewport）会变小，而布局视口（innerHeight）
 * 常常不变。两者的差就是"键盘占了多少"：
 *
 *     键盘高度 = innerHeight − visualViewport.height − visualViewport.offsetTop
 *
 * `offsetTop` 那一项是 iOS 上页面被顶上去时的情况；安卓一般是 0。
 * 这个算法**自带纠错**：
 *   · 万一某台机器（老安卓）真的把窗口缩了 → 两个高度一起变小 → 算出来是 0 → 不重复让位；
 *   · 键盘收起 → 算出来 0 → 变量归零。
 *
 * 结果写成 `--q-ime-bottom`，由外壳（`app-shell.tsx`）一处消费：
 * 外壳下内边距 + 底部导航的 bottom。**只有这一处定义、一处引用**。
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

/**
 * 挂上监听，把键盘高度写进 `--q-ime-bottom`。
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
    root.style.setProperty("--q-ime-bottom", `${settled}px`);
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
    root.style.removeProperty("--q-ime-bottom");
  };
}
