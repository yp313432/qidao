import type { Conversation } from "@/lib/types";

export function summaryEntries(conversations: readonly Conversation[]) {
  return conversations.filter((conversation) => !conversation.incognito).flatMap((conversation) => {
    const archived = conversation.summaryArchive ?? [];
    const summaries = conversation.summary ? [...archived, conversation.summary] : archived;
    return summaries.filter((summary) => typeof summary.text === "string" && summary.text.trim())
      .map((summary) => ({
        id: `summary:${conversation.id}:${summary.upToIndex}`,
        conversationId: conversation.id,
        title: conversation.title,
        summary,
        latest: summary === conversation.summary,
      }));
  }).sort((a, b) => b.summary.updatedAt - a.summary.updatedAt);
}
