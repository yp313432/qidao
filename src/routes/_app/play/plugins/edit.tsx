import { createFileRoute } from "@tanstack/react-router";
import { PluginEditor } from "@/components/play/plugin-editor";

/**
 * 插件编辑器 —— 跟工具区那三个编辑器同一套路（整屏 + 保存放标题栏 + 隐藏底部导航）。
 * `?id=` = 编辑哪一条；没有 = 新建。内置时感的地址也从这儿改（id=builtin_shigan）。
 */
export const Route = createFileRoute("/_app/play/plugins/edit")({
  validateSearch: (search: Record<string, unknown>): { id?: string } => ({
    id: typeof search.id === "string" ? search.id : undefined,
  }),
  component: PluginEditorRoute,
});

function PluginEditorRoute() {
  const { id } = Route.useSearch();
  return <PluginEditor id={id} />;
}
