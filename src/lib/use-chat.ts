import { useCallback, useRef, useState } from "react";
import { actionTools } from "@/lib/action-schema";
import { buildContext } from "@/lib/awareness";
import { resolveAiName } from "@/lib/branding";
import {
  historyForApi,
  makeDirectRound,
  makeServerRound,
  streamChat,
  type ApiMessage,
  type ChatDelta,
} from "@/lib/chat-client";
import { isOwnApi, QUOTA_LIMIT } from "@/lib/models";
import { actionFeedback, assembleMessages, pickWorldEntries, promptToolsFor } from "@/lib/prompt";
import { useApp } from "@/lib/store";
import { runToolLoop, type ToolRoundRecord, type ToolRoundSend } from "@/lib/tool-loop";
import { shouldUseNativeTools } from "@/lib/tool-protocol";
import type { AppAction, Attachment, ChatMessage } from "@/lib/types";
import { resolveVoiceLang, speak } from "@/lib/voice";

export type UseChatOpts = {
  /**
   * 工具轮里"模型没说话"时念一句过渡（**只有语音页要**）。
   *
   * 为什么需要：上了原生 tools 之后，"他决定去动手"那一轮可能一个字正文都没有 ——
   * 静音几秒再出声，用户会以为断了。念一句"等一下，我去看看"，
   * 通话的节奏就不塌（用户已知这个折中，见交接文档 §2.2）。
   */
  onFiller?: (text: string) => void;
  /**
   * 这一轮**强制**走哪条通道（诊断 / 验收用；不填就用设置里的判断）。
   * 生产界面不传它 —— 免得出现"设置里选了自动、实际被某个页面覆盖"这种隐性走散。
   */
  forceProtocol?: "native" | "text";
};

/* --------------------------- 他的「动作块」协议 --------------------------- */

/**
 * 模型把「要做的动作」放在一个代码块里：
 *
 *   ```qidao
 *   {"kind":"navigate","path":"/play/listen"}
 *   ```
 *
 * ⚠️ 但**不能只认这一种写法**。用户实测报过："写动态和信不可以了，
 * 他说他执行了，但是是空的" —— 模型只是把格式写偏了一点（标记大小写、
 * 尾随逗号、中文引号、或者干脆没包代码块），旧解析器就整段丢掉，
 * 于是什么都没发生，而它自己以为做了。
 *
 * 所以这里分四层兜底：严格块 → 任意代码块 → 裸 JSON → 修一遍再试。
 */
const STRICT_BLOCK = /```[ \t]*qidao[ \t]*\r?\n?([\s\S]*?)```/gi;
/** 任意代码块（有些模型会写成 ```json 或干脆不写标记） */
const ANY_BLOCK = /```[ \t]*[a-zA-Z0-9_-]*[ \t]*\r?\n([\s\S]*?)```/g;

/** 常见 JSON 走样修一遍（尾随逗号 / 中文引号 / 单引号 / 字符串里的裸换行） */
function repairJson(raw: string): string {
  let t = raw.trim();
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  // 去掉尾随逗号
  t = t.replace(/,\s*([}\]])/g, "$1");
  // 单引号当引号用
  t = t.replace(/'([^'\\]*)'(\s*:)/g, '"$1"$2');
  t = t.replace(/:\s*'([^'\\]*)'/g, ': "$1"');
  // 字符串里的裸换行 → \n（模型经常在正文里换行）
  t = t.replace(/"(?:[^"\\]|\\.)*"/g, (m) => m.replace(/\r?\n/g, "\\n"));
  return t;
}

/** 从一段文本里"扫出"所有看起来像动作的 JSON 对象（按括号配对，不靠正则贪心） */
function scanObjects(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "{") continue;
    // 只看开头一小段里带 "kind" 的，避免把普通正文里的 {} 也拿来试
    const head = text.slice(i, i + 240);
    if (!/"kind"\s*:/.test(head)) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j += 1) {
      const c = text[j]!;
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') inStr = !inStr;
      if (inStr) continue;
      if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          out.push(text.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
  }
  return out;
}

function collectFrom(chunk: string, out: AppAction[]) {
  const attempts = [chunk, repairJson(chunk)];
  for (const raw of attempts) {
    try {
      const parsed = JSON.parse(raw) as AppAction | AppAction[];
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        if (item && typeof item === "object" && typeof (item as { kind?: unknown }).kind === "string") {
          out.push(item);
        }
      }
      return;
    } catch {
      /* 换下一种修法 */
    }
  }
}

