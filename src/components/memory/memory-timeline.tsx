import { useMemo } from "react";
import { KIND_LABEL, retention } from "@/lib/memory";
import type { Memory } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 时间线视图：把记忆按"什么时候记住的"排下来。
 *
 * 和卡片墙的区别：卡片墙回答"他记得什么"，
 * 时间线回答"**这半年他是怎么一点点认识我的**" ——
 * 所以按天分组，左边一条竖线，每条带类型色点；
 * 被想起/确认过的还会标出来（那是这条记忆"活过"的证据）。
 */

const KIND_DOT: Record<Memory["kind"], string> = {
  profile: "bg-sky-400",
  preference: "bg-rose-400",
  project: "bg-amber-400",
  relationship: "bg-violet-400",
  timeline: "bg-emerald-400",
};

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  if (diff < 7) return `${diff} 天前`;
  if (d.getFullYear() === today.getFullYear()) return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function clock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function MemoryTimeline({
  memories,
  onOpen,
}: {
  memories: Memory[];
  onOpen?: (m: Memory) => void;
}) {
  /** 按"记住的那一天"分组，新的在上 */
  const groups = useMemo(() => {
    const map = new Map<string, Memory[]>();
    for (const m of memories) {
      const d = new Date(m.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      const list = map.get(key);
      if (list) list.push(m);
      else map.set(key, [m]);
    }
    return [...map.entries()]
      .map(([key, list]) => ({
        key,
        label: dayLabel(list[0]!.createdAt),
        items: list.slice().sort((a, b) => b.createdAt - a.createdAt),
      }))
      .sort((a, b) => b.items[0]!.createdAt - a.items[0]!.createdAt);
  }, [memories]);

  if (memories.length === 0) {
    return (
      <p className="py-12 text-center text-[13px] leading-6 text-muted">
        还没有记忆。
        {"\n"}跟他聊几句，或者在上面点「+」自己加一条。
      </p>
    );
  }

  return (
    <div className="relative pl-1">
      {/* 竖线：贯穿整条时间线 */}
      <span className="absolute top-2 bottom-2 left-[7px] w-px bg-line" aria-hidden />
      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.key}>
            <p className="mb-2 pl-5 text-[11px] font-medium text-subtle">{g.label}</p>
            <div className="space-y-3">
              {g.items.map((m) => {
                const r = retention(m);
                const touched = m.lastRecalledAt ?? m.lastConfirmedAt;
                return (
                  <div key={m.id} className="relative flex gap-3">
                    <span
                      className={cn(
                        "relative z-10 mt-1.5 size-3.5 shrink-0 rounded-full border-2 border-surface",
                        KIND_DOT[m.kind],
                        r < 0.4 && "opacity-45",
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => onOpen?.(m)}
                      className="min-w-0 flex-1 rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-left"
                    >
                      <p className="text-[13.5px] leading-6 text-fg">{m.content}</p>
                      <p className="mt-1 text-[11px] text-subtle">
                        {clock(m.createdAt)} · {KIND_LABEL[m.kind]}
                        {m.status === "archived" && " · 已归档"}
                        {m.recallCount > 0 && ` · 想起过 ${m.recallCount} 次`}
                        {touched ? ` · 最近一次 ${dayLabel(touched)}` : ""}
                        {` · 清晰度 ${Math.round(r * 100)}%`}
                      </p>
                      {m.tags.length > 0 && (
                        <p className="mt-1 text-[11px] text-muted">#{m.tags.slice(0, 4).join(" #")}</p>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
