import { ACTION_SCHEMA, kindOfToolName, type ActionTool } from "@/lib/action-schema";
import { actionTitle } from "@/lib/action-meta";
import type { ApiMessage, ChatDelta } from "@/lib/chat-client";
import { parseToolArgs } from "@/lib/tool-wire";
import type { AssembledToolCall } from "@/lib/tool-calls";
import type { AppAction, ToolCallRecord } from "@/lib/types";

/**
 * 原生 `tools` 的**多轮循环（agent loop）** —— P2 的核心，P6 补上"上限与如实收尾"。
 *
 * 为什么需要它：一个动作要真的落地，链路是这样的 ——
 *
 *   模型选了一个 function
 *     → 客户端过权限闸门（没授权会弹卡片问用户，**这一步是异步的**）
 *       → 真的执行（改数据 / 切页面 / 调工具）
 *         → 结果**回灌**成一条 `role:"tool"` 消息
 *           → **同一轮里立刻再发一次**，让模型基于结果接着说（可以再调工具）
 *             → …直到它给出最终回答，或者撞上上限
 *
 * 老协议的毛病正是最后两步没有：动作发出去就结束了，模型**永远收不到结果**，
 * 所以它只能猜自己干没干成（用户原话："每次调用工具他说他没有回执，不知道自己到底用没用"，
 * 以及"这一轮我发出动作，成没成，要等下一轮结果回来才知道；这一轮里我完全看不见"）。
 *
 * 四个必须守住的边界：
 *   · **步数上限 `TOOL_LOOP_MAX`（6）** —— 否则模型可以无限"调一下、再调一下"烧 token
 *   · **墙钟预算 `TOOL_LOOP_BUDGET_MS`（60 秒）** —— 用户点了停止、或者卡在闸门上等确认，
 *     都不能让这一轮无限挂着（原来单笔要等 5 分钟，界面上就是"卡住了"）
 *   · **撞上上限要如实说**（`limitNote`）—— 不许让模型在正文里说"我都做好了"而后面几步没跑
 *   · **降级只认明确信号**（见 `looksLikeToolsUnsupported`）—— 内容报错、限流、超时都不降级
 *
 * 还有一条贯穿全文的规矩（用户点名要的 **"执行结果那一栏永远有回话"**）：
 *   每一次调用都必须产出一行 `notice`（✅ 成了 / ❌ 没成 / ⚠️ 没匹配上 / ⏳ 还在等确认），
 *   **并且同一句话作为 tool 消息回给模型** —— 他和用户在同一个事实上对齐，谁都不许沉默。
 *
 * 这个文件**不许 import store / React / 浏览器 API**：验收脚本要用纯 node 跑它
 * （动作执行由调用方注入，见下面 `runActions` / `runOneAction`）。
 */

/** 一轮最多几**步**（一次工具执行算一步）—— agent loop 的步数上限 */
export const TOOL_LOOP_MAX = 6;

/** 一整轮（从发出第一条消息到收尾）的墙钟预算：到点必须停下来并如实说明 */
export const TOOL_LOOP_BUDGET_MS = 60_000;

/** 等"某一笔动作被用户点掉"的单笔上限。用户可能正在犹豫要不要授权，所以给得宽一点。 */
const RESOLVE_TIMEOUT_MS = 5 * 60_000;
/** 轮询间隔：够灵敏（点一下就到），又不至于每秒空转几十次 */
const RESOLVE_POLL_MS = 150;

/**
 * 一次工具调用的**结局分类**。
 *
 * 为什么要分类（而不是只有 ok/不 ok）：用户点名"这三件事在我这长得一样"——
 * 没匹配上（名字写错）、参数错、被拒绝，在他眼里都是"没动静"。
 * 界面上必须一眼分得出是哪一种，回给模型的话也要说清（他才知道怎么改）。
 */
