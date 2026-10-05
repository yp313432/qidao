import { createFileRoute } from "@tanstack/react-router";
import { HttpToolEditor } from "@/components/tools/http-editor";

/**
 * HTTP 工具的编辑页（独立页面，不是弹层）。
 *
 * 「编辑哪一条」放在 `?id=` 上：没有参数就是新建。
 * 这样深链接、返回、刷新都是对的，不用把状态藏在某个组件里。
 */

function HttpToolEditorRoute() {
  const { id } = Route.useSearch();
  return <HttpToolEditor key={id ?? "new"} id={id} />;
}

export const Route = createFileRoute("/_app/tools/http")({
  // 没有 id = 新建；有 id = 编辑那一条。返回类型写成可选，
  // 调用方（列表页的 Link）才能既传 `{}` 又传 `{ id }`。
  validateSearch: (search: Record<string, unknown>): { id?: string } =>
    typeof search.id === "string" ? { id: search.id } : {},
  component: HttpToolEditorRoute,
});
