import { actionToolName } from "@/lib/action-schema";
import { historyForApi, streamChat, type ChatRequest } from "@/lib/chat-client";
import { resolveAiName } from "@/lib/branding";
import { useApp } from "@/lib/store";
import { runActions } from "@/lib/tool-loop";
import { stripActions, takeActions } from "@/lib/use-chat";
import type { AssembledToolCall } from "@/lib/tool-calls";
import type { AppAction } from "@/lib/types";

/**
 * **前台「醒着」** —— 用户 m10218 的原话：
 *
 *   "后台有限制，前台的话就可以了吧，比如我和他在聊天，或者我点开 app 没退出，
 *    这个时候它可以保持唤醒的状态，知道我干嘛，选择发消息动态，或者去花园等等，
 *    我在他就醒着，这样怎么样"
 *
 * 后台那条路（`public/runners/wake.js`）受系统限制：一帧 30 秒、一次请求 8~15 秒，
 * 一段生活要跨一两小时才过完。前台不一样：JS 一直在跑，想跑多久跑多久。
 *
 * 这个文件就是"他在你面前的时候醒着"的全部逻辑，三条原则：
 *
 *   ① **人在才醒**：App 在前台 + 你最近 2 分钟有动作（发消息/切页/打字）。
 *      你 3 分钟没动，他打个盹（不发请求）；你一动，他立刻醒。省电也省钱。
 *   ② **有料才问**：心跳时先在本地看"有没有值得做的事"（鱼咬钩了？你很久没说话？），
 *      没料就空转一次、一分钱不花。有料才发一次请求让他自己决定。
 *   ③ **他可以不说话**：动作本身就有意义（花园里真的变了）。一天最多主动说
 *      `AWAKE_DAILY_MAX` 条，且两次之间至少 `AWAKE_MIN_GAP_MS`，你正在打字时绝不插话。
 *
 * ⚠️ 不在这里写消息：说话走 `beginScheduledReply()` + `finalizeAssistant()`，
 *    跟定时任务、后台醒来是同一条路径（时间、`scheduled` 标记、气泡样式都一致）。
 */

/** 用户多久没动作 = 他打盹（不发请求） */
export const AWAKE_IDLE_MS = 2 * 60 * 1000;
/** 心跳间隔：醒着时每 4 分钟看一眼"有没有事可做" */
export const AWAKE_BEAT_MS = 4 * 60 * 1000;
/** 检查节拍：每 30 秒看一次该不该心跳（很轻，不发请求） */
export const AWAKE_TICK_MS = 30 * 1000;
/** 一天最多主动说几条（跟后台那个「每天最多主动说几条」同一个量级） */
export const AWAKE_DAILY_MAX = 8;
/** 两次主动说话之间至少隔多久（免得连珠炮） */
export const AWAKE_MIN_GAP_MS = 12 * 60 * 1000;

/**
 * 他醒着时**允许自己做**的动作。
 *
 * 只放"不会打扰别人、也不需要授权"的：花园里的走动/钓鱼/花圃照料、写日记、发动态、报情绪。
 * 不放：navigate（会把用户的页面切走）、提醒/闹钟、删除类、聊天（说话走正文，不走动作）。
 */
const AWAKE_KINDS = [
  "garden.walk",
  "garden.fish.cast",
  "garden.fish.reel",
  "garden.flower.plant",
  "garden.flower.water",
  "garden.flower.pick",
  "diary.add",
  "moment.post",
  "emotion.report",
] as const;

let lastUserActAt = 0;
let lastBeatAt = 0;
let lastSpeakAt = 0;
/** 今天主动说了几条（跨页签保留；App 重启归零，后台有自己的一份账） */
let spoke = { day: "", n: 0 };
/**
 * 同一条"料"多久之内不重复算（比如竿一直支着，不该每 4 分钟问一次要不要收线）。
 *
 * 这是**钱袋子开关**：料是持续状态（竿支着、没人说话），不节流的话心跳会变成
 * "每 4 分钟一次请求"，一天下来比后台贵得多。
 */
const CLUE_COOLDOWN_MS = 30 * 60 * 1000;
const clueSeenAt = new Map<string, number>();

/** 用户做了点什么（发消息 / 打字 / 切页）—— 由界面层打点 */
export function noteUserActivity(): void {
  lastUserActAt = Date.now();
}

