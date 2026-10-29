import { useEffect, useState } from "react";
import { Pin, X } from "lucide-react";
import { ALL_KINDS, KIND_HINT, KIND_LABEL, retention } from "@/lib/memory";
import type { Memory, MemoryKind } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 记忆详情面板（从底部升起）。
 *
 * 原来点卡片只是弹一个 window.prompt 让用户改文字 —— 太粗糙，
 * 而且看不到这条记忆的"来历"：什么时候记住的、被想起过几次、
 * 和谁连在一起、现在还剩多少清晰度。
 */

function ago(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 个月前`;
}

function when(ts: number | undefined): string {
  if (!ts) return "还没";
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function MemoryDetail({
  memory,
  linkNames,
  onClose,
  onSave,
  onConfirm,
  onArchive,
  onDelete,
  onTogglePin,
}: {
  memory: Memory | null;
  linkNames: string[];
  onClose: () => void;
  onSave: (patch: Partial<Memory>) => void;
  onConfirm: () => void;
  onArchive: () => void;
  onDelete: () => void;
  /** 钉住 / 取消钉住 */
  onTogglePin: () => void;
}) {
  const [draft, setDraft] = useState(memory?.content ?? "");
  const [kind, setKind] = useState<MemoryKind>(memory?.kind ?? "profile");
  const [tagText, setTagText] = useState((memory?.tags ?? []).join(" "));

  useEffect(() => {
    if (!memory) return;
    setDraft(memory.content);
    setKind(memory.kind);
    setTagText(memory.tags.join(" "));
  }, [memory?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!memory) return null;
  const dirty =
    draft.trim() !== memory.content ||
    kind !== memory.kind ||
    tagText.trim() !== memory.tags.join(" ");
  const r = retention(memory);
  /** 改过口、已经不算数的那条：不删，只在上面说清楚 */
  const expired = memory.validUntil !== undefined && memory.validUntil <= Date.now();

  return (
    /* z-70：底部导航是 z-60，弹层必须压过它，否则最后一排按钮被导航挡住 */
    <div className="fixed inset-0 z-70 flex flex-col justify-end" role="dialog" aria-modal="true">
      <button type="button" aria-label="关闭" className="absolute inset-0 bg-fg/25" onClick={onClose} />
      <div className="glass-panel relative z-10 max-h-[86%] overflow-y-auto rounded-t-3xl px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
        <div className="mb-3 flex items-center justify-between">
          <p className="font-serif text-[15px]">这条记忆</p>
          <button type="button" aria-label="关闭" onClick={onClose} className="flex size-9 items-center justify-center">
            <X className="size-4.5" />
          </button>
        </div>

        {/* 内容 */}
        <p className="mb-1.5 text-[12px] text-muted">内容</p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-2xl bg-chip px-3 py-2.5 text-[13.5px] leading-6 outline-none"
        />

        {/* 过期说明：改过口的不删，留作"你以前说过"的证据 */}
        {expired && (
          <div className="mt-2 rounded-2xl bg-accent/10 px-3.5 py-2.5 text-[11.5px] leading-5 text-accent">
            这条已经不算数了 —— {when(memory.validUntil)} 起失效。它不会被删除，也不再参与联想，
            只在你要「你以前是怎么说的」时才翻出来。
          </div>
        )}

        {/* 类型 */}
        <p className="mt-3 mb-1.5 text-[12px] text-muted">类型</p>
        <div className="flex flex-wrap gap-1.5">
          {ALL_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px]",
                kind === k ? "bg-fg text-bg" : "bg-chip text-muted",
              )}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-subtle">{KIND_HINT[kind]}</p>

        {/* 标签 */}
        <p className="mt-3 mb-1.5 text-[12px] text-muted">
          标签（空格分开）—— 他说「好累」时靠这些才联想得到
        </p>
        <input
          value={tagText}
          onChange={(e) => setTagText(e.target.value)}
          placeholder="例如：累 休息 不想动 低能量"
          className="h-10 w-full rounded-2xl bg-chip px-3 text-[13px] outline-none"
        />

        {/* 来历 */}
        <div className="mt-3 rounded-2xl bg-chip px-3.5 py-3 text-[12px] leading-6 text-muted">
          <p>记住于 {when(memory.createdAt)}（{ago(memory.createdAt)}）</p>
          <p>最后改动 {when(memory.updatedAt)}</p>
          <p>被想起过 {memory.recallCount} 次{memory.lastRecalledAt ? ` · 最近 ${ago(memory.lastRecalledAt)}` : ""}</p>
          <p>确认过 {memory.lastConfirmedAt ? `${when(memory.lastConfirmedAt)}` : "还没"}</p>
          <p>
            当前清晰度 {Math.round(r * 100)}% · 置信度 {Math.round(memory.confidence * 100)}% ·
            {memory.source ? ` 来源「${memory.source}」` : " 来源未记"}
          </p>
          {linkNames.length > 0 && <p className="mt-1">连着：{linkNames.join(" / ")}</p>}
        </div>

        {/* 钉住：钉住的那条永不淡化、也不会被自动归档 */}
        <button
          type="button"
          onClick={onTogglePin}
          aria-pressed={!!memory.pinned}
          className={cn(
            "mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-[13px]",
            memory.pinned ? "bg-accent/14 font-medium text-accent" : "bg-chip text-fg",
          )}
        >
          <Pin className="size-4" strokeWidth={1.8} fill={memory.pinned ? "currentColor" : "none"} />
          {memory.pinned ? "已钉住 · 永不淡化（点一下取消）" : "钉住这条 · 永不淡化、不会被归档"}
        </button>

        {/* 动作 */}
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={!dirty}
            onClick={() => {
              onSave({
                content: draft.trim() || memory.content,
                kind,
                tags: tagText.split(/\s+/).map((t) => t.replace(/^#/, "")).filter(Boolean).slice(0, 12),
              });
              onClose();
            }}
            className="h-11 flex-1 rounded-2xl bg-ink text-[13px] font-medium text-ink-fg disabled:opacity-40"
          >
            保存
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="h-11 rounded-2xl bg-chip px-4 text-[13px] text-fg"
          >
            还成立
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              onArchive();
              onClose();
            }}
            className="h-10 flex-1 rounded-2xl bg-chip text-[12px] text-muted"
          >
            {memory.status === "active" ? "归档（不再参与联想）" : "恢复"}
          </button>
          <button
            type="button"
            onClick={() => {
              onDelete();
              onClose();
            }}
            className="h-10 rounded-2xl bg-chip px-4 text-[12px] text-muted"
          >
            彻底删除
          </button>
        </div>
      </div>
    </div>
  );
}
