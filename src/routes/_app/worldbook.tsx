import { createFileRoute } from "@tanstack/react-router";
import { WorldbookView } from "@/components/views/worldbook-view";

export const Route = createFileRoute("/_app/worldbook")({
  component: WorldbookView,
});
