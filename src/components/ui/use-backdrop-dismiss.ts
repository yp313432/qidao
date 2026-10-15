import { useRef } from "react";

/**
 * **点空白处返回** —— 全 App 弹层的统一规则（用户要求："找出所有的弹层，逻辑都要一致"）。
 *
 * 为什么不用 `onClick`：
 * 在遮罩上**滑动**一下再松手，浏览器仍然会补一个 click（思考链那个弹层踩过这个坑），
 * 于是"想滚一下"变成"误关"。这里自己量位移：按下→松手移动超过 8px 就不算点击。
 *
 * 为什么不用 `e.target === e.currentTarget` 一个条件就够：
 * 按下和松手必须**都落在遮罩本身**才关（按在卡片上、松手滑到遮罩，不算）。
 *
 * 用法：
 *   const backdrop = useBackdropDismiss(() => setOpen(false));
 *   <div className="fixed inset-0 ..." {...backdrop}>
 *     <div onClick={(e) => e.stopPropagation()}>卡片内容</div>
 *   </div>
 */
export function useBackdropDismiss(onDismiss: () => void, moveTolerance = 8) {
  const start = useRef<{ x: number; y: number } | null>(null);

  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      start.current = e.target === e.currentTarget ? { x: e.clientX, y: e.clientY } : null;
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      if (e.target !== e.currentTarget) return;
      if (Math.abs(e.clientX - s.x) > moveTolerance || Math.abs(e.clientY - s.y) > moveTolerance) return;
      onDismiss();
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };
}
