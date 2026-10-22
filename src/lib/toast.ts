/**
 * 全局轻提示（toast）。
 *
 * 为什么要这个（用户 m10539："这个安卓底层的弹窗没做适配"）：
 * `window.alert()` 在 WebView 里会被渲染成**安卓系统原生对话框** —— 白卡片 + 一个 OK，
 * 跟这个 App 的玻璃质感完全不是一个东西，还会挡住内容、长文案读不完。
 * 但有些提示是从 lib 层（没有 React 上下文）发出来的，比如「额度用尽」，
 * 所以用一个极小的发布订阅把消息送到界面上，由 `components/global-toast.tsx` 负责显示。
 */

type Listener = (message: string) => void;

const listeners = new Set<Listener>();

/** 发一条提示（谁都能调，不需要 React 上下文） */
export function pushToast(message: string): void {
  const text = message.trim();
  if (!text) return;
  for (const fn of listeners) fn(text);
}

/** 订阅（`global-toast.tsx` 用） */
export function subscribeToast(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
