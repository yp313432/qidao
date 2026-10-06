import { useMemo } from "react";
import { InnerFlower } from "@/components/inner-flower";
import { PageHeader } from "@/components/page-header";
import { useApp } from "@/lib/store";
import { resolveAiName } from "@/lib/branding";
import { DIMS, averageDims, dimsOf, strongest } from "@/lib/state-dims";
import type { MoodId } from "@/lib/types";
import { useActivity } from "@/lib/use-activity";
import { useScrollMemory } from "@/lib/ux";
import { cn } from "@/lib/utils";

/**
 * 内在 · 状态。
 *
 * 那些数字不是算法拼的 —— 是他**每轮回复时自己报的**
 * （动作协议里的 state.report，L0 静默执行）。
 *
 * 2026-10 改版（用户："把可视化改成下面那个圆那个圆的扇形的那种，情绪可以多种"）：
 *   · **折线 → 一朵花**：一圈花瓣，每瓣一个情绪维度，长度=数值（`InnerFlower`）
 *   · 维度从 3 个（精力/想念/好奇）扩到 11 个（`lib/state-dims.ts`），
 *     但**每轮只报"此刻明显的那几个"**（稀疏）—— 省 token，也更像真的
 *   · 「最近 30 天」那朵画的是**平均值**（能平均的才敢平均；没记录的天不算 0）
 *
 * 三样东西：此刻 / 最近 30 天的平均 / 心情分布。
 */

const MOODS: { id: MoodId; label: string; dot: string; bar: string }[] = [
  { id: "calm", label: "平静", dot: "bg-sky-400", bar: "bg-sky-400/70" },
  { id: "joy", label: "开心", dot: "bg-amber-400", bar: "bg-amber-400/70" },
  { id: "focus", label: "专注", dot: "bg-emerald-400", bar: "bg-emerald-400/70" },
  { id: "low", label: "低落", dot: "bg-slate-400", bar: "bg-slate-400/70" },
  { id: "miss", label: "想念", dot: "bg-rose-400", bar: "bg-rose-400/70" },
  // spark 以前**漏在这里**了（类型里有、上报白名单和这里都没有）→ "心动"永远显示不出来
  { id: "spark", label: "心动", dot: "bg-fuchsia-400", bar: "bg-fuchsia-400/70" },
];

function relTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
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
  const nowDims = useMemo(() => (latest ? dimsOf(latest) : null), [latest]);
  const topNow = nowDims ? strongest(nowDims) : null;

  /** 最近 30 天：那朵画的是平均值 */
  const recent = useMemo(() => {
    const from = Date.now() - 30 * 86_400_000;
    return sorted.filter((s) => s.at >= from);
  }, [sorted]);
  const avgDims = useMemo(() => averageDims(recent), [recent]);
  const activeDims = recent.length
    ? DIMS.filter((d) => avgDims[d.id] > 0.12)
    : [];

  /** 心情分布 */
  const moodCounts = useMemo(
    () =>
      MOODS.map((m) => ({
        ...m,
        n: recent.filter((s) => s.mood === m.id).length,
        total: recent.length,
      })),
    [recent],
  );
  const moodTotal = moodCounts[0]?.total ?? 0;

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      <PageHeader title="内在" />

      {samples.length === 0 || !latest || !nowDims || !topNow ? (
        <section className="px-4">
          <div className="rounded-3xl border border-line bg-surface px-4 py-6 text-center">
            <p className="text-[13px] leading-6 text-muted">
              他还没报过状态。
              {"\n"}跟他聊两句，这朵花就会慢慢长出来。
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
                  {MOODS.find((m) => m.id === latest.mood)?.label ?? "平静"}
                </span>
                <span className="text-[12px] text-subtle">此刻 · {relTime(latest.at)}</span>
              </div>
              {latest.note && (
                <p className="mt-1 text-[12px] leading-5 text-muted">「{latest.note}」</p>
              )}

              <InnerFlower dims={nowDims} mode="now" className="mt-3" />

              {/* 花瓣下面把那几个"亮着的"写成数值 —— 图看不出精确数字，文字补上 */}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                {DIMS.filter((d) => nowDims[d.id] > 0.12).map((d) => (
                  <span key={d.id} className="inline-flex items-center gap-1">
                    <span className="size-1.5 rounded-full" style={{ background: d.color }} />
                    {d.label} {Math.round(nowDims[d.id] * 100)}%
                  </span>
                ))}
                {DIMS.every((d) => nowDims[d.id] <= 0.12) && (
                  <span className="text-subtle">这一笔他没报出明显的情绪</span>
                )}
              </div>
            </div>
          </section>

          {/* 最近 30 天的平均 */}
          <section className="mt-3 px-4">
            <div className="rounded-3xl border border-line bg-surface px-4 py-4">
              <div className="mb-1 flex items-baseline justify-between">
                <p className="text-[13px] font-medium">最近 30 天 · 平均</p>
                <p className="text-[11px] text-subtle">
                  {recent.length} 次记录
                  {activeDims.length ? ` · 常在的是 ${activeDims.map((d) => d.label).join("、")}` : ""}
                </p>
              </div>
              <InnerFlower dims={avgDims} mode="avg" className="mt-2" />
              <p className="mt-1 text-center text-[11px] leading-4 text-subtle">
                没记录的日子<span className="text-muted">不算 0</span>
                （不然"某天没聊"会被当成"那天没情绪"）
              </p>
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
        这朵花是{aiName}
        <span className="text-fg">自己报</span>的 —— 不是估算，也不是拿聊天频率凑的。
        每轮他只会报<span className="text-fg">此刻明显的那几样</span>，
        没报的就是没有；只存在这台设备上。他报得诚实，这朵花才有意义。
      </p>
    </div>
  );
}
