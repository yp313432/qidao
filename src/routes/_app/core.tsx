import { createFileRoute } from "@tanstack/react-router";
import { CoreView } from "@/components/views/core-view";

export const Route = createFileRoute("/_app/core")({
  component: CoreView,
});