export type ToolOutcomeCategory =
  /** 真的执行了 */
  | "ok"
  /** 闸门那边判的：用户拒绝了（或这类操作永不交给模型） */
  | "denied"
  /** 没有这个动作名（模型写错了名字） */
  | "unknown"
  /** 参数不是合法 JSON，或者少了必填参数 */
  | "badargs"
  /** 执行器自己回了一句"没做成"（比如"待办得有内容"） */
  | "refused"
  /** 还在等用户点确认，或者等到超时（如实说：没执行） */
  | "pending";

/** 一次工具调用的执行结果（要回灌给模型、也要显示给用户的那句话） */
export type ToolCallOutcome = {
  /** 回灌给模型的**人话结果**（成功、被拒绝、参数坏了，都在这儿） */
  result: string;
  /** ⭐ 界面上那一行"永远有回话"的结论：`✅ 动作名 · 结果` / `❌ …` / `⚠️ 没有叫 … 的动作` */
  notice: string;
  /** 给界面/日志看的短标题（如「切页面 → /play/playlist」） */
  title: string;
  ok: boolean;
  category: ToolOutcomeCategory;
};

export type ToolRoundRecord = {
  round: number;
  calls: ToolCallRecord[];
};

/** 单轮请求的返回值（由 transport 提供） */
export type ToolRoundResult = {
  content: string;
  thinking: string;
  toolCalls: AssembledToolCall[];
  usage?: { prompt?: number; completion?: number; cached?: number; total?: number };
  /** 上游明确拒绝 `tools` 参数 → 调用方应该摘掉 tools 再发一次（文本协议） */
  toolsRejected?: boolean;
  /** 连接被看门狗掐断（发出去的内容仍然有效） */
  stalled?: boolean;
  /** 报错时给用户看的人话（成功时没有） */
  error?: string;
};

/** 单轮请求：`messages` 由循环负责拼（含上一轮的 tool 回灌） */
export type ToolRoundSend = (args: {
  messages: ApiMessage[];
  tools: ActionTool[] | null;
  /** 这一轮有什么数据变化（给界面做节流刷新用） */
  onDelta: (d: ChatDelta) => void;
  signal?: AbortSignal;
}) => Promise<ToolRoundResult>;

/** 循环是因为什么停下来的（收尾那句"到上限了"要看它） */
export type ToolLoopStop =
  /** 模型给出最终回答（正常结束） */
  | "done"
  /** 撞上步数上限 */
  | "maxRounds"
  /** 撞上墙钟预算 */
  | "budget"
  /** 用户点了停止 */
  | "aborted";

export type RunToolLoopResult = {
  /** 各轮可见正文拼起来（工具轮的"我去查一下"也在这儿） */
  content: string;
  thinking: string;
  /**
   * **已经执行、但结果没能回给模型**的那些调用（撞上步数/预算/用户停止）。
   *
   * 语义要精确：不是"没执行的"，而是"我停下了，所以他没能看到这一步的结果"——
   * 收尾文案必须按这个口径写，不然又是一次"说成做过了"。
   */
  pendingCalls: AssembledToolCall[];
  usage?: { prompt?: number; completion?: number; cached?: number; total?: number };
  /** 最后一轮的连接状态 */
  stalled: boolean;
  error?: string;
  /** 用没用上原生工具（决定正文里要不要带"动作块"给界面解析） */
  usedNative: boolean;
  /** 上游明确拒绝 `tools` → 调用方该摘掉 tools 按文本协议重来（此时 content 已经清空） */
  toolsRejected?: boolean;
  /** 每一轮的动作记录（给"看过程"用） */
  rounds: ToolRoundRecord[];
  /** 真的执行了几步 */
  steps: number;
  /** 因为什么停下 */
  stoppedBy: ToolLoopStop;
  /** 有没有撞上限（步数 / 预算 / 用户停止都算） */
  hitLimit: boolean;
  /** 这一轮跑了多久 */
  elapsedMs: number;
  /** 撞上限时那句**如实说明**（调用方直接拼进正文就行，别自己另写一份） */
  limitNote?: string;
};

