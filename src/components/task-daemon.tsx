import { useEffect, useRef } from "react";
import { buildContext } from "@/lib/awareness";
import { resolveAiName } from "@/lib/branding";
import { historyForApi, streamChat, type ApiMessage } from "@/lib/chat-client";
import { localNotify } from "@/lib/notify";
import { runAction } from "@/lib/actions";
import { actionFeedback, pickWorldEntries, promptToolsFor } from "@/lib/prompt";
import { echoCapOf, freeCountOf, isDiaryWake, isEchoWake, isFreeWake, isSystemWake, levelOf } from "@/lib/wake-schedule";
import { useApp } from "@/lib/store";

/**
 * 定时任务的守护进程。
 *
 * 能做到哪一层（安卓的硬限制，说清楚免得期待错位）：
 *   · App 活着（或刚打开）→ **真的到点让他开口**，一句他自己想的话发进对话 ✅
 *   · App 完全关闭 → 这里跑不了（WebView 的 JS 被系统停掉了），
 *     由**原生通知**准时响做兜底；点开 App 时守护进程会把该说的补上 ✅
 *
 * 三条护栏（不做的话会变成骚扰）：
 *   ① 每天总数上限 ② 安静时段不说话 ③ 同一天同一个任务只跑一次
 */

const QUIET_FROM = 23;
const QUIET_TO = 7;
const DAILY_CAP = 3;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 动作白名单（**只增不改**）：跟前台收草稿那条路、后台运行器是同一套，删东西/改设置永远进不来 */
const DRAFT_ACTION_WHITELIST = new Set([
  "diary.add",
  "moment.post",
  "moment.comment",
  "moment.like",
  "letter.write",
  "emotion.report",
]);

/**
 * 把回复里的**动作块**抠出来，同时给出**去掉动作块之后给人看的正文**。
 *
 * ⚠️ 2026-10 真机踩到的（用户："唤醒说要写日记，实际没写"）：
 * 定时任务这条路（`task-daemon`）原来**既不执行动作、也不把动作块藏起来** ——
 * 于是对话里摊着一串 `{"kind":"diary.add","body":"…"}`，而日记页是空的。
 * 抠不出来就 `action: null` + 原文返回，**绝不编、绝不动数据**。
 */
