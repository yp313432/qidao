"use client";

import { Link } from "@tanstack/react-router";
import { ChevronRight, Plus, Puzzle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { catalogOf } from "@/lib/plugins";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

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
  const customs = useApp((s) => s.settings.customPlugins);
  const plugins = catalogOf(customs);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      <PageHeader title="插件" description="装进栖岛的小页面" />

      <div className="px-4">
        <ul className="space-y-2.5">
          {plugins.map((p) => {
            const off = p.enabled === false;
            return (
              <li key={p.id}>
                <Link
                  to="/play/plugins/$slug"
                  params={{ slug: p.slug }}
                  className={cn(
                    "flex items-center gap-3 rounded-3xl border border-line bg-elevated px-4 py-3.5",
                    off && "opacity-45",
                  )}
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
          className="mt-3 flex items-center gap-3 rounded-3xl border border-dashed border-line px-4 py-3.5 text-muted"
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
          能嵌进来的是"允许被嵌的网页"（你自己做的最稳）。有些网站明确禁止被嵌 ——
          那种点开会告诉你怎么回事，并给你一个用浏览器打开的按钮。
        </p>
      </div>
    </div>
  );
}
