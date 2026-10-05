import { createFileRoute } from "@tanstack/react-router";
import { DocEditor } from "@/components/tools/doc-editor";

/** 新建文档的编辑页（原来是 window.prompt，现在跟 HTTP / MCP 共用一套写法）。 */
export const Route = createFileRoute("/_app/tools/docs")({
  component: DocEditor,
});
