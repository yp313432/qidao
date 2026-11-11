import { createFileRoute } from "@tanstack/react-router";
import { MePage } from "@/components/views/me-sections";

export const Route = createFileRoute("/_app/space")({
  component: () => (
    <MePage
      tab="space"
      title="外观"
      subtitle="材质、纸色、字体、背景 —— 点哪一行展开哪一行"
    />
  ),
});
