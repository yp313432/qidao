/**
 * App 内横幅通知（他主动发消息、而你不在聊天页时弹一条）。
 *
 * 用户 2026-11-01："app 内发消息会弹一个横幅，比如我在其它页面，他发了消息我其实
 * 不知道，要进入聊天才知道，所以加一个我不在聊天页面它给我发消息时，来一条横幅
 * 通知。要自然有动效那种"。
 *
 * 跟 `lib/toast.ts` 的区别：
 *   · toast 是纯文字的轻提示（底部）
 *   · 这个是**带人设的通知**（顶部横幅：头像 + 名字 + 一句正文），点了直接进聊天
 *
 * 为什么用发布订阅而不是放进 store：触发点在 task-daemon（App 内的非 React
 * 回调）里，走订阅比往全局 store 塞一个"临时横幅"状态更干净，也不会被持久化。
 */

export type ChatNotice = {
  /** 同一时间只显示一条，后来的覆盖前面的 */
  id: number;
  /** 谁说的（aiName / displayName） */
  name: string;
  /** 头像 url，空则显示名字首字 */
  avatar: string;
  /** 一句话正文（已经去掉分段标记、截断过） */
  body: string;
  /** 哪条对话 */
  conversationId: string;
};

type Listener = (notice: ChatNotice | null) => void;

const listeners = new Set<Listener>();
let seq = 0;

/** 弹一条横幅（message 为空则什么都不做） */
export function pushChatNotice(input: Omit<ChatNotice, "id">): void {
  const body = input.body.trim();
  if (!body) return;
  const notice: ChatNotice = { ...input, body, id: ++seq };
  for (const fn of listeners) fn(notice);
}

/** 手动收掉（点横幅、点关闭、或者切到聊天页时调用） */
export function clearChatNotice(): void {
  for (const fn of listeners) fn(null);
}

export function subscribeChatNotice(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
