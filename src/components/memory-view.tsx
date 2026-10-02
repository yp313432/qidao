import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { computeContext, computeStorage, prettyBytes, type StorageUsage } from "@/lib/context";
import { useApp } from "@/lib/store";
import { useActivity } from "@/lib/use-activity";
import { useScrollMemory } from "@/lib/ux";
import { cn, formatClock } from "@/lib/utils";

const BUDGET_STEPS = [2000, 4000, 6000, 8000, 12000, 16000, 24000, 32000];
const KEEP_STEPS = [4, 8, 12, 16, 24, 32, 40];
const COMPACT_STEPS = [50, 60, 70, 80, 90];

export function MemoryView() {
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patchSettings);
  const requestLog = useApp((s) => s.requestLog);
  const conversations = useApp((s) => s.conversations);
  useActivity("在看内存设置");
  const scrollRef = useScrollMemory("memory");

  const [store, setStore] = useState<StorageUsage | null>(null);
  const [mounted, setMounted] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    void computeStorage().then(setStore).catch(() => setStore(null));
  }, [conversations.length]);

  // 预览读本地数据，等挂载后再算，避免服务端/客户端不一致
  const ctx = useMemo(() => (mounted ? computeContext() : null), [mounted, conversations, settings, requestLog]);

  const stats = useMemo(() => {
    let prompt = 0;
    let completion = 0;
    let cached = 0;
    let prefixChanges = 0;
    let known = 0;
    for (let i = 0; i < requestLog.length; i += 1) {
      const e = requestLog[i]!;
      if (typeof e.prompt === "number") {
        prompt += e.prompt;
        known += 1;
      }
      if (typeof e.completion === "number") completion += e.completion;
      if (typeof e.cached === "number") cached += e.cached;
      const older = requestLog[i + 1];
      if (older?.promptHash && e.promptHash && older.promptHash !== e.promptHash) prefixChanges += 1;
    }
    return { count: requestLog.length, prompt, completion, cached, known, prefixChanges };
  }, [requestLog]);

  const hitRate = stats.prompt > 0 ? Math.round((stats.cached / stats.prompt) * 100) : 0;

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 4000);
  }

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      <header className="flex items-center gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1">
        <Link to="/me" aria-label="返回我的" className="flex size-11 items-center justify-center">
          <ChevronLeft className="size-6" strokeWidth={1.6} />
        </Link>
        <h1 className="flex-1 font-serif text-lg font-medium">上下文与内存</h1>
      </header>

      {/* 预算 */}
      <section className="mt-2 px-4">
        <h2 className="mb-2 px-1 text-[12px] tracking-wide text-muted">这一轮请求装了什么</h2>
        <div className="rounded-3xl border border-line bg-surface px-4 py-4">
          {!ctx ? (
            <p className="text-[12px] text-subtle">读取中…</p>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <p className="text-[15px] font-medium">
                  约 {ctx.total} / {ctx.budget} tokens
                </p>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px]",
                    ctx.ratio >= 0.9
                      ? "bg-warn/20 text-warn"
                      : ctx.ratio >= 0.7
                        ? "bg-warn/15 text-warn"
                        : "bg-ok/15 text-ok",
                  )}
                >
                  {Math.round(ctx.ratio * 100)}%
                </span>
              </div>

              <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-elevated">
                <span
                  className="h-full bg-accent"
                  style={{ width: `${(ctx.systemTokens / ctx.budget) * 100}%` }}
                  title="系统提示词"
                />
                <span
                  className="h-full bg-fg/60"
                  style={{ width: `${(ctx.historyTokens / ctx.budget) * 100}%` }}
                  title="对话历史"
                />
                <span
                  className="h-full bg-warn"
                  style={{ width: `${(ctx.attachmentTokens / ctx.budget) * 100}%` }}
                  title="附件（图片）"
                />
              </div>

              <ul className="mt-3 space-y-1 text-[11px] leading-4 text-muted">
                <li>
                  <span className="text-accent">■</span> 系统提示词 · 约 {ctx.systemTokens} tokens
                  {ctx.systemTokens === 0 && "（发过一次消息就有准确值）"}
                </li>
                <li>
                  <span className="text-fg/60">■</span> 对话历史 · 约 {ctx.historyTokens} tokens（
                  {ctx.messages} 条参与）
                </li>
                <li>
                  <span className="text-warn">■</span> 附件图片 · 约 {ctx.attachmentTokens} tokens
                </li>
              </ul>

              {ctx.folded > 0 && (
                <p className="mt-3 rounded-2xl bg-chip px-3 py-2 text-[11px] leading-4 text-muted">
                  为了不超预算，更早的 <span className="font-medium text-fg">{ctx.folded}</span> 条
                  消息这一轮没有发出去（本地仍然保留）。
                  <span className="text-subtle">
                    「智能摘要压缩」需要接入 AI 才能真正总结，现在是按预算截断。
                  </span>
                </p>
              )}
            </>
          )}
        </div>
      </section>

      {/* 设置 */}
      <section className="mt-5 px-4">
        <h2 className="mb-2 px-1 text-[12px] tracking-wide text-muted">保留策略</h2>
        <div className="divide-y divide-line rounded-3xl border border-line bg-surface px-4">
          <Stepper
            label="上下文预算"
            hint="超出就折叠更早的消息"
            value={`${settings.contextBudget} tokens`}
            onPrev={() => patch({ contextBudget: step(BUDGET_STEPS, settings.contextBudget, -1) })}
            onNext={() => patch({ contextBudget: step(BUDGET_STEPS, settings.contextBudget, 1) })}
          />
          <Stepper
            label="至少保留最近"
            hint="预算再紧也不裁这些"
            value={`${settings.keepRecent} 条`}
            onPrev={() => patch({ keepRecent: step(KEEP_STEPS, settings.keepRecent, -1) })}
            onNext={() => patch({ keepRecent: step(KEEP_STEPS, settings.keepRecent, 1) })}
          />
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-[13px] font-medium">自动折叠</p>
              <p className="mt-0.5 text-[11px] text-muted">关掉就一直按条数截断</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoCompact}
              aria-label="自动折叠"
              onClick={() => patch({ autoCompact: !settings.autoCompact })}
              className={cn(
                "relative h-7 w-12 shrink-0 rounded-full transition-colors",
                settings.autoCompact ? "bg-ink" : "bg-fg/10",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 left-0.5 size-6 rounded-full bg-elevated shadow-sm transition-transform",
                  settings.autoCompact && "translate-x-5",
                )}
              />
            </button>
          </div>
          <Stepper
            label="用到多少开始折叠"
            hint="给回复留出空间"
            value={`${settings.compactAt}%`}
            disabled={!settings.autoCompact}
            onPrev={() => patch({ compactAt: step(COMPACT_STEPS, settings.compactAt, -1) })}
            onNext={() => patch({ compactAt: step(COMPACT_STEPS, settings.compactAt, 1) })}
          />
        </div>
      </section>

      {/* 缓存与用量 */}
      <section className="mt-5 px-4">
        <h2 className="mb-2 flex items-center justify-between px-1 text-[12px] tracking-wide text-muted">
          <span>缓存命中与用量</span>
          {stats.count > 0 && (
            <button
              type="button"
              onClick={() => useApp.getState().clearRequestLog()}
              className="text-[11px] text-subtle"
            >
              清空记录
            </button>
          )}
        </h2>
        <div className="rounded-3xl border border-line bg-surface px-4 py-3.5">
          {stats.count === 0 ? (
            <p className="text-[12px] leading-5 text-subtle">
              还没有请求记录。发一条消息后，这里会显示输入/输出/缓存命中的真实数字，
              以及「前缀有没有变」—— 缓存命不中通常就是前缀变了。
            </p>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <p className="text-[15px] font-medium">缓存命中率 {hitRate}%</p>
                <span className="text-[11px] text-muted">{stats.count} 次请求</span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-elevated">
                <span className="block h-full bg-ok" style={{ width: `${hitRate}%` }} />
              </div>
              <ul className="mt-3 space-y-1 text-[11px] leading-4 text-muted">
                <li>输入合计 {stats.prompt.toLocaleString()} tokens</li>
                <li>输出合计 {stats.completion.toLocaleString()} tokens</li>
                <li>其中缓存命中 {stats.cached.toLocaleString()} tokens</li>
                <li>
                  前缀变更{" "}
                  <span className={stats.prefixChanges > 0 ? "text-warn" : "text-ok"}>
                    {stats.prefixChanges}
                  </span>{" "}
                  次
                  {stats.prefixChanges === 0
                    ? "（系统提示词一直没变，最容易命中）"
                    : "（每次变都会让历史那段的缓存失效）"}
                </li>
                <li className="text-subtle">
                  指纹 {requestLog[0]?.promptHash || "—"} · 最近 {formatClock(requestLog[0]?.at ?? Date.now())}
                </li>
              </ul>
              {stats.known === 0 && (
                <p className="mt-2 text-[11px] leading-4 text-warn">
                  上游没返回 usage —— 有的兼容接口不发。这种情况只看得到前缀诊断。
                </p>
              )}
            </>
          )}
        </div>
      </section>

      {/* 思考链归档已经删掉（回复时当场就能看到，再存一份纯占地方）。
          老数据在加载时已经清空，这里不再有这一块。 */}

      {/* 本地存储 */}
      <section className="mt-5 px-4">
        <h2 className="mb-2 px-1 text-[12px] tracking-wide text-muted">本地存储占用</h2>
        <div className="rounded-3xl border border-line bg-surface px-4 py-3.5">
          {!store ? (
            <p className="text-[12px] text-subtle">统计中…</p>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <p className="text-[15px] font-medium">
                  {prettyBytes(store.localBytes + store.musicBytes)}
                </p>
                {store.quotaBytes && (
                  <span className="text-[11px] text-muted">
                    浏览器给的额度 {prettyBytes(store.quotaBytes)}
                  </span>
                )}
              </div>
              <ul className="mt-3 space-y-1.5 text-[11px] leading-4 text-muted">
                <li>
                  设置与数据（localStorage）· <span className="text-fg">{prettyBytes(store.localBytes)}</span>
                </li>
                <li>
                  本地音乐（IndexedDB）· <span className="text-fg">{prettyBytes(store.musicBytes)}</span>
                  <span className="text-subtle"> · {store.musicTracks} 首</span>
                </li>
              </ul>
              {store.breakdown.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-line pt-2.5 text-[11px] leading-4 text-subtle">
                  {store.breakdown.slice(0, 6).map((b) => (
                    <li key={b.key} className="flex justify-between gap-3">
                      <span className="truncate font-mono">{b.key}</span>
                      <span className="shrink-0">{prettyBytes(b.bytes)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </section>

      {toast && (
        <p className="mt-4 px-5 text-center text-[12px] text-muted">{toast}</p>
      )}
      <div className="h-6" />
    </div>
  );
}

function step(steps: number[], current: number, dir: number): number {
  const i = steps.indexOf(current);
  if (i < 0) {
    // 不在档位里：找最接近的
    const sorted = [...steps].sort((a, b) => a - b);
    const next = sorted.find((s) => (dir > 0 ? s > current : s < current));
    return next ?? current;
  }
  const j = Math.min(steps.length - 1, Math.max(0, i + dir));
  return steps[j]!;
}

function Stepper({
  label,
  hint,
  value,
  onPrev,
  onNext,
  disabled,
}: {
  label: string;
  hint: string;
  value: string;
  onPrev: () => void;
  onNext: () => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("flex items-center justify-between py-3", disabled && "opacity-50")}>
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{label}</p>
        <p className="mt-0.5 text-[11px] text-muted">{hint}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          aria-label={`${label} 减少`}
          disabled={disabled}
          onClick={onPrev}
          className="flex size-8 items-center justify-center rounded-full bg-fg/8 text-fg"
        >
          −
        </button>
        <span className="min-w-16 text-center text-[12px]">{value}</span>
        <button
          type="button"
          aria-label={`${label} 增加`}
          disabled={disabled}
          onClick={onNext}
          className="flex size-8 items-center justify-center rounded-full bg-fg/8 text-fg"
        >
          ＋
        </button>
      </div>
    </div>
  );
}
