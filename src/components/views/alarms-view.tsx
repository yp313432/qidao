import { DateTimeField } from "@/components/ui/datetime-picker";
import { useEffect, useState } from "react";
import { AlarmClock, Bell, BellOff, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { resolveAiName } from "@/lib/branding";
import { testNativeAlarm } from "@/lib/native-alarm";
import { askExactAlarm, exactAlarmState } from "@/lib/notify";
import { IS_APP } from "@/lib/platform";
import { previewRing } from "@/lib/ring-tone";
import { saveToSystemAlarm } from "@/lib/system-alarm";
import { useApp } from "@/lib/store";
import { useActivity } from "@/lib/use-activity";
import { useScrollMemory } from "@/lib/ux";
import { cn } from "@/lib/utils";

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
  const [saving, setSaving] = useState(false);
  const hasLocalAlarms = reminders.some((r) => r.ring && !r.systemClock);

  useEffect(() => {
    if (!IS_APP) return;
    void exactAlarmState().then(setExact);
  }, []);

  async function submit() {
    if (!text.trim() || saving) return;
    const date = onceDate || undefined;
    const systemClock = IS_APP && ring;
    setSysMsg("");
    if (systemClock) {
      setSaving(true);
      const result = await saveToSystemAlarm(time, text.trim(), date);
      setSaving(false);
      if (!result.ok) {
        setSysMsg(result.reason ?? "没能交给手机时钟");
        return;
      }
      setSysMsg("已把设置请求发给手机时钟。");
    }
    addReminder({ text, time, ring, date, systemClock });
    setText("");
    setAdding(false);
  }

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      <PageHeader
        title="闹钟"
        right={
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            aria-label="加一个"
            className="mr-1 flex size-11 items-center justify-center rounded-full"
          >
            <Plus className={cn("size-5 transition-transform", adding && "rotate-45")} strokeWidth={1.7} />
          </button>
        }
      />

      <section className="px-4">
        <div className="rounded-3xl border border-line bg-surface px-4 py-3.5">
          <p className="text-[13px] leading-5">
            {IS_APP
              ? "响铃闹钟由手机时钟管理。修改或关闭闹钟请到手机时钟。"
              : "网页版打开时可以响铃。"}
          </p>

          {(!IS_APP || hasLocalAlarms) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  /*
                   * 试听走的就是**真的那条路**（原生响铃页）—— 否则用户听到的是
                   * 网页合成的音，真闹钟响了什么样他永远不知道。
                   * 网页版没有原生响铃页，退回 `previewRing()`。
                   */
                  if (!IS_APP) {
                    previewRing();
                    return;
                  }
                  void testNativeAlarm("这是试听 · 真闹钟就长这样").then((r) => {
                    if (!r.ok) {
                      setSysMsg(r.reason ?? "没能试听");
                      previewRing();
                    }
                  });
                }}
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
                  {exact === "granted" ? "精确定时已开 ✅" : "打开精确定时（安卓 12+）"}
                </button>
              )}
            </div>
          )}
          {IS_APP && hasLocalAlarms && exact === "denied" && (
            <p className="mt-2 text-[11px] leading-4 text-subtle">
              没开精确定时的话，系统会把闹钟跟别的定时合并一下，可能晚几十秒到几分钟。
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
              <DateTimeField mode="time" value={time} onChange={setTime} />
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
                onClick={() => void submit()}
                disabled={!text.trim() || saving}
                className="ml-auto h-11 shrink-0 rounded-2xl bg-ink px-5 text-[13px] font-medium text-ink-fg disabled:opacity-40"
              >
                设好
              </button>
            </div>
            {/* 空 = 每天；填了日期 = 只响这一次 */}
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[12px] text-muted">只这一次</span>
              <DateTimeField mode="date" value={onceDate} onChange={setOnceDate} />
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
                      {r.systemClock ? " · 已发给手机时钟" : r.ring ? " · 响铃" : " · 只弹通知"}
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
                    {!r.systemClock && (
                      <>
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
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => removeReminder(r.id)}
                      className="ml-auto flex items-center gap-1 rounded-full bg-chip px-2.5 py-1 text-[11px] text-muted"
                    >
                      <Trash2 className="size-3" />
                      {r.systemClock ? "移除记录" : "删除"}
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