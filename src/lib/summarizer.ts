import {
  historyForApi,
  makeDirectRound,
  makeServerRound,
  type ApiMessage,
  type ChatDelta,
  type ChatRequest,
} from "@/lib/chat-client";
import { assembleMessages } from "@/lib/prompt";
import { useApp } from "@/lib/store";
import {
  buildSummaryPrompt,
  planSummary,
  SUMMARY_MAX_CHARS,
  type ConversationSummary,
  type SummaryMsg,
} from "@/lib/summary";
import { estimateTokens } from "@/lib/tokens";
import type { ModelId } from "@/lib/models";
import type { ReplyStyle, Conversation } from "@/lib/types";

/**
 * 对话摘要（滚动摘要）—— **真的去跑**：判定在 `lib/summary.ts`，这里负责发请求和落库。
 *
 * 用户拍板的需求：
 *   "ai 写，五十八十轮对话总结一次，你举得这个次数可以吗，还是要改，给我建议"
 *   → 建议是**不按轮数**、按空间触发（历史用到留给历史那部分的 80%）。
 *     默认预算 12000 时大约每 15~20 轮一次；预算调大频率自然降低。
 *   "摘要我也要能看见和编辑，就是屏幕总结完出现一条线，展开就是摘要"
 *   → 存在 `conversation.summary` 里，界面在对话顶部画一条可展开的线（能看能改）。
 *
 * 两条纪律（改的时候别破坏）：
 *   ① **不占用户的对话额度、也不产生新的对话消息** —— 它是一次后台的小请求：
 *      没有工具、没有历史、没有感知层，只有一段摘要提示词。
 *   ② **失败不能影响主流程** —— 摘不出来就照旧走"整条丢"，绝不能因为摘要失败
 *      让这一轮回复出问题。
 */

/** 库里那条消息之前已经被摘要吸收的位置（"水位线"）。没有摘要时是 0。 */
function watermark(conv: Conversation): number {
  return conv.summary?.upToIndex ?? 0;
}

/** 把库里的消息切成：已有的（被水位线盖住的）/ 新的 */
function sliceMessages(conv: Conversation, endExclusive: number) {
  return conv.messages.slice(watermark(conv), endExclusive);
}

/**
 * 调模型把一段对话压成摘要。
 *
 * **故意不传** `aiName` / `persona` / `context` / `worldAlways`：
 * 摘要不需要人设，也不需要"此刻在干什么" —— 多传只会让它更容易发挥（写进原文没有的东西），
 * 而往上下文里投毒（假记忆）**比忘掉更糟**。
 */
export async function summarizeBatch(opts: {
  prompt: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const st = useApp.getState();
  const settings = st.settings;
  const model: ModelId = st.model;
  const style: ReplyStyle = settings.replyStyle;

  const req: ChatRequest = {
    model,
    messages: [{ role: "user", content: opts.prompt }],
    style,
    tools: [],
    customBaseUrl: settings.customBaseUrl || undefined,
    customApiKey: settings.customApiKey || undefined,
    upstreamModel: settings.upstreamModel || undefined,
    name: "summary",
    // 摘要要稳、要短：给它一个明确的上限
    maxTokens: 700,
    assembled: assembleMessages(
      { style, tools: [], name: "summary" },
      [{ role: "user", content: opts.prompt }],
    ) as ApiMessage[],
  };

  let text = "";
  const onDelta = (d: ChatDelta) => {
    if (d.content) text += d.content;
  };

  const useDirect = Boolean(
    (settings.customBaseUrl ?? "").trim() && (settings.customApiKey ?? "").trim(),
  );
  const send = useDirect ? makeDirectRound(req) : makeServerRound(req);
  /** 摘要请求**不带 tools**（`tools: null`）—— 它不是"动手"，只是"把这段压一下" */
  const round = await send({ messages: req.assembled ?? [], tools: null, onDelta, signal: opts.signal });
  if (round.error && !text) return null;

  const clean = text
    .replace(/```[\s\S]*?```/g, "") // 它偶尔会包代码块
    .replace(/^#+\s*/gm, "") // 标题记号
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SUMMARY_MAX_CHARS);
  return clean || null;
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
): Promise<string | null> {
  const sourceTokens = batch.reduce((n, m) => n + estimateTokens(m.content), 0);
  const text = await summarizeBatch({ prompt: buildSummaryPrompt(batch, previous) });
  if (!text) return null;
  const conv = useApp.getState().conversations.find((c) => c.id === conversationId);
  useApp.getState().patchSummary(conversationId, {
    text,
    upToIndex,
    covered: (conv?.summary?.covered ?? 0) + coveredAdd,
    tokens: estimateTokens(text),
    sourceTokens: (conv?.summary?.sourceTokens ?? 0) + sourceTokens,
  });
  return text;
}

/**
 * 「这一轮写完了，看看要不要摘」—— 给 `use-chat` 每个回合末尾调一次。
 *
 * 判定是纯函数（`planSummary`）：**只有历史用到留给历史那部分的 80% 才摘** ——
 * 正常聊天永远不触发，长对话大约每 15~20 轮一次（预算 12000 时）。
 */
export async function maybeSummarize(opts: {
  conversationId: string;
  /** 这一轮**发出去**的那份历史（顺序 = 发出去的顺序） */
  history: ApiMessage[];
  systemTokens: number;
  toolTokens: number;
}): Promise<void> {
  const conv = useApp.getState().conversations.find((c) => c.id === opts.conversationId);
  if (!conv) return;
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
  const end = Math.max(from, conv.messages.length - keep);
  const batchSrc = sliceMessages(conv, end).filter((m) => m.content.trim());
  const batch: SummaryMsg[] = batchSrc.map((m) => ({ role: m.role, content: m.content }));

  const plan = planSummary({
    messages: batch,
    summary: conv.summary,
    historyTokens,
    historyRoom: room,
    keepRecent: 0,
    minBatch: 6,
  });
  if (!plan.should) return;

  await runAndStore(opts.conversationId, batch, conv.summary, end, batchSrc.length);
}

/** 界面上「重新生成摘要」用：立刻重摘一次（不看触发线） */
export async function summarizeNow(conversationId: string): Promise<string | null> {
  const st = useApp.getState();
  const conv = st.conversations.find((c) => c.id === conversationId);
  if (!conv) return null;
  const keep = Math.max(2, st.settings.keepRecent);
  const from = watermark(conv);
  const end = Math.max(from, conv.messages.length - keep);
  const batchSrc = sliceMessages(conv, end).filter((m) => m.content.trim());
  if (batchSrc.length === 0) return null;
  const batch: SummaryMsg[] = batchSrc.map((m) => ({ role: m.role, content: m.content }));
  return runAndStore(conversationId, batch, conv.summary, end, batchSrc.length);
}

export { historyForApi };
