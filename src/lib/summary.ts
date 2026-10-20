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
  /** 第几次摘要（0 = 第一次）；旧摘要配额按它衰减，见 oldSummaryQuota() */
  passes?: number;
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
/** 摘要正文的上限（字）—— 太长了就失去"压缩"的意义 */
export const SUMMARY_MAX_CHARS = 280;

/**
 * 四段固定格式（用户 m09620 定的"结构化摘要"）。
 *
 * 为什么要固定段：一段散文重写几次就会把"未了的事"冲掉；
 * 固定槽位 + 各自字数上限，才能保证"答应过什么、没做完什么"永远有地方放。
 * 四个上限加起来 = SUMMARY_MAX_CHARS。
 */
export const SUMMARY_SECTIONS: { key: string; title: string; max: number; hint: string }[] = [
  { key: "state", title: "他现在的状态", max: 70, hint: "在干嘛、心情、身体；只写事实" },
  { key: "between", title: "你们之间", max: 90, hint: "发生过的事、关系变化、聊过的决定" },
  { key: "open", title: "未了的事", max: 70, hint: "答应过什么、没做完的、说好要做的（最重要）" },
  { key: "taboo", title: "雷区与约定", max: 50, hint: "忌讳、称呼、明确说过不喜欢的" },
];

/** 每攒多少条"还没摘过"的消息就摘一次（50 条 ≈ 25 轮） */
export const SUMMARY_EVERY_MESSAGES = 50;

/** 单次最多摘多少条 —— 攒了很久也不会一口气摘几百条 */
export const SUMMARY_BATCH_MAX = 50;

/**
 * 旧摘要能占的字数比例（按"第几次摘要"衰减）。
 *
 * 用户 m09621 原话的意思是"越早的内容越可以压"，但压到 40% 就到底
 * （再压就只剩骨架，等于忘掉）。第 2 次先保持 100%：刚摘的内容还很有用，
 * 没必要立刻挤掉。
 */
export function oldSummaryQuota(passes: number): number {
  /*
    ⚠️ 这里原来是 [1, 0.7, 0.5, 0.4]，有个漏洞（用户 m09723 追问"会不会爆"时发现）：
    第二次摘要时旧内容能占 100%，新摘的 25 轮**一个字都放不下**，等于白摘。

    总字数**恒定 280 字**（不是每段累加，是每次重写成同一段 280 字），
    所以只要保证"旧 + 新 = 280"就永远不会越滚越大：
      · 第二次：旧 140（50%）+ 新 140（50%）
      · 第三次起：旧 112（40%）+ 新 168（60%）—— 40% 是地板，再压就只剩骨架。
  */
  return Math.max(0, passes) <= 1 ? 0.5 : 0.4;
}

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
  /** 历史占多少 token（仅用于界面显示，不再决定触发） */
  historyTokens: number;
  /** 留给历史的额度（同上，仅显示） */
  historyRoom: number;
  /** 至少保留最近多少条不动（跟上下文设置里那个同一套值） */
  keepRecent: number;
  /** 每攒多少条就摘一次；不传用 SUMMARY_EVERY_MESSAGES */
  everyMessages?: number;
  /** 一次至少摘几条才划算（默认 6） */
  minBatch?: number;
}): SummaryPlan {
  const none: SummaryPlan = { should: false, batch: [], prompt: "", upToIndex: 0 };
  const minBatch = input.minBatch ?? 6;
  const every = Math.max(minBatch, input.everyMessages ?? SUMMARY_EVERY_MESSAGES);

  /**
   * 可摘范围：`summary.upToIndex` 之后、并且**不碰**最近 `keepRecent` 条。
   *
   * ⚠️ 2026-10 改（用户 m09621）：触发条件从"历史用到 80% token"改成
   * **"没摘过的攒到 every 条"**。旧写法有两个毛病：①`historyTokens` 算的是
   * "要发出去的历史"（只有最近 16 条），几乎永远碰不到线；②一旦碰到线，
   * 要摘的却是"上次摘要之后到现在"的全部（用户真机上一次性摘了 434 条）。
   */
  const keep = Math.max(2, input.keepRecent);
  const start = Math.max(0, input.summary?.upToIndex ?? 0);
  const end = Math.max(start, input.messages.length - keep);
  const pending = end - start;
  if (pending < every) return none;

  /** 一次最多摘 SUMMARY_BATCH_MAX 条，剩下的留给下次 */
  const take = Math.min(pending, SUMMARY_BATCH_MAX);
  const batch = input.messages.slice(start, start + take);
  /** 全是空壳就别摘（省一次调用） */
  const hasText = batch.some((m) => (m.content ?? "").trim().length > 0);
  if (!hasText) return none;

  const upToIndex = start + take;
  return {
    should: true,
    batch,
    prompt: buildSummaryPrompt(batch, input.summary),
    upToIndex,
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
    .map(
      (m) =>
        `${m.role === "user" ? "用户" : m.role === "assistant" ? "我" : "（系统/工具）"}：${m.content.trim()}`,
    )
    .join("\n");

  /**
   * 旧摘要的配额：越老的越可以压，但压到 40% 就到底。
   * 第一次摘（没有旧摘要）时全给新内容。
   */
  const passes = Math.max(0, previous?.passes ?? 0);
  const quota = previous?.text?.trim()
    ? Math.round(SUMMARY_MAX_CHARS * oldSummaryQuota(passes))
    : 0;
  const fresh = SUMMARY_MAX_CHARS - quota;

  const prev = previous?.text?.trim()
    ? `\n【已经有的摘要（更早的那些，必须并进新版）】\n${previous.text.trim()}\n
这份旧摘要最多只能占 ${quota} 字；新的对话占 ${fresh} 字。
处理规则：
1. 旧摘要里每一条，先看下面这段新对话有没有"提到它、更新它、推翻它"；
2. 有的 → **并成一条**（用新的说法，不要重复写两遍）；
3. 没有的 → 压进 ${quota} 字里（宁可写短，**不许整段删掉**）；
4. 「未了的事」和「雷区与约定」这两段里的条目**永远不许压缩掉**（除非新对话里明确说这件事做完了/取消了）。
`
    : "";

  const sectionLines = SUMMARY_SECTIONS.map(
    (x) => `· ${x.title}（最多 ${x.max} 字）—— ${x.hint}`,
  ).join("\n");

  return `把下面的对话压成一份**给未来的自己看**的摘要。${prev}
【只写四段，每段一行，标题照抄】
${sectionLines}

【规矩】
· 只写**事实**：谁做了什么、说了什么、发生了什么。不推测动机、不评价、不抒情。
· 时间写具体日期（"10 月 20 日"），不写"前几天/上次"。
· 指代固定：用户 = "她"，你自己 = "我"。不许自创新称呼。
· 合并重复：同一件事只写一次；新对话里更准确的，用新的。
· 必须带过来（不许因为"不重要"删掉）：答应过的事、没做完的事、用户明确说过的偏好与忌讳、称呼、重要日期。
· 四段加起来不超过 ${SUMMARY_MAX_CHARS} 字；某段没内容就写"（无）"，别用别的段去填。
· 只输出这四段正文，不要写"以下是摘要"之类的开场白。

【新对话原文】
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
