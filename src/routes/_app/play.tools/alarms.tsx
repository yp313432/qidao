import { createFileRoute } from "@tanstack/react-router";
import { AlarmsView } from "@/components/alarms-view";

export const Route = createFileRoute("/_app/play/tools/alarms")({
  component: AlarmsView,
});
