import type { ModelId } from "./models";
import { getModel } from "./models";
import type { ChatMessage, PermissionMode, ReplyStyle } from "./types";
import { attachmentsToText } from "./attachments";
import { assembleMessages } from "./prompt";
import type { PromptTool } from "./prompt";
import type { ActionTool } from "./action-schema";
import { createDeltaAccumulator, type WireToolCall } from "./tool-calls";
import { looksLikeToolsUnsupported } from "./tool-wire";
import type { ToolRoundResult, ToolRoundSend } from "./tool-loop";
import { estimateTokens } from "./tokens";

export type ChatDelta = {
  thinking?: string;
  content?: string;
  /**
   * 原生 `tools` 的**分片增量**（OpenAI 兼容协议的原始形状）。
   * 直接透传给装配器（`lib/tool-calls`），别在这里拼 —— 分片规则只有一处实现。
   */
  toolCalls?: WireToolCall[];
  error?: string;
  done?: boolean;
  /** 上游返回的用量（有的实现只在最后一帧给） */
  usage?: { prompt?: number; completion?: number; cached?: number; total?: number };
  /** 服务端第一帧报回来的提示词指纹（用于判断前缀有没有变） */
  meta?: { promptHash?: string; systemTokens?: number; model?: string };
};

/** 文本，或多模态的 content parts（OpenAI 风格）。 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** 发给上游的一条 `tool_calls`（只在**工具循环内部**的内存历史里出现） */
export type ApiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ApiMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentPart[];
  /** 原生 tools：assistant 选中了哪些 function（回灌时必须原样带着） */
  tool_calls?: ApiToolCall[];
  /** 原生 tools：这条是哪个调用的结果 */
  tool_call_id?: string;
};

/** 随每条消息一起上报的「用户此刻的状态」，让 AI 知道你在干什么。 */
export type ChatContext = {
  /** 当前活动，例如「在听歌 · 夜航 · 播放中」 */
  activity?: string;
  /** 最近的活动轨迹（新 → 旧） */
  recent?: string[];
  /** 已被允许的能力（中文标题） */
  granted?: string[];
  /** 此刻正在播放的音乐（如果有） */
  nowPlaying?: string;
  /** 用户那边的天气（"晴 22°C"）—— 跟此刻并列，不塞进 aware 清单 */
  weather?: string;
  /** 逐项感知内容（已按权限过滤），每行形如「文档库：…」 */
  aware?: string[];
  /** 客户端当前时间 */
  now?: string;
};

