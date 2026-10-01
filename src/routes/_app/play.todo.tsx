import { createFileRoute } from "@tanstack/react-router";
import { ToolsTodo } from "@/components/play/tools-todo";

export const Route = createFileRoute("/_app/play/todo")({
  component: ToolsTodo,
});
