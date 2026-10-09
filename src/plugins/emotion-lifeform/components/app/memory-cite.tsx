import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { MemoryRecord } from "@/plugins/emotion-lifeform/lib/memory/adapter";

/** 记忆宇宙那一页（用户点「在记忆宇宙里看」就去这里，不带参数聚焦） */
export const MEMORY_UNIVERSE_HREF = "/play/plugins/memory";

function formatMemoryWhen(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** 「被想起过 3 次」—— 直接说数，不修饰 */
function recallText(count: number | undefined) {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count as number)) : 0;
  if (n === 0) return "还没被想起过";
  return `被想起过 ${n} 次`;
}

/**
 * 一条**记忆引用** —— 平时一行，点了才当场展开（用户选的 B）。
 *
 * 为什么是"点了才渲染"：给 AI 的上下文只引**一句**（`explanation`），
 * 全文、时间、被想起次数都是**人想看时才展开**的东西 —— 展开前不渲染正文，
 * 所以既不占面板高度，也不会把那件事变成"每次都给模型看全文"。
 *
 * 展开里给的是记忆真有的字段（不编）：
 *   · 记忆全文（`fullContent` / `summary`）
 *   · 形成时间（`createdAt`）
 *   · 被想起次数（`recallCount`）
 *   · 一条去记忆宇宙的路（`/play/plugins/memory`，就是跳过去，不带参数）
 */
export function MemoryCite({
  memory,
  explanation,
  sourceLabelOverride,
}: {
  memory: MemoryRecord;
  explanation?: string;
  /** 模拟数据时用来标一下（真记忆不传，就用记忆自己的来源） */
  sourceLabelOverride?: string;
}) {
  const [open, setOpen] = useState(false);
  const demo = Boolean(memory.isDemoData);
  const sourceLabel = sourceLabelOverride ?? (demo ? "模拟记忆" : memory.sourceLabel);
  const line = explanation?.trim() || `${memory.title} · ${sourceLabel}`;
  const full = memory.fullContent?.trim() || memory.summary;

  return (
    <article
      className="mb-2 rounded-lg border border-line bg-surface px-3 py-2"
      data-memory-id={memory.id}
      data-memory-kind={demo ? "demo" : "real"}
    >
      {/* 平时只有这一行。整行可点 = 就地展开 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-memory-toggle={memory.id}
        className="flex min-h-11 w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-xs text-blush">
          {line}
          <span className="text-faint"> · {sourceLabel}</span>
        </span>
        <span aria-hidden className="shrink-0 text-xs text-faint">
          {open ? "收起" : "展开"}
        </span>
      </button>

      {open ? (
        <div className="flex flex-col gap-2 pb-1" data-memory-open={memory.id}>
          <p className="text-sm text-fg">{full}</p>
          <p className="text-xs text-faint">
            形成于 {formatMemoryWhen(memory.createdAt)} · {recallText(memory.recallCount)}
          </p>
          {memory.tags.length ? (
            <div className="flex flex-wrap gap-1">
              {memory.tags.map((tag) => (
                <span key={tag} className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          <Link to={MEMORY_UNIVERSE_HREF} className="min-h-11 self-start text-sm text-primary">
            在记忆宇宙里看
          </Link>
        </div>
      ) : null}
    </article>
  );
}
