import { createFileRoute } from "@tanstack/react-router";
import { MePage } from "@/components/me-sections";

export const Route = createFileRoute("/_app/space")({
  component: () => (
    <MePage
      tab="space"
      title="我的空间"
      subtitle="这个空间长什么样 —— 他的头像和名字、背景图、主题、字体、字号"
    />
  ),
});
