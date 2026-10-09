import { Link } from "@tanstack/react-router";
import { ChevronRight, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useApp } from "@/lib/store";
import { GROUPS, PERMISSIONS, permissionSummary } from "@/lib/permissions";
import { resolveAiName } from "@/lib/branding";

/**
 * 「AI 概览」—— 文档里的"大玻璃主卡"。
 *
 * AI核心说明第 3 节："AI概览：顶部大玻璃主卡。显示 AI 名称、头像、一句描述，
 * 以及'能感知多少项 / 正在使用多少项 / 待确认多少项'等概览。"
 *
 * 这一页**只读**：不提供任何开关，改权限去「感知权限」那一页 ✅（纯 UI，功能不动）
 */
export function CoreView() {
  const settings = useApp((s) => s.settings);
  const permissions = useApp((s) => s.settings.permissions);
  const memories = useApp((s) => s.memories);
  const aiName = resolveAiName(settings.aiName);

  // 跟权限页用**同一个**统计函数，免得两处数字对不上
  const { allow, ask, deny } = permissionSummary(permissions);
  const activeMemories = memories.filter((m) => m.status === "active").length;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader title="AI 概览" />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24">
        {/* 主卡：他现在的样子 */}
        <section className="rounded-3xl border border-line bg-elevated px-5 py-6 text-center">
          <div className="mx-auto flex size-20 items-center justify-center overflow-hidden rounded-full bg-chip">
            {settings.aiAvatar ? (
              <img src={settings.aiAvatar} alt={aiName} className="size-full object-cover" />
            ) : (
              <Sparkles className="size-7 text-accent" />
            )}
          </div>
          <p className="mt-3 font-serif text-xl">{aiName}</p>
          <p className="mt-1 text-[12px] leading-5 text-muted">
            在 {settings.displayName || "你"} 的这个小世界里，陪你说话的那个
          </p>
          <div className="mt-4 flex items-center justify-center gap-5">
            <div>
              <p className="font-serif text-2xl">{allow}</p>
              <p className="mt-0.5 text-[11px] text-subtle">允许</p>
            </div>
            <div>
              <p className="font-serif text-2xl text-warn">{ask}</p>
              <p className="mt-0.5 text-[11px] text-subtle">需询问</p>
            </div>
            <div>
              <p className="font-serif text-2xl text-muted">{deny}</p>
              <p className="mt-0.5 text-[11px] text-subtle">已拒绝</p>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-subtle">
            他现在记得 {activeMemories} 条关于你的事
          </p>
        </section>

        {/* 二级入口：跟「我的 → AI 核心」一致 */}
        <section className="mt-5">
          <h2 className="mb-2 px-1 text-[12px] tracking-wide text-muted">往下看</h2>
          <div className="space-y-2">
            {[
              { to: "/permissions", label: "感知权限", hint: `${PERMISSIONS.length} 项能力，按 ${GROUPS.length} 组收着` },
              { to: "/worldbook", label: "怎么和你相处", hint: "给他的规矩 · 说话风格 · 思考引导" },
              { to: "/inner", label: "他的状态", hint: "他最近的状态样本（数据还在，只是这张图不用了）" },
              { to: "/memories", label: "他记得你什么", hint: "记忆库：列表 + 关系图" },
            ].map((it) => (
              <Link
                key={it.to}
                to={it.to}
                className="flex items-center justify-between gap-3 rounded-2xl bg-chip px-3.5 py-3"
              >
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{it.label}</span>
                  <span className="mt-0.5 block text-[11px] text-subtle">{it.hint}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted" />
              </Link>
            ))}
          </div>
        </section>

        <p className="mt-6 px-1 text-[11px] leading-5 text-subtle">
          这一页只是"看一眼他现在什么样"。要调什么，点上面那四项进去改 ✅
        </p>
      </div>
    </div>
  );
}
