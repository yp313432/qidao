import { actionToolName } from "@/lib/action-schema";
import { historyForApi, streamChat, type ChatRequest } from "@/lib/chat-client";
import { resolveAiName } from "@/lib/branding";
import { useApp } from "@/lib/store";
import { runActions } from "@/lib/tool-loop";
import { pickWorldEntries } from "@/lib/prompt";
import { proactiveEvent } from "@/lib/proactive";
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
  "memory.add",
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

/** 把"醒着/打盹"同步给界面（头像旁那枚胶囊） */
function syncAwakeState(now = Date.now()): void {
  const want: "awake" | "asleep" = isAwake(now) ? "awake" : "asleep";
  const st = useApp.getState();
  if (st.awakeState !== want) st.setAwakeState(want);
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

  /**
   * **时段的料**：一个人待着的时候，是"天光"最容易让他想动。
   *
   * ⚠️ 第一版只写了"天刚亮 / 天在暗"，结果一天里绝大多数时间**一条料都没有**，
   * 于是他永远不动（用户 m10324："点开 app 好久了，也没看到有动静"）。
   * 现在四个时段都算料，各自 30 分钟冷却一次。
   *
   * ⚠️ 2026-11-07 用户 m05528："这个自动发的消息好像人机，都差不多类型的"
   * —— 根因就在这几条 note 上：它们原本是**环境描写**（"天在暗下来，花园里安静下来了"
   * "夜里了，院子里只剩虫声"），原样进了提示词的「你注意到：」，模型于是照着复述，
   * 每条主动消息都变成同一种布景句。现在只给**中性时间标签**，描写留给他自己想说才说。
   */
  const hour = new Date(now).getHours();
  if (hour >= 5 && hour < 9) out.push({ kind: "morning", note: "清晨" });
  if (hour >= 9 && hour < 12) out.push({ kind: "forenoon", note: "上午" });
  if (hour >= 12 && hour < 15) out.push({ kind: "noon", note: "中午" });
  if (hour >= 15 && hour < 18) out.push({ kind: "afternoon", note: "下午" });
  if (hour >= 18 && hour < 21) out.push({ kind: "dusk", note: "傍晚" });
  if (hour >= 21 || hour < 1) out.push({ kind: "night", note: "夜里" });

  /**
   * **很久没说话**：看的是"最后一条消息的时间"，不是"用户最后动屏幕的时间"。
   *
   * 这是一个必须记住的坑：用 `lastUserActAt` 的话，**你越在场它越不成立** ——
   * 你一动屏幕时间就被刷新，这条料永远不会出现（第一版就是这么哑的）。
   */
  const st2 = useApp.getState();
  const conv = st2.conversations.find((c) => c.id === st2.activeId) ?? st2.conversations[0];
  const lastMsgAt = conv?.messages.at(-1)?.createdAt ?? 0;
  if (lastMsgAt > 0 && now - lastMsgAt > 20 * 60 * 1000) {
    out.push({ kind: "quiet", note: `你们上一次说话是 ${Math.round((now - lastMsgAt) / 60000)} 分钟前` });
  }

  /**
   * **基线**：即使上面一条都没中，也给他 25% 的机会"就是想动一下"。
   *
   * 没有这条的话，他在"没鱼咬钩、也不是整点时段"的大部分时间里永远不动，
   * 用户看到的就是"这个功能像坏的"。25% × 每 4 分钟一拍 ≈ 平均 16 分钟动一次，
   * 既不烦人，又让人能感觉到他活着。
   */
  if (out.length === 0 && Math.random() < 0.25) {
    out.push({ kind: "idle", note: "没什么事，只是醒着" });
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

/**
 * 他"记得关于她的事"里的前几条（只取生效中的）。
 *
 * 主动通道原来完全不读记忆 —— 所以主动消息永远是"在干嘛""想你了"这种放之四海皆可的话，
 * 而正文那条路是带着记忆说话的。读进来之后他才能说出"你昨天说脖子疼"这种具体的话。
 */
function activeMemoryLines(limit: number): string[] {
  const st = useApp.getState();
  return (st.memories ?? [])
    .filter((m) => m.status === "active" && m.content.trim())
    .slice(-limit)
    .map((m) => m.content.trim().slice(0, 60));
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

  /**
   * **带上最近的对话**：不带的话他"醒着"却不知道你们刚聊到哪儿，
   * 一开口就是"你好"或者重复问一遍 —— 用户会立刻发现不对。
   * 只取最近 6 条（不是全量）：这一拍的重点是"我现在想做什么"，不是回顾。
   *
   * 2026-11-07 用户 m05528："这个自动发的消息好像人机，都差不多类型的，是为啥，
   * 有规定吗还是，能不能和正文的 ai 是同一个通道，总感觉像两个" →
   * 所以这里补三样跟正文同源的东西：①最近 10 条（原来 6）②世界书 ③他最近自己说过的句子，
   * 并在规矩里**明令禁止环境描写**（那是"人机感"的直接来源）。
   */
  const conv = st.conversations.find((c) => c.id === st.activeId) ?? st.conversations[0];
  const history = conv ? historyForApi(conv.messages.slice(-12), { keepRecent: 10 }) : [];
  /** 他最近自己主动说过的句子 —— 用来防"每条都一个调调" */
  const recentOwn = (conv?.messages ?? [])
    .filter((m) => m.role === "assistant" && m.content.trim())
    .slice(-3)
    .map((m) => m.content.replace(/\s+/g, " ").trim().slice(0, 40));

  /**
   * ⚠️ 2026-11-07 用户 m05637："跟自动唤醒有关的都按着一套来，我不想看到出现两种人格"。
   *
   * 原来这里是**本文件自己写的一段 guidance**，措辞/规矩都跟定时那条、跟手机后台那条
   * 不一样 —— 三条通道三套语气。现在统一交给 `lib/proactive.ts` 的 `proactiveEvent()`：
   * 同一个函数、同样禁写环境、同样允许沉默、同样"别把机制说出来"。
   *
   * 跟另外两条路的差别只剩"有由头"（这里是醒着时看到的几件小事）和"能做的动作"
   * （前台这条路能真的调动作）。
   */
  const guidance = proactiveEvent({
    timeText: clockText(now),
    who: settings.displayName || "她",
    /** 醒着这条路的由头 = 他察觉到的几件小事（原来是"你注意到：…"那种布景句） */
    intent: found.length > 0 ? found.map((c) => c.note).join("；") : undefined,
    own: recentOwn,
    memories: activeMemoryLines(3),
    allowSilent: true,
    actionHints: [
      'garden.walk {"place":"池塘|长椅|花圃|门廊|石板路口"}',
      'garden.fish.cast {"spot":"池塘"}   garden.fish.reel {}',
      'garden.flower.plant {"species":"rosa"}   garden.flower.water {"species":"rosa"}',
      'garden.flower.pick {"species":"rosa"}   diary.add {"body":"…"}   moment.post {"text":"…"}',
    ],
  });

  /** 世界书：让主动通道读到跟正文**同一份**规矩（原来这里是空的，等于换了个脑子说话） */
  const world = pickWorldEntries(st.worldBook ?? [], guidance);

  let acc = "";
  let failed = false;
  try {
    const req: ChatRequest = {
      model,
      messages: [...history, { role: "user", content: guidance }],
      style: settings.replyStyle,
      segmentEnabled: settings.segmentReply !== false,
      tools: [],
      customBaseUrl: settings.customBaseUrl || undefined,
      customApiKey: settings.customApiKey || undefined,
      upstreamModel: settings.upstreamModel || undefined,
      maxTokens: 320,
      name: settings.displayName,
      aiName: aiName || undefined,
      persona: settings.persona || undefined,
      context: { now: clockText(now) },
      worldAlways: world.always,
      worldHit: world.hit,
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
    syncAwakeState();
    void awakeBeat().catch(() => {});
  }, AWAKE_TICK_MS);
  syncAwakeState();

  return () => {
    window.clearInterval(timer);
    window.removeEventListener("pointerdown", mark);
    window.removeEventListener("keydown", mark);
    window.removeEventListener("scroll", mark, true);
    window.removeEventListener("touchstart", mark);
  };
}