export type ChatRequest = {
  model: ModelId;
  messages: ApiMessage[];
  style: ReplyStyle;
  tools: PromptTool[];
  /**
   * **原生 `tools`（function calling）** —— 61 个内部动作的定义，见 `action-schema.ts`。
   *
   * 只有确认上游支持时才发（探测过 / 用户在设置里强制开）；
   * 走服务端时由 `/api/chat` 透传给上游，走直连时由 `streamDirect` 直接带上。
   * 不发就是老路子：动作写在正文的 ```qidao 代码块里（见 use-chat 的 takeActions）。
   */
  actionTools?: ActionTool[];
  /**
   * 已经拼好的 messages（工具循环自带系统提示词 + tool 回灌时用，避免二次拼装）。
   *
   * ⚠️ 服务端**不会**用它拼系统提示词 —— 那里仍然读 `req` 的各字段自己拼（提示词指纹、
   * token 统计都靠那份）。这个字段只跟你走服务端时的"工具循环"有关（见 `makeServerRound`）。
   */
  assembled?: ApiMessage[];
  /**
   * 这一轮**强制**走哪条通道（诊断用）。
   *
   * 为什么留这个口子：探测结论可能是错的（换了一把上游、或者中转偷偷改了行为），
   * 用户需要一个"我就是要试原生 / 我就是要回保底"的开关，
   * 而自动降级只能单向（从原生掉到文本、回不去）。
   * 验收脚本也靠它来真跑"上游不认 tools → 自动降级"这条路。生产代码不传它。
   */
  toolProtocol?: "native" | "text";
  /**
   * ⭐ 工具循环里**每一轮**都从这条口子发出去（而不是重拼 `messages`）：
   * 那一轮要带的东西（上一轮 assistant 的 tool_calls + tool 结果）只有客户端有。
   *
   * 服务端收到它就用它当上游的 messages（自己仍然按 `req` 拼系统提示词做指纹/token 统计）。
   * 这样"电脑上（走服务端）"和"手机上（直连）"是**同一条逻辑**，不会走散。
   */
  assembledMessages?: ApiMessage[];

  customBaseUrl?: string;
  customApiKey?: string;
  /** 自定义上游的真实模型名（留空则用服务端配的） */
  upstreamModel?: string;
  name: string;
  /** AI 的名字（用户在设置里自填），用于服务端拼系统提示词 */
  aiName?: string;
  /** 他的人设/自述 */
  persona?: string;
  /** 用户此刻在干什么 —— 感知层 */
  context?: ChatContext;
  /** 世界书 · 常驻条目（进系统提示词） */
  worldAlways?: string[];
  /** 世界书 · 这轮命中关键词的条目（挂最后一条用户消息尾部） */
  worldHit?: string[];
  /** 他刚才动手的**结果**（回执）—— 让他下一轮知道自己到底做没做 */
  recentActions?: string[];
  /** 用户给它的授权（实时）—— 用来生成说明书里"你现在的权限"那一节 */
  permissions?: Record<string, PermissionMode>;
  /**
   * 最大输出长度（token）。0 / 留空 = 跟随所选档位的默认值。
   *
   * 用户实测：思考链一长就被掐断、只剩空回复。有些网关把**思考也算进 max_tokens**，
   * 所以调大它能缓解；但调太大某些模型会直接报错 —— 所以做成可调，默认跟随档位。
   */
  maxTokens?: number;
};

/** 上游回的错误正文 → 一句人话（JSON 的 error.message 优先，其次原文前 160 字） */
function digestErrorBody(status: number, text: string): string {
  let msg = `上游返回 ${status}`;
  try {
    const j = JSON.parse(text) as { error?: { message?: string } | string };
    msg =
      typeof j.error === "string" ? j.error : (j.error?.message ?? `${msg}：${text.slice(0, 160)}`);
  } catch {
    msg = `${msg}：${text.slice(0, 160)}`;
  }
  return msg;
}

/** 一次流式请求的结果（两种"结束后才知道的状态"） */
type StreamOutcome = {
  /** 看门狗掐断了连接（已经收到的内容仍然有效） */
  stalled: boolean;
  /**
   * ⭐ 上游**明确拒绝**了 `tools` 参数 —— 该摘掉 tools、按文本协议重来。
   *
   * 为什么必须从这儿带出来：这是"自动降级"唯一的触发点。少了它，
   * 用户会看到一句英文报错（"tools is not supported"）然后什么都没发生 ——
   * 这正是**手机上（直连）**那条路最容易漏的地方（走服务端时由服务端标这个信号）。
   */
  toolsRejected: boolean;
};

/**
 * 直连模式：手机直接跟模型说话，中间不经过任何服务器。
 *
 * 为什么要它：封装成 APK 之后没有 `/api/chat` 这个服务端了。
 * 而这正是**解决"要挂梯子"的关键** —— 国内接口（DeepSeek 等）允许浏览器直连
 * （CORS 已实测放开），所以手机 ↔ 模型 是直路：又快又不用 proxy。
 *
 * 与走服务端**共用同一份提示词**（lib/prompt），所以他人设、感知层一模一样。
 *
 * P2 起它多了一个身份：**工具循环的直接通道**（`makeDirectRound` 就是拿它当一轮用）。
 *
 * `fetchImpl` 是给验收脚本注入假 fetch 用的（默认就是真 fetch）。
 */