/** 去掉动作块（含流式期间只收到一半的），让对话里只显示正文。 */
export function stripActions(text: string): string {
  return text
    .replace(STRICT_BLOCK, "")
    .replace(/```[ \t]*qidao[\s\S]*$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 取出回复里的动作。四层兜底，尽量别把模型的动作丢掉。 */
export function takeActions(text: string): AppAction[] {
  const out: AppAction[] = [];

  // ① 严格的 ```qidao 块
  for (const m of text.matchAll(STRICT_BLOCK)) collectFrom((m[1] ?? "").trim(), out);
  if (out.length) return out;

  // ② 任意代码块里，只要能解析出 kind 就算
  for (const m of text.matchAll(ANY_BLOCK)) {
    const body = (m[1] ?? "").trim();
    if (!/"kind"\s*:/.test(body)) continue;
    collectFrom(body, out);
  }
  if (out.length) return out;

  // ③ 正文里直接写的裸 JSON（没包代码块）
  for (const obj of scanObjects(text)) collectFrom(obj, out);
  return out;
}

/** 他是不是"看起来想动手"（用来在解析失败时如实告诉用户，而不是装作没事） */
export function looksLikeAction(text: string): boolean {
  return /"kind"\s*:/.test(text);
}


/**
 * 对话发送逻辑（对话页与语音页共用）。
 *
 * 故意**不按工具名逐条写文案**（那会变成第二份状态清单，迟早过期，见坑 #31）：
 * 一句通用的、不承诺具体结果的过渡词就够了，而且用户要求"说人话"。
 */
const TOOL_FILLER = "嗯，我看一下。";

/** 同一轮里已经念过过渡就不重复念（一轮里连调三个动作会念三遍，很吵） */
function shouldFillVoice(r: ToolRoundRecord, roundHasText: boolean): boolean {
  return !roundHasText && r.calls.length > 0;
}

/**
 * 内部信号：上游**明确拒绝**了 `tools` 参数 → 该摘掉 tools、按文本协议重来。
 *
 * 用一个 Error 子类而不是返回值，是因为它要在**深两层的异步栈**里穿出来
 * （`runToolLoop` → `makeDirectRound` → `streamDirect`），返回值会被层层吞掉。
 */
class NativeRejected extends Error {
  constructor() {
    super("上游不支持 tools");
    this.name = "NativeRejected";
  }
}

/**
 * 对话发送逻辑（对话页与语音页共用）。
 *
 * 从 chat-view 里抽出来的原因很直接：语音模式改成独立页面之后，
 * 它也要能「发一条、等回复、念出来」，这两页必须走同一套逻辑，
 * 否则预算控制、用量统计、权限感知很快会两套走偏。
 */

function notifyQuota(aiName: string) {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      new Notification(`${aiName}额度提醒`, { body: "本窗口额度即将用尽。" });
    } else if (Notification.permission !== "denied") {
      void Notification.requestPermission();
    }
  } catch {
    /* ignore */
  }
}

