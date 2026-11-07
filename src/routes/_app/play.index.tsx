import { createFileRoute } from "@tanstack/react-router";
import { PlayHub } from "@/components/views/play-hub";

export const Route = createFileRoute("/_app/play/")({
  component: PlayHub,
});
