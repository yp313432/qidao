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
 * **表情库**：一张表情 = 图 + 一个分组。
 *
 * 用户原话（2026-11）："表情包能不能做成一个库，我传到库里，他从我传的库里挑，
 * 并且库里带分组，我自己分，然后他就可以用了。"
 *
 * 分组就是"按情绪挑"缺的那块：他说"我现在想发个『无语』"，
 * 客户端从**无语那一组**里随机挑一张 → 不用把图库塞进提示词，也不用他认识每张图。
 */
export type Sticker = { id: string; url: string; group: string };

/** 没分组的那一档（老数据迁过来也进这里，所以它一定存在） */
export const DEFAULT_STICKER_GROUP = "未分组";

/**
 * 把他说的话对上某一组。
 *
 * 容忍三种说法：**完全相同** / **包含**（"发个抱抱的表情" → 命中"抱抱"）/
 * **分组名包含他的话**（他说"抱" → 命中"抱抱"）。取**最长**的那个命中，
 * 免得"难过"和"难过到哭"两组的匹配打架时挑错。
 */
export function matchStickerGroup(groups: string[], feel?: string): string | null {
  const q = (feel ?? "").trim().toLowerCase();
  if (!q) return null;
  const clean = groups.filter((g) => typeof g === "string" && g.trim().length > 0);
  const exact = clean.find((g) => g.trim().toLowerCase() === q);
  if (exact) return exact;
  const hits = clean
    .filter((g) => {
      const gl = g.trim().toLowerCase();
      return gl.includes(q) || q.includes(gl);
    })
    .sort((a, b) => b.length - a.length);
  return hits[0] ?? null;
}

/** 分组清单（按出现顺序去重；空分组也算 —— 用户可能刚建好还没传图） */
export function stickerGroupList(lib: Sticker[], extra: string[] = []): string[] {
  const out: string[] = [];
  const push = (g: string) => {
    const name = (g ?? "").trim();
    if (name && !out.includes(name)) out.push(name);
  };
  extra.forEach(push);
  lib.forEach((s) => push(s.group || DEFAULT_STICKER_GROUP));
  return out;
}

/**
 * 从库里挑一张。
 *   · `feel` 能对上某一组 → **只从那一组**里挑
 *   · 对不上（或者没说）→ 全库随机
 *   · 都尽量避开**上一次发过的那张**（连着发同一张很假）
 * @returns `{url, group, matched}`；库空时返回 null
 */
export function pickStickerByGroup(
  lib: Sticker[],
  feel?: string,
  last?: string,
): { url: string; group: string; matched: boolean } | null {
  const all = (lib ?? []).filter((s) => s && typeof s.url === "string" && s.url.length > 0);
  if (all.length === 0) return null;
  const groups = stickerGroupList(all);
  const hit = matchStickerGroup(groups, feel);
  const pool = hit ? all.filter((s) => (s.group || DEFAULT_STICKER_GROUP) === hit) : all;
  const from = pool.length > 0 ? pool : all;
  const notLast = last ? from.filter((s) => s.url !== last) : from;
  const pick = (notLast.length > 0 ? notLast : from)[
    Math.floor(Math.random() * (notLast.length > 0 ? notLast.length : from.length))
  ];
  return { url: pick.url, group: pick.group || DEFAULT_STICKER_GROUP, matched: Boolean(hit) };
}

/**
 * 挑一张：随机，但**尽量不跟上次重复**（库里有 2 张以上时）。
 *
 * ⚠️ 这是**老接口**（库里只有 `string[]`、还没有分组那会儿用的）。
 * 新代码一律走 `pickStickerByGroup()` —— 那个才认分组。
 */
export function pickSticker(urls: string[], last?: string): string | undefined {
  const all = (urls ?? []).filter((u) => typeof u === "string" && u.length > 0);
  if (all.length === 0) return undefined;
  if (all.length === 1) return all[0];
  const pool = last ? all.filter((u) => u !== last) : all;
  const from = pool.length > 0 ? pool : all;
  return from[Math.floor(Math.random() * from.length)];
}
