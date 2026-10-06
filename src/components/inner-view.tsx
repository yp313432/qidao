import { useMemo } from "react";
import { InnerFlower } from "@/components/inner-flower";
import { PageHeader } from "@/components/page-header";
import { useApp } from "@/lib/store";
import { resolveAiName } from "@/lib/branding";
import { DIMS, averageDims, dimsOf, moodDisplay, strongest } from "@/lib/state-dims";
import { useActivity } from "@/lib/use-activity";
import { useScrollMemory } from "@/lib/ux";

/**
 * 内在 · 状态。
 *
 * 那些数字不是算法拼的 —— 是他**每轮回复时自己报的**
 * （动作协议里的 state.report，L0 静默执行）。
 *
 * 2026-10 改版：
 *   · **折线 → 一朵花**（`InnerFlower`）：一圈花瓣，每瓣一个情绪维度，长度=数值
 *   · 维度 3 → 11（`lib/state-dims.ts`），每轮**只报此刻明显的那几个**（稀疏、省 token）
 *   · **背景改成整页铺满**（`.tide-bg`：粉紫渐变 + 珍珠光斑 + 两条正弦波纹）——
 *     原来那层背景塞在卡片里，跟整页底色不搭（用户真机反馈："和底层背景不符合"）
 *
 * 三样东西：此刻 / 最近 30 天的平均 / 心情分布。
 */

/**
 * 心情分布用的词表。
 *
 * **跟花瓣共用同一张表**（`lib/state-dims.ts` 的 DIMS）—— 用户："ai 的心情描述
 * 还是那六个吗，太少了，而且不好分类，直接改成图上的这十一个吧。"
 * 颜色也直接取词表里的 `d.color`（走 inline style），不再各写一套 Tailwind 色类 ——
 * 否则色类和词表迟早有一处对不上。
 */
const MOODS = DIMS.map((d) => ({ id: d.id, label: d.label, color: d.color }));

/** 珍珠光斑：位置/大小/延迟都写死（不用随机数 —— 免得 SSR 首帧跟客户端不一致） */
const PEARLS = [
  { left: "10%", top: "12%", size: 11, delay: "0s" },
  { left: "80%", top: "20%", size: 7, delay: "-3s" },
  { left: "24%", top: "52%", size: 6, delay: "-6s" },
  { left: "68%", top: "66%", size: 13, delay: "-1.5s" },
  { left: "44%", top: "8%", size: 5, delay: "-8s" },
  { left: "88%", top: "48%", size: 9, delay: "-4.5s" },
];

