import { createFileRoute } from "@tanstack/react-router";
import { MePage } from "@/components/views/me-sections";

export const Route = createFileRoute("/_app/voice-settings")({
  component: () => (
    <MePage tab="voice" title="语音" subtitle="他说话的声音、语速，还有把你说的话转成文字" />
  ),
});
