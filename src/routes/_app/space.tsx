import { createFileRoute } from "@tanstack/react-router";
import { MePage } from "@/components/me-sections";

export const Route = createFileRoute("/_app/space")({
  component: () => (
    <MePage
      tab="space"
      title="我的空间"
      subtitle="材质、背景、字体、对话框的颜色 —— 点哪一行展开哪一行"
    />
  ),
});
