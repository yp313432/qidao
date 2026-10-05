import { createFileRoute } from "@tanstack/react-router";
import { GobangView } from "@/components/play/gobang-view";

export const Route = createFileRoute("/_app/play/games/gobang")({
  component: GobangView,
});
