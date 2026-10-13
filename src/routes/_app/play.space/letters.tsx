import { createFileRoute } from "@tanstack/react-router";
import { LettersPage } from "@/components/play/space-letters";

/** 信 —— 动态空间目录里的第三项。上一级是 /play/space（见 nav-tree）。 */
export const Route = createFileRoute("/_app/play/space/letters")({
  component: LettersPage,
});
