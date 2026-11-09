import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { LiquidChat } from "@/liquid/components/liquid-chat";
import { LiquidShell } from "@/liquid/components/liquid-shell";

/**
 * 液态世界的隔离预览页（`/design/liquid`）。
 *
 * 为什么单独开一页：液态是**另一套世界**（透明顶栏、抽屉导航、无底导），
 * 在真对话页上改一半就没法看。这一页把外壳 + 气泡 + 输入条摆在一起，
 * 手机上打开就能判断玻璃、折角、回弹对不对，不用等整页接完。
 *
 * 它不挂在 `_app` 布局里（不要 AppShell 的导航和返回钮），也不进任何菜单。
 * 强制 `data-material="liquid"`，离开时还原用户自己的选择 —— 所以这一页
 * 不会污染设置。纯色侧一行都不引用这里的东西。
 */

export const Route = createFileRoute("/design/liquid")({
  component: DesignLiquid,
});

function DesignLiquid() {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.material;
    root.dataset.material = "liquid";
    return () => {
      if (previous) root.dataset.material = previous;
      else delete root.dataset.material;
    };
  }, []);

  return (
    <LiquidShell>
      <LiquidChat />
      {/* 提示只做浮层：它一旦参与布局，`main.lq-page` 的定位祖先就不是舞台了，
          整页会缩成内容高度 —— 输入条就浮在半空（用户 m07978 说的就是这个）。 */}
      <div className="lq-dev__badge lq-glass lq-glass--chip">
        液态 · 玻璃 C 配方（按住任意一块看回弹）
      </div>
    </LiquidShell>
  );
}
