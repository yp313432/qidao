import { useState, type ReactNode } from "react";
import { LiquidShellCtx, settingsMemory } from "@/liquid/lib/drawer-state";

/**
 * 液态世界的外框：柔光底 + 3D 舞台。
 *
 * 只干两件纯色外框也干的事：
 *   · 铺一层"背后有东西可以透"的底（玻璃要透，见 ARCHITECTURE 坑 63）
 *   · 给页面一个 3D 舞台，抽屉拉开时页面折过去（`data-open` 驱动）
 *
 * 顶栏、消息、输入条、抽屉、设置页**都在对话页自己身上** —— 纯色也是这样
 * （`src/components/chat/chat-view.tsx` 里既有 header 也有抽屉），
 * 所以这里只把两个开合状态通过 context 传下去。
 *
 * ⚠️ 这一层**不许往里塞自己的布局元素**（顶栏、徽标都不行）：
 * 一旦有个带 `position:relative` 的兄弟节点，页面 `position:absolute; inset:0`
 * 的定位祖先就变成它，整页缩成内容高度、输入条会浮在半空（用户 m07978）。
 */

export function LiquidShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  /* 初值来自模块级记忆：从设置的三级页返回时，还停在设置列表上 */
  const [settings, setSettingsState] = useState(() => settingsMemory.get());
  const setSettings = (value: boolean) => {
    settingsMemory.set(value);
    setSettingsState(value);
  };

  /* 光跟手指：一个全局委托，卸载时自己摘掉 */

  return (
    <LiquidShellCtx.Provider value={{ open, setOpen, settings, setSettings }}>
      <div className="lq">
        <div className="lq-canvas" aria-hidden="true" />
        <div className="lq-stage" data-open={open} data-settings={settings}>
          {children}
        </div>
      </div>
    </LiquidShellCtx.Provider>
  );
}
