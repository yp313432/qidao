import { useEffect } from "react";
import { AlarmClock } from "lucide-react";
import { resolveAiName } from "@/lib/branding";
import { startRinging, stopRinging } from "@/lib/ring-tone";
import { useApp } from "@/lib/store";

/**
 * 闹钟到点的全屏响铃页。
 *
 * 为什么要有它：系统通知只能"提醒"，闹钟得**占满屏幕 + 一直响**，
 * 否则用户睡过去了根本不知道响过。
 * App 关着时走原生定时通知（见 lib/notify.ts 的 scheduleNative），
 * 那个只能弹通知；回到 App 时这个页面会补上。
 */
export function AlarmOverlay() {
  const ringing = useApp((s) => s.ringing);
  const setRinging = useApp((s) => s.setRinging);
  const snoozeReminder = useApp((s) => s.snoozeReminder);
  const fireReminder = useApp((s) => s.fireReminder);
  const aiName = useApp((s) => resolveAiName(s.settings.aiName));

  useEffect(() => {
    if (ringing) startRinging();
    else stopRinging();
    return () => stopRinging();
  }, [ringing]);

  if (!ringing) return null;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-7 bg-ink/92 px-8 text-center backdrop-blur-md">
      <AlarmClock className="size-10 text-ink-fg/80" strokeWidth={1.5} />
      <div>
        <p className="font-serif text-4xl tracking-wide text-ink-fg">{ringing.time}</p>
        <p className="mt-4 text-[17px] leading-7 text-ink-fg">{ringing.text}</p>
        <p className="mt-2 text-[12px] text-ink-fg/55">{aiName} 给你设的闹钟</p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-2.5">
        <button
          type="button"
          onClick={() => {
            stopRinging();
            snoozeReminder(ringing.id, 5);
            setRinging(null);
          }}
          className="h-12 rounded-2xl bg-ink-fg/12 text-[15px] font-medium text-ink-fg"
        >
          再响 5 分钟
        </button>
        <button
          type="button"
          onClick={() => {
            stopRinging();
            fireReminder(ringing.id);
            setRinging(null);
          }}
          className="h-12 rounded-2xl bg-ink-fg text-[15px] font-medium text-ink"
        >
          关掉
        </button>
      </div>
    </div>
  );
}
