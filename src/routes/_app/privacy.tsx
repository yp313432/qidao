import { createFileRoute } from "@tanstack/react-router";
import { MePage } from "@/components/views/me-sections";

export const Route = createFileRoute("/_app/privacy")({
  component: () => (
    <MePage
      tab="privacy"
      title="隐私与数据"
      subtitle="他能不能知道你在哪、记不记得住、数据存在哪里"
    />
  ),
});
