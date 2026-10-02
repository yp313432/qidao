import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlarmClock, Bell, BellOff, ChevronLeft, Plus, Trash2 } from "lucide-react";
import { resolveAiName } from "@/lib/branding";
import { askExactAlarm, exactAlarmState } from "@/lib/notify";
import { IS_APP } from "@/lib/platform";
import { previewRing } from "@/lib/ring-tone";
import { saveToSystemAlarm } from "@/lib/system-alarm";
import { useApp } from "@/lib/store";
import { useActivity } from "@/lib/use-activity";
import { useScrollMemory } from "@/lib/ux";
import { cn } from "@/lib/utils";

/**
 * 闹钟 / 提醒。
 *
 * 三件事必须说清（否则用户会以为它像系统闹钟那样绝对可靠）：
 *   · App 开着 → 到点**全屏响铃 + 真的响**（WebAudio 合成，不用音频文件）
 *   · App 关着 → 只有系统通知（我们把闹钟交给了系统定时，那个照样会响）
 *   · 安卓 12+ 还要单独授权"闹钟和提醒"，没授权时系统可能推迟几十秒到几分钟
 */
export function AlarmsView() {
  useActivity("在看闹钟");
  const scrollRef = useScrollMemory("alarms");
  const reminders = useApp((s) => s.reminders);
  const addReminder = useApp((s) => s.addReminder);
  const patchReminder = useApp((s) => s.patchReminder);
  const removeReminder = useApp((s) => s.removeReminder);
  const toggle = useApp((s) => s.toggleReminder);
  const aiName = useApp((s) => resolveAiName(s.settings.aiName));

  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [time, setTime] = useState("07:30");
  const [ring, setRing] = useState(true);
  /** 只响这一次的日期（空 = 每天） */
  const [onceDate, setOnceDate] = useState("");
  const [exact, setExact] = useState<"granted" | "denied" | "unknown">("unknown");
  const [sysMsg, setSysMsg] = useState("");

  useEffect(() => {
    if (!IS_APP) return;
    void exactAlarmState().then(setExact);
  }, []);

  function submit() {
    if (!text.trim()) return;
    addReminder({ text, time, ring, date: onceDate || undefined });
    setText("");
    setAdding(false);
  }

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      <header className="flex items-center gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1">
        <Link to="/me" aria-label="返回我的" className="flex size-11 items-center justify-center">
          <ChevronLeft className="size-6" strokeWidth={1.6} />
        </Link>
        <h1 className="flex-1 font-serif text-lg font-medium">闹钟</h1>
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
            到点会<span className="text-fg">全屏响铃</span>（带声音），不只弹一条通知 ——
            只发通知的话，睡着的时候根本不知道响过。
          </p>
          <p className="mt-2 text-[11px] leading-4 text-subtle">
            App 关着时靠系统定时通知（我们把闹钟交给了系统，所以照样会响，但只弹通知）。
            网页版没有这个能力。
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => previewRing()}
              className="rounded-full bg-chip px-3 py-1.5 text-[12px] text-fg"
            >
              听一下铃声
            </button>
            {IS_APP && (
              <button
                type="button"
                onClick={() => void askExactAlarm().then(() => exactAlarmState().then(setExact))}
                className={cn(
                  "rounded-full px-3 py-1.5 text-[12px]",
                  exact === "granted" ? "bg-chip text-muted" : "bg-accent text-accent-fg",
                )}
              >
                {exact === "granted" ? "精确定时已授权 ✅" : "申请精确定时（安卓 12+）"}
              </button>
            )}
          </div>
          {IS_APP && exact === "denied" && (
            <p className="mt-2 text-[11px] leading-4 text-subtle">
              没授权时闹钟可能晚几十秒到几分钟 —— 这是安卓的省电规矩，不是我们偷懒。
            </p>
          )}
          {sysMsg && <p className="mt-2 text-[11px] leading-4 text-fg">{sysMsg}</p>}
        </div>
      </section>

      {adding && (
        <section className="mt-3 px-4">
          <div className="rounded-3xl border border-line bg-surface px-4 py-3.5">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="闹钟说什么，例如：起来吃药"
              className="h-11 w-full rounded-2xl bg-chip px-3 text-[13px] outline-none"
            />
            <div className="mt-2 flex items-center gap-2">
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="h-11 rounded-2xl bg-chip px-3 text-[13px] outline-none"
              />
              <button
                type="button"
                onClick={() => setRing((v) => !v)}
                className={cn(
                  "flex h-11 items-center gap-1.5 rounded-2xl px-3 text-[12px]",
                  ring ? "bg-accent text-accent-fg" : "bg-chip text-muted",
                )}
              >
                {ring ? <Bell className="size-4" /> : <BellOff className="size-4" />}
                {ring ? "响铃" : "只提醒"}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!text.trim()}
                className="ml-auto h-11 shrink-0 rounded-2xl bg-ink px-5 text-[13px] font-medium text-ink-fg disabled:opacity-40"
              >
                设好
              </button>
            </div>
            {/* 空 = 每天；填了日期 = 只响这一次 */}
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[12px] text-muted">只这一次</span>
              <input
                type="date"
                value={onceDate}
                onChange={(e) => setOnceDate(e.target.value)}
                className="h-10 rounded-2xl bg-chip px-3 text-[13px] outline-none"
              />
              {onceDate && (
                <button
                  type="button"
                  onClick={() => setOnceDate("")}
                  className="rounded-full bg-chip px-3 py-1.5 text-[12px] text-muted"
                >
                  清掉（改成每天）
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="mt-4 space-y-2.5 px-4">
        {reminders.length === 0 ? (
          <p className="py-12 text-center text-[13px] leading-6 text-muted">
            还没有闹钟/提醒。
            {"\n"}也可以直接跟{aiName}说「明早七点半叫我起来」。
          </p>
        ) : (
          reminders.map((r) => (
            <article key={r.id} className="rounded-3xl border border-line bg-surface px-4 py-3.5">
              <div className="flex items-start gap-3">
                <AlarmClock
                  className={cn("mt-0.5 size-4 shrink-0", r.ring ? "text-accent" : "text-subtle")}
                  strokeWidth={1.7}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-serif text-xl">{r.time}</span>
                    {/* "是一次还是每天"必须写清楚 —— 用户专门提过 */}
                    <span className="text-[11px] text-subtle">
                      {r.date ? `${r.date} 只这一次` : "每天"}
                      {r.ring ? " · 响铃" : " · 只弹通知"}
                    </span>
                    {r.snoozeUntil && (
                      <span className="text-[11px] text-subtle">
                        已贪睡到{" "}
                        {new Date(r.snoozeUntil).toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </span>
                    )}
                  </div>
                  <p className={cn("mt-0.5 text-[13px] leading-5", r.done && "text-subtle line-through")}>
                    {r.text}
                  </p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => patchReminder(r.id, { ring: !r.ring })}
                      className={cn(
                        "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px]",
                        r.ring ? "bg-accent text-accent-fg" : "bg-chip text-muted",
                      )}
                    >
                      {r.ring ? <Bell className="size-3" /> : <BellOff className="size-3" />}
                      {r.ring ? "响铃" : "只提醒"}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle(r.id)}
                      className="rounded-full bg-chip px-2.5 py-1 text-[11px] text-muted"
                    >
                      {r.done ? "恢复" : "已完成"}
                    </button>
                    {/* 交给手机自带时钟 —— 系统闹钟连省电模式都拦不住，最可靠 */}
                    <button
                      type="button"
                      onClick={() => {
                        void saveToSystemAlarm(r.time, r.text).then((res) => {
                          setSysMsg(
                            res.ok
                              ? `已经把「${r.time} ${r.text}」存进手机时钟了 ✅`
                              : `没能存进系统时钟：${res.reason}`,
                          );
                        });
                      }}
                      className="rounded-full bg-chip px-2.5 py-1 text-[11px] text-muted"
                    >
                      存到手机闹钟
                    </button>
                    <button
                      type="button"
                      onClick={() => removeReminder(r.id)}
                      className="ml-auto flex items-center gap-1 rounded-full bg-chip px-2.5 py-1 text-[11px] text-muted"
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
