"use client";

import { Link } from "@tanstack/react-router";
import { ChevronRight, Pencil, Plus, Puzzle } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { catalogOf } from "@/lib/plugins";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { isSolid, materialOf } from "@/lib/material";
import { openPluginWeb } from "@/lib/plugin-open";
import { pushToast } from "@/lib/toast";

/**
 * **插件** —— 玩乐区里的一个新区：一个目录装所有插件。
 *
 * 用户的想法（原话）：
 *   "他和时感组成一个插件类别，然后点开是这两个插件，以后我如果有新加的插件也放里面"
 *   "有一个单独的插件区……点进去写上地址和名字，就能插进去了"
 *
 * 写法照玩乐首页那排入口（图标 + 名字 + 一行小字），**不新造第二套样式** ——
 * 这是用户自己定的规矩（同一类零件只有一处写法）。
 *
 * 这一页**不隐藏底部导航**（它是玩乐的子页，还在 App 的框架里），
 * 点进**具体某个插件**才整页铺满（跟时感一样，见 `pluginBySlug` 那条路由）。
 */
export function PluginHub() {
  const solidPaper = useApp((s) => isSolid(s.settings));
  // 液态：这是**二级列表**（一级「插件」点进来的目录），卡片换成玻璃片；
  // 点进具体某个插件（三级）维持原样 —— 用户 m08921/m08995。
  const liquid = useApp((s) => materialOf(s.settings) === "liquid");
  const customs = useApp((s) => s.settings.customPlugins);
  const plugins = catalogOf(customs);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      <PageHeader title="插件" description="网页应用与内置扩展" />

      <div className="px-4">
        <ul className="space-y-2.5">
          {plugins.map((p) => {
            const off = p.enabled === false;
            return (
              <li
                key={p.id}
                className={cn(
                  "flex items-center",
                  liquid ? "lq-glass" : "rounded-3xl border border-line bg-elevated",
                  solidPaper && "pp-entry",
                  off && "opacity-45",
                )}
              >
                <Link
                  to="/play/plugins/$slug"
                  params={{ slug: p.slug }}
                  onClick={(event) => {
                    if (off) { event.preventDefault(); return; }
                    if (p.custom && p.openMode === "browser" && p.url) {
                      event.preventDefault(); void openPluginWeb(p.url).catch((error: unknown) => pushToast((error as Error).message || "网页没能打开"));
                    }
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-line bg-chip">
                    <Puzzle className="size-[1.15rem] text-accent" strokeWidth={1.7} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-serif text-[15px]">{p.name}</span>
                    <span className="mt-1 block text-[11px] leading-4 text-subtle">
                      {off ? "已关掉" : p.hint}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
                </Link>

                {/*
                  自己加的插件给一个「改」的入口 —— 用户 m00624："插件没有删除或移除功能"。
                  删掉那颗按钮在编辑页（`plugin-editor.tsx` 的「删掉这个插件」），
                  所以这里只要把人送到编辑页就行，删除逻辑全仓只有一处。
                  内置的那几个（时感 / 记忆宇宙）不走这里：它们是 App 自带的，删不得。
                */}
                {p.custom && (
                  <Link
                    to="/play/plugins/edit"
                    search={{ id: p.id }}
                    aria-label={`改 ${p.name}`}
                    className="mr-2 flex size-9 shrink-0 items-center justify-center rounded-full text-muted active:bg-chip"
                  >
                    <Pencil className="size-4" strokeWidth={1.8} aria-hidden="true" />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>

        {/*
          「添加插件」——用户的诉求就是"点进去写上地址和名字"：
          所以这里只留一个入口，表单在下一页（跟工具区的编辑器同一个套路）。
        */}
        <Link
          to="/play/plugins/edit"
          search={{}}
          className={cn("mt-3 flex items-center gap-3 rounded-3xl border border-dashed border-line px-4 py-3.5 text-muted", solidPaper && "pp-entry pp-entry-add")}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-line bg-chip">
            <Plus className="size-[1.15rem]" strokeWidth={1.7} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-serif text-[15px]">添加插件</span>
            <span className="mt-1 block text-[11px] leading-4 text-subtle">
              填个名字 + 地址就行
            </span>
          </span>
        </Link>

        <p className="mt-4 px-1 text-[11px] leading-4 text-subtle">
          普通网站默认独立打开，不要求网站允许嵌入。嵌入模式适合明确支持它的小应用。
          网页入口不会自动获得读取聊天或操作栖岛的权限；社区 MCP 和 Skills 在工具页管理。
        </p>
      </div>
    </div>
  );
}
