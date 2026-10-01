import { createFileRoute } from "@tanstack/react-router";
import { MusicListView } from "@/components/play/music-list";

export const Route = createFileRoute("/_app/play/listen")({
  component: MusicListView,
});
