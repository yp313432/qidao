import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceView } from "@/components/workspace-view";

export const Route = createFileRoute("/_app/workspace")({
  component: WorkspaceView,
});
