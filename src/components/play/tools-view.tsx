import { Link } from "@tanstack/react-router";
import { CalendarHeart, ChevronRight, Grid3x3, ListChecks } from "lucide-react";
import { SceneBackdrop } from "@/components/background-layer";
import { PlayHeader } from "@/components/play-header";
import { countdown, sortDates } from "@/lib/days";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * 小日子：一个抽屉，装着过日子用的几样东西。
 *
 * 每张卡上顺手带一句现状（最近的倒数、几件待办没做）——
 * 不然点进去才知道有没有东西，等于白点一次。
 */
export function ToolsView() {
  const settings = useApp((s) => s.settings);
  const dates = useApp((s) => s.dates);
  const todos = useApp((s) => s.todos);

  const openTodos = todos.filter((t) => !t.done).length;
  const next = sortDates(dates)[0] ?? null;
  const nextLabel = next
    ? `${countdown(next.at, next.yearly).label} · ${next.title}`
    : "还没记日子";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SceneBackdrop image={settings.diaryImage} />
      <PlayHeader title="小日子" />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-above-nav">
        <p className="text-center text-[10px] tracking-[0.28em] text-subtle uppercase">
          our small days
        </p>
        <p className="mt-2 px-2 text-center text-[12px] leading-5 text-muted">
          在栖岛上，过我们的小日子。
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {/* 五子棋：占整行 */}
          <ToolCard
            to="/play/gobang"
            title="五子棋"
            desc="跟他下一局"
            icon={<Grid3x3 className="size-5" strokeWidth={1.6} />}
            tone="from-amber-200/50 via-transparent to-rose-200/25"
            wide
          />

          <ToolCard
            to="/play/days"
            title="重要日子"
            desc={nextLabel}
            icon={<CalendarHeart className="size-5" strokeWidth={1.6} />}
            tone="from-rose-200/50 via-transparent to-violet-200/25"
          />

          <ToolCard
            to="/play/todo"
            title="待办"
            desc={openTodos > 0 ? `${openTodos} 件没做` : todos.length > 0 ? "都做完了" : "还没有待办"}
            icon={<ListChecks className="size-5" strokeWidth={1.6} />}
            tone="from-sky-200/50 via-transparent to-emerald-200/25"
          />
        </div>

        <p className="mt-10 text-center text-[10px] tracking-[0.28em] text-subtle uppercase">
          one thing at a time
        </p>
      </div>
    </div>
  );
}

function ToolCard({
  to,
  title,
  desc,
  icon,
  tone,
  wide = false,
}: {
  to: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
  tone: string;
  wide?: boolean;
}) {
  return (
    <Link
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      to={to as any}
      className={cn(
        "aster-card relative overflow-hidden rounded-[1.6rem] border border-line px-4 py-4",
        wide && "col-span-2",
      )}
    >
      <span className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br", tone)} />
      <span className="relative flex items-start justify-between gap-2">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-elevated text-accent">
          {icon}
        </span>
        <ChevronRight className="mt-2 size-4 text-subtle" />
      </span>
      <span className="relative mt-3 block">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-muted">{desc}</span>
      </span>
    </Link>
  );
}
