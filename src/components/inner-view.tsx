import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useApp } from "@/lib/store";
import { resolveAiName } from "@/lib/branding";
import type { MoodId, StateSample } from "@/lib/types";
import { useActivity } from "@/lib/use-activity";
import { useScrollMemory } from "@/lib/ux";
import { cn } from "@/lib/utils";

/**
 * 内在 · 状态。
 *
 * 那条曲线不是算法拼的 —— 是他**每轮回复时自己报的**
 * （动作协议里的 state.report，L0 静默执行）。
 * 所以这条线能当"他这段时间过得怎么样"来看。
 *
 * 三样东西：此刻的状态 / 最近 30 天的起伏 / 心情分布。
 */

const MOODS: { id: MoodId; label: string; dot: string; bar: string }[] = [
  { id: "calm", label: "平静", dot: "bg-sky-400", bar: "bg-sky-400/70" },
  { id: "joy", label: "开心", dot: "bg-amber-400", bar: "bg-amber-400/70" },
  { id: "focus", label: "专注", dot: "bg-emerald-400", bar: "bg-emerald-400/70" },
  { id: "low", label: "低落", dot: "bg-slate-400", bar: "bg-slate-400/70" },
  { id: "miss", label: "想念", dot: "bg-rose-400", bar: "bg-rose-400/70" },
];

const LINES: { key: "energy" | "missing" | "curious"; label: string; stroke: string }[] = [
  { key: "energy", label: "精力", stroke: "rgb(52,211,153)" },
  { key: "missing", label: "想念", stroke: "rgb(251,113,133)" },
  { key: "curious", label: "好奇", stroke: "rgb(96,165,250)" },
];

function relTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** 最近 N 天，每天一个点（同一天报几次就取平均） */
function dailySeries(samples: StateSample[], days = 30) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const buckets: StateSample[][] = Array.from({ length: days }, () => []);
  for (const s of samples) {
    const idx = days - 1 - Math.floor((start.getTime() + 86_400_000 - s.at) / 86_400_000);
    if (idx >= 0 && idx < days) buckets[idx]!.push(s);
  }
  return buckets.map((b, i) => {
    const day = new Date(start.getTime() - (days - 1 - i) * 86_400_000);
    return {
      day,
      count: b.length,
      energy: b.length ? avg(b.map((x) => x.energy)) : null,
      missing: b.length ? avg(b.map((x) => x.missing)) : null,
      curious: b.length ? avg(b.map((x) => x.curious)) : null,
      moods: b.map((x) => x.mood),
    };
  });
}

