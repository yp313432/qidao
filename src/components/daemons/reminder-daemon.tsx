import { useEffect } from "react";
import { resolveAiName } from "@/lib/branding";
import { localNotify, registerServiceWorker } from "@/lib/notify";
import { IS_APP } from "@/lib/platform";
import { kvGet, kvGetJSON, kvSet, kvSetJSON } from "@/lib/data/local-kv";
import { syncNativeAlarms } from "@/lib/native-alarm";
import { useApp } from "@/lib/store";

const LAST_KEY = "qidao:last-diary-reminder";
/** 已经交给系统的闹钟 id（改时间/删掉时要撤） */
const SCHEDULED_KEY = "qidao:alarms-scheduled";

/**
 * 原生闹钟有没有接管成功。
 *
 * 这个变量决定 App 自己还要不要弹全屏响铃页：
 *   · true  = 系统已经会在到点把 `AlarmActivity` 拉起来（App 关着也响），
 *             App 内那一层**必须让位**，否则同一时刻会响两遍
 *   · false = 退回老路（只在 App 活着时由下面的 `check()` 弹）
 * 放在模块级而不是 state：`check()` 在 setInterval 里跑，读 state 会读到旧值。
 */
let nativeAlarmReady = false;

/** 把字符串 id 折成一个稳定的正整数 —— 原生通知只认数字 */
function hashId(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 2147483000;
  return h || 1;
}

/**
 * 本地提醒守护。
 *
 * App 打开（或后台标签页还活着）时，到点就发一条**真的系统通知**。
 * 局限必须说清楚：App 被完全关掉它就停了 —— 那种情况需要 Web Push +
 * 服务端主动推，见「我的 → 通知」里的状态面板。
 */