async function streamDirect(
  req: ChatRequest,
  onDelta: (d: ChatDelta) => void,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<StreamOutcome> {
  const base = (req.customBaseUrl ?? "").trim().replace(/\/+$/, "");
  const key = (req.customApiKey ?? "").trim();
  const model = (req.upstreamModel ?? "").trim();

  if (!base || !key) {
    onDelta({
      error: "还没接模型：去「我的 → 自定义上游」填地址和密钥。",
      done: true,
    });
    return { stalled: false, toolsRejected: false };
  }
  if (!model) {
    onDelta({
      error: "还差模型名：去「我的 → 自定义上游」填（可点「拉取可用模型」问对方要列表）。",
      done: true,
    });
    return { stalled: false, toolsRejected: false };
  }

  const messages = req.assembled ?? assembleMessages(req, req.messages);
  // 0 / 空 = 跟随档位；用户在设置里调过就用他的
  const maxTokens = req.maxTokens && req.maxTokens > 0 ? req.maxTokens : getModel(req.model).maxTokens;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        max_tokens: maxTokens,
        // 只有真的要走原生工具调用时才带 tools —— 留空就是老协议（正文里的动作块）
        ...(req.actionTools && req.actionTools.length > 0 ? { tools: req.actionTools } : {}),
      }),
      signal,
    });
  } catch (err) {
    onDelta({
      error: `连不上上游：${(err as Error).message || "网络错误"}（检查地址、密钥、以及手机能不能上网）`,
      done: true,
    });
    return { stalled: false, toolsRejected: false };
  }

  if (!res.ok) {
    let text = "";
    try {
      text = await res.text();
    } catch {
      /* ignore */
    }
    onDelta({ error: digestErrorBody(res.status, text), done: true });
    /**
     * 只认"明确拒绝 tools"这一种 —— 401（密钥）、429（限流）、5xx（对方挂了）
     * 摘掉 tools 也一样不通，降级只会掩盖真正的问题。
     */
    const rejected = looksLikeToolsUnsupported(res.status, text);
    return { stalled: false, toolsRejected: rejected };
  }
  if (!res.body) {
    onDelta({ error: "上游没返回内容", done: true });
    return { stalled: false, toolsRejected: false };
  }

  onDelta({ meta: { model } });
  return readSseStream(res.body, onDelta, signal);
}

/**
 * 读一束 SSE 直到结束。
 *
 * 从 `streamDirect` 里抽出来的原因：P2 之后有两处要读流（老的 UI 流、工具循环的每一轮）。
 * 看门狗、缓冲切行、`[DONE]`、错误帧 —— 只能有一份实现。
 *
 * `contentType` 传进来是为了一个实测过的坑：**有的中转无视 `stream:true`，
 * 直接回一整份非流式 JSON**。那时 body 里没有 `data:` 行，得按非流式解析，
 * 否则会得到"上游没返回内容"这种看不懂的失败。
 */
