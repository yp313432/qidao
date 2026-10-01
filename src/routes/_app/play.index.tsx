import { createFileRoute } from "@tanstack/react-router";
import { PlayHub } from "@/components/play-hub";

export const Route = createFileRoute("/_app/play/")({
  component: PlayHub,
});
