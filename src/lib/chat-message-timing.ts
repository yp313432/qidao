import type { ChatMessage } from "./types";

export function describeUserMessageTiming(
  messages: readonly Pick<ChatMessage, "id" | "role" | "createdAt">[],
  replyId: string,
): string | undefined {
  const replyIndex = messages.findIndex((message) => message.id === replyId);
  const labels = ["最新一条", "往前一条", "再往前一条"];
  const entries: string[] = [];
  let newerTime: number | undefined;

  for (let index = replyIndex - 1; index >= 0 && entries.length < labels.length; index--) {
    const message = messages[index]!;
    if (message.role !== "user") continue;

    const sentAt = new Date(message.createdAt);
    const time = sentAt.getTime();
    const label = labels[entries.length];
    if (!Number.isFinite(time) || time <= 0) {
      entries.push(`${label}时间未知`);
      newerTime = undefined;
      continue;
    }

    const elapsed = newerTime !== undefined && newerTime >= time
      ? `（到后一条相隔 ${(newerTime - time) / 1000} 秒）`
      : "";
    entries.push(`${label} ${sentAt.toLocaleString("zh-CN", { hour12: false })}${elapsed}`);
    newerTime = time;
  }

  return entries.length ? entries.join("；") : undefined;
}
