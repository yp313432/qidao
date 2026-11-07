/**
 * **他说话了，而你不在聊天页 —— 统一从这一个口子弹横幅。**
 *
 * 用户 m04650："横幅通知你要看一下，它只触发过一次，不怎么弹"。
 *
 * 查下来不是坏了，是**只在一条路上接了**：原来只有 `task-daemon` 里"他自己排的唤醒"
 * （自由活动 / 日记 / 回响）会弹，而且要求那一刻 App 开着、你又恰好不在对话页。
 * 一天最多也就几条这种唤醒，落在那个窗口里的概率很低 —— 所以"只见过一次"。
 *
 * 现在改成两条路都走这里：
 *   · `lib/use-chat.ts` —— 你发了消息之后切到别的页面，回复到了照样弹
 *   · `components/daemons/task-daemon.tsx` —— 他自己开口（唤醒 / 你定的定时任务）
 *
 * 两条判据（跟唤醒让路用的是同一面旗子，见 `lib/chat-presence`）：
 *   ① 人在对话页 → 不弹（消息直接落进对话，再弹一条是多余的）
 *   ② 正文为空（比如只挂了个附件）→ 不弹
 */
import { resolveAiName } from "@/lib/branding";
import { isChatPageActive } from "@/lib/chat-presence";
import { pushChatNotice } from "@/lib/inapp-notice";
import { useApp } from "@/lib/store";

export function announceAssistantMessage(input: {
  conversationId: string;
  body: string | undefined;
}): void {
  if (typeof document === "undefined") return;
  if (isChatPageActive()) return;

  const body = (input.body ?? "").trim();
  if (!body) return;

  const settings = useApp.getState().settings;
  pushChatNotice({
    name: resolveAiName(settings.aiName),
    avatar: settings.aiAvatar || "",
    body,
    conversationId: input.conversationId,
  });
}
