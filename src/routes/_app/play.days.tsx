import { createFileRoute } from "@tanstack/react-router";
import { ToolsDays } from "@/components/play/tools-days";

export const Route = createFileRoute("/_app/play/days")({
  component: ToolsDays,
});
