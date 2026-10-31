import { useEffect } from "react";

/**
 * 弹层打开时锁住背后的滚动。
 *
 * 为什么不用 CSS `body:has(...)`：Capacitor 用的是系统 WebView，
 * Android 10 那批机器上的 WebView 可能低到 100 以前，`:has` 直接不生效，
 * 于是"背景还能滑"是分机型出现的 bug；这里老老实实改 inline style。
 *
 * 只改 overflow，不动 position:fixed —— 后者会让页面瞬间跳到顶部，
 * 在长列表上比不锁还难受。
 */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}