/**
 * 执行一个工具调用 —— 默认实现。
 *
 * ⚠️ 这里**故意用动态 import**：`store` / `actions` 会连锁 import 一大堆界面模块，
 * 而验收脚本要在纯 node 里跑这个文件（没有 zustand 的 DOM 依赖）。动态 import 只在
 * 真正要执行的时候才发生，且调用方随时可以换成自己的假实现（`verify-agent-loop.mjs` 就是这么干的）。
 *
 * `deadline` 是一整轮的墙钟截止时刻：等闸门的那一段**也受它夹**，
 * 否则"用户没点那张卡片"会让整轮挂满 5 分钟，界面上就是"发出去就没动静了"。
 */
export async function runActions(
  calls: AssembledToolCall[],
  signal?: AbortSignal,
  deadline?: number,
): Promise<ToolCallOutcome[]> {
  const { useApp } = await import("@/lib/store");
  const out: ToolCallOutcome[] = [];
  for (const call of calls) {
    out.push(await runOneAction(call, signal, useApp, deadline));
  }
  return out;
}

/** 闸门那一侧给我们的最小接口（真实现是 store，验收脚本给假的 —— 所以这里只认这两个口） */
export type ActionQueue = {
  getState: () => {
    actionLog: { title: string; result: string; message: string; at: number }[];
    requestAction: (a: AppAction, from?: string) => void;
  };
};

/**
 * 一笔动作：入队 → 等闸门那边 resolve → 从 actionLog 取结果。
 *
 * ⚠️ 这里**不自己执行**动作 —— 真执行在 `components/action-gate.tsx`（用户点掉卡片那一刻），
 * 因为权限判定和确认卡片都在那一侧。这里只负责"入队 + 等结果"。
 * 若在这里再执行一次，就会出现两套执行路径（一套过闸门、一套不过）——那是最危险的走散。
 *
 * 导出它是为了验收：脚本给一个假 `app`，就能在纯 node 里真跑"没匹配上 / 参数错 / 被拒 /
 * 等确认"这四条路，而不是只测我自己写的假包装。
 */
export async function runOneAction(
  call: AssembledToolCall,
  signal: AbortSignal | undefined,
  app: ActionQueue,
  deadline?: number,
): Promise<ToolCallOutcome> {
  const kind = kindOfToolName(call.name);
  /**
   * 不是我们的工具名 —— 只可能是模型瞎编的。
   *
   * 必须**如实回一句**（而不是悄悄丢掉），否则模型会以为自己调过了；
   * 界面上也要留一行 ⚠️（用户点名："匹配不到动作也回一条'没匹配上'，别沉默"）。
   */
  if (!kind) {
    return {
      ok: false,
      category: "unknown",
      title: `不认识的工具 ${call.name}`,
      notice: `⚠️ 没有叫 ${call.name} 的动作（是不是名字写错了？）`,
      result:
        `没有「${call.name}」这个动作（是不是名字写错了？），什么都没执行。` +
        `要动手请只用这次收到的工具清单里的名字。`,
    };
  }

  const def = ACTION_SCHEMA.find((a) => a.kind === kind);
  const parsed = parseToolArgs(call.args);
  /** 参数错了就说清**是哪个参数**（用户点名："参数错：说清哪个参数不对"） */
  if (parsed.error) {
    const want = describeFields(def);
    return {
      ok: false,
      category: "badargs",
      title: `${kind} 参数不对`,
      notice: `❌ ${kind} · 参数不是合法 JSON：${parsed.error}${want ? `（这个动作要的参数：${want}）` : ""}`,
      result:
        `「${kind}」没执行：${parsed.error}。` +
        (want ? `这个动作要的参数是：${want}。` : "") +
        `请把参数重新写成一个合法的 JSON 对象再调一次。`,
    };
  }

  const missing = (def?.fields ?? [])
    .filter((f) => f.required && !(f.name in parsed.args))
    .map((f) => f.name);
  if (missing.length > 0) {
    return {
      ok: false,
      category: "badargs",
      title: `${kind} 少参数`,
      notice: `❌ ${kind} · 少了参数「${missing.join("、")}」`,
      result:
        `「${kind}」没执行：少了必填参数「${missing.join("、")}」。` +
        `这个动作要的参数是：${describeFields(def)}。补齐之后再调一次。`,
    };
  }

  const action = { kind, ...parsed.args } as AppAction;
  const logBefore = new Set(app.getState().actionLog.map(stampOf));
  app.getState().requestAction(action, "AI");

  const resolved = await waitForResolution(app, logBefore, signal, deadline, kind);
  if (!resolved) {
    return {
      ok: false,
      category: "pending",
      title: actionTitle(action),
      notice: `⏳ ${kind} · 还在等你点确认，没执行`,
      result: `「${actionTitle(action)}」还在等用户点确认，暂时不知道结果。别当成已经做了。`,
    };
  }
  return resolved;
}

