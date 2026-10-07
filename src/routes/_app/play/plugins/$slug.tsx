import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { PluginFrame } from "@/components/play/plugin-frame";
import { useEffect } from "react";
import { pluginBySlug } from "@/lib/plugins";
import { useApp } from "@/lib/store";

/**
 * **用户自己加的插件**（iframe 型）—— `/play/plugins/c_<id>`。
 *
 * 跟时感走同一个壳（`PluginFrame`）：整页铺满、自带返回钮、
 * 嵌不进去时明说原因并给一个"用浏览器打开"的按钮。
 *
 * slug 是 `c_<id>`（`c_` 前缀避免跟内置的 `shigan` / `memory` 撞名）。
 */
export const Route = createFileRoute("/_app/play/plugins/$slug")({
  component: CustomPluginView,
});

function CustomPluginView() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const customs = useApp((s) => s.settings.customPlugins);
  const plugin = pluginBySlug(customs, slug);

  /** 这个 slug 不在目录里（比如插件被删了、或者旧书签）→ 回插件列表 */
  useEffect(() => {
    if (!plugin) void navigate({ to: "/play/plugins", replace: true });
  }, [plugin, navigate]);

  if (!plugin) return null;
  if (!plugin.url) throw notFound();

  return <PluginFrame url={plugin.url} title={plugin.name} local={false} />;
}
