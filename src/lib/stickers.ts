/**
 * **表情包**：挑一张发出去。
 *
 * 用户原话（2026-11）：
 *   "可以发表情包……我感觉这个表情包应该是挺成熟，他们自己就可以调用表情包，
 *    而且发的就是他的表情包格式。"
 *
 * ── 参考的做法（`asashiki/sticker-mcp`，同一个问题的成熟解）────────
 *   · 给 AI 一个 `{id, 名字, 标签}` 的**目录**（一轮对话只要一次）
 *   · AI 按**情绪/场景**挑，多个匹配就**随机**取一个
 *   · 认不出来就把目录还给它，让它重试（不许它自己编名字）
 *
 * ── 栖岛这一版（v1）到哪一步了 ─────────────────────────────
 *   · 他现在能**自己决定发一张**（动作 `sticker.send`）✓
 *   · "按情绪挑" 需要**每张表情有标签** —— 那是下一步（要给他一个打标签的界面），
 *     现在先随机挑，但**避开上一次发过的那张**（不然连着发同一张很假）
 *   · 目录不进提示词：表情库在手机本地，他只需要知道"有这么个动作"
 */

/** 预设标签（下一步给表情打标签时用；先放在这儿，别散落在界面里） */
export const STICKER_TAGS = [
  "开心",
  "无语",
  "抱抱",
  "委屈",
  "晚安",
  "吃瓜",
  "点赞",
  "累",
  "催",
  "害羞",
] as const;

export type StickerTag = (typeof STICKER_TAGS)[number];

/**
 * 挑一张：随机，但**尽量不跟上次重复**（库里有 2 张以上时）。
 * 没有表情库就返回 undefined —— 调用方要如实说"库里还没有"。
 */
export function pickSticker(urls: string[], last?: string): string | undefined {
  const all = (urls ?? []).filter((u) => typeof u === "string" && u.length > 0);
  if (all.length === 0) return undefined;
  if (all.length === 1) return all[0];
  const pool = last ? all.filter((u) => u !== last) : all;
  const from = pool.length > 0 ? pool : all;
  return from[Math.floor(Math.random() * from.length)];
}