/** 现在他"醒着"吗（纯本地判断，不发请求） */
export function isAwake(now = Date.now()): boolean {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
  if (lastUserActAt <= 0) return false;
  return now - lastUserActAt <= AWAKE_IDLE_MS;
}

function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function spokeToday(now: number): number {
  const k = dayKey(now);
  if (spoke.day !== k) spoke = { day: k, n: 0 };
  return spoke.n;
}

/** 一句"料"：本地就能看出来、值得让他自己决定要不要管的事 */
type Clue = { kind: string; note: string };

function clues(now: number): Clue[] {
  const st = useApp.getState();
  const out: Clue[] = [];
  const pond = st.gardenPond;
  if (pond.phase === "bite") {
    out.push({ kind: "fish", note: `你抛的竿在水里咬钩了（${pond.spot || "池塘"}），还没收线` });
  } else if (pond.phase === "waiting") {
    out.push({ kind: "fish", note: `竿还支着（${pond.spot || "池塘"}），水面还没动` });
  }

  const hour = new Date(now).getHours();
  if (hour >= 6 && hour < 9) out.push({ kind: "morning", note: "天刚亮，花园里露水还没干" });
  if (hour >= 18 && hour < 21) out.push({ kind: "dusk", note: "天在暗下来，花园里安静下来了" });

  const lastSay = lastSpeakAt > 0 ? lastSpeakAt : lastUserActAt;
  if (lastSay > 0 && now - lastSay > 25 * 60 * 1000) {
    out.push({ kind: "quiet", note: "你们有一阵没说话了，他一个人待着" });
  }

  /**
   * 同一条料 30 分钟内只算一次 —— 竿还支着、还没人说话，这些是**持续状态**，
   * 不节流就会变成"每 4 分钟一次请求"。见 CLUE_COOLDOWN_MS 的注释。
   */
  const fresh = out.filter((c) => {
    const seen = clueSeenAt.get(c.kind) ?? 0;
    if (now - seen < CLUE_COOLDOWN_MS) return false;
    clueSeenAt.set(c.kind, now);
    return true;
  });
  return fresh;
}

