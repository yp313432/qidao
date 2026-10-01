import { useEffect } from "react";

/** 会被点亮高光的玻璃类名。 */
const GLASS_SELECTOR = ".bg-surface,.bg-elevated,.bg-chip,.aster-card,.glass-nav";

/** 停手/离开后光晕淡出的时长。 */
const FADE_OUT_MS = 520;

/**
 * 指针高光。
 *
 * 以前是「点哪块玻璃，就在那一整块上横扫一道光带」—— 又快又亮，像闪电。
 * 现在改成**一小团柔光跟着手指/鼠标走**：光落在你按下的那一点上，
 * 停手或离开时慢慢淡掉。更像玻璃反光，也不刺眼。
 *
 * 实现上覆盖的是**一个跟着走的小胶囊**（位置/尺寸/圆角都照抄那块玻璃），
 * 而不是去改各玻璃类的 background —— 那样每加一种玻璃都要同步一遍，很容易漏。
 *
 * 事件用 touch / mouse 三件套而不是 Pointer Events：部分手机内核支持不全。
 */
export function GlassHighlight() {
  useEffect(() => {
    const glow = document.createElement("div");
    glow.className = "pointer-glow";
    glow.setAttribute("aria-hidden", "true");
    document.body.appendChild(glow);

    let raf = 0;
    let hideTimer = 0;

    const show = (el: HTMLElement, x: number, y: number) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      glow.style.transition = "opacity 0.12s ease";
      glow.style.transform = `translate3d(${r.left}px, ${r.top}px, 0)`;
      glow.style.width = `${r.width}px`;
      glow.style.height = `${r.height}px`;
      glow.style.borderRadius = cs.borderTopLeftRadius || "16px";
      glow.style.setProperty("--gx", `${x - r.left}px`);
      glow.style.setProperty("--gy", `${y - r.top}px`);
      glow.style.opacity = "1";
    };

    const hide = () => {
      window.clearTimeout(hideTimer);
      glow.style.transition = `opacity ${FADE_OUT_MS}ms ease`;
      glow.style.opacity = "0";
    };

    const onMove = (e: Event) => {
      const me = e as MouseEvent & { touches?: TouchList };
      const x = me.touches?.[0]?.clientX ?? me.clientX;
      const y = me.touches?.[0]?.clientY ?? me.clientY;
      if (typeof x !== "number" || typeof y !== "number") return;

      const node = e.target as Element | null;
      if (!node || typeof node.closest !== "function") return;
      const el = node.closest(GLASS_SELECTOR) as HTMLElement | null;

      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        window.clearTimeout(hideTimer);
        if (!el) {
          hide();
          return;
        }
        show(el, x, y);
      });
    };

    window.addEventListener("touchstart", onMove, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("touchend", hide, { passive: true });
    window.addEventListener("touchcancel", hide, { passive: true });
    window.addEventListener("mouseleave", hide);

    return () => {
      window.removeEventListener("touchstart", onMove);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchend", hide);
      window.removeEventListener("touchcancel", hide);
      window.removeEventListener("mouseleave", hide);
      cancelAnimationFrame(raf);
      window.clearTimeout(hideTimer);
      glow.remove();
    };
  }, []);

  return null;
}
