import { useEffect } from "react";
import { resolveAiName } from "@/lib/branding";
import { cancelNative, localNotify, registerServiceWorker, scheduleNative } from "@/lib/notify";
import { IS_APP } from "@/lib/platform";
import { useApp } from "@/lib/store";

const LAST_KEY = "qidao:last-diary-reminder";
/** 已经交给系统的闹钟 id（改时间/删掉时要撤） */
const SCHEDULED_KEY = "qidao:alarms-scheduled";

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
   * 把"响铃"的闹钟交给**系统**去定时。
   *
   * 这是"App 关着也能响"的关键：本地定时器在 App 被划掉后就停了，
   * 但系统级的定时通知不会。缺点也说清 —— 系统只弹通知，不会自动唱铃声，
   * 回到 App 时全屏响铃页会补上。
   */
  const reminders = useApp((s) => s.reminders);
  const reminderKey = reminders.map((r) => `${r.id}:${r.time}:${r.ring}:${r.done}`).join("|");
  useEffect(() => {
    if (!IS_APP) return;
    let cancelled = false;
    void (async () => {
      const alarms = useApp.getState().reminders.filter((r) => r.ring && !r.done);
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
        prev = JSON.parse(localStorage.getItem(SCHEDULED_KEY) ?? "[]") as number[];
      } catch {
        prev = [];
      }
      for (const id of prev) if (!want.has(id)) await cancelNative(id);
      for (const [id, v] of want) {
        if (cancelled) return;
        await scheduleNative({
          id,
          title: "栖岛 · 闹钟",
          body: v.text,
          daily: { hour: v.hour, minute: v.minute },
        });
      }
      localStorage.setItem(SCHEDULED_KEY, JSON.stringify([...want.keys()]));
    })();
    return () => {
      cancelled = true;
    };
  }, [reminderKey]);

  useEffect(() => {
    if (!enabled) return;

    const check = () => {
      const now = new Date();
      const [h, m] = time.split(":").map((v) => Number(v));
      const dueAt = (Number.isFinite(h) ? h : 21) * 60 + (Number.isFinite(m) ? m : 0);
      if (now.getHours() * 60 + now.getMinutes() < dueAt) return;
      const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      if (localStorage.getItem(LAST_KEY) === today) return;
      localStorage.setItem(LAST_KEY, today);
      void localNotify("栖岛", `${name} 提醒你：今天还没写日记。`);
    };

    check();
    const id = window.setInterval(check, 30_000);
    return () => window.clearInterval(id);
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

        // ① 贪睡到期：直接再响一次（不占"每天一次"的名额）
        if (r.snoozeUntil && Date.now() >= r.snoozeUntil) {
          st.patchReminder(r.id, { snoozeUntil: undefined });
          st.fireReminder(r.id);
          void localNotify("栖岛 · 闹钟", r.text);
          if (isAlarm) st.setRinging({ id: r.id, text: r.text, time: r.time });
          continue;
        }

        // ② 常规：到点 + 今天还没响过
        const [h, m] = r.time.split(":").map((v) => Number(v));
        const dueAt = (Number.isFinite(h) ? h : 21) * 60 + (Number.isFinite(m) ? m : 0);
        if (minutes < dueAt) continue;
        const key = `qidao:rem:${r.id}`;
        if (localStorage.getItem(key) === today) continue;
        localStorage.setItem(key, today);
        st.fireReminder(r.id);
        // 闹钟：通知 + **全屏响铃**（只发通知人会睡过去）
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
