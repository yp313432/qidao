/**
 * **「他正跟他聊着天」这件事，得有个地方记着。**
 *
 * 用户 m01146 原话："我在对话时不要触发那个唤醒……我在其它页面的时候，它可以主动发消息
 * 唤醒，但我正和它聊着天呢，他还突然来一句我在花园散步呢就很割裂。"
 *
 * 所以规矩是：**对话页开着（且 App 在前台）时，他自己排的那三类唤醒（自由活动 / 日记保底 /
 * 回响）一律让路**；等他切到别的页面、或者把 App 收起来，到点的任务下一轮 tick 再开口。
 *
 * 为什么不用持久化 / store：这只是一面"现在人在不在聊天页"的旗子，
 * 刷新、冷启动都该是 false（人不在对话页了）；放模块级变量最省事，也不会脏进历史记录。
 */
let chatPageActive = false;

/** 对话页挂载/卸载时改它（见 `components/chat/chat-view.tsx`） */
export function setChatPageActive(active: boolean): void {
  chatPageActive = active;
}

export function isChatPageActive(): boolean {
  return chatPageActive;
}

/**
 * 这次唤醒要不要让路。
 *
 * 只看两件事：① 人是否停在对话页 ② App 是否在前台。
 * 后台（`visibilityState !== "visible"`）时不该让路 —— 那正是他"自己醒着"的时候。
 */
export function wakeShouldYield(): boolean {
  if (typeof document === "undefined") return false;
  return chatPageActive && document.visibilityState === "visible";
}
