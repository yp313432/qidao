import { createFileRoute } from "@tanstack/react-router";
import { MusicAddView } from "@/components/play/music-add";

export const Route = createFileRoute("/_app/play/add")({
  component: MusicAddView,
});
