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

export function useLiquidShell(): LiquidShellState {
  const value = useContext(LiquidShellCtx);
  if (!value) throw new Error("useLiquidShell 只能用在 <LiquidShell> 里面");
  return value;
}
