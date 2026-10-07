import { createFileRoute } from "@tanstack/react-router";
import { MemoryUniversePluginView } from "@/components/play/plugins/memory-universe";

/**
 * 记忆宇宙 —— **原生型插件**：`src/plugins/memory-universe/` 那套星图直接渲染，
 * 读的是栖岛本地真实的记忆（映射见 `adapter/qidao-memory.ts`）。
 *
 * ⚠️ 插件内部的组件 / 引擎 / CSS **一个像素都没动**（跟 Grok 原版逐字节一致），
 * 这一页只负责外壳（撑满 + 返回钮 + 喂数据）。
 */
export const Route = createFileRoute("/_app/play/plugins/memory")({
  component: MemoryUniversePluginView,
});
