/**
 * 对话摘要（滚动摘要）—— **什么时候摘、摘哪几条、摘要长什么样**。
 *
 * 用户拍板的需求（原话）：
 *   "按你的来，修正加摘要"
 *   "ai 写，五十八十轮对话总结一次，你举得这个次数可以吗，还是要改，给我建议"
 *   "摘要我也要能看见和编辑，就是屏幕总结完出现一条线，展开就是摘要"
 *
 * ── 为什么需要它 ──────────────────────────────────────────────
 *
 * 现在超预算的处理是**整条丢掉**更早的消息（"忘掉"）。丢掉的后果是
 * 模型**再也想不起来**那部分 —— 而长对话里恰恰是前面那些"我们定过什么、
 * 他喜欢什么、还有什么事没做完"最有价值。
 *
 * ── 频率为什么不按"轮数"定 ────────────────────────────────────
 *
 * 用户提的是"50~80 轮一次"。但实测（`probe-history-trim.mjs`）默认预算下
 * **20~30 轮就已经开始丢**了 —— 按 50~80 轮触发，等于中间几十轮白丢。
 * 所以拍板改成**按空间触发**：历史用到"留给历史那部分的 80%"时摘一次。
 * 轮数是**结果**不是设定：预算 12000 ≈ 每 15~20 轮；预算调到 20000 ≈ 每 25~30 轮。
 *
 * 这个文件**零 import**（纯逻辑，纯 node 可直接跑），
 * 所以判定/切段/提示词这几件事能被 `verify-summary.mjs` 单测。
 */

/** 摘要存什么（存在这条对话自己身上，换对话各算各的） */
export type ConversationSummary = {
  /** 摘要正文 */
  text: string;
  /** 已经摘到第几条（**不含**这条）—— 它之前的消息都在摘要里了 */
  upToIndex: number;
  /** 一共吸收了多条 */
  covered: number;
  /** 摘要自身占多少 token（估算；用于界面上显示"省了多少"） */
  tokens: number;
  /** 最后一次生成时间 */
  updatedAt: number;
  /** 生成摘要时这一批原文占多少 token（省了多少就看它） */
  sourceTokens: number;
};

export type SummaryMsg = { role: "user" | "assistant" | "system" | "tool"; content: string };

export type SummaryPlan = {
  /** 该不该摘 */
  should: boolean;
  /** 要交给模型去压的那些消息（已经切好） */
  batch: SummaryMsg[];
  /** 交给模型的完整提示词 */
  prompt: string;
  /** 摘要写回来之后，`upToIndex` 应该是多少 */
  upToIndex: number;
};

/**
 * 触发线：历史用到"留给历史那部分"的百分之多少就摘。
 *
 * 80 是这么定的：留 20% 的余量给"这一轮刚要发的新消息 + 工具回灌"，
 * 免得刚摘完就又爆。别调太低（会频繁摘、白花钱），也别调太高（来不及摘就丢了）。
 */
export const SUMMARY_TRIGGER_RATIO = 0.8;

/** 摘要正文的上限（字）—— 太长了就失去"压缩"的意义 */
export const SUMMARY_MAX_CHARS = 320;

/**
 * 决定"现在该不该摘、摘哪几条"。
 *
 * 不摘的三种情况（都要想清楚，否则会白花钱或摘出废话）：
 *   ① 没超触发线
 *   ② 能摘的（除去要保留的最近 N 条）太少 —— 摘两句话不值得花一次调用
 *   ③ 要摘的那些**一个字都没有**（空消息/纯附件）→ 摘出来是空话，还污染上下文
 */
export function planSummary(input: {
  /** 这次要发出去的历史（已经裁过的，顺序 = 要发的顺序） */
  messages: SummaryMsg[];
  /** 已有的摘要（没有就 undefined） */
  summary?: ConversationSummary;
  /** 历史占多少 token */
  historyTokens: number;
  /** 留给历史的额度 */
  historyRoom: number;
  /** 至少保留最近多少条不动（跟上下文设置里那个同一套值） */
  keepRecent: number;
  /** 一次至少摘几条才划算（默认 6） */
  minBatch?: number;
}): SummaryPlan {
  const none: SummaryPlan = { should: false, batch: [], prompt: "", upToIndex: 0 };
  const minBatch = input.minBatch ?? 6;

  /** ① 没到触发线就别动 */
  const trigger = Math.max(1, input.historyRoom) * SUMMARY_TRIGGER_RATIO;
  if (input.historyTokens < trigger) return none;

  /**
   * ② 可摘范围：`summary.upToIndex` 之后、并且**不碰**最近 `keepRecent` 条。
   * 注意用 `max(upToIndex, 0)` 起步 —— 已经摘过的不重复摘。
   */
  const keep = Math.max(2, input.keepRecent);
  const start = Math.max(0, input.summary?.upToIndex ?? 0);
  const end = Math.max(start, input.messages.length - keep);
  if (end - start < minBatch) return none;

  const batch = input.messages.slice(start, end);
  /** ③ 全是空壳就别摘（省一次调用） */
  const hasText = batch.some((m) => (m.content ?? "").trim().length > 0);
  if (!hasText) return none;

  return {
    should: true,
    batch,
    prompt: buildSummaryPrompt(batch, input.summary),
    upToIndex: end,
  };
}

/**
 * 给模型的摘要提示词。
 *
 * ⚠️ 这段的核心是**只许压缩、不许发挥**：摘要是"我们聊过什么"的记录，
 * 不是模型的创作。写进"我猜他知道…"这种东西，等于往上下文里**投毒**（假记忆），
 * 比忘掉更糟 —— 忘掉只是记不起来，记错是拿错的当真的用。
 */
export function buildSummaryPrompt(
  batch: SummaryMsg[],
  previous?: ConversationSummary,
): string {
  const lines = batch
    .filter((m) => (m.content ?? "").trim())
    .map((m) => `${m.role === "user" ? "用户" : m.role === "assistant" ? "我" : "（系统/工具）"}：${m.content.trim()}`)
    .join("\n");

  const prev = previous?.text?.trim()
    ? `\n【已经有的摘要（更早的那些，请一起并入新版，别丢信息）】\n${previous.text.trim()}\n`
    : "";

  return `把下面这段对话压成一份**给未来的自己看**的摘要。${prev}
【要写的（只写这几类事实）】
· 聊了什么、聊出了什么结论或决定
· 用户的偏好、习惯、重要的身边人／日子
· 还没做完、约好要做的事（谁答应谁什么）
· 情绪要点（他很在意的事、明显的起伏）

【不许写的】
· 你的推测、脑补、"他可能需要…" —— **只写实际说过的**
· 客套话、复述原文、逐条流水账
· 任何原文里没有的信息（宁可漏，别编）

【格式】不超过 ${SUMMARY_MAX_CHARS} 字，用短句或短条目，中文。
（这份摘要会替代原文进入后续对话，所以**准确性最重要**：拿不准的就别写。）

【对话原文】
${lines}`;
}

/**
 * 把摘要放进发出去的 messages 的**最前面**。
 *
 * 为什么标"原文已不再带上"：不标的话模型会把摘要当成用户的**原话**，
 * 于是可能出现"你说过 X"（其实只是摘要里的一句概括）这种对不上的情况。
 */
export function summaryMessage(summary: ConversationSummary): SummaryMsg {
  return {
    role: "system",
    content:
      "【更早的对话（摘要，原文已不再带上）】\n" +
      `${summary.text.trim()}`,
  };
}
