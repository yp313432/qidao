"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, ShieldAlert, Smartphone } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { readScreenTime, formatDuration, openUsageSettings, type ScreenTime } from "@/lib/screen-time";
import { cn } from "@/lib/utils";

/**
 * **屏幕时间** —— 今天（或最近 7 天）每个 App 用了多久。
 *
 * 用户原话（2026-11）："我还加个功能，就是能看到屏幕使用时长，
 * 就是知道我一天每个app用了多久那个。"
 *
 * 三条界面纪律：
 *  1. **没授权时给按钮，不给一句"失败了"** —— 这项是系统的特殊权限，
 *     用户记不住菜单路径（`lib/env-check.ts` 里也是同样的做法）。
 *  2. **网页版说人话**：直接讲"这个只在装到手机上的栖岛里能看"，
 *     不许显示一个 0 分钟的空列表让他以为一天没玩手机。
 *  3. 合计数字取**所有 App 之和**（≈ 屏幕亮着的时长），列表只列前 40 个 ——
 *     两个数对不上时以合计为准，别自己再算一遍。
 */
export function ScreenTimePage() {
  const [days, setDays] = useState<1 | 7>(1);
  const [state, setState] = useState<ScreenTime | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (d: 1 | 7) => {
    setLoading(true);
    setFailed(false);
    try {
      const r = await readScreenTime(d);
      setState(r);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const totalMs = state?.ok ? state.totalMs : 0;
  const maxMs = state?.ok && state.apps.length > 0 ? state.apps[0].ms : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      <PageHeader
        title="屏幕时间"
        description="今天每个 App 用了多久"
        right={
          <button
            type="button"
            onClick={() => void load(days)}
            disabled={loading}
            aria-label="刷新"
            className="flex size-9 items-center justify-center rounded-full text-muted transition-colors active:bg-chip disabled:opacity-40"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} strokeWidth={1.7} aria-hidden="true" />
          </button>
        }
      />

      <div className="px-4">
        {/* 今天 / 近 7 天 */}
        <div className="mt-1 flex gap-2">
          {([1, 7] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors",
                days === d ? "choice-card-on" : "choice-card-off",
              )}
            >
              {d === 1 ? "今天" : "近 7 天"}
            </button>
          ))}
        </div>

        {/* 合计 */}
        <section className="aster-card mt-3 rounded-3xl border border-line px-4 py-5">
          <p className="text-[11px] tracking-[0.18em] text-subtle uppercase">
            {days === 1 ? "today" : "last 7 days"}
          </p>
          <p className="mt-2 font-serif text-3xl leading-none">
            {loading || !state?.ok ? "—" : formatDuration(totalMs)}
          </p>
          <p className="mt-2 text-[12px] text-muted">
            {state?.ok ? `共 ${state.apps.length} 个 App 在动过屏幕` : "还没读到数据"}
          </p>
        </section>

        {/* 主体 */}
        {loading && !state ? (
          <div className="mt-6 flex items-center justify-center gap-2 py-10 text-[13px] text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            正在读系统数据…
          </div>
        ) : failed || !state ? (
          <ErrorCard onRetry={() => void load(days)} />
        ) : !state.ok ? (
          state.reason === "unsupported" ? (
            <UnsupportedCard />
          ) : (
            <GrantCard detail={state.detail} />
          )
        ) : state.apps.length === 0 ? (
          <p className="mt-8 px-1 text-center text-[13px] text-muted">
            这{days === 1 ? "一天" : "七天"}还没有记录到前台时长。
          </p>
        ) : (
          <ul className="mt-4 space-y-2.5">
            {state.apps.map((a, i) => {
              const pct = maxMs > 0 ? Math.max(2, Math.round((a.ms / maxMs) * 100)) : 0;
              return (
                <li key={a.pkg} className="rounded-2xl border border-line px-3 py-2.5">
                  <div className="flex items-baseline gap-2">
                    <span className="w-4 shrink-0 text-[11px] tabular-nums text-subtle">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">{a.app}</span>
                    <span className="shrink-0 text-[12px] tabular-nums text-muted">{formatDuration(a.ms)}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-chip">
                    <div className="h-full rounded-full bg-accent/70" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-5 px-1 text-[11px] leading-relaxed text-subtle">
          数据来自系统「使用情况访问」，只在手机本地读取，不会上传。
        </p>
      </div>
    </div>
  );
}

/** 没开「使用情况访问」：给路径 + 一个直接跳过去的按钮 */
function GrantCard({ detail }: { detail?: string }) {
  return (
    <section className="mt-4 rounded-2xl border border-line px-4 py-4">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.7} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium">还差一个系统开关</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            {detail || "还没打开「使用情况访问」"}。打开它，栖岛才能读出每个 App 用了多久。
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-subtle">
            设置 → 应用 → 特殊应用权限 → 使用情况访问 → 栖岛
          </p>
          <button
            type="button"
            onClick={() => void openUsageSettings()}
            className="mt-3 rounded-full border border-line px-3.5 py-1.5 text-[12.5px] transition-colors active:bg-chip"
          >
            去开「使用情况访问」
          </button>
        </div>
      </div>
    </section>
  );
}

/** 网页版：没有这个能力（跟"没授权"是两件事，不许显示成 0 分钟） */
function UnsupportedCard() {
  return (
    <section className="mt-4 rounded-2xl border border-line px-4 py-4">
      <div className="flex items-start gap-2.5">
        <Smartphone className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.7} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium">这一页只能在手机上用</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            网页版读不到系统的使用情况。把栖岛装到手机上，打开「使用情况访问」就能看到。
          </p>
        </div>
      </div>
    </section>
  );
}

/** 读的过程中出了意外（原生报错等）：给重试，别只说"失败" */
function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="mt-4 rounded-2xl border border-line px-4 py-4">
      <p className="text-[13.5px] font-medium">这次没读到</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">可能是系统这次没给数据，点一下再试。</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-full border border-line px-3.5 py-1.5 text-[12.5px] transition-colors active:bg-chip"
      >
        重试
      </button>
    </section>
  );
}
