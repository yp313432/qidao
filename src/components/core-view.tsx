import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Sparkles } from "lucide-react";
import { FileButton } from "@/components/file-button";
import { readImageFile } from "@/lib/image-file";
import { PageHeader } from "@/components/page-header";
import { Avatar } from "@/components/avatar";
import { useApp } from "@/lib/store";
import { GROUPS, PERMISSIONS, permissionSummary } from "@/lib/permissions";
import { resolveAiName } from "@/lib/branding";

/**
 * 「AI 概览」—— 文档里的"大玻璃主卡"。
 *
 * AI核心说明第 3 节："AI概览：顶部大玻璃主卡。显示 AI 名称、头像、一句描述，
 * 以及'能感知多少项 / 正在使用多少项 / 待确认多少项'等概览。"
 *
 * 这一页基本**只读**：不提供任何开关，改权限去「感知权限」那一页。
 * 唯一的两个例外（用户 m14237："ai 的名字和头像挪到 ai 概览那里改"）：点头像换图、点名字改名。
 */
export function CoreView() {
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patchSettings);
  /** 点名字才进编辑态：平时就是一行字，不占地方也不用一直显示输入框 */
  const [editingName, setEditingName] = useState(false);
  /** 滚过主卡之后顶栏收成"小头像 + 名字"（用户 m14665 图三，与「我的」同一套） */
  const [solid, setSolid] = useState(false);
  const solidRef = useRef(false);
  const onScroll = (el: HTMLElement) => {
    const next = el.scrollTop > 92;
    if (next !== solidRef.current) {
      solidRef.current = next;
      setSolid(next);
    }
  };
  const [draftName, setDraftName] = useState("");
  const permissions = useApp((s) => s.settings.permissions);
  const memories = useApp((s) => s.memories);
  const aiName = resolveAiName(settings.aiName);

  // 跟权限页用**同一个**统计函数，免得两处数字对不上
  const { allow, ask, deny } = permissionSummary(permissions);
  const activeMemories = memories.filter((m) => m.status === "active").length;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div
        className="relative z-20 transition-colors duration-200"
        style={
          solid
            ? {
                backgroundColor: "var(--aster-surface)",
                backdropFilter: "blur(20px) saturate(1.5)",
                WebkitBackdropFilter: "blur(20px) saturate(1.5)",
                borderBottom: "0.5px solid var(--aster-line)",
              }
            : undefined
        }
      >
        <PageHeader
          title="AI 概览"
          right={
            <span
              className="flex items-center gap-1.5 overflow-hidden transition-opacity duration-200"
              style={{ opacity: solid ? 1 : 0 }}
            >
              <Avatar role="ai" size={22} />
              <span className="max-w-24 truncate text-[13px] text-muted">{aiName}</span>
            </span>
          }
        />
      </div>

      <div onScroll={(e) => onScroll(e.currentTarget)} className="min-h-0 flex-1 overflow-y-auto px-4 pb-24">
        {/* 主卡：他现在的样子 */}
        <section className="rounded-3xl border border-line bg-elevated px-5 py-6 text-center">
          <FileButton
            ariaLabel="更换 AI 头像"
            accept="image/*"
            className="mx-auto flex size-20 items-center justify-center overflow-hidden rounded-full bg-chip"
            onPick={(files) => {
              const file = files[0];
              if (file) readImageFile(file, (url) => patch({ aiAvatar: url }));
            }}
          >
            {settings.aiAvatar ? (
              <img src={settings.aiAvatar} alt={aiName} className="size-full object-cover" />
            ) : (
              <Sparkles className="size-7 text-accent" />
            )}
          </FileButton>
          {editingName ? (
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value.slice(0, 12))}
              onBlur={() => {
                patch({ aiName: draftName.trim() });
                setEditingName(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  patch({ aiName: draftName.trim() });
                  setEditingName(false);
                }
                if (e.key === "Escape") setEditingName(false);
              }}
              maxLength={12}
              aria-label="AI 名字"
              placeholder={aiName}
              className="mt-3 w-full bg-transparent text-center font-serif text-xl outline-none placeholder:text-subtle"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraftName(settings.aiName ?? "");
                setEditingName(true);
              }}
              aria-label="改 AI 的名字"
              className="mt-3 font-serif text-xl"
            >
              {aiName}
            </button>
          )}
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
          点名字能改、点头像能换；其他设置点上面那三项进去改。
        </p>
      </div>
    </div>
  );
}