/** `path（必填）` / `text` 这种一行参数说明（给"参数错了"那句用） */
function describeFields(
  def: { fields: readonly { name: string; required: boolean }[] } | undefined,
): string {
  if (!def || def.fields.length === 0) return "";
  return def.fields.map((f) => (f.required ? `${f.name}（必填）` : f.name)).join("、");
}

function stampOf(e: { title: string; at: number }): string {
  return `${e.at}|${e.title}`;
}

/**
 * 执行器回的那句人话，看起来是不是"其实没做成"。
 *
 * 为什么需要它（这一条是用户原话逼出来的）：`runAction()` 只回一句人话，
 * 里面既有"已高亮页面上的「x」"，也有"待办得有内容"这种**没做成的**。
 * 闸门那边一律按"允许执行"记账，于是回执会写成 ✅ —— 模型于是接着说"我记好了"，
 * 而用户那边什么都没有。用户报过的正是这个："他说他执行了，但是是空的"。
 *
 * 判据**故意保守**（宁可不标红，也不要把成功说成失败）：
 * 只认这些"否定式开头/固定说法"，而且只在**短句**上生效（长报告里出现"没"字很正常）；
 * 另外**加了一条结构化判据**：结果自己写了 `ok:false` 的（感知动作那种 JSON 回执）
 * 一律算没做成 —— 那条跟长度无关，因为"权限没给要说清去哪个设置页"必然很长。
 */
const REFUSED_HINT =
  /(没找到|没有|没说|没内容|没什么|没给|不能空着|得有|都得有|还是空的|是空的|读不出来|只能在浏览器|不会交给模型|^需要一个|失败)/;

/**
 * 从一句回话里抠出**那段 JSON 回执**。
 *
 * ⚠️ 不能要求整句都是 JSON：闸门记账时会加前缀 —— 真跑出来的是
 *     `按你的授权直接执行：{"ok":false,…}`（或没挂权限那句「这个动作不用授权，直接执行：…」），
 * 只看 `startsWith("{")` 会**一条都判不到**（第一版就是这么漏的，靠
 * `verify-sense-ui.mjs` 的 B-观察 那行 ✅ 才发现的）。所以按首尾花括号取那段来解析。
 */
function jsonOutcome(text: string): { ok?: unknown; summary?: unknown } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!data || typeof data !== "object") return null;
    return data as { ok?: unknown; summary?: unknown };
  } catch {
    return null;
  }
}

/**
 * ⚠️ **结构化判据**（2026-10 补的那一条）：结果**自己说**了 `ok:false`。
 *
 * 为什么非加不可（`verify-sense-ui.mjs` 把这条现状打印出来过）：
 * 主动感知那几个动作（`sense.*`）回的是一行 JSON，失败时长这样：
 *   `{"ok":false,"gap":"web","summary":"读最近的通知要装成 App…","fix":"…去哪个设置页开"}`
 * —— 而"权限没给要说清设置页路径"那句话**必然长于 48 字**，所以只看长度的
 * `looksRefused()` 永远判不到它：界面上于是出现
 * `✅ sense.notifications · {ok:false,…}`（图标 ✅ 内容却是失败）。
 * 这里直接看结构化字段，跟长度无关 —— **不削弱**原来那条，只是多一条入口。
 */
function saysFailed(text: string): boolean {
  return jsonOutcome(text)?.ok === false;
}

