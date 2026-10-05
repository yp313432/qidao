import { createFileRoute } from "@tanstack/react-router";
import { McpEditor } from "@/components/tools/mcp-editor";

/**
 * MCP 服务器的编辑页（独立页面，不是弹层）。
 *
 * 「编辑哪一条」放在 `?id=` 上：没有参数就是新建。
 * 原来的底部弹层被底部导航（z-60 > z-40）压住，最后那栏输入框看不见。
 */

function McpEditorRoute() {
  const { id } = Route.useSearch();
  return <McpEditor key={id ?? "new"} id={id} />;
}

export const Route = createFileRoute("/_app/tools/mcp")({
  // 没有 id = 新建；有 id = 编辑那一条。返回类型写成可选，
  // 调用方（列表页的 Link）才能既传 `{}` 又传 `{ id }`。
  validateSearch: (search: Record<string, unknown>): { id?: string } =>
    typeof search.id === "string" ? { id: search.id } : {},
  component: McpEditorRoute,
});
