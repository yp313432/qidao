/**
 * 液态世界 · 让玻璃上的光跟着手指走。
 *
 * 为什么不是每个组件各挂一个监听：一屏几十块玻璃，各挂一个就是几十个
 * pointermove —— 手机上手指一动就掉帧。这里只挂**一个**全局委托：
 * 命中 `closest(SELECTOR)` 之后只写 `--mx` / `--my` 两个 CSS 变量，
 * 并且用 rAF 合并（一帧最多写一次），全程不进 React state。
 *
 * 光斑本身在 `.lq-glass::before`（glass.css）与 `.k-card::before`（styles/kit.css）里 ——
 * 液态下纯色那套 `.k-card` 也要有同一道反光（用户 m08509"能做液态玻璃的做液态"），\n * 所以选择器同时认这两类，不用为二级页再写一套组件。\n * 这个文件不碰任何颜色、不碰任何布局。
 */

/** 光斑允许跑出边界的余量（%），太靠外会只剩一片白 */
const RANGE = 20;

/** 该发光的玻璃：液态原语 + 纯色的卡片/行（液态模式下它们也变成玻璃） */
const SELECTOR = ".lq-glass, .k-card";

function clampPercent(value: number): number {
  return Math.max(-RANGE, Math.min(100 + RANGE, value));
}

type Pending = { el: HTMLElement; x: number; y: number };

/**
 * 挂上全局光斑监听，返回卸载函数。SSR 环境下是空操作。
 */
export function mountGlassLight(): () => void {
  if (typeof window === "undefined" || typeof requestAnimationFrame !== "function") {
    return () => {};
  }

  let frame = 0;
  let pending: Pending | null = null;

  const flush = () => {
    frame = 0;
    if (!pending) return;
    const { el, x, y } = pending;
    pending = null;
    el.style.setProperty("--mx", `${x.toFixed(1)}%`);
    el.style.setProperty("--my", `${y.toFixed(1)}%`);
  };

  const aim = (el: HTMLElement, clientX: number, clientY: number) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    pending = {
      el,
      x: clampPercent(((clientX - rect.left) / rect.width) * 100),
      y: clampPercent(((clientY - rect.top) / rect.height) * 100),
    };
    if (frame === 0) frame = requestAnimationFrame(flush);
  };

  const onMove = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const el = target.closest<HTMLElement>(SELECTOR);
    if (!el) return;
    aim(el, event.clientX, event.clientY);
  };

  /** 手指离开后光斑回到中上，别一直卡在刚才那一点 */
  const onRelease = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const el = target.closest<HTMLElement>(SELECTOR);
    if (!el) return;
    el.style.setProperty("--mx", "50%");
    el.style.setProperty("--my", "-8%");
  };

  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onMove, { passive: true });
  window.addEventListener("pointerup", onRelease, { passive: true });
  window.addEventListener("pointercancel", onRelease, { passive: true });

  return () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pending = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerdown", onMove);
    window.removeEventListener("pointerup", onRelease);
    window.removeEventListener("pointercancel", onRelease);
  };
}
