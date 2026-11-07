import { createFileRoute } from "@tanstack/react-router";
import { MePage } from "@/components/views/me-sections";

export const Route = createFileRoute("/_app/notify")({
  component: () => (
    <MePage
      tab="active"
      title="主动与通知"
      subtitle="他多久找你一次、半夜要不要安静、找过你之后留不留痕"
    />
  ),
});
