import { useEffect, type RefObject } from "react";

/**
 * 键盘弹起/收起时把消息列表重新贴到底。
 *
 * ── 为什么单独一个 hook（用户 m03679 第 2 条）────────────────────
 * 用户原话："第二个还是气泡的字会被对话框挡住。"
 *
 * 上一版只把 `padBottom` 挂进了"消息变了就滚到底"那个 effect 的依赖 ——
 * 那解决的是**输入条自己变高**（贴底规则改了、模型行换行了、引用条出现了）。
 * 键盘弹起不是这件事：输入条高度一点没变（`.pb-composer` 已经是 0），
 * 变的是**可视区高度**（WebView 被顶上去）。依赖没变 → 那个 effect 根本不会跑
 * → 列表短掉的那一截没人补 → 最后一条消息被输入条压住。
 *
 * 所以这里单独盯三件事：
 *   · `visualViewport` 的 resize（安卓/iOS 键盘都会触发，最准）；
 *   · `window` resize（个别 WebView 只发这个）；
 *   · `documentElement` 上 `data-keyboard` 属性的变化（`lib/keyboard.ts` 写的）。
 *
 * 只有当时处于"贴底"状态（`stickBottom.current === true`）才滚 ——
 * 用户正用手指往上翻的时候不许把他拽回底部（那条规则见 chat-view 的自动跟滚注释）。
 *
 * 放在 `lib/` 而不是 chat-view 里，是因为 `guard-styles.mjs` 规定
 * 最大的部件文件只许变小、不许再长（chat-view.tsx 已经是 2200+ 行）。
 */
export function useStickToBottom(
  scroller: RefObject<HTMLElement | null>,
  stickBottom: RefObject<boolean>,
) {
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const stick = () => {
      if (!stickBottom.current) return;
      // 下一帧再滚：键盘收放时 WebView 的高度是异步变的，同帧读到的还是旧值
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    };
    stick();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", stick);
    window.addEventListener("resize", stick);
    const mo = new MutationObserver(stick);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-keyboard"],
    });
    return () => {
      vv?.removeEventListener("resize", stick);
      window.removeEventListener("resize", stick);
      mo.disconnect();
    };
  }, [scroller, stickBottom]);
}
