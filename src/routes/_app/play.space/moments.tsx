import { createFileRoute } from "@tanstack/react-router";
import { MomentsWall } from "@/components/play/moments-wall";

/**
 * 朋友圈（动态）。
 *
 * 「玩乐 → 动态空间 → 动态」点进来的就是这一页 —— 整页铺满、自带返回钮，
 * 上一级是动态空间目录（层级只写在 `lib/nav-tree.ts` 一处）。
 */
export const Route = createFileRoute("/_app/play/space/moments")({
  component: MomentsWall,
});
