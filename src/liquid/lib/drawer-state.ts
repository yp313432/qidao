import { createContext, useContext } from "react";

/**
 * 液态世界的两个开合状态：
 *   · 抽屉（对话列表 / 功能）
 *   · 设置页（点底部头像进，纯色「我的」那一整套设置）
 *
 * 单独放一个模块，是因为 `react-refresh/only-export-components`
 * 不许"组件文件里再导出 hook"（外壳那个文件只该导出组件）。
 */

export type LiquidShellState = {
  open: boolean;
  setOpen: (value: boolean) => void;
  settings: boolean;
  setSettings: (value: boolean) => void;
};

export const LiquidShellCtx = createContext<LiquidShellState | null>(null);

/**
 * 设置层的开合要**跨路由记住**。
 *
 * 层级是：头像 → 设置（一级）→ 八项列表（二级）→ 每一项的页面（三级）。
 * 三级是独立路由，从它返回 `/` 时 `LiquidShell` 会重新挂载，
 * 状态只放在组件里就会丢 —— 用户会落回对话页而不是设置列表（用户 m09048）。
 */
let settingsOpen = false;

export const settingsMemory = {
  get: () => settingsOpen,
  set: (value: boolean) => {
    settingsOpen = value;
  },
};

export function useLiquidShell(): LiquidShellState {
  const value = useContext(LiquidShellCtx);
  if (!value) throw new Error("useLiquidShell 只能用在 <LiquidShell> 里面");
  return value;
}
