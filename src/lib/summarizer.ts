import {
  historyForApi,
  makeDirectRound,
  makeServerRound,
  type ApiMessage,
  type ChatDelta,
  type ChatRequest,
} from "@/lib/chat-client";
import { useApp } from "@/lib/store";
import {
  buildSummaryPrompt,
  planSummary,
  summarySystemPrompt,
  cleanSummaryText,
  type ConversationSummary,
  type SummaryMsg,
} from "@/lib/summary";
import { estimateTokens, shortHash } from "@/lib/tokens";
import { measureRequest, mergeReportedUsage } from "@/lib/request-accounting";
import { uid } from "@/lib/utils";
import type { Conversation } from "@/lib/types";

/** 回顾请求独立于聊天说明书；记录用量，失败不影响聊天，不推进原文水位线。 */

/** 库里那条消息之前已经被摘要吸收的位置（"水位线"）。没有摘要时是 0。 */
function watermark(conv: Conversation): number {
  return conv.summary?.upToIndex ?? 0;
}

/** 把库里的消息切成：已有的（被水位线盖住的）/ 新的 */
function sliceMessages(conv: Conversation, endExclusive: number) {
  return conv.messages.slice(watermark(conv), endExclusive);
}

/** 总结使用独立指令，只携带本次原文、此前回顾和当前心态语境。 */
export async function summarizeBatch(opts: {
  prompt: string;
  conversationId?: string;
  replyId?: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const st = useApp.getState();
  const settings = st.settings;
  const system = summarySystemPrompt();
  const messages: ApiMessage[] = [{ role: "system", content: system }, { role: "user", content: opts.prompt }];
  const req: ChatRequest = {
    model: "haiku", messages, assembled: messages, assembledMessages: messages,
    name: settings.displayName, style: settings.replyStyle, tools: [], actionTools: undefined,
    customBaseUrl: settings.customBaseUrl || undefined,
    customApiKey: settings.customApiKey || undefined,
    upstreamModel: settings.upstreamModel || undefined,
    effortOn: settings.effortProbeOk === true,
    maxTokens: 4096,
  };
  const replyId = opts.replyId || uid("summaryrun");
  const requestIndex = Math.max(0, ...st.requestLog.filter((entry) => entry.replyId === replyId).map((entry) => entry.requestIndex ?? 0)) + 1;
  let upstream = "内置上游";
  try { if (settings.customBaseUrl) upstream = new URL(settings.customBaseUrl).host; } catch { upstream = "自定义上游"; }
  const entry = {
    at: Date.now(), requestId: uid("summaryrequest"), replyId, requestIndex,
    conversationId: opts.conversationId, purpose: "summary" as const,
    model: req.upstreamModel || req.model, upstream, promptHash: shortHash(system),
    systemTokens: estimateTokens(system), tools: 0,
    inputEstimate: measureRequest(messages, null, { sections: [{ id: "summary", title: "回忆总结指令", text: system }] }),
  };
  st.logRequest(entry);
  let streamed = "";
  let usage: ChatDelta["usage"];
  const receive = (delta: ChatDelta) => {
    if (delta.content) streamed += delta.content;
    if (delta.usage) {
      usage = mergeReportedUsage(usage, delta.usage);
      useApp.getState().logRequest({ ...entry, prompt: usage?.prompt, completion: usage?.completion, cached: usage?.cached });
    }
  };
  try {
    const send = settings.customBaseUrl?.trim() && settings.customApiKey?.trim() ? makeDirectRound(req) : makeServerRound(req);
    const round = await send({ messages, tools: null, onDelta: receive, signal: opts.signal });
    usage = mergeReportedUsage(usage, round.usage);
    useApp.getState().logRequest({ ...entry, prompt: usage?.prompt, completion: usage?.completion, cached: usage?.cached });
    if (round.error || round.stalled || opts.signal?.aborted) return null;
    return cleanSummaryText(round.content || streamed, round.finishReason === "length");
  } catch {
    // 失败不覆盖旧回顾，也不把未总结的原文标成已覆盖。
    return null;
  }
}

/** 把一批消息压成摘要并落库（两个入口共用：自动触发 / 用户点"重新生成"） */
async function runAndStore(
  conversationId: string,
  batch: SummaryMsg[],
  previous: ConversationSummary | undefined,
  /** 库里的下标：摘要覆盖到这儿（不含） */
  upToIndex: number,
  /** 这一批里有多少条是"有内容的"（界面上显示"吸收了 N 条"） */
  coveredAdd: number,
  replyId?: string,
): Promise<string | null> {
  const sourceTokens = batch.reduce((n, m) => n + estimateTokens(m.content), 0);
  const state = useApp.getState();
  const active = state.conversations.find((conversation) => conversation.id === conversationId);
  const mood = state.emotionEvents[0];
  const recent = active?.messages.filter((message) => message.content.trim()).slice(-4)
    .map((message) => `${message.role === "user" ? "yan" : "我"}：${message.content.trim().slice(0, 240)}`).join("\n");
  const text = await summarizeBatch({ conversationId, replyId, prompt: buildSummaryPrompt(batch, undefined, {
    now: new Date().toLocaleString("zh-CN", { hour12: false }),
    mood: mood ? `${mood.primaryEmotion}（${new Date(mood.at).toLocaleString("zh-CN", { hour12: false })}记录）` : undefined,
    recent,
  }) });
  if (!text) return null;
  const conv = useApp.getState().conversations.find((c) => c.id === conversationId);
  if (!conv || conv.incognito || conv.summary !== previous || upToIndex > conv.messages.length) return null;
  useApp.getState().patchSummary(conversationId, {
    fromIndex: previous?.upToIndex ?? 0,
    text,
    /* 仅记录总结次数，不再机械压缩旧内容比例。 */
    passes: (previous?.passes ?? 0) + 1,
    upToIndex,
    covered: coveredAdd,
    tokens: estimateTokens(text),
    sourceTokens,
  }, true);
  return text;
}

/** 每轮结束后按未总结消息数判定；最近 keepRecent 条继续保留原文。 */
export async function maybeSummarize(opts: {
  conversationId: string;
  replyId?: string;
  /** 这一轮**发出去**的那份历史（顺序 = 发出去的顺序） */
  history: ApiMessage[];
  systemTokens: number;
  toolTokens: number;
}): Promise<void> {
  const conv = useApp.getState().conversations.find((c) => c.id === opts.conversationId);
  if (!conv || conv.incognito) return;
  const settings = useApp.getState().settings;
  const budget = settings.contextBudget || 12000;
  const room = Math.max(0, budget - opts.systemTokens - opts.toolTokens);

  const historyTokens = opts.history.reduce(
    (n, m) => n + (typeof m.content === "string" ? estimateTokens(m.content) : 260),
    0,
  );

  /**
   * ⚠️ 判定用的下标是"**库里**的下标"，不是"发出去那份"的下标 ——
   * 两者不一样：库里还有空消息、以及已经被摘要吸收过的那些。
   * 所以这里先按水位线切出"还没摘过的那一段"，再把最近 `keepRecent` 条留在外面。
   */
  const keep = Math.max(2, settings.keepRecent);
  const from = watermark(conv);
  const messages: SummaryMsg[] = conv.messages.map((m) => ({ role: m.role, content: m.content }));

  /** 用户关掉「自动折叠」就别再自动摘了（他手动点"重新总结"仍然可以） */
  if (settings.autoCompact === false) return;

  const plan = planSummary({
    messages,
    summary: conv.summary,
    historyTokens,
    historyRoom: room,
    keepRecent: keep,
    /* 触发改成"没摘过的攒够多少条"（用户 m09621："25 轮摘一次"） */
    everyMessages: settings.summaryEvery || 50,
    minBatch: 6,
  });
  if (!plan.should) return;

  const batch = plan.batch.filter((message) => message.content.trim());
  if (plan.upToIndex <= from) return;
  await runAndStore(opts.conversationId, batch, conv.summary, plan.upToIndex, batch.length, opts.replyId);
}

/** 界面上「重新生成摘要」用：立刻重摘一次（不看触发线） */
export async function summarizeNow(conversationId: string): Promise<string | null> {
  const st = useApp.getState();
  const conv = st.conversations.find((c) => c.id === conversationId);
  if (!conv || conv.incognito) return null;
  const lastMessage = conv.messages.at(-1);
  const batchEnd = lastMessage?.role === "assistant" && !lastMessage.content.trim()
    ? conv.messages.length - 1
    : conv.messages.length;
  const batchSrc = sliceMessages(conv, batchEnd).filter((m) => m.content.trim());
  if (batchSrc.length === 0) return null;

  /**
   * 手动「重新总结」一次可能面对 400+ 条未摘消息（真机就出现过 434 条）。
   * 一次性全塞给上游有爆上下文的风险，所以这里按 token 从最早未总结的消息依次收取：
   * 超了就只总结连续的前一段，水位线停在真正压到的那一条，剩下的下次再压。
   */
  const MAX_SRC_TOKENS = 24000;
  let src = batchSrc;
  const allTokens = batchSrc.reduce((n, m) => n + estimateTokens(m.content), 0);
  if (allTokens > MAX_SRC_TOKENS) {
    const kept: typeof batchSrc = [];
    let used = 0;
    for (const item of batchSrc) {
      const tokens = estimateTokens(item.content);
      if (used + tokens > MAX_SRC_TOKENS) break;
      kept.push(item); used += tokens;
    }
    if (!kept.length) return null;
    src = kept;
  }

  const batch: SummaryMsg[] = src.map((m) => ({ role: m.role, content: m.content }));
  /* 水位线：这一批最后一条在**库里的下标 +1**（batchSrc 已过滤空消息，不能直接拿长度当下标） */
  const last = src[src.length - 1];
  let upTo = batchEnd;
  if (last) {
    const idx = conv.messages.lastIndexOf(last);
    if (idx >= 0) upTo = idx + 1;
  }
  return runAndStore(conversationId, batch, conv.summary, upTo, src.length);
}

export { historyForApi };

