/**
 * 标准件（ui-kit）—— `.k-*` 类对应的 React 封装。
 *
 * 规矩（`scripts/guard-styles.mjs` 会盯）：
 *   · 这里只拼类名和结构，不写颜色/字号/阴影/圆角；
 *   · 想改观感 → 改 `src/styles/modes/*.css` 里的变量值，不在这加类；
 *   · 新增控件 → 先在 `src/styles/kit.css` 里写成 `.k-xxx`，再来包一层。
 *
 * 为什么单独一层：页面里散着写的 Tailwind 类没法被"模式"统一覆盖。
 * 有了这层，"这个按钮在纯色模式下什么手感"只有一个答案。
 */
export { KButton } from "./k-button";
export { KCard } from "./k-card";
export { KChip } from "./k-chip";
export { KEmpty } from "./k-empty";
export { KFold } from "./k-fold";
export { KHead } from "./k-head";
export { KInput } from "./k-input";
export { KNavbar, type KNavItem } from "./k-navbar";
export { KOpt, KOpts } from "./k-opt";
export { KRow } from "./k-row";
export { KSlider } from "./k-slider";
export { KSwitch } from "./k-switch";