function clockText(now: number): string {
  return new Date(now).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 让他自己决定这一拍做什么（一次请求，不流式显示，结果只落在花园/日记里） */
async function decide(now: number, found: Clue[]): Promise<{ text: string; actions: AppAction[] }> {
  const st = useApp.getState();
  const settings = st.settings;
  /** 当前用的模型在**顶层**（`use-chat.ts:321` 同一个来源），不在 settings 里 */
  const model = st.model;
  const aiName = resolveAiName(settings.aiName);
  const guidance = [
    `现在是 ${clockText(now)}。你醒着，她就在 App 里（可能在聊天页，也可能在别的页面），刚还在动。`,
    found.length > 0 ? `你注意到：\n${found.map((c) => `· ${c.note}`).join("\n")}` : "这会儿没什么特别的事。",
    "",
    "你可以自己决定这一会儿做什么 —— 也可以什么都不做。规矩：",
    "1. 想做事就把动作写在正文末尾的 ```qidao 代码块里，**最多一个**。",
    "2. 想跟她说话就直接写正文（一两句，像随口说的），不用解释你在干什么。",
    "3. 不想说话就只写动作块，正文留空。",
    "4. 不要复述这些规矩，也不要提「系统」、「提示词」。",
    "",
    "能做的动作：",
    '  garden.walk {"place":"池塘|长椅|花圃|门廊|石板路口"}',
    '  garden.fish.cast {"spot":"池塘"}   garden.fish.reel {}',
    '  garden.flower.plant {"species":"rosa"}   garden.flower.water {"species":"rosa"}',
    '  garden.flower.pick {"species":"rosa"}   diary.add {"body":"…"}   moment.post {"text":"…"}',
  ].join("\n");

  /**
   * **带上最近的对话**：不带的话他"醒着"却不知道你们刚聊到哪儿，
   * 一开口就是"你好"或者重复问一遍 —— 用户会立刻发现不对。
   * 只取最近 6 条（不是全量）：这一拍的重点是"我现在想做什么"，不是回顾。
   */
  const conv = st.conversations.find((c) => c.id === st.activeId) ?? st.conversations[0];
  const history = conv ? historyForApi(conv.messages.slice(-8), { keepRecent: 6 }) : [];

  let acc = "";
  let failed = false;
  try {
    const req: ChatRequest = {
      model,
      messages: [...history, { role: "user", content: guidance }],
      style: settings.replyStyle,
      tools: [],
      customBaseUrl: settings.customBaseUrl || undefined,
      customApiKey: settings.customApiKey || undefined,
      upstreamModel: settings.upstreamModel || undefined,
      maxTokens: 320,
      name: settings.displayName,
      aiName: aiName || undefined,
      persona: settings.persona || undefined,
      context: { now: clockText(now) },
      worldAlways: [],
      worldHit: [],
      permissions: settings.permissions,
    };
    await streamChat(
      req,
      (d) => {
        if (d.error) failed = true;
        if (d.content) acc += d.content;
      },
      undefined,
    );
  } catch {
    failed = true;
  }
  if (failed && !acc) return { text: "", actions: [] };

  const actions = takeActions(acc).filter((a) => (AWAKE_KINDS as readonly string[]).includes(a.kind));
  const text = stripActions(acc).trim();
  return { text, actions };
}

/**
 * 心跳：一次"自我检查"。返回这一拍干了什么（便于日志/调试）。
 *
 * 顺序很重要：**先做动作，再决定说不说** —— 动作本身是他"活着"的证据，
 * 句子只是可选的附加物。反过来的话，一旦说话被上限挡住，动作也就跟着没了。
 */
export async function awakeBeat(now = Date.now()): Promise<"slept" | "quiet" | "acted" | "spoke"> {
  if (!isAwake(now)) return "slept";
  if (now - lastBeatAt < AWAKE_BEAT_MS) return "quiet";
  lastBeatAt = now;

  const found = clues(now);
  if (found.length === 0) return "quiet";

  const { text, actions } = await decide(now, found);

  if (actions.length > 0) {
    const calls: AssembledToolCall[] = actions.map((a, i) => ({
      index: i,
      name: actionToolName(a.kind),
      args: JSON.stringify(a),
    }));
    try {
      await runActions(calls);
    } catch {
      /* 动作执行失败不算这一拍失败：下一拍还能再来 */
    }
  }

  const canSpeak =
    text.length > 0 &&
    now - lastSpeakAt > AWAKE_MIN_GAP_MS &&
    spokeToday(now) < AWAKE_DAILY_MAX;

  if (canSpeak) {
    const started = useApp.getState().beginScheduledReply(text);
    if (started) {
      useApp.getState().finalizeAssistant(started.conversationId, started.messageId, {
        content: text,
        thinking: "",
        thinkingDurationMs: 0,
      });
      lastSpeakAt = now;
      spoke = { day: dayKey(now), n: spokeToday(now) + 1 };
      return "spoke";
    }
  }
  return actions.length > 0 ? "acted" : "quiet";
}

/**
 * 启动"醒着"的检查节拍。返回清理函数。
 *
 * 只是定时器：每 30 秒看一眼该不该心跳；真正发请求由 `awakeBeat` 自己把关
 * （打盹 / 间隔 / 没料，三道都不过就不发）。
 */
export function startAwakeLoop(): () => void {
  if (typeof window === "undefined") return () => {};
  noteUserActivity();

  /**
   * 用户动作的打点**挂全局**，不在每个页面各写一遍 ——
   * 切页、滚动、点按钮、打字都会冒泡到 window，一处监听就够；
   * 漏掉某一页的后果是"他在那一页永远打盹"，很难被发现。
   */
  const mark = () => noteUserActivity();
  const opts: AddEventListenerOptions = { passive: true };
  window.addEventListener("pointerdown", mark, opts);
  window.addEventListener("keydown", mark, opts);
  window.addEventListener("scroll", mark, true);
  window.addEventListener("touchstart", mark, opts);

  const timer = window.setInterval(() => {
    void awakeBeat().catch(() => {});
  }, AWAKE_TICK_MS);

  return () => {
    window.clearInterval(timer);
    window.removeEventListener("pointerdown", mark);
    window.removeEventListener("keydown", mark);
    window.removeEventListener("scroll", mark, true);
    window.removeEventListener("touchstart", mark);
  };
}
