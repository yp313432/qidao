/**
 * **分段回复**：把他一次输出切成几条 —— 一条一个气泡，像真人连着发消息。
 *
 * 用户原话（2026-11）：
 *   "他这个回复只能我回一句，他回一句，就感觉不像真人；能不能他分段回呢？
 *    一句就跟发消息似的，可以发好几条那种。"
 *
 * ── 为什么用「分隔符」这条路 ──────────────────────────────────
 *   · **分隔符**（本文件）：任何模型都行、几乎不花 token，坏掉也只是"没分段"（原文还在）
 *   · 让他返回 JSON 数组：贵（要引号/转义），少一个引号整条就废
 *   · 每段一次请求（auto-continue）：成本 × 段数，还多一层循环
 *   → SillyTavern 的「Custom Chat Separator」也是这么做的。
 *
 * ── 两条硬纪律 ──────────────────────────────────────────────
 *   1. **一个字都不许丢**：段数超过上限时，多出来的并进**最后一段**，而不是截掉
 *   2. `content` 仍存**完整原文**，`parts` 只是"这条消息该怎么渲染"的提示 ——
 *      记忆 / 总结 / 导出 / 搜索 / 上下文拼装都只读 `content`，所以它们**一行都不用改**
 */

/** 分隔符。选 `|||` 是因为正常中文里几乎不会出现，而且不会被 markdown 吃掉。 */
export const SEGMENT_SEP = "|||";

/** 界面上那几个旋钮的范围（跟设置页共用一份，别各写一套） */
export const SEGMENT_LIMITS = {
  maxParts: { min: 1, max: 6, def: 3 },
  maxSentences: { min: 1, max: 4, def: 2 },
  delayMs: { min: 400, max: 3000, def: 1200 },
} as const;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

/**
 * 按"每条最多几句"把一段再切开。
 *
 * 只在**句末标点**后面切（并把紧随的引号/括号带上），所以不会把一个句子拦腰截断。
 * 每 `max` 句合成一条 —— 不是"一句一条"，否则长回复会被拆成一堆碎片。
 */
function splitSentences(text: string, max: number): string[] {
  const t = text.trim();
  if (!t) return [];
  const chunks = t.match(/[^。！？!?…\n]+[。！？!?…]*[”」』）)]*/g) ?? [t];
  const clean = chunks.map((c) => c.trim()).filter(Boolean);
  if (clean.length <= max) return [t];
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += max) out.push(clean.slice(i, i + max).join(""));
  return out;
}

/** 切分（纯函数，验收脚本直接跑它） */
export function splitSegments(
  raw: string,
  opts: { maxParts?: number; maxSentences?: number } = {},
): string[] {
  const maxParts = clamp(opts.maxParts ?? SEGMENT_LIMITS.maxParts.def, 1, 12);
  const maxSentences = clamp(
    opts.maxSentences ?? SEGMENT_LIMITS.maxSentences.def,
    1,
    12,
  );
  const text = (raw ?? "").trim();
  if (!text) return [];
  /** 只留一条 = 等于没开分段，直接原样返回（避免无意义地动原文） */
  if (maxParts <= 1) return [text];

  /** ① 先按分隔符切（整行 `|||` 和行内 `|||` 都算） */
  let parts = text
    .split(SEGMENT_SEP)
    .map((s) => s.trim())
    .filter(Boolean);

  /** ② 再按"每条最多几句"细切 */
  const finer: string[] = [];
  for (const p of parts) finer.push(...splitSentences(p, maxSentences));
  parts = finer;

  /** ③ 超过上限：多的并进最后一段（**丢字是最不能接受的失败**） */
  if (parts.length > maxParts) {
    return [...parts.slice(0, maxParts - 1), parts.slice(maxParts - 1).join("")];
  }
  return parts.length ? parts : [text];
}

/** 这段正文里有没有分隔符（流式期间要用它判断"第一段写完了没"） */
export function isSegmented(raw: string): boolean {
  return (raw ?? "").includes(SEGMENT_SEP);
}

/**
 * 流式期间只显示**第一段**。
 *
 * 为什么：他一边写一边往外冒，如果整条都先显示出来，等收尾再"逐段冒"就会**重排一次**
 * （内容跳一下）。所以第一段照旧流式出来，后面的等他写完再一条条补 —— 这才像真人
 * （先回一句，隔一两秒又补一句）。
 */
export function firstSegment(raw: string): string {
  const i = (raw ?? "").indexOf(SEGMENT_SEP);
  return i < 0 ? raw : raw.slice(0, i);
}

/** 收尾时算 `parts`：只有真的切成 2 条以上才写进消息，否则不写（老消息没有这一格） */
export function partsFor(
  raw: string,
  opts: { enabled?: boolean; maxParts?: number; maxSentences?: number } = {},
): string[] | undefined {
  if (opts.enabled === false) return undefined;
  const parts = splitSegments(raw, opts);
  return parts.length > 1 ? parts : undefined;
}
