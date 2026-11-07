import type { FontId, PlanetTone, ReplyStyle, TextTone } from "@/lib/types";

/**
 * 个性化那几组选项表 —— 纯数据，没有任何 JSX。
 * 回复风格 / 字体 / 文字颜色 / 小宇宙行星色。
 */

export const STYLES: { id: ReplyStyle; label: string }[] = [
  { id: "default", label: "默认" },
  { id: "concise", label: "简洁" },
  { id: "explanatory", label: "详尽" },
];

export const FONTS: { id: FontId; label: string; hint: string; stack: string }[] = [
  { id: "system", label: "默认", hint: "无衬线", stack: '"DM Sans", system-ui, sans-serif' },
  {
    id: "serif",
    label: "衬线",
    hint: "宋体 · 优雅",
    stack: '"Source Serif 4", "Songti SC", "SimSun", serif',
  },
  {
    id: "kai",
    label: "楷体",
    hint: "手写 · 文艺",
    stack: '"Kaiti SC", "KaiTi", "楷体", "STKaiti", serif',
  },
  {
    id: "mono",
    label: "等宽",
    hint: "代码感",
    stack: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
  },
];

export const TONES: { id: TextTone; label: string }[] = [
  { id: "auto", label: "跟随主题" },
  { id: "dark", label: "深色字" },
  { id: "light", label: "浅色字" },
  { id: "custom", label: "自定义" },
];

/**
 * 小宇宙里行星/星环的预设色。
 *
 * 跟「文字颜色」是**两个独立的开关**（用户："球体颜色和字体颜色做个切割吧，
 * 她两分开，不放一起，不然不好同时兼顾"）。
 * 三个色取自视觉 Skill 的配色原则：冷薄荷青为主 + 雾紫为辅 + 暖金点缀。
 * swatch 只用来画那个小圆点，真实取值在 store.ts 的 PLANET_COLORS。
 */
export const PLANET_TONES: { id: PlanetTone; label: string; swatch?: string }[] = [
  { id: "auto", label: "跟随文字" },
  { id: "mist", label: "冷薄荷青", swatch: "#7fa8b8" },
  { id: "violet", label: "雾紫", swatch: "#9a8cba" },
  { id: "gold", label: "暖金", swatch: "#c9a227" },
  { id: "custom", label: "自定义" },
];
