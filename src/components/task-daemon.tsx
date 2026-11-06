import { useEffect, useRef } from "react";
import { buildContext } from "@/lib/awareness";
import { resolveAiName } from "@/lib/branding";
import { isChatPageActive, wakeShouldYield } from "@/lib/chat-presence";
import { pushChatNotice } from "@/lib/inapp-notice";
import { historyForApi, streamChat, type ApiMessage } from "@/lib/chat-client";
import { localNotify } from "@/lib/notify";
import { runAction } from "@/lib/actions";
import { actionFeedback, pickWorldEntries, promptToolsFor } from "@/lib/prompt";
import { partsFor, stripInvisible } from "@/lib/segment";
import { stripActions } from "@/lib/use-chat";
import { echoCapOf, freeCountOf, isDiaryWake, isEchoWake, isFreeWake, isStaleOneOff, isSystemWake, levelOf, COOLDOWN_MS, DAILY_PROACTIVE_CAP, msSinceLastMessage, proactiveCountToday } from "@/lib/wake-schedule";
import { buildProactiveInstruction, readSilent } from "@/lib/wake-prompt";
import { useApp } from "@/lib/store";
import { syncTaskNotifications } from "@/lib/task-notify";

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
 * 抠不出来就 `actions: []` + 原文返回，**绝不编、绝不动数据**。
 *
 * ⚠️ 2026-11 用户 m02156 报的第 3 条：一条唤醒里同时写了日记 + 报了情绪（两个动作），
 * 而旧版只抠**第一个**，剩下的 `{"kind":"emotion.report",…}` 就摊在气泡里。
 * 所以改成：**把正文里所有能解析的白名单动作都抠出来**（数组元素也算），并逐个从正文里删掉。
 */
