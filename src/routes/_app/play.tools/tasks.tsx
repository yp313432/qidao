import { createFileRoute } from "@tanstack/react-router";
import { TasksView } from "@/components/tasks-view";

export const Route = createFileRoute("/_app/play/tools/tasks")({
  component: TasksView,
});
