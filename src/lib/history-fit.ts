import { estimateTokens } from "@/lib/tokens";
import type { ApiMessage } from "@/lib/chat-client";

/**
 * 「一次请求到底占多少」与「历史还能装多少」—— **只算数，不碰 store、不碰网络**。
 *
 * 为什么要单独一个文件（而不是塞在 `context.ts` 里）：
 *   这些是**纯函数**，要能在纯 node 里被单测（`verify-budget-fit.mjs`），
 *   而 `context.ts` 一 import 就带上 store / IndexedDB。
 *
 * ── 为什么要有这个文件（用户拍板的第一步）────────────────────────
 *
 * 原来的 `contextBudget`（默认 6000）**只算历史、不算系统提示词和工具定义** ——
 * 那是个假数字：实测短对话就已经 7970、长对话稳在 11550（超出设置近一倍），
 * 用户从界面上**完全看不出来自己已经超了**，也看不出来"更早的对话已经丢了"。
 *
 * 所以现在改成**整轮口径**：预算框住"这一次请求的全部 token"。
 */

/** 只取历史里"人能读的内容"那部分 —— 附件正文不在这个文件里粗算（见 context.ts） */
function contentTokens(content: ApiMessage["content"]): { text: number; image: number } {
  if (typeof content === "string") return { text: estimateTokens(content), image: 0 };
  let text = 0;
  let image = 0;
  for (const part of content ?? []) {
    if (part.type === "text") text += estimateTokens(part.text);
    else image += 260; // 一张图粗估
  }
  return { text, image };
}

export type RequestEstimate = {
  /** 系统提示词（含说明书、工具清单、规则） */
  system: number;
  /** 这一轮 tools 定义的 token（按需挑过的那几个） */
  tools: number;
  /** 历史消息（含图片的粗估） */
  history: number;
  /** 合计 = 系统 + 工具 + 历史 */
  total: number;
  /** 分给历史的额度（= max(0, 预算 − 系统 − 工具)） */
  historyRoom: number;
};

/**
 * 量一次请求。
 *
 * @param systemPrompt 已经拼好的系统提示词（调用方给，避免这里再拼一遍）
 * @param toolsJson    这一轮要发的 tools 的 JSON（`JSON.stringify(actionToolsFor(kinds))`）
 * @param messages     要发出去的历史
 * @param budget       整轮预算
 */
export function estimateRequest(
  systemPrompt: string,
  toolsJson: string,
  messages: ApiMessage[],
  budget: number,
): RequestEstimate {
  const system = estimateTokens(systemPrompt);
  const tools = toolsJson.length > 2 ? estimateTokens(toolsJson) : 0;
  let history = 0;
  for (const m of messages) {
    const t = contentTokens(m.content);
    history += t.text + t.image;
  }
  const room = Math.max(0, budget - system - tools);
  return { system, tools, history, total: system + tools + history, historyRoom: room };
}

export type FitInput = {
  /** 系统提示词 token */
  system: number;
  /** 这一轮工具定义 token */
  tools: number;
  /** 整轮预算 */
  budget: number;
  /** 至少保留最近多少条（预算再紧也不裁） */
  keepRecent: number;
  /** 用到多少比例就开始裁（0~100） */
  compactAt: number;
};

export type FitPlan = {
  /** 留给历史的额度 */
  historyRoom: number;
  /** 从第几条开始发（前面的已经被裁掉/被摘要吸收）；与 messageTokens 的下标对应 */
  fromIndex: number;
  /** 裁掉了几条 */
  dropped: number;
  /** 这次裁剪后，历史占多少 token */
  historyTokens: number;
  /** 固定开销（系统 + 工具）本身是不是已经超预算了 —— 超了就该在界面上说清楚 */
  overBudget: boolean;
};

/**
 * 算"从第几条开始发"（**不真的裁**，只给下标 —— 调用方拿着它去切数组）。
 *
 * 规则跟原来一致（从最新往回收，装不下就停；最近 `keepRecent` 条无条件保留），
 * 区别只有一处：**额度算的是"整轮预算 − 系统 − 工具"**（原来是"整轮预算"）。
 *
 * @param tokenOf 第 i 条的 token（调用方给，这里不重新算一遍）
 */
export function planHistoryFit(
  input: FitInput,
  total: number,
  tokenOf: (i: number) => number,
): FitPlan {
  const historyRoom = Math.max(0, input.budget - input.system - input.tools);
  /** 用到比例线之上才开始往回扔（`compactAt` 是"用到百分之多少"） */
  const limit = historyRoom * (Math.min(100, Math.max(1, input.compactAt)) / 100);
  const keep = Math.max(2, input.keepRecent);

  let used = 0;
  let from = total;
  for (let i = total - 1; i >= 0; i -= 1) {
    const forced = total - i <= keep;
    const t = tokenOf(i);
    if (!forced && used + t > limit) break;
    used += t;
    from = i;
  }
  return {
    historyRoom,
    fromIndex: from,
    dropped: from,
    historyTokens: used,
    overBudget: input.system + input.tools >= input.budget,
  };
}
