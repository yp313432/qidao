import { createFileRoute } from "@tanstack/react-router";
import { VoiceView } from "@/components/voice-view";

export const Route = createFileRoute("/_app/voice")({
  component: VoiceView,
});
