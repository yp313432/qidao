import { listTracks } from "@/lib/music-db";
import { useApp } from "@/lib/store";
import { historyForApi } from "@/lib/chat-client";
import { estimateTokens, prettyBytes } from "@/lib/tokens";

export { estimateTokens, shortHash, prettyBytes, thinkingToPrune } from "@/lib/tokens";

/**
 * 上下文与内存的度量。
 *
 * token 数是**估算**，不是真实分词 —— 目标是让你看清「预算花在哪」，
 * 而不是给出账单级精度。真实用量以消息下方那行 usage 为准。
 */

/** 粗略估算：ASCII 每 4 字符约 1 token；中日韩每字约 1 token。 */

export type ContextBreakdown = {
  /** 参与本次请求的消息条数 */
  messages: number;
  /** 会话里一共有多少条 */
  totalMessages: number;
  /** 被折叠掉的条数 */
  folded: number;
  historyTokens: number;
  attachmentTokens: number;
  /** 最近一次请求里服务端报上来的系统提示词大小（还没请求过就是 0） */
  systemTokens: number;
  total: number;
  budget: number;
  ratio: number;
};

/** 当前会话在预算里的分布（客户端估算）。 */
export function computeContext(): ContextBreakdown {
  const st = useApp.getState();
  const conv = st.conversations.find((c) => c.id === st.activeId);
  const all = conv?.messages ?? [];
  const sent = historyForApi(all, {
    budget: st.settings.contextBudget,
    keepRecent: st.settings.keepRecent,
    autoCompact: st.settings.autoCompact,
    compactAt: st.settings.compactAt,
  });
  const log = st.requestLog;
  const systemTokens = log[0]?.systemTokens ?? 0;

  let historyTokens = 0;
  let attachmentTokens = 0;
  for (const m of sent) {
    if (typeof m.content === "string") {
      historyTokens += estimateTokens(m.content);
    } else {
      for (const part of m.content) {
        if (part.type === "text") historyTokens += estimateTokens(part.text);
        // 图片按一张约 260 token 粗估
        else attachmentTokens += 260;
      }
    }
  }

  const budget = st.settings.contextBudget || 6000;
  const total = systemTokens + historyTokens + attachmentTokens;
  return {
    messages: sent.length,
    totalMessages: all.filter((m) => m.content.trim() || m.role === "user").length,
    folded: Math.max(0, all.filter((m) => m.content.trim()).length - sent.length),
    historyTokens,
    attachmentTokens,
    systemTokens,
    total,
    budget,
    ratio: Math.min(1, total / budget),
  };
}

/** 附件正文会被摊进多少 token。 */
export function attachmentTokensOf(text: string): number {
  return estimateTokens(text);
}

/** 某条消息贡献的 token（用于列表里显示）。 */
export function messageTokens(content: string, attachmentsText = ""): number {
  return estimateTokens(content) + estimateTokens(attachmentsText);
}

export type StorageUsage = {
  localBytes: number;
  musicBytes: number;
  musicTracks: number;
  quotaBytes: number | null;
  usedBytes: number | null;
  breakdown: { key: string; bytes: number }[];
};

function bytesOfLocalStorage(): { total: number; breakdown: { key: string; bytes: number }[] } {
  if (typeof localStorage === "undefined") return { total: 0, breakdown: [] };
  let total = 0;
  const breakdown: { key: string; bytes: number }[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    const val = localStorage.getItem(key) ?? "";
    // UTF-16，按 2 字节/字符 粗算
    const bytes = (key.length + val.length) * 2;
    total += bytes;
    breakdown.push({ key, bytes });
  }
  breakdown.sort((a, b) => b.bytes - a.bytes);
  return { total, breakdown };
}

export async function computeStorage(): Promise<StorageUsage> {
  const { total, breakdown } = bytesOfLocalStorage();

  let musicBytes = 0;
  let musicTracks = 0;
  try {
    const tracks = await listTracks();
    musicTracks = tracks.length;
    for (const t of tracks) musicBytes += t.blob.size;
  } catch {
    /* IndexedDB 不可用就算了 */
  }

  let quotaBytes: number | null = null;
  let usedBytes: number | null = null;
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      quotaBytes = est.quota ?? null;
      usedBytes = est.usage ?? null;
    }
  } catch {
    /* 不支持就算了 */
  }

  return { localBytes: total, musicBytes, musicTracks, quotaBytes, usedBytes, breakdown };
}

/** 思考档案会占多少地方（估算）。 */
