import { useEffect, useRef } from "react";
import { buildContext } from "@/lib/awareness";
import { resolveAiName } from "@/lib/branding";
import { historyForApi, streamChat, type ApiMessage } from "@/lib/chat-client";
import { localNotify } from "@/lib/notify";
import { actionFeedback, pickWorldEntries, promptToolsFor } from "@/lib/prompt";
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
      // 护栏①：今天已经说够次数了
      const ranToday = st.tasks.filter((t) => t.lastRunDay === today).length;
      if (ranToday >= DAILY_CAP) return;

      // 找一个到点的任务（护栏③：同一天只跑一次）
      const due = st.tasks.find((t) => {
        if (!t.enabled || t.lastRunDay === today) return false;
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
      useApp.getState().finalizeAssistant(conversationId, messageId, {
        content: content || "（他自己开了口，但没说出什么）",
        thinking,
        thinkingDurationMs: 0,
      });
      if (due.notify) {
        void localNotify(aiName, (content || "他主动说了句话").slice(0, 60));
      }
      busy.current = false;
    };

    void tick();
    const id = window.setInterval(() => void tick(), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return null;
}
