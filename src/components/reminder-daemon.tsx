import { useEffect } from "react";
import { resolveAiName } from "@/lib/branding";
import { localNotify, registerServiceWorker } from "@/lib/notify";
import { useApp } from "@/lib/store";

const LAST_KEY = "qidao:last-diary-reminder";

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
        const [h, m] = r.time.split(":").map((v) => Number(v));
        const dueAt = (Number.isFinite(h) ? h : 21) * 60 + (Number.isFinite(m) ? m : 0);
        if (minutes < dueAt) continue;
        const key = `qidao:rem:${r.id}`;
        if (localStorage.getItem(key) === today) continue;
        localStorage.setItem(key, today);
        st.fireReminder(r.id);
        void localNotify("栖岛 · 提醒", r.text);
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
