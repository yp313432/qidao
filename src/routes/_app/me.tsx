import { createFileRoute } from "@tanstack/react-router";
import { MeView } from "@/components/views/me-view";

export const Route = createFileRoute("/_app/me")({
  component: MeView,
});
