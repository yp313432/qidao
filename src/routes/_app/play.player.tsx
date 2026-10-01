import { createFileRoute } from "@tanstack/react-router";
import { PlayerView } from "@/components/play/player-view";

export const Route = createFileRoute("/_app/play/player")({
  component: PlayerView,
});
