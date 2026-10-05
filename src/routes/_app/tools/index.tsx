import { createFileRoute } from "@tanstack/react-router";
import { ToolsView } from "@/components/tools-view";

export const Route = createFileRoute("/_app/tools/")({
  component: ToolsView,
});
