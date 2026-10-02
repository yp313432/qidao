import { useMemo, useState } from "react";
import { CalendarHeart, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { SceneBackdrop } from "@/components/background-layer";
import { PlayHeader } from "@/components/play-header";
import { countdown, dayDiff, sortDates, startOfDay } from "@/lib/days";
import { useApp } from "@/lib/store";
import { cn, formatClock } from "@/lib/utils";

const WEEK = ["一", "二", "三", "四", "五", "六", "日"];

/** 重要日子：上面一个日历，下面一列倒数。 */
export function ToolsDays() {
  const settings = useApp((s) => s.settings);
  const dates = useApp((s) => s.dates);
  // 日历要把"那天所有的东西"都显示出来，不只是重要日子
  const diary = useApp((s) => s.diary);
  const reminders = useApp((s) => s.reminders);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [picked, setPicked] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const today = startOfDay(Date.now());
  const sorted = useMemo(() => sortDates(dates), [dates]);

  /** 这一天有哪些日子（含每年重复的） */
  const onDay = (day: number) =>
    dates.filter((d) => {
      const t = new Date(d.at);
      const c = new Date(day);
      if (d.yearly) return t.getMonth() === c.getMonth() && t.getDate() === c.getDate();
      return startOfDay(d.at) === startOfDay(day);
    });

  /** 这一天的日记 */
  const diaryOn = (day: number) => diary.filter((d) => startOfDay(d.createdAt) === startOfDay(day));
  /** 每天都会响的闹钟/提醒（不挑日子，所以每天都列出来） */
  const dailyAlarms = reminders.filter((r) => !r.done);
  const hasAnything = (day: number) => onDay(day).length > 0 || diaryOn(day).length > 0;

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  // 周一当第一列
  const pad = (first.getDay() + 6) % 7;
  const dayCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: pad }, () => null),
    ...Array.from({ length: dayCount }, (_, i) => {
      const d = new Date(month.getFullYear(), month.getMonth(), i + 1);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SceneBackdrop image={settings.diaryImage} />
      <PlayHeader title="重要日子" backTo="/play/tools" />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-above-nav">
        <p className="text-center text-[10px] tracking-[0.28em] text-subtle uppercase">
          days worth remembering
        </p>

        {/* 日历 */}
        <div className="mt-3 rounded-3xl border border-line bg-surface px-3.5 py-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label="上个月"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              className="flex size-8 items-center justify-center rounded-full bg-chip"
            >
              <ChevronLeft className="size-4" />
            </button>
            <p className="font-serif text-[15px]">
              {month.getFullYear()} 年 {month.getMonth() + 1} 月
            </p>
            <button
              type="button"
              aria-label="下个月"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              className="flex size-8 items-center justify-center rounded-full bg-chip"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-y-1">
            {WEEK.map((w) => (
              <span key={w} className="text-center text-[10px] text-subtle">
                {w}
              </span>
            ))}
            {cells.map((c, i) => {
              if (c === null) return <span key={`p${i}`} />;
              const has = hasAnything(c);
              const isToday = c === today;
              const isPicked = picked === c;
              return (
                <button
                  key={c}
                  type="button"
                  aria-label={`${new Date(c).getMonth() + 1}月${new Date(c).getDate()}日`}
                  onClick={() => {
                    setPicked(isPicked ? null : c);
                    setAdding(false);
                  }}
                  className={cn(
                    "relative mx-auto flex size-9 items-center justify-center rounded-full text-[13px]",
                    isPicked && "bg-ink text-ink-fg",
                    !isPicked && isToday && "bg-accent/20 text-accent",
                    !isPicked && !isToday && "text-fg",
                  )}
                >
                  {new Date(c).getDate()}
                  {has && (
                    <span
                      className={cn(
                        "absolute bottom-1 size-1.5 rounded-full",
                        isPicked ? "bg-ink-fg" : "bg-accent",
                      )}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {picked !== null && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-[12px] font-medium">
                {new Date(picked).getMonth() + 1} 月 {new Date(picked).getDate()} 日
              </p>
              {onDay(picked).length === 0 && diaryOn(picked).length === 0 ? (
                <p className="mt-1 text-[11px] text-muted">这天还没有记什么。</p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {onDay(picked).map((d) => (
                    <li key={d.id} className="flex items-center gap-2 text-[12px]">
                      <span className="size-1.5 rounded-full bg-accent" />
                      <span className="flex-1">{d.title}</span>
                      {d.yearly && <span className="text-[10px] text-subtle">每年</span>}
                    </li>
                  ))}
                  {diaryOn(picked).map((d) => (
                    <li key={d.id} className="flex items-start gap-2 text-[12px] leading-5 text-muted">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-sky-400" />
                      <span className="min-w-0 flex-1">
                        日记 · {d.body.slice(0, 46)}
                        {d.body.length > 46 ? "…" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {/* 闹钟是每天都响的，不挑日子，所以单独列 */}
              {dailyAlarms.length > 0 && (
                <div className="mt-2.5">
                  <p className="text-[11px] font-medium text-muted">每天的闹钟</p>
                  <ul className="mt-1 space-y-0.5">
                    {dailyAlarms.slice(0, 4).map((r) => (
                      <li key={r.id} className="text-[12px] text-muted">
                        <span className="tabular-nums">{r.time}</span> · {r.text}
                        {r.ring ? "（响铃）" : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="mt-2.5 flex items-center gap-1 rounded-full bg-chip px-3 py-1.5 text-[11px] font-medium"
              >
                <Plus className="size-3" />
                记一个在这天
              </button>
            </div>
          )}
        </div>

        {/* 添加 */}
        {(adding || picked === null) && (
          <DateForm
            initial={picked}
            onDone={() => {
              setAdding(false);
              setPicked(null);
            }}
          />
        )}

        {/* 倒数列表 */}
        <div className="mt-4">
          <p className="px-1 pb-2 text-[11px] tracking-wide text-subtle">
            最近的排在前面 · {dates.length} 个
          </p>
          {dates.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-line px-6 py-10 text-center">
              <CalendarHeart className="mx-auto size-6 text-muted" strokeWidth={1.5} />
              <p className="mt-3 text-[13px] text-muted">
                还没有记日子。生日、纪念日、约好的那天 —— 记下来就不会忘。
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {sorted.map((d) => {
                const c = countdown(d.at, d.yearly);
                const past = c.since > 0;
                return (
                  <li key={d.id}>
                    <div
                      className={cn(
                        "flex items-center gap-3 rounded-3xl border border-line px-4 py-3",
                        past ? "bg-surface/60" : "bg-surface",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate text-[14px] font-medium", past && "text-muted")}>
                          {d.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted">
                          {new Date(d.at).getFullYear()} 年 {new Date(d.at).getMonth() + 1} 月{" "}
                          {new Date(d.at).getDate()} 日
                          {d.yearly ? " · 每年" : ""}
                          {d.yearly && c.years > 0 ? ` · 第 ${c.years} 年` : ""}
                        </p>
                        {d.note && <p className="mt-1 text-[11px] text-subtle">{d.note}</p>}
                      </div>
                      <div className="shrink-0 text-right">
                        <p
                          className={cn(
                            "font-serif text-[15px]",
                            past ? "text-subtle" : c.days === 0 ? "text-accent" : "text-fg",
                          )}
                        >
                          {c.label}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={`删掉${d.title}`}
                        onClick={() => useApp.getState().deleteDate(d.id)}
                        className="shrink-0 text-subtle"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="mt-8 text-center text-[10px] tracking-[0.28em] text-subtle uppercase">
          keep it somewhere warm
        </p>
      </div>
    </div>
  );
}

/** 加一个日子。默认拿今天。 */
function DateForm({ initial, onDone }: { initial: number | null; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(() => {
    const d = new Date(initial ?? Date.now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [yearly, setYearly] = useState(true);
  const [note, setNote] = useState("");

  function save() {
    const t = title.trim();
    if (!t) return;
    const [y, m, d] = day.split("-").map(Number);
    const at = new Date(y, (m ?? 1) - 1, d ?? 1);
    at.setHours(0, 0, 0, 0);
    useApp.getState().addDate(t, at.getTime(), yearly, note);
    setTitle("");
    setNote("");
    onDone();
  }

  return (
    <div className="mt-3 rounded-3xl border border-line bg-surface px-4 py-4">
      <p className="text-[13px] font-medium">记一个日子</p>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="日子的名字"
        placeholder="生日 / 纪念日 / 约好的那天…"
        className="mt-2.5 w-full rounded-2xl bg-chip px-3.5 py-2.5 text-[13px] outline-none placeholder:text-subtle"
      />
      <div className="mt-2.5 flex items-center gap-2">
        <input
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          aria-label="日期"
          className="min-w-0 flex-1 rounded-2xl bg-chip px-3.5 py-2.5 text-[13px] outline-none"
        />
        <button
          type="button"
          onClick={() => setYearly((v) => !v)}
          aria-pressed={yearly}
          className={cn(
            "shrink-0 rounded-2xl px-3.5 py-2.5 text-[12px] font-medium",
            yearly ? "bg-ink text-ink-fg" : "bg-chip text-muted",
          )}
        >
          {yearly ? "每年" : "只一次"}
        </button>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label="备注"
        placeholder="备注（可空）"
        className="mt-2.5 w-full rounded-2xl bg-chip px-3.5 py-2.5 text-[12px] outline-none placeholder:text-subtle"
      />
      <button
        type="button"
        onClick={save}
        className="mt-3 w-full rounded-2xl bg-ink py-3 text-[14px] font-medium text-ink-fg"
      >
        记下来
      </button>
      <p className="mt-2 text-center text-[11px] text-subtle">
        今天 {formatClock(Date.now())} · 距离那天 {day ? dayDiff(Date.now(), new Date(day).getTime()) : 0} 天
      </p>
    </div>
  );
}
