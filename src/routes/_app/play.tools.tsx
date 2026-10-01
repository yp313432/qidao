import { createFileRoute } from "@tanstack/react-router";
import { ToolsView } from "@/components/play/tools-view";

export const Route = createFileRoute("/_app/play/tools")({
  component: ToolsView,
});