async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (d: ChatDelta) => void,
  signal?: AbortSignal,
): Promise<StreamOutcome> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let finished = false;
  let sawAnyData = false;

  const handle = (payload: string) => {
    if (!payload || payload === "[DONE]") {
      if (!finished) {
        finished = true;
        onDelta({ done: true });
      }
      return;
    }
    try {
      const j = JSON.parse(payload) as {
        choices?: {
          delta?: {
            content?: string | null;
            reasoning_content?: string | null;
            reasoning?: string | null;
            tool_calls?: WireToolCall[];
            function_call?: { name?: string; arguments?: string };
          };
        }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          /** DeepSeek 用这个字段报"命中缓存的 token 数" */
          prompt_cache_hit_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        } | null;
        error?: { message?: string } | string;
      };
      if (j.error) {
        const m = typeof j.error === "string" ? j.error : (j.error.message ?? "上游报错");
        onDelta({ error: m, done: true });
        finished = true;
        return;
      }
      const d = j.choices?.[0]?.delta;
      // 思考链：DeepSeek 用 reasoning_content，个别实现用 reasoning
      const think = d?.reasoning_content ?? d?.reasoning;
      if (think) onDelta({ thinking: think });
      if (d?.content) onDelta({ content: d.content });
      // 原生工具调用：**原样透传**分片，拼装只有一处实现（lib/tool-calls）
      if (d?.tool_calls?.length) sawAnyData = true;
      if (d?.tool_calls?.length) onDelta({ toolCalls: d.tool_calls });
      if (j.usage) {
        onDelta({
          usage: {
            prompt: j.usage.prompt_tokens,
            completion: j.usage.completion_tokens,
            total: j.usage.total_tokens,
            // 缓存命中：DeepSeek 叫 prompt_cache_hit_tokens，OpenAI 那套在
            // prompt_tokens_details.cached_tokens —— 两个都读，否则永远是 0
            cached:
              j.usage.prompt_cache_hit_tokens ??
              j.usage.prompt_tokens_details?.cached_tokens,
          },
        });
      }
    } catch {
      /* 半截帧先跳过，下一轮补全 */
    }
  };

  /**
   * 看门狗：流式连接**长时间不吐字**绝不能无限等。
   *
   * 实测症状：思考链很长时，连接被中途掐断（经过代理/中转时尤其常见），
   * 界面上就是"卡住"，最后只剩一条空回复。
   * 这里 45 秒没有新数据就主动断开 —— 已经收到的内容全部保住，
   * 上层会告诉用户"是断了，不是没话说"。
   */
  let lastAt = Date.now();
  let stalled = false;
  const stallTimer = window.setInterval(() => {
    if (Date.now() - lastAt > 45_000) stalled = true;
  }, 3000);
  const stall = new Promise<"stall">((resolve) => {
    const wait = window.setInterval(() => {
      if (stalled) {
        window.clearInterval(wait);
        resolve("stall");
      }
    }, 500);
  });

  while (true) {
    const next = await Promise.race([reader.read(), stall]);
    if (next === "stall") {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
    const { done, value } = next;
    if (done) break;
    lastAt = Date.now();
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      sawAnyData = true;
      handle(trimmed.slice(5).trim());
    }
  }
  window.clearInterval(stallTimer);
  if (buf.trim().startsWith("data:")) handle(buf.trim().slice(5).trim());

  /**
   * 一整束里连一个 `data:` 行都没有 → 对方把流式请求当成非流式答了。
   * 这是**不能猜**的地方（猜错就是"半个字都不回"），所以明说。
   */
  if (!sawAnyData && !stalled && !signal?.aborted) {
    onDelta({
      error:
        "上游没有按流式回内容（一帧 data: 都没有）—— 有些中转会无视 stream:true。" +
        "已经把这一轮当成失败，可以点「重新生成」再试。",
      done: true,
    });
  }
  if (!finished) onDelta({ done: true });
  // 走到这儿说明上游**收下了** tools（HTTP 2xx）—— 不是"不支持"那种情况
  return { stalled, toolsRejected: false };
}

/* ─────────────────── 工具循环用的一轮（同一条直连路径） ─────────────────── */

/**
 * 把"一轮带 tools 的流式请求"包成工具循环要的形状（`ToolRoundSend`）。
 *
 * ⚠️ 必须和 UI 那条路**共用 `streamDirect`** —— 否则"手机上（直连）"和
 * "电脑上（走服务端）"就会是两套行为，那是这个仓库最忌讳的走散。
 *
 * @param fetchImpl 测试注入用的假 fetch（默认真 fetch）
 */
export function makeDirectRound(req: ChatRequest, fetchImpl?: typeof fetch): ToolRoundSend {
  return async ({ messages, tools, onDelta, signal }): Promise<ToolRoundResult> => {
    const acc = createDeltaAccumulator();
    let content = "";
    let thinking = "";
    let usage: ToolRoundResult["usage"];
    let error: string | undefined;

    const outcome = await streamDirect(
      { ...req, assembled: messages, assembledMessages: messages, actionTools: tools ?? undefined },
      (d: ChatDelta) => {
        if (d.error) error = d.error;
        if (d.usage) usage = d.usage;
        if (d.thinking) thinking += d.thinking;
        if (d.content) content += d.content;
        if (d.toolCalls) acc.push({ tool_calls: d.toolCalls });
        onDelta(d);
      },
      signal,
      fetchImpl,
    );

    return {
      content,
      thinking,
      toolCalls: acc.calls(),
      usage,
      error,
      stalled: outcome.stalled,
      toolsRejected: outcome.toolsRejected,
    };
  };
}

