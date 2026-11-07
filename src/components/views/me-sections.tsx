/**
 * 「我的」这一组页面的公开出口 —— 只转出，不写实现。
 *
 * 为什么拆：原来 MeHub + MePage + 四个 tab 的区块 + 小部件全挤在一个 3532 行的文件里，
 * 改「通知」那一段要在三千多行里翻。现在按职责分到 src/components/me/：
 *
 *   me-hub.tsx       首页（头像 + 入口卡）
 *   me-page.tsx      二级页外壳（返回 + 标题 + 滚动区）
 *   me-sections.tsx  四个 tab 的区块 JSX（共用一份状态）
 *   me-widgets.tsx   小部件（Section / Group / Row / ImageRow …）
 *   me-options.ts    选项表（回复风格 / 字体 / 文字色 / 行星色）
 *   me-format.ts     相对时间
 *   me-types.ts      MeTab
 *
 * 外部只认这个路径（`@/components/views/me-sections`）—— me/ 内部再怎么拆，调用方不用改。
 */
export type { MeTab } from "../me/me-types";
export { MeHub } from "../me/me-hub";
export { MePage } from "../me/me-page";
