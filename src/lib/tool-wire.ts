/**
 * 原生 `tools`（function calling）协议里那些**纯函数** —— 解析参数、认出"这把上游不认 tools"。
 *
 * 为什么要单独一个文件：主链路（`chat-client`）和验收脚本都要用同一套判断，
 * 而它们跑在两个环境里（浏览器 / 纯 node），所以这个文件**不许 import 任何东西**，
 * 也不许碰浏览器 API —— 这样 `verify-tool-loop.mjs` 能用 `node --experimental-strip-types` 直接跑。
 *
 * 跟隔壁 `tool-calls.ts` 的分工：
 *   · `tool-calls.ts` —— 把**流式的分片 `tool_calls`** 拼成完整的"名字 + 参数字符串"
 *   · 本文件        —— 拿到拼好的**参数字符串之后**的事（解析成对象、认降级信号）
 */

/** 模型给的参数是不是"看起来像 JSON 对象"（空字符串也很常见：无参调用） */
export function looksLikeJsonArgs(text: string): boolean {
  if (typeof text !== "string") return false;
  const t = text.trim();
  if (!t) return true;
  if (!(t.startsWith("{") || t.startsWith("["))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

export type ToolArgsParse = {
  /** 解析出来的参数对象；解析不了就是空对象 */
  args: Record<string, unknown>;
  /** 解析失败时给模型看的一句人话（成功时没有） */
  error?: string;
};

/**
 * 把模型给的 `arguments` 字符串变成对象。
 *
 * 三种情况都要如实区分（用户最烦的"他悄悄没干活"就是从这儿开始的）：
 *   ① 空字符串 / 空对象 → 成功，没有参数（无参调用很常见，不是错）
 *   ② 合法 JSON 对象     → 成功
 *   ③ 半截 JSON、纯文字  → **不算成功**：回一句原因给模型，让它自己重写一遍参数
 *
 * 注意：`null` / 数组 / 数字都当失败 —— 内部动作的参数永远是对象。
 */
export function parseToolArgs(raw: string): ToolArgsParse {
  // 防御性：签名要求 string，但真到了脏输入也不该把上层炸掉（退回"没有参数"）
  if (typeof raw !== "string") return { args: {}, error: "参数不是一段文本" };
  const text = raw.trim();
  if (!text) return { args: {} };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { args: parsed as Record<string, unknown> };
    }
    return { args: {}, error: "参数不是一个 JSON 对象" };
  } catch (err) {
    const why = (err as Error)?.message || "解析不了";
    return { args: {}, error: `参数不是合法的 JSON（${why}）` };
  }
}

/**
 * 上游是不是**明确拒绝**了 `tools` 这个参数？
 *
 * 为什么要单独拎出来：这是"该不该自动降级回文本协议"的唯一信号，
 * 判错了只有两种下场 —— 要么一直报错，要么把本来支持工具的上游降级掉。
 *
 * 三条同时成立才算：
 *   ① **400 系**（400 / 404 / 422）—— 401 密钥、403 权限、429 限流、5xx 对方挂了
 *      摘掉 tools 也一样不通，降级只会把真因盖住；
 *   ② 正文里**提到了工具**（英文 tool 或中文「工具」）——
 *      不然一句泛泛的 400（比如 "invalid api key"）会被当成"不支持工具"；
 *   ③ 说清了是"不认识 / 不支持"。
 *
 * ⚠️ 中文那一条是**真踩过的**：上游（国内中转）回「不支持工具调用」时，
 * 只认 ASCII `tool` 会让降级永远不触发，用户就一直看着报错（edge-verify 抓到的）。
 */
export function looksLikeToolsUnsupported(status: number, body: string): boolean {
  if (status !== 400 && status !== 404 && status !== 422) return false;
  const text = (body ?? "").toLowerCase();
  if (!/tool|工具|函数调用/.test(text)) return false;
  return /not supported|unsupported|unknown|invalid|unrecognized|no such|不支持|不允许|无法识别|不能识别/.test(
    text,
  );
}

/**
 * 这一轮"什么都没有"（没正文、没思考、没有工具调用）——
 * 这种情况才值得自动重试一次（实测：经过代理的流会被中途掐断，只剩一条空回复）。
 *
 * ⚠️ **光有工具调用、没有正文不算空** —— 这正是上了原生 tools 之后
 * 最容易写错的地方：按老规矩判断"没正文 = 失败"，工具轮会被无限重发。
 */
export function isEmptyRound(r: {
  content: string;
  thinking: string;
  toolCalls: unknown[];
}): boolean {
  return !r.content.trim() && !r.thinking.trim() && r.toolCalls.length === 0;
}
