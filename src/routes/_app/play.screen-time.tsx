import { createFileRoute } from "@tanstack/react-router";
import { ScreenTimePage } from "@/components/play/screen-time";

/**
 * 屏幕时间（玩乐 → 屏幕时间）。
 *
 * 用户原话（2026-11）："我还加个功能，就是能看到屏幕使用时长，
 * 就是知道我一天每个app用了多久那个。"
 *
 * 跟 `/play/listen`、`/play/space` 这些玩乐子页一样**整屏铺满**（`FULL_BLEED_PREFIXES`
 * 里有 `/play/`），底部导航由外层收起来 —— 这是玩乐区子页的既有规矩，不单独为它破例。
 */
export const Route = createFileRoute("/_app/play/screen-time")({
  component: ScreenTimePage,
});