/** 那一行回话给人看的部分：JSON 回执取 `summary`（人话），别把整串字段甩到界面上 */
function refusalDetail(text: string): string {
  const data = jsonOutcome(text);
  const summary = typeof data?.summary === "string" ? data.summary.trim() : "";
  if (!summary) return text;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  /** 前缀（"按你的授权直接执行："之类）留着 —— 它解释了这一步是怎么跑起来的 */
  return `${text.slice(0, start)}${summary}${text.slice(end + 1)}`;
}

export function looksRefused(message: string): boolean {
  const text = (message ?? "").trim();
  if (!text) return false;
  /** ① 结构化：结果自己是 `ok:false`（感知那类 JSON 回执）—— 跟长度无关 */
  if (saysFailed(text)) return true;
  /** ② 原来那条：只在**短句**上按措辞判（长报告里出现"没"字很正常，别误伤） */
  if (text.length > 48) return false;
  return REFUSED_HINT.test(text);
}

/**
 * 等某一笔动作出结果（闸门那边执行完会往 `actionLog` 里写一条）。
 *
 * 为什么不能用"等 pendingActions 变短"：一笔动作可能是**被拒绝**的
 * （用户点了拒绝），那也得出结果给模型，不能让它以为做成了。
 *
 * 也不用 store.subscribe 做事件唤醒：`requestAction` 是**先入队再进闸门**的，
 * 订阅回调可能在 actionLog 写入之前就把 promise 收掉（竞态）。
 * 150ms 轮询一次，人点一下的延迟感受不出来，但绝不会漏。
 *
 * 截止时刻 = min(这一轮的总预算, 单笔上限)：用户没点那张卡片时，
 * 到点就回一句"还在等你点确认，没执行"——**不许沉默地挂着**。
 */
async function waitForResolution(
  store: ActionQueue,
  before: Set<string>,
  signal?: AbortSignal,
  deadline?: number,
  /** 内部 kind（`ui.highlight` 这种）—— 只用来写那一行回话，界面上一眼能对上是哪个动作 */
  kind = "动作",
): Promise<ToolCallOutcome | null> {
  const until = Math.min(deadline ?? Number.POSITIVE_INFINITY, Date.now() + RESOLVE_TIMEOUT_MS);
  for (;;) {
    const fresh = store.getState().actionLog.find((e) => !before.has(stampOf(e)));
    if (fresh) {
      const refused = fresh.result === "denied";
      if (refused) {
        return {
          ok: false,
          category: "denied",
          title: fresh.title,
          /**
           * 被拒的那一行要**说清是用户拒的**（不是模型写错、也不是系统坏了）——
           * 用户："被拒（权限）：说清是你拒的"。
           */
          notice: `❌ ${kind} · 你拒了这次执行，所以没做（${fresh.message || "你按了拒绝"}）`,
          result: `「${fresh.title}」被用户拒绝了，没有执行${fresh.message ? `（${fresh.message}）` : ""}。`,
        };
      }
      /**
       * ⚠️ 执行器回的那句话本身可能就是"没做成"（如「待办得有内容」）。
       * 这时候**不能打 ✅** —— 否则模型会接着说"我记好了"，而库里什么都没有。
       */
      if (looksRefused(fresh.message)) {
        /**
         * 界面上那一行**只放人话**：感知动作回的是 JSON，整串字段甩上去没法看
         * （`summary` 才是给人读的那句，`fix` 那句"去哪个设置页开"留给模型）。
         */
        const detail = refusalDetail(fresh.message);
        return {
          ok: false,
          category: "refused",
          title: fresh.title,
          notice: `❌ ${kind} · ${detail}`,
          result: `「${fresh.title}」没做成：${fresh.message}。别当成已经做了。`,
        };
      }
      return {
        ok: true,
        category: "ok",
        title: fresh.title,
        notice: `✅ ${kind} · ${fresh.message || "执行了"}`,
        /** 回给模型的话**不重复动作标题**（标题里本来就含着参数，套两层「」很难读） */
        result: `${fresh.message || "执行了"}（这个动作确实执行了）`,
      };
    }
    if (signal?.aborted) return null;
    if (Date.now() > until) return null;
    await new Promise((r) => setTimeout(r, RESOLVE_POLL_MS));
  }
}

