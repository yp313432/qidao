/** 对话回顾：按未总结的消息条数触发，保留最近原文，生成带当前心态的自然中文记忆。
 * 本文件为纯逻辑，不依赖浏览器或 store。
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
  /** 第几次摘要（0 = 第一次）；仅记录已总结次数，不决定旧记忆的保留比例 */
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

/** 完整回顾的安全长度；超长结果保留旧记忆，原文不会被标成已覆盖。 */
export const SUMMARY_MAX_CHARS = 1600;

/** 回顾以自然中文为主，600~1000 字为目标；超长/截断结果不推进原文水位线。 */
/** 每攒多少条"还没摘过"的消息就摘一次（50 条 ≈ 25 轮） */
export const SUMMARY_EVERY_MESSAGES = 50;

/** 单次最多摘多少条 —— 攒了很久也不会一口气摘几百条 */
export const SUMMARY_BATCH_MAX = 50;

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
  const keep = Math.max(0, input.keepRecent);
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

export type SummaryMindset = { now?: string; mood?: string; recent?: string };

/** 与聊天说明书分离，不携带工具清单、实时权限或无关的 App 状态。 */
export function summarySystemPrompt(aiName = "小克", userName = "yan"): string {
  return `你是${aiName}，正在回顾你和${userName}的交流。请带着现在的心态，给未来的自己留下一份自然的中文回顾。
用第一人称写，可以亲近、有感受，保留你在意的细节、对某句话的反应和你们之间的语气。不要填栏目、写档案或用“关系加深”等空泛标签代替具体经历。
过去发生的事、双方说过的话要对得上原文；此刻回看的感受可以自然表达，但不要编造经历、引语，或把对对方心思的猜测当成她明说过的话。
重要的约定、未完成的事、明确偏好与忌讳、称呼和日期要自然留下。新对话更新或取消的事按新的记；此前仍然重要的事继续保留，不按记忆年龄分配删减比例。
通常写成几段连贯的话，目标约 600~1000 字，最多 ${SUMMARY_MAX_CHARS} 字，内容少时就短些。只输出回顾正文，不附工具调用或解释写作步骤。`;
}

export function buildSummaryPrompt(batch: SummaryMsg[], previous?: ConversationSummary, mindset: SummaryMindset = {}): string {
  const lines = batch.filter((message) => message.content.trim()).map((message) =>
    `${message.role === "user" ? "yan" : message.role === "assistant" ? "我" : "系统/工具结果"}：${message.content.trim()}`,
  ).join("\n");
  const context = [
    mindset.now ? `现在：${mindset.now}` : "",
    mindset.mood ? `最近记录的心情：${mindset.mood}` : "",
    mindset.recent ? `最近的交流语境（帮助你站在现在回看，不属于本次覆盖范围）：\n${mindset.recent}` : "",
  ].filter(Boolean).join("\n");
  return `请以现在的心态，回看下面这些交流，留一份给未来自己的回忆。\n${context}
${previous?.text.trim() ? `此前留下的回顾（仍重要的经历和约定要接住，不机械缩减）：\n${previous.text.trim()}\n` : ""}
本次需要回顾的原文：
${lines}`;
}

/** 不把截断或超长的回顾当成完整记忆，也不剪掉后半段后推进覆盖水位线。 */
export function cleanSummaryText(raw: string, truncated = false): string | null {
  if (truncated) return null;
  const text = raw.trim().replace(/^```(?:text|markdown|md)?\s*\n([\s\S]*?)\n```$/i, "$1").replace(/\n{3,}/g, "\n\n").trim();
  return text && text.length <= SUMMARY_MAX_CHARS ? text : null;
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