export function ReminderDaemon() {
  const settings = useApp((s) => s.settings);
  const enabled = settings.notifications && settings.diaryReminders;
  const time = settings.reminderTime || "21:00";
  const name = resolveAiName(settings.aiName);

  // 打开 App 就试着注册一次 SW（只有 HTTPS / localhost 会成功）
  useEffect(() => {
    void registerServiceWorker();
  }, []);

  /**
   * 把"响铃"的闹钟变成**真正的系统闹钟**。
   *
   * 2026-11 用户 m05769 报的 bug：以前这里只是 `scheduleNative()` 排了一条定时通知 ——
   * App 不在前台就只会"悄悄插一条通知"，不响、不震、不亮屏，睡着的人根本不知道。
   *
   * 现在交给 `AlarmManager.setAlarmClock()`（见 `lib/native-alarm.ts` 与
   * `QidaoAlarmPlugin.java`）：到点由系统把 `AlarmActivity` 拉起来，全屏 + 铃声 + 震动。
   *
   * 边界说清楚：
   *   · 只有**每天重复**的闹钟走原生（`setAlarmClock` 是一次性的，重复由
   *     `AlarmReceiver` 自己排下一次）
   *   · 带了 `date` 的一次性闹钟仍走 App 内那条（系统闹钟表达不了"只在某一天"，
   *     硬排成 daily 会第二天又响一次）
   */
  const reminders = useApp((s) => s.reminders);
  const reminderKey = reminders.map((r) => `${r.id}:${r.time}:${r.ring}:${r.done}`).join("|");
  useEffect(() => {
    if (!IS_APP) return;
    let cancelled = false;
    void (async () => {
      const alarms = useApp.getState().reminders.filter((r) => r.ring && !r.done && !r.date);
      const want = new Map<number, { text: string; hour: number; minute: number }>();
      for (const r of alarms) {
        const [h, m] = r.time.split(":").map((v) => Number(v));
        want.set(hashId(r.id), {
          text: r.text,
          hour: Number.isFinite(h) ? h : 21,
          minute: Number.isFinite(m) ? m : 0,
        });
      }
      let prev: number[] = [];
      try {
        prev = kvGetJSON<number[]>(SCHEDULED_KEY, []);
      } catch {
        prev = [];
      }
      /* 差分：上次排过、这次不该有的（删了闹钟 / 把响铃改成只提醒）交给原生撤掉 */
      const removed = prev.filter((id) => !want.has(id));
      if (cancelled) return;

      const r = await syncNativeAlarms(
        [...want].map(([id, v]) => ({
          id,
          hour: v.hour,
          minute: v.minute,
          text: v.text,
          daily: true,
        })),
        removed,
      );
      if (cancelled) return;
      nativeAlarmReady = r.ok;
      kvSetJSON(SCHEDULED_KEY, [...want.keys()]);
    })();
    return () => {
      cancelled = true;
    };
  }, [reminderKey]);

  /**
   * ⚠️ 2026-10：**这条"提醒用户写日记"的通知删掉了**。
   *
   * 用户原话："日记是让他写，不是提醒给我写。" 现在到 20:30 还没写，
   * 由 `lib/wake-schedule.ts` 的**日记保底**唤醒他本人去写（见 `wake-plan.tsx`），
   * 不再弹通知打扰用户（用户定的通知规则：只有评论/点赞/发动态弹）。
   */
  useEffect(() => {
    void LAST_KEY;
    void enabled;
    void time;
    void name;
  }, [enabled, time, name]);

  // 他设的提醒：到点就发（同一个提醒每天只响一次）
  //
  // 注意顺序：一定要等 Service Worker 真正 active 之后才开始检查。
  // 否则通知会退到 `new Notification()` 兜底 —— 那种通知不可点、
  // 也拿不到「点通知回到 App」的能力。
  useEffect(() => {
    let timer = 0;
    let cancelled = false;

    const check = () => {
      const st = useApp.getState();
      if (!st.settings.notifications) return;
      const now = new Date();
      const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      const minutes = now.getHours() * 60 + now.getMinutes();

      for (const r of st.reminders) {
        if (r.done) continue;
        const isAlarm = Boolean(r.ring);

        // 一次性闹钟（带了 date）：不是今天就直接跳过
        if (r.date) {
          const t = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
          if (r.date !== t) continue;
        }

        // ① 贪睡到期：直接再响一次（不占"每天一次"的名额）
        if (r.snoozeUntil && Date.now() >= r.snoozeUntil) {
          st.patchReminder(r.id, { snoozeUntil: undefined });
          st.fireReminder(r.id);
          if (isAlarm) {
            /* 原生接管时系统会自己响 —— App 内不再重复弹，否则会响两遍 */
            if (!nativeAlarmReady) {
              void localNotify("栖岛 · 闹钟", r.text);
              st.setRinging({ id: r.id, text: r.text, time: r.time });
            }
          } else {
            void localNotify("栖岛 · 提醒", r.text);
          }
          continue;
        }

        // ② 常规：到点 + 今天还没响过
        const [h, m] = r.time.split(":").map((v) => Number(v));
        const dueAt = (Number.isFinite(h) ? h : 21) * 60 + (Number.isFinite(m) ? m : 0);
        if (minutes < dueAt) continue;
        const key = `qidao:rem:${r.id}`;
        if (kvGet(key) === today) continue;
        kvSet(key, today);
        st.fireReminder(r.id);
        // 一次性闹钟：只弹通知的那种直接删；全屏响铃的先标完成，
        // 等用户在响铃界面点"关掉"再删（见 alarm-overlay.tsx，用户 2026-11-01）
        if (r.date) {
          if (isAlarm) st.patchReminder(r.id, { done: true });
          else st.removeReminder(r.id);
        }
        // 闹钟：通知 + **全屏响铃**（只发通知人会睡过去）
        // 2026-11：原生闹钟接管之后，App 这一层要让位 —— 系统到点会自己把响铃页拉起来
        // （见 QidaoAlarmPlugin / AlarmActivity），再弹一次就是"响两遍"。
        if (isAlarm && nativeAlarmReady) continue;
        void localNotify(isAlarm ? "栖岛 · 闹钟" : "栖岛 · 提醒", r.text);
        if (isAlarm) st.setRinging({ id: r.id, text: r.text, time: r.time });
      }
    };

    void (async () => {
      await registerServiceWorker();
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((resolve) => window.setTimeout(resolve, 4000)),
        ]).catch(() => undefined);
      }
      if (cancelled) return;
      check();
      timer = window.setInterval(check, 30_000);
    })();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