function splitAction(text: string): { action: Record<string, unknown> | null; rest: string } {
  const s = String(text ?? "");
  const tries: string[] = [];
  const arr = /\[[\s\S]*\]/.exec(s);
  if (arr) tries.push(arr[0]);
  let depth = 0;
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        tries.push(s.slice(start, i + 1));
        start = -1;
      }
    }
  }
  for (const raw of tries) {
    try {
      let v = JSON.parse(raw) as unknown;
      if (Array.isArray(v)) v = v[0];
      const o = v as { kind?: unknown };
      if (o && typeof o.kind === "string" && DRAFT_ACTION_WHITELIST.has(o.kind)) {
        const at = s.indexOf(raw);
        return {
          action: o as Record<string, unknown>,
          rest: at >= 0 ? (s.slice(0, at) + s.slice(at + raw.length)) : s,
        };
      }
    } catch {
      /* 试下一个 */
    }
  }
  return { action: null, rest: s };
}
export function TaskDaemon() {
  const busy = useRef(false);

  useEffect(() => {
    const tick = async () => {
      if (busy.current) return;
      const st = useApp.getState();
      const now = new Date();
      const today = dayKey(now);
      const minutes = now.getHours() * 60 + now.getMinutes();

      // 护栏②：安静时段不说话
      if (now.getHours() >= QUIET_FROM || now.getHours() < QUIET_TO) return;
      /**
       * 护栏①：今天已经说够次数了。
       *
       * ⚠️ 2026-10：他"自己的日子"那三类（自由活动 / 日记保底 / 回响）**单独计数**
       * —— 用户定的是"独立额度"：他自己有事干而醒来，不该吃掉"用户给他定的定时任务"的次数。
       * 见 `lib/wake-schedule.ts`。
       */
      const ranToday = st.tasks.filter((t) => t.lastRunDay === today && !isSystemWake(t)).length;
      if (ranToday >= DAILY_CAP) return;
      const level = levelOf(st.settings);
      const ranFree = st.tasks.filter((t) => t.lastRunDay === today && isFreeWake(t)).length;
      const ranDiary = st.tasks.filter((t) => t.lastRunDay === today && isDiaryWake(t)).length;
      const ranEcho = st.tasks.filter((t) => t.lastRunDay === today && isEchoWake(t)).length;

      // 找一个到点的任务（护栏③：同一天只跑一次）
      const due = st.tasks.find((t) => {
        if (!t.enabled || t.lastRunDay === today) return false;
        if (isDiaryWake(t) && ranDiary >= 1) return false;
        if (isFreeWake(t) && ranFree >= freeCountOf(level)) return false;
        if (isEchoWake(t) && ranEcho >= echoCapOf(level)) return false;
        if (t.at) return Date.now() >= t.at;
        if (!t.time) return false;
        const [h, m] = t.time.split(":").map(Number);
        const at = (Number.isFinite(h) ? h! : 8) * 60 + (Number.isFinite(m) ? m! : 0);
        return minutes >= at;
      });
      if (!due) return;

      busy.current = true;
      // 先标记跑过 —— 否则 30 秒后又触发一次
      useApp.getState().markTaskRun(due.id);

      const started = useApp.getState().beginScheduledReply(due.prompt);
      if (!started) {
        busy.current = false;
        return;
      }
      const { conversationId, messageId } = started;
      const s = useApp.getState();
      const world = pickWorldEntries(s.worldBook, due.prompt);
      // 回执：他上一轮动手的结果（定时任务里也要带上，否则他不知道自己做过什么）
      const recentActions = actionFeedback(s.actionLog, s.pendingActions.length);
      const settings = s.settings;
      const aiName = resolveAiName(settings.aiName);
      const conv = s.conversations.find((c) => c.id === conversationId);
      const history = historyForApi(
        (conv?.messages ?? []).filter((m) => m.id !== messageId),
        { budget: settings.contextBudget },
      );
      const messages: ApiMessage[] = [
        ...history,
        {
          role: "user",
          content:
            `【定时任务 · 用户此刻不在场】现在是 ${now.toLocaleString("zh-CN", { hour12: false })}。\n` +
            `请你主动说一句话：${due.prompt}\n` +
            `（这是你自己按时醒来的，不是用户在问你。直接说，别复述这条指令、别解释"我收到了定时任务"。）`,
        },
      ];

      let content = "";
      let thinking = "";
      let timer = 0;
      const flush = () => {
        if (timer) {
          window.clearTimeout(timer);
          timer = 0;
        }
        useApp.getState().patchMessage(conversationId, messageId, { content, thinking });
      };
      const schedule = () => {
        if (!timer) timer = window.setTimeout(flush, 150);
      };

      try {
        await streamChat(
          {
            model: s.model,
            messages,
            style: settings.replyStyle,
            /*
              定时任务也要拿到工具清单 —— 不然提示词里会写"暂时没有外部工具"，
              那是假话（用户可能明明配了 MCP / HTTP），模型就会说"你没配工具"。
              传上之后，定时任务里也能自己调工具。
            */
            tools: promptToolsFor(useApp.getState().enabledTools(), useApp.getState().httpTools),
            customBaseUrl: settings.customBaseUrl || undefined,
            customApiKey: settings.customApiKey || undefined,
            upstreamModel: settings.upstreamModel || undefined,
            name: settings.displayName,
            aiName,
            persona: settings.persona || undefined,
            context: buildContext(),
            worldAlways: world.always,
            worldHit: world.hit,
            recentActions,
            permissions: settings.permissions,
          },
          (d) => {
            if (d.error) {
              content = content || `（他自己开口时出了点问题：${d.error}）`;
              schedule();
              return;
            }
            if (d.thinking) {
              thinking += d.thinking;
              schedule();
            }
            if (d.content) {
              content += d.content;
              schedule();
            }
          },
        );
      } catch {
        content = content || "（他自己开口时没连上模型）";
      }
      flush();
      /**
       * **他自己的时间 → 回复里那串动作要真的执行**（用户真机："说要写日记实际没写"）：
       * 先抠出来按白名单执行，再把动作块从**看得见的正文**里去掉。
       */
      const { action: draftAction, rest: draftRest } = splitAction(content);
      if (draftAction) {
        try {
          await runAction(draftAction as never, { navigate: () => {} });
        } catch {
          /* 动作没执行成功也不该让这条消息本身消失 */
        }
      }
      const shown =
        draftRest.trim() || (draftAction ? "（这件事我做完了）" : "（他自己开了口，但没说出什么）");
      useApp.getState().finalizeAssistant(conversationId, messageId, {
        content: shown,
        thinking,
        thinkingDurationMs: 0,
        /** 来源标记：这条是**定时任务**（跟主动唤醒共用一个 `scheduled`，界面靠它区分） */
        origin: "cron",
      });
      if (due.notify) {
        void localNotify(aiName, shown.slice(0, 60));
      }
      busy.current = false;
    };

    void tick();
    const id = window.setInterval(() => void tick(), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return null;
}