/** 构建时就定下来：给 APK 打包时设 VITE_DIRECT_UPSTREAM=1 */
const DIRECT_BUILD = (import.meta.env?.VITE_DIRECT_UPSTREAM as string | undefined) === "1";

/**
 * POST `/api/chat`。
 *
 * 返回 `null` = **这一跳不能用**，有两种情况，调用方都该改走直连：
 *   ① 拿到了 SPA 的 HTML（这个壳里根本没有服务端 —— 比如忘了设构建标志就打了包）
 *   ② 非 2xx（服务端已经把错因写进 onDelta 了）
 * 否则返回那个 `text/event-stream` 响应。
 *
 * `out.fail` 顺带带出"这一跳为什么失败"：降级判断要用（见 `makeServerRound`）。
 */
async function postServerChat(
  req: ChatRequest,
  onDelta: (d: ChatDelta) => void,
  signal?: AbortSignal,
  out?: { fail?: { status: number; message: string; toolsUnsupported?: boolean } },
): Promise<Response | null> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });

  /**
   * 兜底：万一在没有服务端的壳里跑（比如忘了设构建标志就打了包），
   * `/api/chat` 会返回 SPA 的 HTML 而不是事件流。认出来就改走直连 ——
   * 否则用户会看到"发出去了、一个字都不回"这种最难查的失败。
   */
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("text/event-stream")) return null;

  if (!res.ok) {
    let msg = `请求失败 ${res.status}`;
    let toolsUnsupported: boolean | undefined;
    try {
      const j = (await res.json()) as { error?: string; toolsUnsupported?: boolean };
      if (j.error) msg = j.error;
      toolsUnsupported = j.toolsUnsupported;
    } catch {
      /* ignore */
    }
    /**
     * ⚠️ 这里有个容易踩的坑：本地 dev server 把上游的 400 变成了 **502**，
     * 所以"上游不要 tools"这个信号**只能靠服务端显式告诉我们**（`toolsUnsupported`），
     * 不能靠状态码猜 —— 猜的话 502 会被当成"服务端挂了"，于是永远不降级。
     */
    if (out) out.fail = { status: res.status, message: msg, toolsUnsupported };
    onDelta({ error: msg, done: true });
    return null;
  }
  return res;
}

/** 读服务端那一跳的事件流（每帧就是一个 ChatDelta；服务端已经把上游的 tool_calls 透传过来了） */
async function readServerStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (d: ChatDelta) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") {
        onDelta({ done: true });
        continue;
      }
      try {
        const json = JSON.parse(payload) as ChatDelta;
        onDelta(json);
      } catch {
        /* skip malformed chunk */
      }
    }
  }
  onDelta({ done: true });
}

export async function streamChat(
  req: ChatRequest,
  onDelta: (d: ChatDelta) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (DIRECT_BUILD) {
    await streamDirect(req, onDelta, signal);
    return;
  }

  const res = await postServerChat(req, onDelta, signal);
  if (!res) {
    // 服务端那一跳不可用 → 直连（错误信息已经在上面报过了，这里只补数据）
    await streamDirect(req, onDelta, signal);
    return;
  }
  if (!res.body) {
    onDelta({ error: "无法读取回复流", done: true });
    return;
  }
  await readServerStream(res.body, onDelta);
}

/* ─────────────────── 工具循环用的一轮（走服务端那一跳） ─────────────────── */

/**
 * 把"一轮带 tools 的流式请求"包成工具循环要的形状（`ToolRoundSend`），**走服务端**。
 *
 * 跟 `makeDirectRound` 只差"中间那一跳"：解析、分片拼装、降级判断全都共用
 * （`createDeltaAccumulator` / `looksLikeToolsUnsupported`），
 * 免得"电脑上"和"手机上"变成两套行为。
 */
