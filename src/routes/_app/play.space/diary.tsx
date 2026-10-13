import { createFileRoute } from "@tanstack/react-router";
import { DiaryPage } from "@/components/play/space-diary";

/** 日记 —— 动态空间目录里的第二项。上一级是 /play/space（见 nav-tree）。 */
export const Route = createFileRoute("/_app/play/space/diary")({
  component: DiaryPage,
});
