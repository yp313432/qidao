/**
 * **摘要块 → 可检索的小记忆**（2026-11 记忆细化）。
 *
 * 用户原话："摘要是被切分成一件一件的小事……提到论文，这行字就被检索到，
 * 带回给模型，而不是把包含这行字的那一整段都注入。"
 *
 * 职责只有一件事：把库里的摘要要点变成"块引用"，给 `recall.ts` 当候选；
 * 回写、编辑、渲染都不在这里。旧摘要（没有 `blocks`）在读取时按句临时拆，
 * 不回写存档 —— 拆不干净也不会丢内容。
 */

import type { Conversation } from "@/lib/types";
import type { RecallableMemory } from "@/lib/recall";
import { looseSummaryBlocks, type SummaryBlock } from "./summary.ts";

export type SummaryBlockRef = {
  /** `block:<对话id>:<upToIndex>:<块下标>` —— 前缀区分记忆库那些 `summary:` id */
  id: string;
  /** 它属于哪份摘要：`summary:<对话id>:<upToIndex>`（摘要库按这个 id 找） */
  summaryId: string;
  conversationId: string;
  conversationTitle: string;
  /** 这份是不是该对话当前的摘要（当前会话的近期摘要会整段接上下文，不重复召回） */
  latest: boolean;
  text: string;
  tags: string[];
  at?: string;
  /** 摘要生成时间（块的"新鲜度"跟它走） */
  updatedAt: number;
  index: number;
};

/** "11-18"（本地时间；只用于给模型一个时间线索，不做时区/年份推断） */
function shortDate(ms: number): string {
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getMonth() + 1}-${date.getDate()}`;
}

/** 库里所有非隐身对话的摘要块（当前 + 归档），按摘要时间新→旧 */
export function summaryBlockRefs(conversations: readonly Conversation[]): SummaryBlockRef[] {
  const out: SummaryBlockRef[] = [];
  for (const conversation of conversations) {
    if (conversation.incognito) continue;
    const summaries = conversation.summary
      ? [...(conversation.summaryArchive ?? []), conversation.summary]
      : (conversation.summaryArchive ?? []);
    for (const summary of summaries) {
      if (!summary?.text?.trim()) continue;
      const blocks: SummaryBlock[] = summary.blocks ?? looseSummaryBlocks(summary.text);
      const summaryId = `summary:${conversation.id}:${summary.upToIndex}`;
      blocks.forEach((block, index) => {
        const text = block.text.trim();
        if (!text) return;
        out.push({
          id: `block:${conversation.id}:${summary.upToIndex}:${index}`,
          summaryId,
          conversationId: conversation.id,
          conversationTitle: conversation.title,
          latest: summary === conversation.summary,
          text,
          tags: (block.tags ?? []).map((tag) => String(tag).trim()).filter(Boolean),
          at: block.at,
          updatedAt: summary.updatedAt,
          index,
        });
      });
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 转成 `recall.ts` 认的最小形状；日期并进正文，模型看到就知道这是哪天的旧事 */
export function blockToRecallable(ref: SummaryBlockRef): RecallableMemory {
  const at = ref.at || shortDate(ref.updatedAt);
  return {
    id: ref.id,
    content: at ? `${at} ${ref.text}` : ref.text,
    tags: [...(at ? [at] : []), ...ref.tags],
    kind: "summary",
    status: "active",
    createdAt: ref.updatedAt,
    updatedAt: ref.updatedAt,
  };
}

/** `block:conv:upTo:index` → 摘要库的 `summary:conv:upTo`（点来源链接用） */
export function summaryIdOfBlock(blockId: string): string | null {
  if (!blockId.startsWith("block:")) return null;
  const parts = blockId.split(":");
  if (parts.length < 4) return null;
  return `summary:${parts[1]}:${parts[2]}`;
}

/** `block:conv:upTo:index` 里的块下标（摘要库展开时定位高亮用） */
export function blockIndexOf(blockId: string): number {
  const parts = blockId.split(":");
  const index = Number(parts[3]);
  return Number.isInteger(index) && index >= 0 ? index : -1;
}
