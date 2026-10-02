import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlarmClock, ChevronLeft, Plus, Trash2 } from "lucide-react";
import { resolveAiName } from "@/lib/branding";
import { useApp } from "@/lib/store";
import { useActivity } from "@/lib/use-activity";
import { useScrollMemory } from "@/lib/ux";
import { cn } from "@/lib/utils";

/**
 * 定时任务：让他到点自己开口。
 *
 * 说清边界（别让人以为它像闹钟那样绝对可靠）：
 *   App 活着 → 真的到点他会说话 ✅
 *   App 完全关闭 → 只有系统通知；点开 App 时补上那句话 ✅
 * 另外有三条护栏：每天最多 3 条、23:00–07:00 不说话、同一天同一任务只跑一次。
 */
export function TasksView() {
  useActivity("在看定时任务");
  const scrollRef = useScrollMemory("tasks");
  const tasks = useApp((s) => s.tasks);
  const addTask = useApp((s) => s.addTask);
  const removeTask = useApp((s) => s.removeTask);
  const toggleTask = useApp((s) => s.toggleTask);
  const updateTask = useApp((s) => s.updateTask);
  const aiName = useApp((s) => resolveAiName(s.settings.aiName));

  const [adding, setAdding] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [time, setTime] = useState("08:00");

  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  })();
  const ranToday = tasks.filter((t) => t.lastRunDay === today).length;

  function add() {
    if (!prompt.trim()) return;
    addTask({ prompt, time, notify: true });
    setPrompt("");
    setAdding(false);
  }

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      <header className="flex items-center gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1">
        <Link to="/me" aria-label="返回我的" className="flex size-11 items-center justify-center">
          <ChevronLeft className="size-6" strokeWidth={1.6} />
        </Link>
        <h1 className="flex-1 font-serif text-lg font-medium">定时任务</h1>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          aria-label="加一个"
          className="mr-1 flex size-11 items-center justify-center rounded-full"
        >
          <Plus className={cn("size-5 transition-transform", adding && "rotate-45")} strokeWidth={1.7} />
        </button>
      </header>

      <section className="px-4">
        <div className="rounded-3xl border border-line bg-surface px-4 py-3.5">
          <p className="text-[13px] leading-5">
            到点让<span className="text-fg">{aiName}</span>自己开口说一句 —— 不是死板的提醒文案，
            是他按你的交代现想的话。
          </p>
          <p className="mt-2 text-[11px] leading-4 text-subtle">
            App 开着时他<span className="text-fg">真的会说</span>；App 完全关掉时只能发系统通知，
            点开才补上那句话。今天已经主动说了 {ranToday} 次（每天最多 3 次，23:00–07:00 不说话）。
          </p>
          <p className="mt-2 text-[11px] leading-4 text-subtle">
            想更可靠：系统设置 → 应用 → 栖岛 → 电池 → 选「不受限制 / 不优化」。
            能明显减少被杀，但安卓仍可能在深度省电时推迟它 —— 真正稳的是常驻前台服务（以后做）。
          </p>
        </div>
      </section>

      {adding && (
        <section className="mt-3 px-4">
          <div className="rounded-3xl border border-line bg-surface px-4 py-3.5">
            <p className="mb-2 text-[12px] text-muted">让他做什么（自由描述）</p>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              placeholder="比如：跟我说句早安，顺便提一下今天该做的事"
              className="w-full resize-none rounded-2xl bg-chip px-3 py-2.5 text-[13px] leading-5 outline-none"
            />
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[12px] text-muted">每天</span>
              <input
                value={time}
                onChange={(e) => setTime(e.target.value)}
                placeholder="08:00"
                className="h-10 w-24 rounded-2xl bg-chip px-3 text-center text-[13px] outline-none"
              />
              <button
                type="button"
                onClick={add}
                disabled={!prompt.trim()}
                className="ml-auto h-10 shrink-0 rounded-2xl bg-ink px-4 text-[13px] font-medium text-ink-fg disabled:opacity-40"
              >
                设好
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="mt-4 space-y-2.5 px-4">
        {tasks.length === 0 ? (
          <p className="py-12 text-center text-[13px] leading-6 text-muted">
            还没有定时任务。
            {"\n"}你可以直接跟他说「每天早上八点跟我说句早安」，他会自己设好。
          </p>
        ) : (
          tasks.map((t) => (
            <article key={t.id} className="rounded-3xl border border-line bg-surface px-4 py-3.5">
              <div className="flex items-start gap-2.5">
                <AlarmClock
                  className={cn("mt-0.5 size-4 shrink-0", t.enabled ? "text-accent" : "text-subtle")}
                  strokeWidth={1.7}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] leading-6">{t.prompt}</p>
                  <p className="mt-1 text-[11px] text-subtle">
                    {t.at
                      ? `一次性 · ${new Date(t.at).toLocaleString("zh-CN", { hour12: false })}`
                      : `每天 ${t.time ?? "08:00"}`}
                    {t.lastRunDay === today && " · 今天已经说过"}
                  </p>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggleTask(t.id)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px]",
                        t.enabled ? "bg-accent text-accent-fg" : "bg-chip text-muted",
                      )}
                    >
                      {t.enabled ? "开着" : "已关"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = window.prompt("改成每天几点？（HH:MM）", t.time ?? "08:00");
                        if (next === null) return;
                        if (/^\d{1,2}:\d{2}$/.test(next.trim())) {
                          updateTask(t.id, { time: next.trim(), at: undefined });
                        }
                      }}
                      className="rounded-full bg-chip px-2.5 py-1 text-[11px] text-muted"
                    >
                      改时间
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTask(t.id)}
                      aria-label="删掉"
                      className="flex items-center gap-1 rounded-full bg-chip px-2.5 py-1 text-[11px] text-muted"
                    >
                      <Trash2 className="size-3" />
                      删除
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