/** 海面正弦波：画两个周期，平移 50% 正好一个周期 → 看不出接缝 */
function wavePath(amp: number, base: number) {
  return `M0 ${base} Q 25 ${base - amp} 50 ${base} T 100 ${base} T 150 ${base} T 200 ${base} V 100 H0 Z`;
}

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

  /** 最近 30 天 */
  const recent = useMemo(() => {
    const from = Date.now() - 30 * 86_400_000;
    return sorted.filter((s) => s.at >= from);
  }, [sorted]);
  const avgDims = useMemo(() => averageDims(recent), [recent]);
  const activeDims = recent.length ? DIMS.filter((d) => avgDims[d.id] > 0.12) : [];

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
    <div ref={scrollRef} className="relative flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      {/*
        整页的潮水背景：`position: fixed` 钉在视口上（这页能滚，放 absolute 会被滚跑）。
        内容在 `relative z-10` 里，卡片半透明让潮水透上来。
      */}
      <div className="tide-bg" aria-hidden="true">
        {PEARLS.map((p, i) => (
          <span
            key={i}
            className="tide-pearl"
            style={{ left: p.left, top: p.top, width: p.size, height: p.size, animationDelay: p.delay }}
          />
        ))}
        <span className="tide-wave tide-wave-far">
          <svg viewBox="0 0 200 100" preserveAspectRatio="none">
            <path d={wavePath(10, 46)} fill="rgba(255,255,255,0.6)" />
          </svg>
        </span>
        <span className="tide-wave tide-wave-near">
          <svg viewBox="0 0 200 100" preserveAspectRatio="none">
            <path d={wavePath(14, 62)} fill="rgba(214,186,255,0.55)" />
          </svg>
        </span>
      </div>

      <div className="relative z-10">
        <PageHeader title="内在" />

        {samples.length === 0 || !latest || !nowDims || !topNow ? (
          <section className="px-4">
            <div className="tide-card rounded-3xl px-4 py-6 text-center">
              <p className="text-[13px] leading-6 text-fg/70">
                他还没报过状态。
                {"\n"}跟他聊两句，这朵花就会慢慢长出来。
              </p>
            </div>
          </section>
        ) : (
          <>
            {/* 此刻 */}
            <section className="px-4">
              <div className="tide-card rounded-3xl px-4 py-4">
                <div className="flex items-baseline gap-2">
                  <span className="font-serif text-2xl text-fg">
                    {/* 老存档的 mood 是 "calm" 这种（新词表里没有）—— moodDisplay 会兜成当时的中文名，不留空白 */}
                    {moodDisplay(latest.mood).label}
                  </span>
                  <span className="text-[12px] text-fg/55">此刻 · {relTime(latest.at)}</span>
                </div>
                {latest.note && (
                  <p className="mt-1 text-[12px] leading-5 text-fg/70">「{latest.note}」</p>
                )}

                <InnerFlower dims={nowDims} mode="now" className="mt-1" />

                {/* 花瓣下面把那几个"亮着的"写成数值 —— 图看不出精确数字，文字补上 */}
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg/70">
                  {DIMS.filter((d) => nowDims[d.id] > 0.12).map((d) => (
                    <span key={d.id} className="inline-flex items-center gap-1">
                      <span className="size-1.5 rounded-full" style={{ background: d.color }} />
                      {d.label} {Math.round(nowDims[d.id] * 100)}%
                    </span>
                  ))}
                  {DIMS.every((d) => nowDims[d.id] <= 0.12) && (
                    <span className="text-fg/50">这一笔他没报出明显的情绪</span>
                  )}
                </div>
              </div>
            </section>

            {/* 最近 30 天的平均 */}
            <section className="mt-3 px-4">
              <div className="tide-card rounded-3xl px-4 py-4">
                <div className="mb-1 flex items-baseline justify-between">
                  <p className="text-[13px] font-medium text-fg">最近 30 天 · 平均</p>
                  <p className="text-[11px] text-fg/55">
                    {recent.length} 次记录
                    {activeDims.length ? ` · 常在的是 ${activeDims.map((d) => d.label).join("、")}` : ""}
                  </p>
                </div>
                <InnerFlower dims={avgDims} mode="avg" />
                <p className="mt-1 text-center text-[11px] leading-4 text-fg/50">
                  没记录的日子<span className="text-fg/70">不算 0</span>
                  （不然"某天没聊"会被当成"那天没情绪"）
                </p>
              </div>
            </section>

            {/* 心情分布 */}
            {moodTotal > 0 && (
              <section className="mt-3 px-4">
                <div className="tide-card rounded-3xl px-4 py-4">
                  <p className="text-[13px] font-medium text-fg">这 30 天的心情分布</p>
                  <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-white/50">
                    {moodCounts
                      .filter((m) => m.n > 0)
                      .map((m) => (
                        <span
                          key={m.id}
                          style={{ width: `${(m.n / moodTotal) * 100}%`, background: m.color }}
                          title={`${m.label} ${m.n} 次`}
                        />
                      ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg/70">
                    {moodCounts.map((m) => (
                      <span key={m.id} className="inline-flex items-center gap-1">
                        <span className="size-1.5 rounded-full" style={{ background: m.color }} />
                        {m.label} {m.n}
                      </span>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </>
        )}

        <p className="mt-3 px-5 text-[11px] leading-5 text-fg/55">
          这朵花是{aiName}
          <span className="text-fg">自己报</span>的 —— 不是估算，也不是拿聊天频率凑的。
          每轮他只会报<span className="text-fg">此刻明显的那几样</span>，
          没报的就是没有；只存在这台设备上。他报得诚实，这朵花才有意义。
        </p>
      </div>
    </div>
  );
}
