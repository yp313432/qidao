import { createFileRoute } from "@tanstack/react-router";
import { MePage } from "@/components/me-sections";

/**
 * 数据。只有备份 / 恢复 —— 记忆库和世界书在「AI 概览」那一层，这里不重复。
 */
export const Route = createFileRoute("/_app/data")({
  component: () => (
    <MePage
      tab="data"
      title="数据"
      subtitle="换手机、清缓存之前，先导出一份"
    />
  ),
});
