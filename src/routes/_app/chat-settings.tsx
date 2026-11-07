import { createFileRoute } from "@tanstack/react-router";
import { MePage } from "@/components/views/me-sections";

export const Route = createFileRoute("/_app/chat-settings")({
  component: () => (
    <MePage
      tab="chat"
      title="对话"
      subtitle="思考过程、回复长短、分段、表情包 —— 都只影响他怎么跟你说话"
    />
  ),
});
