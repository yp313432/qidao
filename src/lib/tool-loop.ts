import { kindOfToolName, type ActionTool } from "@/lib/action-schema";
import { actionTitle } from "@/lib/action-meta";
import type { ApiMessage, ChatDelta } from "@/lib/chat-client";
import { parseToolArgs } from "@/lib/tool-wire";
import type { AssembledToolCall } from "@/lib/tool-calls";
import type { AppAction, ToolCallRecord } from "@/lib/types";

/**
 * 原生 `tools` 的**多轮循环** —— P2 的核心。
 *
 * 为什么需要它：一个动作要真的落地，链路是这样的 ——
 *
 *   模型选了一个 function
 *     → 客户端过权限闸门（没授权会弹卡片问用户，**这一步是异步的**）
 *       → 真的执行（改数据 / 切页面 / 调工具）
 *         → 结果**回灌**成一条 `role:"tool"` 消息
 *           → 自动再发一轮，让模型接着说
 *
 * 老协议的毛病正是最后两步没有：动作发出去就结束了，模型**永远收不到结果**，
 * 所以它只能猜自己干没干成（用户原话："每次调用工具他说他没有回执，不知道自己到底用没用"）。
 *
 * 两个必须守住的边界：
 *   · **轮数上限 5**（SillyTavern 的默认值）—— 否则模型可以无限"调一下、再调一下"烧 token
 *   · **降级只认明确信号**（见 `looksLikeToolsUnsupported`）—— 内容报错、限流、超时都不降级
 *
 * 这个文件**不许 import store / React / 浏览器 API**：验收脚本要用纯 node 跑它
 * （动作执行由调用方注入，见下面 `runActions`）。
 */

/** 一轮最多几轮工具循环（跟 SillyTavern 的默认值一致） */
export const TOOL_LOOP_MAX = 5;

/** 等"某一笔动作被用户点掉"的上限。用户可能正在犹豫要不要授权，所以给得宽一点。 */
const RESOLVE_TIMEOUT_MS = 5 * 60_000;
/** 轮询间隔：够灵敏（点一下就到），又不至于每秒空转几十次 */
const RESOLVE_POLL_MS = 150;

/** 一次工具调用的执行结果（要回灌给模型的那句话） */
export type ToolCallOutcome = {
  /** 回灌给模型的**人话结果**（成功、被拒绝、参数坏了，都在这儿） */
  result: string;
  /** 给界面/日志看的短标题（如「切页面 → /play/playlist」） */
  title: string;
  ok: boolean;
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

export type RunToolLoopResult = {
  /** 各轮可见正文拼起来（工具轮的"我去查一下"也在这儿） */
  content: string;
  thinking: string;
  /** 还没执行的工具调用（撞上轮数上限时非空） */
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
};

/**
 * 执行一个工具调用 —— 默认实现。
 *
 * ⚠️ 这里**故意用动态 import**：`store` / `actions` 会连锁 import 一大堆界面模块，
 * 而验收脚本要在纯 node 里跑这个文件（没有 zustand 的 DOM 依赖）。动态 import 只在
 * 真正要执行的时候才发生，且调用方随时可以换成自己的假实现（`verify-tool-loop.mjs` 就是这么干的）。
 */
export async function runActions(
  calls: AssembledToolCall[],
  signal?: AbortSignal,
): Promise<ToolCallOutcome[]> {
  const { useApp } = await import("@/lib/store");
  const out: ToolCallOutcome[] = [];
  for (const call of calls) {
    out.push(await runOneAction(call, signal, useApp));
  }
  return out;
}

/**
 * 一笔动作：入队 → 等闸门那边 resolve → 从 actionLog 取结果。
 *
 * ⚠️ 这里**不自己执行**动作 —— 真执行在 `components/action-gate.tsx`（用户点掉卡片那一刻），
 * 因为权限判定和确认卡片都在那一侧。这里只负责"入队 + 等结果"。
 * 若在这里再执行一次，就会出现两套执行路径（一套过闸门、一套不过）——那是最危险的走散。
 */
async function runOneAction(
  call: AssembledToolCall,
  signal: AbortSignal | undefined,
  app: {
    getState: () => {
      actionLog: { title: string; result: string; message: string; at: number }[];
      requestAction: (a: AppAction, from?: string) => void;
    };
  },
): Promise<ToolCallOutcome> {
  const kind = kindOfToolName(call.name);
  /**
   * 不是我们的工具名 —— 只可能是模型瞎编的。
   * 必须**如实回一句**（而不是悄悄丢掉），否则模型会以为自己调过了。
   */
  if (!kind) {
    return {
      ok: false,
      title: `不认识的工具 ${call.name}`,
      result: `没有「${call.name}」这个工具，什么都没执行。要动手请只用清单里列出来的那些。`,
    };
  }

  const parsed = parseToolArgs(call.args);
  if (parsed.error) {
    return {
      ok: false,
      title: `${call.name} 参数不对`,
      result: `「${call.name}」没执行：${parsed.error}。请把参数重新写成一个合法的 JSON 对象。`,
    };
  }

  const action = { kind, ...parsed.args } as AppAction;
  const logBefore = new Set(app.getState().actionLog.map(stampOf));
  app.getState().requestAction(action, "AI");

  const resolved = await waitForResolution(app, logBefore, signal);
  if (!resolved) {
    return {
      ok: false,
      title: actionTitle(action),
      result: `「${actionTitle(action)}」还在等用户点确认，暂时不知道结果。别当成已经做了。`,
    };
  }
  return resolved;
}

function stampOf(e: { title: string; at: number }): string {
  return `${e.at}|${e.title}`;
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
 */
async function waitForResolution(
  store: {
    getState: () => {
      actionLog: { title: string; result: string; message: string; at: number }[];
    };
  },
  before: Set<string>,
  signal?: AbortSignal,
): Promise<ToolCallOutcome | null> {
  const deadline = Date.now() + RESOLVE_TIMEOUT_MS;
  for (;;) {
    const fresh = store.getState().actionLog.find((e) => !before.has(stampOf(e)));
    if (fresh) {
      const ok = fresh.result !== "denied";
      return {
        ok,
        title: fresh.title,
        result: ok
          ? `「${fresh.title}」执行了${fresh.message ? `：${fresh.message}` : ""}`
          : `「${fresh.title}」被用户拒绝了，没有执行。`,
      };
    }
    if (signal?.aborted) return null;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, RESOLVE_POLL_MS));
  }
}