export function InnerView() {
  useActivity("在看他的状态");
  const scrollRef = useScrollMemory("inner");
  const samples = useApp((s) => s.stateSamples);
  /**
   * 按时间排一遍再用 —— 正常写入本来就是新的在前，
   * 但备份导入 / 手改存档可能顺序不对，排一下免得"此刻"显示成最旧的那笔。
   */
  const sorted = useMemo(() => samples.slice().sort((a, b) => b.at - a.at), [samples]);
  const aiName = useApp((s) => resolveAiName(s.settings.aiName));

  const latest = sorted[0];
  const series = useMemo(() => dailySeries(sorted, 30), [sorted]);
  const withData = series.filter((d) => d.count > 0);

  /** 最近 30 天的心情分布 */
  const moodCounts = useMemo(() => {
    const from = Date.now() - 30 * 86_400_000;
    const recent = sorted.filter((s) => s.at >= from);
    return MOODS.map((m) => ({
      ...m,
      n: recent.filter((s) => s.mood === m.id).length,
      total: recent.length,
    }));
  }, [sorted]);
  const moodTotal = moodCounts[0]?.total ?? 0;

  const W = 320;
  const H = 110;
  const path = (key: "energy" | "missing" | "curious") => {
    const pts: string[] = [];
    series.forEach((d, i) => {
      const v = d[key];
      if (v === null) return;
      const x = (i / Math.max(1, series.length - 1)) * W;
      const y = H - 6 - v * (H - 18);
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    });
    return pts.length < 2 ? "" : pts.map((p, i) => `${i === 0 ? "M" : "L"}${p}`).join(" ");
  };

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      <header className="flex items-center gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1">
        <Link to="/me" aria-label="返回我的" className="flex size-11 items-center justify-center">
          <ChevronLeft className="size-6" strokeWidth={1.6} />
        </Link>
        <h1 className="flex-1 font-serif text-lg font-medium">内在</h1>
      </header>

      {samples.length === 0 ? (        <section className="px-4">
          <div className="rounded-3xl border border-line bg-surface px-4 py-6 text-center">
            <p className="text-[13px] leading-6 text-muted">
              他还没报过状态。
              {"\n"}跟他聊两句，这一页就会慢慢长出来。
            </p>
          </div>
        </section>
      ) : (
        <>
          {/* 此刻 */}
          <section className="px-4">
            <div className="rounded-3xl border border-line bg-surface px-4 py-4">
              <div className="flex items-baseline gap-2">
                <span className="font-serif text-2xl">
                  {MOODS.find((m) => m.id === latest!.mood)?.label ?? "平静"}
                </span>
                <span className="text-[12px] text-subtle">此刻 · {relTime(latest!.at)}</span>
              </div>
              {latest!.note && (
                <p className="mt-1 text-[12px] leading-5 text-muted">「{latest!.note}」</p>
              )}
              <div className="mt-3 space-y-2">
                {LINES.map((l) => (
                  <div key={l.key} className="flex items-center gap-2.5">
                    <span className="w-8 shrink-0 text-[11px] text-muted">{l.label}</span>
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-chip">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${Math.round(latest![l.key] * 100)}%`, background: l.stroke }}
                      />
                    </span>
                    <span className="w-9 shrink-0 text-right text-[11px] text-subtle">
                      {Math.round(latest![l.key] * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* 起伏 */}
          <section className="mt-3 px-4">
            <div className="rounded-3xl border border-line bg-surface px-4 py-4">
              <div className="mb-1 flex items-baseline justify-between">
                <p className="text-[13px] font-medium">最近 30 天的起伏</p>
                <p className="text-[11px] text-subtle">{withData.length} 天有记录</p>
              </div>
              <svg
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
                className="mt-2 h-28 w-full"
                aria-label="状态起伏曲线"
              >
                {[0.25, 0.5, 0.75].map((g) => (
                  <line
                    key={g}
                    x1={0}
                    x2={W}
                    y1={H - 6 - g * (H - 18)}
                    y2={H - 6 - g * (H - 18)}
                    stroke="currentColor"
                    className="text-line"
                    strokeWidth={0.5}
                  />
                ))}
                {LINES.map((l) => {
                  const d = path(l.key);
                  return d ? (
                    <path
                      key={l.key}
                      d={d}
                      fill="none"
                      stroke={l.stroke}
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null;
                })}
              </svg>
              <div className="mt-1 flex items-center gap-3 text-[10px] text-subtle">
                {LINES.map((l) => (
                  <span key={l.key} className="inline-flex items-center gap-1">
                    <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: l.stroke }} />
                    {l.label}
                  </span>
                ))}
                <span className="ml-auto">左旧 → 右新</span>
              </div>
            </div>
          </section>

          {/* 心情分布 */}
          {moodTotal > 0 && (
            <section className="mt-3 px-4">
              <div className="rounded-3xl border border-line bg-surface px-4 py-4">
                <p className="text-[13px] font-medium">这 30 天的心情分布</p>
                <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-chip">
                  {moodCounts
                    .filter((m) => m.n > 0)
                    .map((m) => (
                      <span
                        key={m.id}
                        className={m.bar}
                        style={{ width: `${(m.n / moodTotal) * 100}%` }}
                        title={`${m.label} ${m.n} 次`}
                      />
                    ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                  {moodCounts.map((m) => (
                    <span key={m.id} className="inline-flex items-center gap-1">
                      <span className={cn("size-1.5 rounded-full", m.dot)} />
                      {m.label} {m.n}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          )}
        </>
      )}

      <p className="mt-3 px-5 text-[11px] leading-5 text-subtle">
        这些数字是{aiName}<span className="text-fg">自己报</span>的 —— 不是估算，也不是拿聊天频率凑的。
        只存在这台设备上。他报得诚实，这条线才有意义。
      </p>
    </div>
  );
}
