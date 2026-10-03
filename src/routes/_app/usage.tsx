import { createFileRoute } from "@tanstack/react-router";
import { MePage } from "@/components/me-sections";

export const Route = createFileRoute("/_app/usage")({
  component: () => (
    <MePage
      tab="usage"
      title="模型与用量"
      subtitle="他用什么工作 —— 当前模型、今天花了多少、上下文预算、接哪家上游"
    />
  ),
});
