import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useActivity } from "@/lib/use-activity";
import { useScrollMemory } from "@/lib/ux";

/**
 * 内在 · 状态。
 *
 * ⚠️ 2026-10：**这页原来那朵花瓣图拆了**（组件 `inner-flower.tsx` 一并删掉）。
 *
 * 用户："这个新的做完旧的情绪那个就不用留了" —— 新的是「星屿」插件
 * （玩乐 → 插件 → 星屿 · `/play/plugins/emotion`）：对话里的情绪在那儿
 * 长成一个活的灵体，比一圈静态花瓣更能看出"他现在什么状态"。
 *
 * 所以这一页**只留一条入口**，不再画图、也不再列那 11 个词
 * （用户："在那个位置留一条简洁的入口，不要新做界面"）。
 *
 * ── 拆的是图，不是数据 ──────────────────────────────────────────────
 * 2026-10：连**数据通道也一起退了** —— `lib/state-dims.ts`（11 个维度）、
 * 动作 `state.report`、store 里的 `stateSamples` 全部删掉（用户："就是那 11 个就不用了"）。
 * 现在情绪只有新词表那一条通道（`emotion.report` → 星屿）。
 * 所以这一页**只剩入口**，别在这儿重画任何图 —— 那正是这次要拆掉的东西。
 */

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

export function InnerView() {
  useActivity("在看他的状态");
  const scrollRef = useScrollMemory("inner");

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

        {/* 唯一的内容：一条去「星屿」的入口（原来花瓣图的位置） */}
        <section className="px-4">
          <div className="tide-card rounded-3xl px-4 py-5">
            <p className="text-[13px] font-medium text-fg">他的情绪</p>
            <p className="mt-1 text-[11px] leading-5 text-fg/70">
              原来这页那张花瓣图不用了 —— 他每轮自己报的情绪，
              现在在「星屿」里长成一个活的灵体。
            </p>
            <Link
              to="/play/plugins/emotion"
              className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-chip px-3.5 py-3"
            >
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">星屿</span>
                <span className="mt-0.5 block text-[11px] text-subtle">玩乐 → 插件 → 星屿</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted" />
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