/**
 * 把工具结果拼成回灌的消息（OpenAI 兼容：assistant 带 tool_calls，紧接着一条条 `role:"tool"`）。
 *
 * **顺序不能变**：先 assistant（带 `tool_calls`）再 tool 结果 —— 缺了前一条，
 * 大多数上游会直接报 "tool message must be a response to a preceding tool_calls"。
 *
 * `content` 放的是 `outcome.result`（给模型的完整人话）；界面上那一行 `notice`
 * （`✅/❌/⚠️/⏳`）说的是**同一个事实**，只是给用户看的短版本 —— 两边不许各说各的。
 */
export function toolResultMessages(
  calls: AssembledToolCall[],
  outcomes: ToolCallOutcome[],
): ApiMessage[] {
  const assistantCalls = calls.map((c, i) => ({
    id: c.id ?? `call_${i}`,
    type: "function" as const,
    function: { name: c.name, arguments: c.args },
  }));
  /** 有的上游不认 `content: null`，统一给空串，比 null 稳 */
  const assistant: ApiMessage = {
    role: "assistant",
    content: "",
    tool_calls: assistantCalls,
  };
  const results: ApiMessage[] = calls.map((c, i) => ({
    role: "tool",
    tool_call_id: c.id ?? `call_${i}`,
    content: outcomes[i]?.result ?? outcomes[i]?.notice ?? "（没有结果）",
  }));
  return [assistant, ...results];
}

/** 撞上限时那句如实说明（**只此一处**实现，界面和报告都引用它，免得口径走散） */
export function limitNoteFor(
  stop: ToolLoopStop,
  steps: number,
  budgetMs: number,
  maxRounds = TOOL_LOOP_MAX,
): string | undefined {
  if (stop === "maxRounds") {
    return (
      `\n\n（到上限了：一次最多连着动手 ${maxRounds} 步，已经走完 ${steps} 步，` +
      "我按上限停下了 —— 最后一步的结果还没能回给他。要继续跟他说一声就行。）"
    );
  }
  if (stop === "budget") {
    return (
      `\n\n（到上限了：这一轮已经跑了 ${Math.round(budgetMs / 1000)} 秒，` +
      "我按时间上限停下了 —— 后面的步骤没再跑，他也没拿到最后一步的结果。）"
    );
  }
  if (stop === "aborted") {
    return "\n\n（你按了停止，我就停在这儿了 —— 后面的步骤没再跑。）";
  }
  return undefined;
}

/**
 * 跑完整个工具循环（agent loop）。
 *
 * 一轮的形状：发出 → 模型回 tool_calls → 客户端执行 → **结果立刻作为 tool 消息再发一次** →
 * 模型基于结果继续说（可以再调）→ …直到它给出最终回答，或者撞上步数/时间上限。
 *
 * @param send 单轮请求（由 transport 提供；循环只负责拼 messages 和决定还要不要再来一轮）
 * @param baseMessages 已经拼好的历史（含系统提示词 + 感知层）
 * @param opts.tools 要发的 tools（null = 走文本协议，不发 tools）
 * @param opts.runActions 动作执行器（默认走真实 store + 闸门；验收时换成假的）
 * @param opts.onStep **执行前**回调（界面拿它显示"第 N 步 · 正在执行 X"）
 * @param opts.onRound 每轮结束后回调（给界面显示"调了什么、结果如何"）
 * @param opts.maxRounds / opts.budgetMs 上限（默认 `TOOL_LOOP_MAX` / `TOOL_LOOP_BUDGET_MS`，验收时调小）
 */
