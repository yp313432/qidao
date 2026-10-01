import { createFileRoute } from "@tanstack/react-router";
import { MemoryView } from "@/components/memory-view";

export const Route = createFileRoute("/_app/memory")({
  component: MemoryView,
});
