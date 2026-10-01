import { useEffect, useRef, type RefObject } from "react";

/**
 * 点空白处关闭。
 *
 * 用 pointerdown/touchstart 而不是 click —— 手机上手指按下就该收起，
 * 不用等抬手。点在容器内部（含它里面的弹层）不关。
 */
export function useDismissOutside(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: Event) => {
      const el = ref.current;
      if (!el) return;
      const target = e.target;
      if (target instanceof Node && el.contains(target)) return;
      onDismiss();
    };
    document.addEventListener("pointerdown", handler);
    document.addEventListener("touchstart", handler, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [ref, onDismiss, active]);
}

/** 每个页面记住的滚动位置。 */
const positions = new Map<string, number>();

/**
 * 记住滚动位置。
 *
 * 注意：这个 App 里页面根部虽然写着 `overflow-y-auto`，**实际滚动的是窗口**
 * （容器会被内容撑高，scrollHeight === clientHeight）。所以这里两条都挂、
 * 两条都恢复 —— 谁在滚就记谁，将来布局改成内部滚动也不用再改。
 */
export function useScrollMemory(key: string) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const doc = typeof document === "undefined" ? null : document.scrollingElement;

    const read = () => {
      if (el && el.scrollHeight > el.clientHeight + 4) return el.scrollTop;
      return doc ? doc.scrollTop : 0;
    };
    const apply = (v: number) => {
      if (el && el.scrollHeight > el.clientHeight + 4) el.scrollTop = v;
      if (doc) doc.scrollTop = v;
    };

    const saved = positions.get(key) ?? 0;
    let retry = 0;
    if (saved > 0) {
      apply(saved);
      // 内容（尤其是异步取回来的）晚一步撑开高度时再补一次
      retry = window.setTimeout(() => {
        if (read() < 4) apply(saved);
      }, 220);
    }

    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => positions.set(key, read()));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    el?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      el?.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      window.clearTimeout(retry);
      positions.set(key, read());
    };
  }, [key]);

  return ref;
}