export async function runToolLoop(input: {
  send: ToolRoundSend;
  baseMessages: ApiMessage[];
  tools: ActionTool[] | null;
  runActions?: (
    calls: AssembledToolCall[],
    signal?: AbortSignal,
    deadline?: number,
  ) => Promise<ToolCallOutcome[]>;
  onStep?: (s: { round: number; calls: AssembledToolCall[] }) => void;
  onRound?: (r: ToolRoundRecord) => void;
  onDelta?: (d: ChatDelta) => void;
  signal?: AbortSignal;
  maxRounds?: number;
  budgetMs?: number;
}): Promise<RunToolLoopResult> {
  const exec = input.runActions ?? runActions;
  const maxRounds = Math.max(1, input.maxRounds ?? TOOL_LOOP_MAX);
  const budgetMs = Math.max(1000, input.budgetMs ?? TOOL_LOOP_BUDGET_MS);
  const startedAt = Date.now();
  /** 整轮的墙钟截止时刻 —— 等闸门、执行、下一轮请求都受它约束 */
  const deadline = startedAt + budgetMs;
  /** 每一轮追加的消息（assistant 的 tool_calls + tool 结果）——**只在内存里**，不写进对话存档 */
  const extra: ApiMessage[] = [];
  const rounds: ToolRoundRecord[] = [];
  let content = "";
  let thinking = "";
  let usage: RunToolLoopResult["usage"];
  let stalled = false;
  let error: string | undefined;
  let usedNative = false;
  let stoppedBy: ToolLoopStop = "done";
  let pendingCalls: AssembledToolCall[] = [];

  for (let round = 1; round <= maxRounds; round += 1) {
    const r = await input.send({
      messages: [...input.baseMessages, ...extra],
      tools: input.tools,
      onDelta: (d) => {
        if (d.content) content += d.content;
        if (d.thinking) thinking += d.thinking;
        input.onDelta?.(d);
      },
      signal: input.signal,
    });
    if (r.toolsRejected) {
      // 这一轮的正文没有任何意义（对方是因为 tools 才报的错），交给调用方降级重来
      return {
        content: "",
        thinking: "",
        pendingCalls: [],
        usedNative: false,
        toolsRejected: true,
        stalled: false,
        rounds,
        steps: rounds.length,
        stoppedBy: "done",
        hitLimit: false,
        elapsedMs: Date.now() - startedAt,
      };
    }
    if (r.error) error = r.error;
    if (r.stalled) stalled = true;
    if (r.usage) usage = r.usage;

    // 没有工具调用 = 模型给最终回答了，正常收尾
    if (r.toolCalls.length === 0) break;

    usedNative = true;
    /** 界面在这一步**执行之前**就该看到"正在执行 X"（用户："这一轮里我完全看不见"） */
    input.onStep?.({ round, calls: r.toolCalls });
    const outcomes = await exec(r.toolCalls, input.signal, deadline);
    const record: ToolRoundRecord = {
      round,
      calls: r.toolCalls.map((c, i) => ({
        name: c.name,
        kind: kindOfToolName(c.name),
        args: c.args,
        result: outcomes[i]?.result ?? "",
        notice: outcomes[i]?.notice ?? "",
        category: outcomes[i]?.category ?? "pending",
        ok: outcomes[i]?.ok ?? false,
      })),
    };
    rounds.push(record);
    input.onRound?.(record);
    // ⭐ 关键的一步：结果**立刻**变成 tool 消息，下一轮请求就带着它
    extra.push(...toolResultMessages(r.toolCalls, outcomes));

    if (input.signal?.aborted) {
      stoppedBy = "aborted";
      pendingCalls = r.toolCalls;
      break;
    }
    if (round === maxRounds) {
      stoppedBy = "maxRounds";
      pendingCalls = r.toolCalls;
      break;
    }
    if (Date.now() >= deadline) {
      stoppedBy = "budget";
      pendingCalls = r.toolCalls;
      break;
    }
  }

  const hitLimit = stoppedBy !== "done";
  return {
    content,
    thinking,
    pendingCalls,
    usage,
    stalled,
    error,
    usedNative,
    rounds,
    steps: rounds.length,
    stoppedBy,
    hitLimit,
    elapsedMs: Date.now() - startedAt,
    limitNote: hitLimit ? limitNoteFor(stoppedBy, rounds.length, budgetMs, maxRounds) : undefined,
  };
}
