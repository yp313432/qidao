import { Link } from "@tanstack/react-router";
import { AlarmClock, CalendarHeart, ChevronRight, ListChecks, Timer, type LucideIcon } from "lucide-react";
import { SceneBackdrop } from "@/components/shell/background-layer";
import { PlayHeader } from "@/components/views/play-header";
import { countdown, sortDates } from "@/lib/days";
import { isSolid } from "@/lib/material";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

type YearEntry = {
  to: "/play/days" | "/play/todo" | "/play/tools/alarms" | "/play/tools/tasks";
  title: string;
  desc: string;
  icon: LucideIcon;
  tone: string;
};

export function ToolsView() {
  const settings = useApp((s) => s.settings);
  const dates = useApp((s) => s.dates);
  const todos = useApp((s) => s.todos);
  const reminders = useApp((s) => s.reminders);
  const tasks = useApp((s) => s.tasks);
  const solid = isSolid(settings);

  const openTodos = todos.filter((todo) => !todo.done).length;
  const next = sortDates(dates)[0];
  const onReminders = reminders.filter((reminder) => !reminder.done).length;
  const onTasks = tasks.filter((task) => task.enabled).length;

  const calendar: YearEntry = {
    to: "/play/days",
    title: "重要日子",
    desc: next ? `${countdown(next.at, next.yearly).label} · ${next.title}` : "还没记日子",
    icon: CalendarHeart,
    tone: "from-rose-200/50 via-transparent to-violet-200/25",
  };
  const entries: YearEntry[] = [
    {
      to: "/play/todo",
      title: "待办",
      desc: openTodos > 0 ? `${openTodos} 件没做` : todos.length > 0 ? "都做完了" : "还没有待办",
      icon: ListChecks,
      tone: "from-sky-200/50 via-transparent to-emerald-200/25",
    },
    {
      to: "/play/tools/alarms",
      title: "闹钟",
      desc: reminders.length > 0 ? `${onReminders} 个开着` : "还没设过",
      icon: AlarmClock,
      tone: "from-emerald-200/45 via-transparent to-sky-200/25",
    },
    {
      to: "/play/tools/tasks",
      title: "定时任务",
      desc: tasks.length > 0 ? `${onTasks} 个开着` : "还没设过",
      icon: Timer,
      tone: "from-violet-200/45 via-transparent to-amber-200/25",
    },
  ];

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", solid && "paper-directory year-directory")}>
      {!solid && <SceneBackdrop image={settings.diaryImage} />}
      <PlayHeader title="岁序" />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-above-nav">
        <p className="directory-caption text-center text-[10px] tracking-[0.28em] text-subtle uppercase">
          Our small days
        </p>
        <p className="mt-2 px-2 text-center text-[12px] leading-5 text-muted">
          在 Yisle 上，过我们的小日子。
        </p>

        {solid ? (
          <div className="year-entries">
            <YearPaperLink entry={calendar} primary />
            <ul className="year-rows">
              {entries.map((entry) => (
                <li key={entry.to}>
                  <YearPaperLink entry={entry} />
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {[calendar, ...entries].map((entry) => (
              <YearGlassLink key={entry.to} entry={entry} />
            ))}
          </div>
        )}

        <p className="directory-caption mt-10 text-center text-[10px] tracking-[0.28em] text-subtle uppercase">
          One thing at a time
        </p>
      </div>
    </div>
  );
}

function YearPaperLink({ entry, primary = false }: { entry: YearEntry; primary?: boolean }) {
  const { icon: Icon, to, title, desc } = entry;
  return (
    <Link to={to} className={cn("year-link", primary && "year-link--primary")}>
      <span className="year-link__icon">
        <Icon className="size-5" strokeWidth={1.6} aria-hidden="true" />
      </span>
      <span className="year-link__title">{title}</span>
      <span className="year-link__status" title={desc}>{desc}</span>
      <ChevronRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

function YearGlassLink({ entry }: { entry: YearEntry }) {
  const { icon: Icon, to, title, desc, tone } = entry;
  return (
    <Link to={to} className="aster-card lq-card relative overflow-hidden rounded-[1.6rem] border border-line px-4 py-4">
      <span className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br", tone)} />
      <span className="relative flex items-start justify-between gap-2">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-elevated text-accent">
          <Icon className="size-5" strokeWidth={1.6} aria-hidden="true" />
        </span>
        <ChevronRight className="mt-2 size-4 text-subtle" aria-hidden="true" />
      </span>
      <span className="relative mt-3 block">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-muted">{desc}</span>
      </span>
    </Link>
  );
}
