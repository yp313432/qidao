import { createFileRoute } from "@tanstack/react-router";
import { SpaceView } from "@/components/play/space-view";

export const Route = createFileRoute("/_app/play/space")({
  component: SpaceView,
});
