import { createFileRoute } from "@tanstack/react-router";
import { MemoryLibrary } from "@/components/memory/memory-library";

export const Route = createFileRoute("/_app/memories")({
  component: MemoryLibrary,
});
