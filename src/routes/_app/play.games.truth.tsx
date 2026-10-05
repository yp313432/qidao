import { createFileRoute } from "@tanstack/react-router";
import { TruthView } from "@/components/play/truth-view";

export const Route = createFileRoute("/_app/play/games/truth")({
  component: TruthView,
});
