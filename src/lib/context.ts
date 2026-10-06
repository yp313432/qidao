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
  /** 其中有多少条是**被摘要吸收**的（这部分没丢信息，只是换成了压缩版） */
  foldedIntosummary: number;
  historyTokens: number;
  attachmentTokens: number;
  /** 这一轮 tools 定义占多少（按上一轮真发出去的那些估） */
  toolTokens: number;
  /** 最近一次请求里服务端报上来的系统提示词大小（还没请求过就是 0） */
  systemTokens: number;
  total: number;
  budget: number;
  ratio: number;
  /** 这条对话有没有「更早的对话摘要」 */
  hasSummary: boolean;
  summaryTokens: number;
  /** 摘要省了多少（原文 − 摘要） */
  summarySaved: number;
  /** 固定开销（系统 + 工具）本身就超预算了 —— 该在界面上直说 */
  overBudget: boolean;
};

/**
 * 从说明书里把"动作名字清单"抠出来，估这一轮 tools 的大小。
 *
 * 为什么能这么算：说明书的形状是 `全部可用的动作名（逗号分隔）：\na、b、c`
 * （见 `lib/tool-select.ts` 的 `renderToolNameList`）—— 那是**稳定**的一段。
 * 这样就不用为了量个数而在 UI 里重跑一遍"按需注册"的判定（那要看用户的下一句话）。
 */
function toolTokensFromPrompt(prompt: string): number {
  const m = prompt.match(/全部可用的动作名[^\n]*\n([^\n]+)/);
  const names = m?.[1]?.split("、").filter(Boolean) ?? [];
  if (names.length === 0) return 0;
  /** 一个动作的 tools 定义 ≈ 它的 JSON：名字 + 说明 + 参数，实测 61 个 ≈ 4007 token */
  return Math.round((names.length / 61) * 4007);
}

/** 当前会话在预算里的分布（客户端估算）。 */
export function computeContext(): ContextBreakdown {
  const st = useApp.getState();
  const conv = st.conversations.find((c) => c.id === st.activeId);
  const all = conv?.messages ?? [];
  const log = st.requestLog;
  const systemTokens = log[0]?.systemTokens ?? 0;
  const toolTokens = systemTokens > 0 ? toolTokensFromPrompt(String(log[0]?.prompt ?? "")) : 0;
  const summary = conv?.summary;

  /**
   * ⚠️ 整轮口径（2026-10 改）：预算框的是**这一次请求的全部 token**（系统+工具+历史）。
   * 原来只把预算用在历史上，于是设置 6000 时实际早就 11550 了，用户从界面上看不出来。
   */
  const sent = historyForApi(all, {
    budget: st.settings.contextBudget,
    keepRecent: st.settings.keepRecent,
    autoCompact: st.settings.autoCompact,
    compactAt: st.settings.compactAt,
    systemTokens,
    toolTokens,
    summary: summary ? { text: summary.text, upToIndex: 0 } : undefined,
  });

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

  const budget = st.settings.contextBudget || 12000;
  const total = systemTokens + toolTokens + historyTokens + attachmentTokens;
  const contentMsgs = all.filter((m) => m.content.trim() || m.role === "user");
  return {
    messages: sent.length,
    totalMessages: contentMsgs.length,
    folded: Math.max(0, contentMsgs.length - sent.length),
    foldedIntosummary: summary?.covered ?? 0,
    historyTokens,
    attachmentTokens,
    toolTokens,
    systemTokens,
    total,
    budget,
    ratio: Math.min(1, total / budget),
    hasSummary: Boolean(summary?.text),
    summaryTokens: summary?.tokens ?? 0,
    summarySaved: Math.max(0, (summary?.sourceTokens ?? 0) - (summary?.tokens ?? 0)),
    overBudget: systemTokens + toolTokens >= budget,
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
