import { createFileRoute } from "@tanstack/react-router";
import { ShiganView } from "@/components/play/shigan-view";

export const Route = createFileRoute("/_app/play/shigan")({
  component: ShiganView,
});
