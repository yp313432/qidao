import { createFileRoute } from "@tanstack/react-router";
import { ShiganPluginView } from "@/components/play/plugins/shigan";

/**
 * 时感 —— 插件里的一个（整页铺满、隐藏底部导航、自带返回钮，跟原来一模一样）。
 */
export const Route = createFileRoute("/_app/play/plugins/shigan")({
  component: ShiganPluginView,
});
