import { createFileRoute } from "@tanstack/react-router";
import { MePage } from "@/components/views/me-sections";

export const Route = createFileRoute("/_app/about")({
  component: () => (
    <MePage tab="about" title="关于与高级" subtitle="版本、自定义上游、用量与诊断 —— 平时不用管" />
  ),
});
