"use client";

import { useEffect } from "react";
import { upstreamComplete } from "@/lib/data/wake-config";
import { useApp } from "@/lib/store";
import {
  echoCapOf,
  isSystemWake,
  levelOf,
  planDay,
  queueEchoes,
} from "@/lib/wake-schedule";

/**
 * **他自己的日子** —— 驱动组件（2026-10 用户定的第一批）。
 *
 * 只做三件事，真正"醒来做事"的是现成的 `TaskDaemon`：
 *   ① 排今天的计划：N 次自由活动 + 20:30 日记保底（今天写过了就不排）
 *   ② 看到你的互动（你发动态 / 你评论他 / 你点赞他）→ 排一条"回响"（3 分钟后，按心情决定回不回）
 *   ③ 把**已经跑过**的系统唤醒清掉，别脏了「玩乐 → 小日子 → 定时任务」那个列表
 */
export function WakePlan() {
  const hydrated = useApp((s) => s.hydrated);
  const moments = useApp((s) => s.moments);
  const diary = useApp((s) => s.diary);
  const settings = useApp((s) => s.settings);

  /** ①+② 计划与回响 */
  useEffect(() => {
    if (!hydrated) return;
    const st = useApp.getState();
    /** 总开关（用户要的"可以关闭的那种"）：关掉就不排新的，并把还没跑的撤掉 */
    if (st.settings.autonomyEnabled === false) {
      for (const task of st.tasks) if (isSystemWake(task)) st.removeTask(task.id);
      return;
    }
    /**
     * ⚠️ **上游不全就一件事都不排**（用户点名要求："记得和上游统一，
     * 不要出现我没填 api 还能做事这样的"）。跟后台唤醒那条共用同一个判定
     * （`upstreamComplete`）—— 地址/key/模型三样齐才算能用。
     */
    const upstreamOk = upstreamComplete({
      baseUrl: st.settings.customBaseUrl,
      apiKey: st.settings.customApiKey,
      model: st.settings.upstreamModel,
    });
    if (!upstreamOk) {
      for (const task of st.tasks) if (isSystemWake(task)) st.removeTask(task.id);
      return;
    }
    const level = levelOf(st.settings);
    const today = new Date();
    const dayKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
    /** 今天他写过的日记（按 `by === "ai"` 算，日期取本地日） */
    const aiDiaryToday = st.diary.some((d) => {
      if (d.by !== "ai") return false;
      const t = new Date(d.createdAt);
      return `${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()}` === dayKey;
    });
    planDay({ level, diaryOn: st.settings.diaryReminders !== false, hasAiDiaryToday: aiDiaryToday, upstreamOk }, (t) =>
      useApp.getState().addTask(t),
    );
    /** 回响：先按额度裁一下（超了就这次不排；第二天额度自然重置） */
    const todayKey = dayKey;
    const ranEcho = st.tasks.filter(
      (t) =>
        t.prompt.startsWith("【回响】") &&
        (t.lastRunDay ?? "") === todayKey,
    ).length;
    const pendingEcho = st.tasks.filter((t) => t.prompt.startsWith("【回响】") && !t.lastRunDay).length;
    if (ranEcho + pendingEcho < echoCapOf(level)) queueEchoes(moments, (t) => useApp.getState().addTask(t), upstreamOk);
  }, [hydrated, moments, diary, settings]);

  /** ③ 清掉跑过的系统唤醒（用户自己定的定时任务不动） */
  useEffect(() => {
    const sweep = () => {
      const st = useApp.getState();
      for (const task of st.tasks) {
        if (isSystemWake(task) && task.lastRunDay) st.removeTask(task.id);
      }
    };
    const timer = window.setInterval(sweep, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
