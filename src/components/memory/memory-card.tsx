import { Check, Link2, Trash2, Archive, Pin } from "lucide-react";
import { KIND_LABEL, retention } from "@/lib/memory";
import type { Memory } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 每种记忆一个颜色（深浅色主题都看得清）。 */
const KIND_STYLE: Record<Memory["kind"], { dot: string; chip: string }> = {
  profile: { dot: "bg-sky-400", chip: "bg-sky-400/12 text-sky-700 dark:text-sky-300" },
  preference: { dot: "bg-rose-400", chip: "bg-rose-400/12 text-rose-700 dark:text-rose-300" },
  project: { dot: "bg-amber-400", chip: "bg-amber-400/14 text-amber-700 dark:text-amber-300" },
  relationship: { dot: "bg-violet-400", chip: "bg-violet-400/12 text-violet-700 dark:text-violet-300" },
  timeline: { dot: "bg-emerald-400", chip: "bg-emerald-400/12 text-emerald-700 dark:text-emerald-300" },
};

/**
 * 记忆曲线的小缩略图。
 *
 * 画的不是装饰 —— 是这条记忆接下来半年的清晰度走向：
 * 项目类会一路下滑（该淡出就淡出），名字/生日那种是一条平线（永远在）。
 */
function DecaySpark({ memory }: { memory: Memory }) {
  const now = Date.now();
  const DAY = 86_400_000;
  const points: number[] = [];
  for (let i = 0; i <= 12; i += 1) {
    points.push(retention(memory, now + (180 * i * DAY) / 12));
  }
  const w = 96;
  const h = 22;
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${((i / 12) * w).toFixed(1)},${(h - p * (h - 3) - 1.5).toFixed(1)}`)
    .join(" ");
  const flat = points.every((p) => Math.abs(p - points[0]!) < 0.02);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 overflow-visible">
      <path d={d} fill="none" strokeWidth="1.6" strokeLinecap="round" className="stroke-accent/70" />
      {flat && <text x={w - 2} y={9} textAnchor="end" className="fill-subtle text-[8px]">不衰减</text>}
    </svg>
  );
}

function ago(ts: number): string {
  const d = Math.floor((Date.now() - ts) / 86_400_000);
  if (d <= 0) return "今天";
  if (d === 1) return "昨天";
  if (d < 30) return `${d} 天前`;
  if (d < 365) return `${Math.floor(d / 30)} 个月前`;
  return `${Math.floor(d / 365)} 年前`;
}

function day(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function MemoryCard({
  memory,
  linkNames,
  onConfirm,
  onArchive,
  onDelete,
  onTogglePin,
  onOpen,
}: {
  memory: Memory;
  /** 关联记忆的名字（用来显示"连着谁"） */
  linkNames: string[];
  onConfirm: () => void;
  onArchive: () => void;
  onDelete: () => void;
  /** 钉住 / 取消钉住（钉住的永不淡化、也不会被归档） */
  onTogglePin: () => void;
  onOpen?: () => void;
}) {
  const r = retention(memory);
  const style = KIND_STYLE[memory.kind];
  const confirmStale = !memory.lastConfirmedAt || Date.now() - memory.lastConfirmedAt > 120 * 86_400_000;
  /** 说过的话后来改了口：这条不删，只是不再算数（validUntil 由写入时的冲突消解关掉） */
  const expired = memory.validUntil !== undefined && memory.validUntil <= Date.now();

  return (
    <article
      className={cn(
        "relative rounded-3xl border bg-surface px-4 py-3.5",
        memory.pinned ? "border-accent/45" : "border-line",
      )}
    >
      {/* 钉住：一进来就能看见，不用点开详情 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        aria-label={memory.pinned ? "取消钉住" : "钉住这条"}
        aria-pressed={!!memory.pinned}
        className={cn(
          "absolute right-2.5 top-2.5 flex size-8 items-center justify-center rounded-full",
          memory.pinned ? "text-accent" : "text-subtle",
        )}
      >
        <Pin className="size-3.5" strokeWidth={1.8} fill={memory.pinned ? "currentColor" : "none"} />
      </button>

      <div className="flex items-start gap-2.5">
        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", style.dot)} />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onOpen} className="block w-full pr-8 text-left">
            <p className="text-[14px] leading-6 text-fg">{memory.content}</p>
          </button>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", style.chip)}>
              {KIND_LABEL[memory.kind]}
            </span>
            {memory.tags.slice(0, 3).map((t) => (
              <span key={t} className="rounded-full bg-chip px-2 py-0.5 text-[10px] text-muted">
                #{t}
              </span>
            ))}
            {memory.recallCount > 0 && (
              <span className="rounded-full bg-chip px-2 py-0.5 text-[10px] text-muted">
                想起过 {memory.recallCount} 次
              </span>
            )}
            {memory.pinned && (
              <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[10px] text-accent">钉住了</span>
            )}
            {expired && (
              <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[10px] text-accent">
                已经不算数
              </span>
            )}
            {memory.status === "archived" && (
              <span className="rounded-full bg-chip px-2 py-0.5 text-[10px] text-subtle">已归档</span>
            )}
          </div>

          {/* 改过口的记忆：说清它为什么作废，但正文留在上面，不擦掉过去 */}
          {expired && (
            <p className="mt-2 text-[11px] leading-4 text-accent/90">
              {day(memory.validUntil!)}起不算数了 —— 后来改了口，这条留着当证据，不再参与联想
            </p>
          )}

          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="min-w-0 text-[11px] text-subtle">
              <span>记住于 {ago(memory.createdAt)}</span>
              <span className="mx-1.5">·</span>
              <span className={cn(r < 0.35 && "text-warn")}>
                清晰度 {Math.round(r * 100)}%
              </span>
              {linkNames.length > 0 && (
                <>
                  <span className="mx-1.5">·</span>
                  <span className="inline-flex items-center gap-1">
                    <Link2 className="size-3" />
                    连着 {linkNames.length} 条
                  </span>
                </>
              )}
            </div>
            <DecaySpark memory={memory} />
          </div>

          <div className="mt-2.5 flex items-center gap-1.5">
            {confirmStale && memory.status === "active" && (
              <button
                type="button"
                onClick={onConfirm}
                className="flex items-center gap-1 rounded-full bg-chip px-2.5 py-1 text-[11px] text-fg"
              >
                <Check className="size-3" />
                还成立
              </button>
            )}
            <button
              type="button"
              onClick={onArchive}
              aria-label={memory.status === "active" ? "归档" : "取消归档"}
              className="flex items-center gap-1 rounded-full bg-chip px-2.5 py-1 text-[11px] text-muted"
            >
              <Archive className="size-3" />
              {memory.status === "active" ? "归档" : "恢复"}
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label="彻底删除"
              className="flex items-center gap-1 rounded-full bg-chip px-2.5 py-1 text-[11px] text-muted"
            >
              <Trash2 className="size-3" />
              删除
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
