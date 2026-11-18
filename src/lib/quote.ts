/**
 * 「> 引用：xxx」这套标记的解析与校验（纯函数，能直接单测）。
 *
 * 由来（用户 m01498 第 1 条）：引用**修改在气泡下面引用，跟微信那样**。
 * 发送时把被引用的原句拼在正文前面（`> 引用：xxx\n\n正文`），显示时再摘出来
 * 单独摆一条小灰条 —— 数据本身不动，历史消息、模型上下文全都不受影响。
 *
 * 2026-11-18 用户 m01264/m01282：「我现在可以引用 AI 说的话，能不能让 AI 也可以
 * 引用我说的话」→ AI 也用同一个标记（提示词里教一句），渲染走同一条管线。
 */
const QUOTE_HEAD = /^>\s*引用\s*[：:]\s*([^\n]*)\n+([\s\S]*)$/;

/** 把正文拆成「引用的那句」+「剩下的正文」；没有引用头就原样返回 */
export function splitQuote(content: string): { quote: string | null; body: string } {
  const m = QUOTE_HEAD.exec(content);
  if (!m) return { quote: null, body: content };
  return { quote: m[1]!.trim(), body: m[2]! };
}

/** 比较前去掉空白和常见标点：模型抄错一个逗号不该判死 */
function normalizeQuote(s: string): string {
  return s.replace(/[\s，。、；：！？,.;:!?"'“”‘’「」『』（）()…—～~-]/g, "");
}

/**
 * 引用必须逐字来自她之前发过的消息（用户 m01282 之前的方案：防止模型编造她的原话）。
 * 只做「包含」判断：引用可以是从长消息里摘的一句，但不许是没说过的话。
 */
export function isVerbatimQuote(quote: string, priorUserText: string): boolean {
  const q = normalizeQuote(quote);
  return q.length >= 2 && normalizeQuote(priorUserText).includes(q);
}
