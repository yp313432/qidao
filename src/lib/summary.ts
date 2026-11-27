/** 对话回顾：按未总结的消息条数触发，保留最近原文，生成带当前心态的自然中文记忆。
 * 本文件为纯逻辑，不依赖浏览器或 store。
 */

/**
 * 摘要里的一小块（2026-11 用户："摘要是被切分成一件一件的小事"）。
 *
 * 模型根据同一批原文分别写连贯回顾和独立要点。
 * 检索命中哪条就只带回哪条，出处还能指回摘要本身。
 */
export type SummaryBlock = {
  /** 这一小段本身（60~160 字，通常一件事） */
  text: string;
  /** 主题标签（1~3 个）—— 旧版按句切出的块可能没有 */
  tags?: string[];
  /** 日期线索（如 "11-18"）—— 原文没提到时不填 */
  at?: string;
  source?: { messageId: string; quote: string };
};

/** 自然回顾和独立要点的分隔标记 */
export const SUMMARY_BLOCK_HEAD = "【要点】";

/** 摘要存什么（存在这条对话自己身上，换对话各算各的） */
export type ConversationSummary = {
  /** 摘要正文（整段回顾） */
  text: string;
  /** 模型提炼的要点，或历史版本留下的摘录。空数组表示明确无要点。 */
  blocks?: SummaryBlock[];
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

export type SummaryMsg = { id?: string; role: "user" | "assistant" | "system" | "tool"; content: string };

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
  const nearBudget = input.historyRoom > 0 && input.historyTokens >= input.historyRoom * 0.8;
  if (pending < (nearBudget ? minBatch : every)) return none;

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
    prompt: buildSummaryPrompt(batch),
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
通常写成几段连贯的话，目标约 600~1000 字，最多 ${SUMMARY_MAX_CHARS} 字，内容少时就短些。第一行用「标题：」加 2–3 个汉字概括这段交流，下一行开始写回顾正文。不附工具调用或解释写作步骤。
正文写完后，另起一行写「${SUMMARY_BLOCK_HEAD}」，直接根据「本次需要回顾的原文」提炼 1–8 条值得以后找回的要点。
每条只写一件事，用自己的话概括，写清涉及的人、对象和结果或进度，让它离开正文也读得懂。优先保留明确的决定、约定、偏好、重要经历和待办。不要从回顾复制句子或按句切分，也不要重复同一件事。
每条另起一行，以「- 」开始，可在前面加「[日期][主题1,主题2]」（日期只取原文明示的日期）。每条最多 200 字。语境和心情只供理解；仅把本次原文支持的内容写入要点，区分提议、确认和完成。没有值得记的要点就在标记下一行写「无」。
如果一小句原话能保留当时的情绪、语气或关键措辞，可以在对应要点的行尾附一个「〔原话 3：逐字摘出的原话〕」标记，其中 3 换成原文的消息编号。原话限 4～80 字，必须在同一条消息里连续出现，保留原字和标点，不加省略号。没有特别值得留的原话就省略标记。`;
}

export function buildSummaryPrompt(batch: SummaryMsg[], previous?: ConversationSummary, mindset: SummaryMindset = {}): string {
  const lines = batch.filter((message) => message.content.trim()).map((message, index) =>
    `[${index + 1}] ${message.role === "user" ? "yan" : message.role === "assistant" ? "我" : "系统/工具结果"}：${message.content.trim()}`,
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
  return text && text.replace(/^标题[：:][^\n]*\n/, "").trim().length <= SUMMARY_MAX_CHARS ? text : null;
}

/** 一对方括号里像不像日期（"11-18"/"11月18日"/"昨天"…）；不像就当标签 */
function looksLikeDate(value: string): boolean {
  return /(?:\d{1,2}\s*[-/月.]\s*\d{1,2}|\d{4}|今天|昨天|前天|上周|这周|周[一二三四五六日天])/.test(value);
}

/** 解析一行要点："- [11-18][论文,疲惫] 改论文到凌晨两点，很累" */
function parseBlockLine(line: string, rejectOversize = false): SummaryBlock | null {
  const match = /^\s*[-*·]\s*(?:\[([^\]\n]{1,24})\])?\s*(?:\[([^\]\n]{1,40})\])?\s*(.+?)\s*$/.exec(line);
  if (!match) return null;
  const text = match[3].replace(/\s+/g, " ").trim();
  if (text.length < 4 || (rejectOversize && text.length > 200)) return null;
  let at = match[1]?.trim() || undefined;
  let tags = match[2] ? match[2].split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean) : [];
  /* 只写了一个括号、内容又不像日期 → 那其实是标签 */
  if (at && tags.length === 0 && !looksLikeDate(at)) {
    tags = at.split(/[,，、\s]+/).filter(Boolean);
    at = undefined;
  }
  return { text: text.slice(0, 200), at, tags: tags.length ? tags.slice(0, 4) : undefined };
}

/** 把「【要点】」后面那一段解析成小块；一行一块，最多 8 块，重复的丢掉 */
export function parseSummaryBlocks(part: string): SummaryBlock[] {
  const out: SummaryBlock[] = [];
  for (const line of part.split(/\r?\n/)) {
    const block = parseBlockLine(line);
    if (!block || out.some((item) => item.text === block.text)) continue;
    out.push(block);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * 解析一次摘要输出：标题 + 正文 + 要点块。
 *
 * 解析不出来（正文为空 / 超长）返回 `null` —— 调用方据此**不推进水位线**，
 * 跟原来 cleanSummaryText 的纪律一致：宁可不记，也不把半截当完整记忆。
 */
export function parseSummaryOutput(
  raw: string,
  requirePoints = false,
  batch: readonly SummaryMsg[] = [],
): { title?: string; text: string; blocks: SummaryBlock[] } | null {
  const body = String(raw ?? "").trim().replace(/^```(?:text|markdown|md)?\s*\n([\s\S]*?)\n```$/i, "$1").trim();
  if (!body) return null;
  const headAt = body.indexOf(SUMMARY_BLOCK_HEAD);
  const narrative = (headAt >= 0 ? body.slice(0, headAt) : body).replace(/\n{3,}/g, "\n\n").trim();
  const blockPart = headAt >= 0 ? body.slice(headAt + SUMMARY_BLOCK_HEAD.length) : "";
  const titleMatch = /^标题[：:]\s*([^\n]*)\n?/.exec(narrative);
  const title = titleMatch?.[1].trim() || undefined;
  const text = (titleMatch ? narrative.slice(titleMatch[0].length) : narrative).trim();
  if (!text || text.length > SUMMARY_MAX_CHARS) return null;
  if (!requirePoints) return { title, text, blocks: parseSummaryBlocks(blockPart) };

  if (headAt < 0 || body.lastIndexOf(SUMMARY_BLOCK_HEAD) !== headAt) return null;
  if (blockPart.trim() === "无") return { title, text, blocks: [] };
  const lines = blockPart.trim().split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0 || lines.length > 8) return null;

  const normalize = (value: string) => value.replace(/[\s\p{P}]+/gu, "");
  const narrativeText = normalize(text);
  const sources = batch.filter((message) => message.content.trim());
  const points = new Map<string, SummaryBlock>();
  for (const line of lines) {
    const marker = /\s*〔原话\s*(\d+)\s*[：:]([^〕]*)〕\s*$/.exec(line);
    const block = parseBlockLine(marker ? line.slice(0, marker.index) : line, true);
    if (!block) return null;
    if (marker) {
      const message = sources[Number(marker[1]) - 1];
      const quote = marker[2].trim();
      if (message?.id && (message.role === "user" || message.role === "assistant")
          && quote.length >= 4 && quote.length <= 80 && message.content.includes(quote)) {
        block.source = { messageId: message.id, quote };
      }
    }
    const key = normalize(block.text);
    if (!key || narrativeText.includes(key)) return null;
    if (!points.has(key)) points.set(key, block);
  }
  return { title, text, blocks: [...points.values()] };
}

/**
 * 旧摘要没有 blocks（这个字段是 2026-11 才加的）—— 用到时按句临时拆。
 *
 * 只临时拆、不回写：摘要是模型写的，逐条改存档会让"编辑/重摘"更绕；
 * 检索时拆一次足够，拆不干净也不会丢内容（整段仍能按句命中）。
 */
export function looseSummaryBlocks(text: string): SummaryBlock[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^。！？；…!?;]+[。！？；…!?;]?/g) ?? [clean];
  const out: SummaryBlock[] = [];
  let buffer = "";
  const flush = () => {
    const piece = buffer.trim();
    if (piece.length >= 8) out.push({ text: piece.slice(0, 200) });
    buffer = "";
  };
  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    if (buffer && (buffer + piece).length > 160) flush();
    buffer += piece;
    if (buffer.length >= 160) flush();
  }
  flush();
  return out.slice(0, 12);
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

