import { createFileRoute } from "@tanstack/react-router";
import { MePage } from "@/components/me-sections";

export const Route = createFileRoute("/_app/data")({
  component: () => (
    <MePage
      tab="data"
      title="数据与记忆"
      subtitle="他记得什么、你给他定了什么规矩 —— 还有一份能保命的备份"
    />
  ),
});