export function useChatStream(opts: UseChatOpts = {}) {
  const settings = useApp((s) => s.settings);
  const model = useApp((s) => s.model);
  const aiName = resolveAiName(settings.aiName);
  const [busy, setBusy] = useState(false);
  const [liveId, setLiveId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** opts 每个渲染都是新对象，用 ref 兜住，免得把 runStream 的依赖表搞脏 */
  const fillerRef = useRef(opts.onFiller);
  fillerRef.current = opts.onFiller;
  const forceProtocolRef = useRef(opts.forceProtocol);
  forceProtocolRef.current = opts.forceProtocol;

  const histOpts = {
    budget: settings.contextBudget,
    keepRecent: settings.keepRecent,
    autoCompact: settings.autoCompact,
    compactAt: settings.compactAt,
  };

  /** 把一段历史丢给模型，边流边写回指定的那一条助手消息。 */
  const runStream = useCallback(
    async (conversationId: string, messageId: string, history: ApiMessage[]) => {
      setBusy(true);
      setLiveId(messageId);
      const started = Date.now();
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      let thinking = "";
      let content = "";
      /** 这次流里**真的拿到过正文**吗（只有思考或只有报错都不算成功 → 会自动重试） */
      let hadContent = false;
      let usage: ChatMessage["usage"];
      let meta: { promptHash?: string; systemTokens?: number; model?: string } | undefined;

      /**
       * 流式写入**节流**。
       *
       * 原来模型每吐一个字就 patchMessage 一次 —— 而这一页是整块毛玻璃，
       * 于是每吐一个字就把整页重绘一遍。手机上表现就是"卡死、像重启了一样"。
       * 改成攒起来，最多每 100ms 写一次；结束时补最后一次。
       */
      let flushTimer = 0;
      let dirty = false;
      const flush = () => {
        if (flushTimer) {
          window.clearTimeout(flushTimer);
          flushTimer = 0;
        }
        if (!dirty) return;
        dirty = false;
        // 写进消息里的是**去掉动作块**的正文 —— 否则那截 JSON 会一直显示在对话里
        useApp.getState().patchMessage(conversationId, messageId, {
          content: stripActions(content),
          thinking,
        });
      };
      const schedule = () => {
        dirty = true;
        if (!flushTimer) flushTimer = window.setTimeout(flush, 100);
      };

      // MCP 服务器 + 用户自己配的 HTTP 接口，一起交给提示词（一处实现见 promptToolsFor）
      const tools = promptToolsFor(useApp.getState().enabledTools(), useApp.getState().httpTools);
      const context = buildContext();
      // 世界书：常驻的进系统提示词，命中关键词的挂在最后一条用户消息尾部。
      // 这里没有直接的 text 变量，就从历史里找最后一条用户消息来判断关键词。
      const lastUser = [...history].reverse().find((m) => m.role === "user");
      const world = pickWorldEntries(
        useApp.getState().worldBook,
        typeof lastUser?.content === "string" ? lastUser.content : "",
      );
      // 他上一轮动手的结果（回执）—— 没有它他不知道自己到底做没做
      const st = useApp.getState();
      const recentActions = actionFeedback(st.actionLog, st.pendingActions.length);

      /**
       * 这一轮走哪条通道（见 `shouldUseNativeTools` 的说明）。
       * 只有**原生**那条路才把 61 个动作的定义当 `tools` 发出去。
       */
      const native = forceProtocolRef.current
        ? forceProtocolRef.current === "native"
        : shouldUseNativeTools(settings);

      /**
       * 把 request 对象拼出来（一处实现，两条通道共用）。
       *
       * `nativeTools` 这个标志**跟着本地变量走，不是跟着开关走** ——
       * 探测说支持、结果上游报了 400，降级重试时要立刻按文本协议重拼提示词，
       * 否则模型手里拿的是"按工具调用"的说明、却没有 tools 可用。
       */
      const buildReq = (nativeTools: boolean) => {
        const base = {
          model,
          messages: history,
          style: settings.replyStyle,
          tools,
          customBaseUrl: settings.customBaseUrl || undefined,
          customApiKey: settings.customApiKey || undefined,
          upstreamModel: settings.upstreamModel || undefined,
          maxTokens: settings.maxTokens,
          name: settings.displayName,
          aiName,
          persona: settings.persona || undefined,
          context,
          worldAlways: world.always,
          worldHit: world.hit,
          recentActions,
          permissions: settings.permissions,
        };
        return { ...base, nativeTools };
      };

      const onDelta = (d: ChatDelta) => {
        if (d.error) {
          /**
           * 错误正文先当"这一轮的话"显示出来（`content || d.error`：已经有正文就不覆盖）。
           * 注意它**不置 hadContent** —— 只有报错、没有正文时还要走"自动重试一次"那条路。
           */
          content = content || d.error;
          schedule();
          flush();
          return;
        }
        if (d.meta) meta = d.meta;
        if (d.usage) usage = d.usage;
        if (d.thinking) {
          thinking += d.thinking;
          schedule();
        }
        if (d.content) {
          hadContent = true;
          content += d.content;
          schedule();
        }

        /**
         * 模型选了工具 —— **先把已经吐出来的正文写进界面再执行**。
         *
         * 不然会这样：他先说一句"我去看一下"，然后调用动作；用户要点的
         * 那张确认卡片几秒后才弹出来，而这期间那句话还压在节流缓冲里没显示，
         * 看起来像"界面卡住了"。
         */
        if (d.toolCalls?.length) {
          dirty = true;
          flush();
        }
      };

      /** 一次尝试共用的一块状态（重试时整块清掉，免得两次的内容混在一起） */
      type AttemptState = {
        pendingCalls: { name: string }[];
        rounds: ToolRoundRecord[];
        usedNative: boolean;
        reqError?: string;
        stalled: boolean;
      };

      /** 原生 tools 那条路：拼好 messages + 循环。同步抛错（真的异常）由外层接住转成重试。 */
      const runNative = async (state: AttemptState): Promise<void> => {
        const reqActive = buildReq(true);
        const assembled = assembleMessages(reqActive, history) as ApiMessage[];
        // 探测说支持 ≠ 一定能用（中转会吞掉 tool_call、或只跟流式一起给）：
        // 所以每轮都瞄一眼"采集回来的工具名有没有不在我们清单里的"。
        const known = new Set(actionTools().map((t) => t.function.name));
        const send: ToolRoundSend = (() => {
          const inner =
            (settings.customBaseUrl ?? "").trim() && (settings.customApiKey ?? "").trim()
              ? makeDirectRound(reqActive)
              : makeServerRound(reqActive);
          return async (args) => {
            const r = await inner(args);
            for (const c of r.toolCalls) {
              if (!known.has(c.name)) {
                // 上游把工具调用"变成一坨普通文字"时常见的形状：名字是垃圾。
                // 这条不降级（没有明确信号），但记下来方便排查 —— 用户报"他瞎调"时先看这个。
                console.warn("[qidao] 上游返回了不在清单里的工具名：", c.name);
              }
            }
            return r;
          };
        })();

        /**
         * 工具循环跑完一轮之后：语音页要有一句过渡（不然那几秒是死寂）。
         * 放在 `onRound` 里而不是循环外，是因为**只有真的调了工具**才需要过渡。
         */
        const roundTextStart = { at: 0 };
        const result = await runToolLoop({
          send,
          baseMessages: assembled,
          tools: actionTools(),
          signal: ac.signal,
          onDelta,
          onRound: (r) => {
            state.rounds.push(r);
            const before = roundTextStart.at;
            const roundHasText = content.slice(before).trim().length > 0;
            roundTextStart.at = content.length;
            if (shouldFillVoice(r, roundHasText)) fillerRef.current?.(TOOL_FILLER);
          },
        });
        state.pendingCalls = result.pendingCalls;
        state.usedNative = result.usedNative;
        if (result.toolsRejected) {
          // 上游明确不要 tools → 交给外层按文本协议再来一遍
          throw new NativeRejected();
        }
        state.reqError = result.error;
        state.stalled = result.stalled;
      };

      /**
       * 断线自动重试（最多两次）。
       *
       * 实测：思考链很长时，经过代理的流式连接容易被中途掐断，
       * 结果是一条**只有思考、没有正文**的空回复（用户报过两次）。
       * 与其让他手动点「重新生成」，不如自己再试一遍 ——
       * 重试时把上一次的思考和错误文本都丢掉，免得两次内容混在一起。
       *
       * ⚠️ P2 起判定标准变了：**"只有工具调用、没有正文"不算空**——
       * 按老规矩（必须有正文）判断的话，工具轮会被无限重发（这正是坑 #36）。
       */
      const state: AttemptState = { pendingCalls: [], rounds: [], usedNative: false, stalled: false };
      let lastErr: unknown = null;
      let rejectedToText = false;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        hadContent = false;
        state.pendingCalls = [];
        state.rounds = [];
        state.usedNative = false;
        state.reqError = undefined;
        state.stalled = false;
        try {
          if (native && !rejectedToText) {
            await runNative(state);
          } else {
            await streamChat(buildReq(false), onDelta, ac.signal);
          }
          lastErr = null;
        } catch (err) {
          // 上游明确拒绝了 tools：这不是错误，是"该换条路" —— 立刻按文本协议重来
          if (err instanceof NativeRejected) {
            rejectedToText = true;
            content = "";
            thinking = "";
            hadContent = false;
            dirty = true;
            flush();
            continue;
          }
          lastErr = err;
        }
        if (ac.signal.aborted) break;
        // 成功 = 真的拿到了正文 **或** 真的调用了工具（两者有一个就不算失败）
        if (hadContent || state.usedNative) break;
        if (attempt === 2) break;
        content = "";
        thinking = "";
        usage = undefined;
        dirty = true;
        flush();
        await new Promise((r) => window.setTimeout(r, 350));
      }
      if (!hadContent && !state.usedNative && !ac.signal.aborted) {
        const why = state.reqError || (lastErr as Error | null)?.message;
        content =
          (why ? `${why}\n\n` : "") +
          "没拿到正文。可能是：连接被掐断（思考链太长时容易这样），地址/密钥不对，或者网络不通。\n\n" +
          "已经自动重试过一次了。可以再点「重新生成」，或者跟他说「想短一点、先给结论」。";
      }
      // 收尾：把最后攒着的那一点写进去，并停掉定时器
      if (flushTimer) {
        window.clearTimeout(flushTimer);
        flushTimer = 0;
      }
      dirty = true;
      flush();

      /**
       * 走**文本协议**时才有"正文里的动作块"要解析（原生那条路已经在循环里执行完了）。
       * 权限、确认弹窗、动作记录都由 store 那一侧负责（没授权的会被拦下来问用户）。
       */
      const actions = state.usedNative ? [] : takeActions(content);
      for (const action of actions) {
        useApp.getState().requestAction(action, "AI");
      }
      /**
       * 他说要动手、却一个动作都没解析出来 —— **如实告诉他**。
       * 用户实测报过："写动态和信不可以了，他说他执行了，但是是空的"：
       * 模型以为做了、用户那边什么都没发生，两边对不上。
       */
      if (!state.usedNative && actions.length === 0 && looksLikeAction(content)) {
        content +=
          "\n\n（他写了个动作，但格式我没看懂，所以没执行 —— 可以点「重新生成」，或者直接跟我说要做什么。）";
      }
      /**
       * 撞上轮数上限：还有动作没执行完。**必须说清**（P5 那条"失败要可见"的规矩），
       * 不然模型会在正文里说"我都做好了"，而实际上后面几步根本没跑。
       */
      if (state.pendingCalls.length > 0) {
        content +=
          `\n\n（他已经连着动手了 ${state.rounds.length} 轮，我先停下让你看看 —— ` +
          "还有更进一步的，直接跟他说一声就行。）";
      }

      useApp.getState().finalizeAssistant(conversationId, messageId, {
        content:
          stripActions(content) ||
          // 空的正文分两种：一种是他真的没说话，一种是**被掐断了**。
          // 后者如果显示成"（空回复）"，用户只会以为坏了 —— 得说清是什么情况。
          (thinking.trim().length > 0
            ? "他想了很久，正文却一个字都没写出来 —— 多半是连接被中途掐断了（思考链越长，经过代理时越容易被掐）。\n\n可以试试：下面的「重新生成」，或者直接跟他说「想短一点、先给结论」。"
            : "（空回复）"),
        thinking,
        thinkingDurationMs: Date.now() - started,
        usage,
        // 这一轮他"真的动过手"的记录（调了哪个动作、成没成）—— 给消息下面那行过程看
        rounds: state.rounds.length > 0 ? state.rounds : undefined,
      });
      if (meta) {
        useApp.getState().logRequest({
          promptHash: meta.promptHash ?? "",
          systemTokens: meta.systemTokens ?? 0,
          model: meta.model ?? model,
          prompt: usage?.prompt,
          completion: usage?.completion,
          cached: usage?.cached,
        });
      }
      // 「本机计数快满了」只在**走服务端**时提醒（那时花的才是服务端那把 key）；
      // 自己带 key 的用户不该被打扰 —— 他花自己的钱，本机不限制。
      if (!isOwnApi(settings) && settings.notifications && settings.quotaAlerts) {
        const q = useApp.getState().quota;
        if (q.used / QUOTA_LIMIT >= 0.9) notifyQuota(aiName);
      }
      if (settings.voiceReplies && content) {
        speak(content, { lang: resolveVoiceLang(settings.voiceLang) });
      }
      setBusy(false);
      setLiveId(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, aiName, settings],
  );

  const send = useCallback(
    async (text: string, attachments?: Attachment[]) => {
      /**
       * 按模式决定拦不拦（bumpQuota 里判断）：
       *   自己带 key → 永远返回 true（花你的钱，本机不管）✅
       *   走服务端   → 超了窗口上限才返回 false ✅
       */
      const ok = useApp.getState().bumpQuota();
      if (!ok) {
        window.alert(
          "本窗口额度用尽了（你现在走的是内置服务端，花的是服务端那把 key）。\n" +
            "想不受限：去「我的 → 自定义上游」填你自己的地址和密钥。",
        );
        return;
      }
      const { conversationId, assistant, user } = useApp
        .getState()
        .addUserMessage(text, attachments);
      const prior = useApp.getState().conversations.find((c) => c.id === conversationId);
      const history = historyForApi(
        prior?.messages.filter((m) => m.id !== assistant.id) ?? [user],
        histOpts,
      );
      await runStream(conversationId, assistant.id, history);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runStream, settings],
  );

  /** 重新生成某一条助手回复：保留它之前的历史，清空本条再跑一次。 */
  const regenerate = useCallback(
    async (messageId: string) => {
      const st = useApp.getState();
      const conversationId = st.activeId;
      if (!conversationId) return;
      const target = st.conversations.find((c) => c.id === conversationId);
      if (!target) return;
      const idx = target.messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return;
      st.patchMessage(conversationId, messageId, {
        content: "",
        thinking: "",
        thinkingDurationMs: 0,
        feedback: undefined,
      });
      await runStream(conversationId, messageId, historyForApi(target.messages.slice(0, idx), histOpts));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runStream, settings],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { busy, liveId, send, regenerate, stop, aiName };
}
