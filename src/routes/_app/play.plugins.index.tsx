import { createFileRoute } from "@tanstack/react-router";
import { PluginHub } from "@/components/play/plugin-hub";

/**
 * 插件目录（玩乐 → 插件）。
 *
 * 这一页**不隐藏底部导航** —— 它是玩乐的子页，还在 App 框架里。
 * 点进具体某个插件才整页铺满（见 `$slug` 那条路由）。
 */
export const Route = createFileRoute("/_app/play/plugins/")({
  component: PluginHub,
});
