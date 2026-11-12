import { createFileRoute } from "@tanstack/react-router";
import { MePage } from "@/components/views/me-sections";

export const Route = createFileRoute("/_app/chat-settings")({
  component: () => (
    <MePage
      tab="chat"
      title="对话"
      subtitle="思考过程、标点分句、发送节奏、连发与表情包"
    />
  ),
});

