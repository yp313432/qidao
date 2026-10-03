import { createFileRoute } from "@tanstack/react-router";
import { MePage } from "@/components/me-sections";

export const Route = createFileRoute("/_app/system")({
  component: () => (
    <MePage
      tab="system"
      title="系统"
      subtitle="通知、定位、语音、思考链这些低频设置 —— 平时不用管，想调的时候来这"
    />
  ),
});
