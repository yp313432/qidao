import { createFileRoute } from "@tanstack/react-router";
import { EnvView } from "@/components/env-view";

export const Route = createFileRoute("/_app/env")({
  component: EnvView,
});
