/**
 * 对话框玻璃的**渐变色**（用户 2026-11 要的）：
 *
 *   "能不能把对话框的彩色渐变效果改成可选择的啊，就是我任选几种颜色组成渐变，
 *    这样我换背景时，他能搭起来。"
 *
 * 只做三件事：
 *   ① 存进设置（`Settings.composerTint`，2~3 个 hex）；
 *   ② `ComposerTint` 把它们写成 `--q-tint-1/2/3` 三个 CSS 变量（`.glass-float` 读）；
 *   ③ 给「我的 → 个性化」一组现成的配色，省得他每次手调。
 *
 * ⚠️ 透明度分三档（0.34 / 0.28 / 0.34）而不是全用 0.34：中间那道要更淡，
 *    渐变才像"从一头透到另一头"，三档一样浓会变成三条色块。
 */

/** CSS 变量的名字，顺序 = 渐变从左上到右下的三段 */
export const TINT_VARS = ["--q-tint-1", "--q-tint-2", "--q-tint-3"] as const;

/** 每一段的 alpha（见文件头注释：中间那道要更淡） */
export const TINT_ALPHAS = [0.34, 0.28, 0.34] as const;

/** 默认配色 = 原来写死在 `.glass-float` 里的那套粉青蓝 */
export const DEFAULT_TINT = ["#f3a4c5", "#a7dbe4", "#a8baf0"] as const;

/** 现成的几套（换背景时先在这里挑一个，再微调） */
export const TINT_PRESETS = [
  { id: "sakura", label: "粉青蓝", colors: [...DEFAULT_TINT] },
  { id: "sunset", label: "蜜桃日落", colors: ["#f7b98a", "#f2a0b5", "#cf9ce8"] },
  { id: "mint", label: "薄荷海", colors: ["#9be3c8", "#9fd6ea", "#a3b6f2"] },
  { id: "violet", label: "紫夜", colors: ["#b9a6f5", "#a9b8ef", "#d3a6e8"] },
  { id: "cream", label: "奶油橘", colors: ["#f6d0a0", "#f3b5a0", "#e8a9c4"] },
  { id: "slate", label: "雾蓝灰", colors: ["#c8d6e5", "#b8c9dd", "#a9bed6"] },
] as const;

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** `#f3a4c5` + 0.34 → `rgba(243, 164, 197, 0.34)`；不是合法 hex 就返回 null（调用方跳过这个变量） */
export function hexToRgba(hex: string, alpha: number): string | null {
  if (!HEX_RE.test(hex)) return null;
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 把设置里那份"可能是 1 个、可能是 4 个、可能有脏值"的数组规整成**正好三个合法 hex**：
 * 缺的用默认色补、多的截掉、坏的换掉 —— 这样调用方永远不用再判空。
 */
export function normalizeTint(raw?: readonly string[] | null): string[] {
  const fallback = DEFAULT_TINT as readonly string[];
  return [0, 1, 2].map((i) => {
    const v = raw?.[i];
    return v && HEX_RE.test(v) ? v : (fallback[i] ?? "#ffffff");
  });
}
