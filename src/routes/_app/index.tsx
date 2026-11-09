import { createFileRoute } from "@tanstack/react-router";
import { ChatView } from "@/components/chat/chat-view";
import { LiquidChat } from "@/liquid/components/liquid-chat";
import { LiquidShell } from "@/liquid/components/liquid-shell";
import { useApp } from "@/lib/store";
import { materialOf } from "@/lib/material";

/**
 * 对话页按材质分派（用户 m08214："OK可以接吧，就把之前那些东西放到现在该放的位置"）。
 *
 *   solid  → `src/components/chat/chat-view.tsx`（纯色那套，一行没动）
 *   liquid → `src/liquid/`（玻璃外壳 + 透明顶栏 + 抽屉 + 无底部导航）
 *
 * 两个世界只共用数据层（store / useChatStream），**样式一行都不互相引用**：
 * 液态的规则写在 `src/liquid/styles/glass.css`，由 `scripts/guard-styles.mjs`
 * 单开一组硬线守着（禁 hex、禁 !important、禁 backdrop-filter、禁跨档选择器）。
 * 这样纯色那边继续冻结，液态怎么折腾都不会漏到它身上。
 */

export const Route = createFileRoute("/_app/")({
  component: ChatRoute,
});

function ChatRoute() {
  const liquid = useApp((s) => materialOf(s.settings) === "liquid");
  if (liquid) {
    return (
      <LiquidShell>
        <LiquidChat />
      </LiquidShell>
    );
  }
  return <ChatView />;
}
