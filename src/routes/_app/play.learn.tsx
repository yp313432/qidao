import { createFileRoute } from "@tanstack/react-router";
import { LearnView } from "@/components/play/learn-view";

export const Route = createFileRoute("/_app/play/learn")({
  component: LearnView,
});