function splitActions(text: string): { actions: Record<string, unknown>[]; rest: string } {
  const s = String(text ?? "");
  const tried: string[] = [];
  const arr = /\[[\s\S]*\]/.exec(s);
  if (arr) tried.push(arr[0]);
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
        tried.push(s.slice(start, i + 1));
        start = -1;
      }
    }
  }

  const actions: Record<string, unknown>[] = [];
  const spans: { at: number; len: number }[] = [];
  const seen = new Set<string>();
  for (const raw of tried) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    let hit = false;
    for (const item of items) {
      const o = item as { kind?: unknown };
      if (o && typeof o.kind === "string" && DRAFT_ACTION_WHITELIST.has(o.kind)) {
        actions.push(o as Record<string, unknown>);
        hit = true;
      }
    }
    if (!hit) continue;
    /**
     * 从正文里删掉这段 JSON。`seen` 挡住同一段被反复匹配
     * （数组那段会把它里面的对象也匹配一遍 —— 那一段只删一次）。
     */
    if (seen.has(raw)) continue;
    seen.add(raw);
    const at = s.indexOf(raw);
    if (at >= 0) spans.push({ at, len: raw.length });
  }

  if (spans.length === 0) return { actions, rest: s };
  spans.sort((a, b) => a.at - b.at);
  let rest = "";
  let cursor = 0;
  for (const sp of spans) {
    if (sp.at < cursor) continue; // 被更大的那段包住了
    rest += s.slice(cursor, sp.at);
    cursor = sp.at + sp.len;
  }
  rest += s.slice(cursor);
  return { actions, rest };
}
export function TaskDaemon() {
  const busy = useRef(false);

  /**
   * **把定时任务排进系统通知**（用户 m10442：他试的是「定时任务」，不是闹钟）。
   *
   * 这个守护进程本身是纯前台 JS —— App 一关就没人跑，所以以前定的 7:30
   * 在 App 关着的时候什么都不会发生。现在任务一有变化就同步到系统闹钟里，
   * 到点由系统弹一条通知把 App 叫起来，点开之后 `tick()` 才真的去问他。
   *
   * 用签名比对短路：store 每变一次都会回调，但只有任务本身变了才重排。
   */
  useEffect(() => {
    let lastSig = "";
    const sync = () => {
      const tasks = useApp.getState().tasks;
      const sig = tasks
        .map((t) => `${t.id}:${t.enabled ? 1 : 0}:${t.time ?? ""}:${t.at ?? ""}`)
        .join("|");
      if (sig === lastSig) return;
      lastSig = sig;
      void syncTaskNotifications(tasks).catch(() => {});
    };
    sync();
    const unsub = useApp.subscribe(() => sync());
    return () => unsub();
  }, []);

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

      /**
       * ⭐ **别在人家聊着天的时候插一句**（用户 m01146）。
       *
       * 他"自己的日子"那三类（自由活动 / 日记保底 / 回响）在对话页开着、App 在前台时
       * **一律让路**：不删、不标记跑过，只是这一轮不开口 —— 等用户切到别的页面
       * 或把 App 收起来，下一轮 tick 照常补上。
       *
       * 用户自己定的定时任务**不拦**：那是他明确要的提醒。
       * （下面还有**冷却 / 每日上限**两道闸，那两道对用户定的任务同样生效 —— 见紧接的一段。）
       */
      if (isSystemWake(due) && wakeShouldYield()) return;

      busy.current = true;
      /**
       * ⭐ **冷场才开口**：刚有人说过话就让路，今天说够了也让路（2026-11）。
       *
       * "正在聊着突然冒一句"那道闸（生成期间切回对话页）只管得住**生成那几十秒**；
       * 更常见的是另一种：**她两分钟前刚回过他，他自己到点又开口** —— 每隔一条任务
       * 就冒一句"在吗"，比不说话更伤。所以这里两道：
       *
       *   ① `COOLDOWN_MS`（5 分钟）内有过消息 → 这一轮不说
       *   ② 今天他已经主动说过 `DAILY_PROACTIVE_CAP` 条 → 这一轮不说
       *
       * ⚠️ 两道闸都是**让路**，不是放弃：**不删任务、不标记跑过**，
       * 30 秒后下一轮 `tick` 再来 —— 等真安静了、或者明天，照样补上。
       */
      const liveConversationId = st.activeId ?? st.conversations[0]?.id ?? null;
      const liveMessages = (
        st.conversations.find((c) => c.id === liveConversationId)?.messages ?? []
      ).filter((m) => m.content.trim());
      const sinceLast = msSinceLastMessage(liveMessages, now.getTime());
      if (sinceLast != null && sinceLast < COOLDOWN_MS) {
        busy.current = false;
        return;
      }
      if (proactiveCountToday(liveMessages, now) >= DAILY_PROACTIVE_CAP) {
        busy.current = false;
        return;
      }
      /**
       * ⭐ **一次性任务（带 `at` = 某一个具体时刻）说完就删**（用户 m01498 第 2 条：
       * "一次性任务做完自动删，别留着"）—— 不然定时任务列表里会永远挂着一张
       * "今天已经说过"的旧卡。
       *
       * 例外：**过期太久的不补发**。App 关着过了夜，第二天早上启动才轮到它，
       * 这时候把昨晚那句"该睡了"补出来，比不说更糟 —— 超过 12 小时直接删掉、不开口。
       */
      if (due.at) {
        useApp.getState().removeTask(due.id);
        if (isStaleOneOff(due.at, Date.now())) {
          busy.current = false;
          return;
        }
      } else {
        // 先标记跑过 —— 否则 30 秒后又触发一次（一次性任务整条删了，不用再标）
        useApp.getState().markTaskRun(due.id);
      }

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
      /** 真实历史（把刚建的占位消息排除掉）；下面"她上一句 / 你上一句"也从这份里取 */
      const realMessages = (conv?.messages ?? []).filter((m) => m.id !== messageId);
      const history = historyForApi(realMessages, { budget: settings.contextBudget });
      const lastUserText =
        [...realMessages].reverse().find((m) => m.role === "user" && m.content.trim())?.content ?? "";
      const lastAssistantText =
        [...realMessages].reverse().find((m) => m.role === "assistant" && m.content.trim())?.content ?? "";
      /**
       * ⭐ **注入内容换成"环境事实 + 允许沉默"**（2026-11）。
       *
       * 以前这里是一条**命令**：
       *   "【定时任务 · 用户此刻不在场】现在是 …。请你主动说一句话：…
       *    （这是你自己按时醒来的，不是用户在问你。别解释"我收到了定时任务"。）"
       * 结果就是反效果 —— 你在括号里否认什么，模型偏偏要解释什么，于是真说出
       * "我收到了定时任务"，用户原话："很割裂"。
       *
       * 现在只给**事实**（几点、隔了多久、上一句是谁说的、他本来想说什么），
       * 让他接着话往下说；没有话就允许沉默（`<silent>`，那条不会发出去）。
       * 拼装见 `lib/wake-prompt.ts` 的 `buildProactiveInstruction`。
       */
      const messages: ApiMessage[] = [
        ...history,
        {
          role: "user",
          content: buildProactiveInstruction({
            now,
            msSinceLast: msSinceLastMessage(
              realMessages.filter((m) => m.content.trim()),
              now.getTime(),
            ),
            lastUser: lastUserText,
            lastAssistant: lastAssistantText,
            /**
             * ⚠️ `actionFeedback` 返回的是 `string[]`（一条动作一行），不是一整段字符串 ——
             * 这里拼成一行给提示词用（`buildProactiveInstruction` 的 `actions` 是 string）。
             */
            actions: recentActions.join("；"),
            intent: due.prompt,
            /** 他自己排的三类（自由活动/日记/回响）里写着动作写法，不能截断 */
            intentKeepFull: isSystemWake(due),
            displayName: settings.displayName,
          }),
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
        /**
         * ⚠️ 流式时**别把沉默标记抖到气泡上**：模型吐 `<silent>` 是一字一字来的，
         * 前几帧会先收到 `<`、`<sil` 这种半截。这些一律当空内容推，
         * 免得用户盯着一闪而过的 `<sil` 猜是什么。
         */
        const preview = readSilent(content);
        const visible = preview.silent || /^<[a-z/]*$/i.test(preview.text) ? "" : preview.text;
        useApp.getState().patchMessage(conversationId, messageId, { content: visible, thinking });
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
            /** 分段规矩也要给到 —— 不然他不知道可以分几条说，用户 m02156 报过"不能分段回复" */
            segmentEnabled: settings.segmentReply !== false,
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
       * ⭐ **允许沉默**（2026-11）：真没什么想说的，他就只输出 `<silent>` ——
       * 这一条不该落成"（他自己开了口，但没说出什么）"那种占位废话。
       *
       * 判定见 `readSilent`（`<silent>` / `<silent/>` / `[silent]` 三种写法都算）：
       * 洗掉标记后**没有正文** → 撤掉占位消息（`dropMessage`）、**不 finalizeAssistant**、
       * 不弹通知，直接收工。标记后面还有正文（他先说了一句、又顺手补个标记）
       * → 标记洗掉，正文照发，绝不把标记显示给她。
       */
      const spoken = readSilent(content);
      if (spoken.silent) {
        useApp.getState().dropMessage(conversationId, messageId);
        busy.current = false;
        return;
      }
      /**
       * **他自己的时间 → 回复里那串动作要真的执行**（用户真机："说要写日记实际没写"）：
       * 先抠出来按白名单执行，再把动作块从**看得见的正文**里去掉。
       * ⚠️ 一条唤醒里可能有**多个**动作（写日记 + 报情绪），所以要循环执行、全部抠干净。
       */
      const { actions: draftActions, rest: draftRest } = splitActions(spoken.text);
      for (const a of draftActions) {
        try {
          await runAction(a as never, { navigate: () => {} });
        } catch {
          /* 动作没执行成功也不该让这条消息本身消失 */
        }
      }
      /**
       * ⚠️ 这里原来只 `stripInvisible` —— `splitActions` 只管代码块/完整 JSON，
       * 遇到"漏在正文里的半截动作 JSON"（用户 m09869 截图那种）会原样塞进气泡。
       * 跟主对话用同一道清洗（`stripActions` 里含按行兜底的 `stripActionLines`）。
       */
      const shown =
        stripInvisible(stripActions(draftRest)).trim() ||
        (draftActions.length ? "（这件事我做完了）" : "（他自己开了口，但没说出什么）");
      /**
       * **分段回复**：定时任务这条路以前整段塞一个气泡，用户 m02156 报"定时唤醒发的消息不能分段"。
       * 跟主对话同一个规则（`lib/segment`）：一条一个气泡，`content` 仍是完整原文。
       */
      const parts = partsFor(shown, {
        enabled: settings.segmentReply !== false,
        maxParts: settings.segmentMaxParts ?? 3,
        maxSentences: settings.segmentMaxSentences ?? 2,
      });
      /**
       * ⚠️ **最后一道让路**（用户 m02731 第 3 条："正在回我消息，突然冒出来一句，很割裂"）。
       *
       * 生成要几十秒：开始生成时他可能不在对话页（`tick` 开头那道判过了），
       * 但**生成期间他又切回对话页** —— 这时消息一落库，就正好插在他和 AI 说话中间。
       * 所以落库前再判一次：还在对话页，就把这条占位消息撤掉，这一条不落。
       * 任务已经标记过"跑过"（见上面 `markTaskRun`），今天不会为这一条再补一次，
       * 明天照常 —— 宁可少说一句，也不在他说话时插嘴。
       */
      if (isSystemWake(due) && wakeShouldYield()) {
        useApp.getState().dropMessage(conversationId, messageId);
        busy.current = false;
        return;
      }

      useApp.getState().finalizeAssistant(conversationId, messageId, {
        content: shown,
        parts,
        thinking,
        thinkingDurationMs: 0,
        /** 来源标记：这条是**定时任务**（跟主动唤醒共用一个 `scheduled`，界面靠它区分） */
        origin: "cron",
      });
      if (due.notify) {
        void localNotify(aiName, shown.slice(0, 60));
      }
      /**
       * **App 内横幅**（用户 2026-11-01："我在其它页面，他发了消息我其实不知道，
       * 要进入聊天才知道……要自然有动效那种"）。
       *
       * 只在"不在聊天页"时弹：在聊天页消息就直接落进对话，再弹一条横幅是多余的。
       * 系统通知（`localNotify`）仍然照发 —— 那个是 App 在后台时用的，两者不冲突。
       */
      if (isSystemWake(due) && !isChatPageActive()) {
        pushChatNotice({
          name: aiName,
          avatar: useApp.getState().settings.aiAvatar || "",
          body: shown,
          conversationId,
        });
      }
      busy.current = false;
    };

    void tick();
    const id = window.setInterval(() => void tick(), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return null;
}