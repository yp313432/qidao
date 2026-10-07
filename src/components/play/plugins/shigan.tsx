"use client";

import { PluginFrame } from "@/components/play/plugin-frame";
import { iframeSrcOf } from "@/lib/plugins";
import { useApp } from "@/lib/store";

/**
 * **时感**（iframe 型插件）—— 现在它是"插件"里的一个，不再是单独的 `shigan-view`。
 *
 * 地址语义（跟原来一样，只是搬了家）：
 *   · **留空** → 用**打进包里的那份副本**（`public/shigan/index.html`）：
 *     两个构建都会带上（Vite 会拷 `public/`），打开**不需要网络、不需要梯子**，而且绝对能嵌。
 *   · 填了 → 用填的（想指到局域网另一台机器时用）。
 *     地址的设置项从「我的 → 我的空间 → 时感地址」**挪到插件编辑器**了 ——
 *     插件的事在插件里管，设置页不再留重复的一份。
 *
 * ⚠️ 必须是**绝对**路径：相对路径会拼在当前目录后面
 * （在 `/play/plugins/shigan` 这一页会去找 `/play/plugins/shigan/index.html` → 404 → 白屏）。
 */
export function ShiganPluginView() {
  const raw = useApp((s) => s.settings.shiganUrl);
  const url = iframeSrcOf(
    { id: "builtin_shigan", name: "时感", hint: "", kind: "iframe", url: raw, slug: "shigan" },
    "/shigan/index.html",
  );
  return <PluginFrame url={url} title="时感" local={url.startsWith("/")} />;
}
