import { createFileRoute } from "@tanstack/react-router";
import { InnerView } from "@/components/inner-view";

export const Route = createFileRoute("/_app/inner")({
  component: InnerView,
});