export function makeServerRound(req: ChatRequest): ToolRoundSend {
  return async ({ messages, tools, onDelta, signal }): Promise<ToolRoundResult> => {
    const acc = createDeltaAccumulator();
    let content = "";
    let thinking = "";
    let usage: ToolRoundResult["usage"];
    let error: string | undefined;

    const payload: ChatRequest = {
      ...req,
      assembled: messages,
      assembledMessages: messages,
      actionTools: tools ?? undefined,
    };
    const fail: { status: number; message: string; toolsUnsupported?: boolean } = {
      status: 0,
      message: "",
    };
    const res = await postServerChat(
      payload,
      (d) => {
        if (d.error) error = d.error;
        if (d.usage) usage = d.usage;
        if (d.thinking) thinking += d.thinking;
        if (d.content) content += d.content;
        if (d.toolCalls) acc.push({ tool_calls: d.toolCalls });
        onDelta(d);
      },
      signal,
      { fail },
    );

    if (!res) {
      /**
       * "这一跳不可用"有三种，降级只该发生在**第一种**：
       *   ① 上游明确不要 tools（服务端标了 `toolsUnsupported`，或它把 400 原样透传了）
       *   ② 这个壳里没有服务端 → 不是上游的问题
       *   ③ 服务端自己挂了 / 密钥不对 / 限流 → 摘掉 tools 也一样不通
       */
      const unsupported =
        fail.toolsUnsupported === true ||
        looksLikeToolsUnsupported(fail.status, `${fail.message} ${error ?? ""}`);
      return {
        content,
        thinking,
        toolCalls: acc.calls(),
        usage,
        error,
        toolsRejected: unsupported,
      };
    }
    if (!res.body) {
      return { content, thinking, toolCalls: acc.calls(), usage, error: "无法读取回复流" };
    }
    await readServerStream(res.body, onDelta);
    return { content, thinking, toolCalls: acc.calls(), usage, error };
  };
}

export type HistoryOpts = {
  /** 估算 token 预算 */
  budget?: number;
  /** 至少保留最近多少条 */
  keepRecent?: number;
  /** 超预算是否折叠更早的消息 */
  autoCompact?: boolean;
  /** 用到预算的百分之多少开始折叠 */
  compactAt?: number;
};

function tokensOf(m: ApiMessage): number {
  if (typeof m.content === "string") return estimateTokens(m.content);
  let n = 0;
  for (const p of m.content) {
    if (p.type === "text") n += estimateTokens(p.text);
    else n += 260; // 一张图粗估
  }
  return n;
}

/**
 * 组装发给上游的历史。
 *
 * 加了预算控制：从最近往回收，装不下就停 —— 但最近 keepRecent 条
 * 无论多长都保留（否则一句长文就能把当前问题挤掉）。
 */
export function historyForApi(messages: ChatMessage[], opts: HistoryOpts = {}): ApiMessage[] {
  const keep = Math.max(2, opts.keepRecent ?? 16);
  const autoCompact = opts.autoCompact ?? true;
  const budget = Math.max(500, opts.budget ?? 6000);
  const limit = budget * ((opts.compactAt ?? 80) / 100);

  const built: ApiMessage[] = messages
    .filter((m) => m.content.trim() || m.role === "user")
    .map((m) => {
      const text = m.content + attachmentsToText(m.attachments);
      // 只有图片/表情走图片通道；语音、文件都只发文字部分
      const images = (m.attachments ?? []).filter(
        (a) => (a.kind === "image" || a.kind === "sticker") && a.dataUrl,
      );
      // 没有图片就走纯文本（兼容所有上游）；
      // 有图片就发 content parts，模型支持视觉时自然就看得见。
      if (images.length === 0) return { role: m.role, content: text };
      return {
        role: m.role,
        content: [
          { type: "text" as const, text },
          ...images.map((a) => ({
            type: "image_url" as const,
            image_url: { url: a.dataUrl as string },
          })),
        ],
      };
    });

  if (!autoCompact) return built.slice(-keep);

  const kept: ApiMessage[] = [];
  let used = 0;
  for (let i = built.length - 1; i >= 0; i -= 1) {
    const item = built[i]!;
    const forced = built.length - i <= keep;
    const t = tokensOf(item);
    if (!forced && used + t > limit) break;
    used += t;
    kept.unshift(item);
  }
  return kept;
}