/**
 * 把工具结果拼成回灌的消息（OpenAI 兼容：assistant 带 tool_calls，紧接着一条条 `role:"tool"`）。
 *
 * **顺序不能变**：先 assistant（带 `tool_calls`）再 tool 结果 —— 缺了前一条，
 * 大多数上游会直接报 "tool message must be a response to a preceding tool_calls"。
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
    content: outcomes[i]?.result ?? "（没有结果）",
  }));
  return [assistant, ...results];
}

/**
 * 跑完整个工具循环。
 *
 * @param send 单轮请求（由 transport 提供；循环只负责拼 messages 和决定还要不要再来一轮）
 * @param baseMessages 已经拼好的历史（含系统提示词 + 感知层）
 * @param opts.tools 要发的 tools（null = 走文本协议，不发 tools）
 * @param opts.runActions 动作执行器（默认走真实 store + runAction；验收时换成假的）
 * @param opts.onRound 每轮结束后回调（给界面显示"调了什么、结果如何"）
 */
export async function runToolLoop(input: {
  send: ToolRoundSend;
  baseMessages: ApiMessage[];
  tools: ActionTool[] | null;
  runActions?: (calls: AssembledToolCall[], signal?: AbortSignal) => Promise<ToolCallOutcome[]>;
  onRound?: (r: ToolRoundRecord) => void;
  onDelta?: (d: ChatDelta) => void;
  signal?: AbortSignal;
}): Promise<RunToolLoopResult> {
  const exec = input.runActions ?? runActions;
  /** 每一轮追加的消息（assistant 的 tool_calls + tool 结果）——**只在内存里**，不写进对话存档 */
  const extra: ApiMessage[] = [];
  const rounds: ToolRoundRecord[] = [];
  let content = "";
  let thinking = "";
  let usage: RunToolLoopResult["usage"];
  let stalled = false;
  let error: string | undefined;
  let usedNative = false;

  for (let round = 1; round <= TOOL_LOOP_MAX; round += 1) {
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
      };
    }
    if (r.error) error = r.error;
    if (r.stalled) stalled = true;
    if (r.usage) usage = r.usage;

    if (r.toolCalls.length === 0) break;

    usedNative = true;
    const outcomes = await exec(r.toolCalls, input.signal);
    const record: ToolRoundRecord = {
      round,
      calls: r.toolCalls.map((c, i) => ({
        name: c.name,
        kind: kindOfToolName(c.name),
        args: c.args,
        result: outcomes[i]?.result ?? "",
        ok: outcomes[i]?.ok ?? false,
      })),
    };
    rounds.push(record);
    input.onRound?.(record);
    extra.push(...toolResultMessages(r.toolCalls, outcomes));

    if (round === TOOL_LOOP_MAX) {
      return { content, thinking, pendingCalls: r.toolCalls, usage, stalled, error, usedNative, rounds };
    }
    if (input.signal?.aborted) break;
  }

  return { content, thinking, pendingCalls: [], usage, stalled, error, usedNative, rounds };
}
