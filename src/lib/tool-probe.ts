/**
 * 上游能力探测 —— 「我这把上游到底支不支持原生 `tools`（function calling）」。
 *
 * 为什么要先测再改架构：下一步要把 App 的内部动作改造成原生 `tools` 调用，
 * 但上游支持参差 —— 很多中转会把 `tool_call` 吞掉、变成一坨普通文字，或者直接回 400。
 * 用户不能把 key 贴出来给开发者，也不该为了测这个去开命令行，
 * 所以探测做成 App 里的一个按钮：用他自己在设置里填好的**地址 + key + 模型名**直接发请求。
 *
 * 三条最小请求（都很便宜，加起来几百 token）：
 *   ① 非流式 + 一个工具    → 看 `choices[0].message.tool_calls` 有没有结构化调用
 *   ② 流式   + 一个工具    → 看 SSE 增量里能不能把**分片**的 tool_call 拼回来
 *   ③ 非流式 + 两个工具    → 看一次能不能返回**多个** tool_call
 *
 * ⚠️ 这个文件必须**能在纯 node 里跑**（`verify-tool-probe.mjs` 用
 * `node --experimental-strip-types` 直接跑它，没有浏览器）：
 *   · 不 import 任何浏览器 API / React / zustand
 *   · 不 import 任何路径别名（`@/…`）
 *   · 只用全局 `fetch` / `AbortController`（node 18+ 与所有浏览器都有）
 * 所以它**一个 import 都没有**，别为了好看加。
 *
 * 请求怎么发的：照抄 `src/lib/chat-client.ts` 里 `streamDirect()` 那一套 ——
 *   地址 `${base}/chat/completions`（base 去掉末尾斜杠）、
 *   头 `Content-Type: application/json` + `Authorization: Bearer <key>`、
 *   体 `{ model, messages, stream, … }`。
 * 字段名一个都没自己发明：`tools` / `tool_choice` 是 OpenAI 兼容协议本身的字段，
 * `model` / `messages` / `stream` / `max_tokens` 跟仓库现在发的一模一样。
 *
 * 设计原则：**永不抛异常**。超时、非 JSON、HTML 错误页、SSE 里没有 tool_call
 * 统统落进 `error`，界面最多显示一句人话，不会崩。
 */

export type ToolProbeResult = {
  /** 有没有一项通过 */
  ok: boolean;
  /** 请求有没有成功（不是 400/401/404） */
  httpOk: boolean;
  /** 非流式：能不能返回结构化 tool_call */
  nonStreamToolCall: boolean;
  /** 流式：SSE 增量里能不能拼出 tool_call */
  streamToolCall: boolean;
  /** 一次能不能返回 2 个 tool_call */
  multiToolCall: boolean;
  /** 三条请求的总耗时（毫秒） */
  latencyMs: number;
  /** 人话的失败原因（HTTP 码 + body 前 200 字） */
  error?: string;
  /** 原始响应片段，便于诊断（截断到 400 字） */
  rawSnippet: string;
};

/** 单个请求的超时。真机往返 800~2000ms，20 秒足够；超了就当成"这条不通"。 */
const DEFAULT_TIMEOUT_MS = 20_000;
/** rawSnippet 的截断长度 */
const SNIPPET_CHARS = 400;
/** 错误信息里贴 body 的截断长度 */
const ERROR_BODY_CHARS = 200;

/** 探测用的第一个工具：最简单的一种（只有一个 string 参数） */
const TIME_TOOL: WireToolSpec = {
  type: "function",
  function: {
    name: "get_time",
    description: "查当前时间。用户问「现在几点」时必须调用这个工具，不要自己猜。",
    parameters: {
      type: "object",
      properties: {
        timezone: { type: "string", description: "IANA 时区名，例如 Asia/Shanghai" },
      },
      required: ["timezone"],
    },
  },
};

/** 探测用的第二个工具：问「能不能一次返回两个」时跟上面一起发出去 */
const TEMPERATURE_TOOL: WireToolSpec = {
  type: "function",
  function: {
    name: "get_temperature",
    description: "查某个城市当前的气温。用户问天气时必须调用这个工具。",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "城市名，例如 杭州" },
      },
      required: ["city"],
    },
  },
};

/**
 * 提示词必须**明说"调用这个工具"**。
 * SillyTavern 那套文档也写明：给不给工具、模不调用工具**都不保证** ——
 * 光把 tools 发出去、然后问"几点"，模型可能直接用文字答，于是把支持工具的上游误判成不支持。
 */
const ASK_ONE =
  "现在几点？必须调用 get_time 这个工具来回答（时区给 Asia/Shanghai），不要直接说时间。";
const ASK_TWO =
  "请【一次性同时】调用 get_time 和 get_temperature 两个工具：查现在几点、以及杭州现在的气温。" +
  "必须返回两个工具调用，不要只调一个，也不要用文字回答。";

/* ────────────────────────── 线上格式（OpenAI 兼容） ────────────────────────── */

type WireToolSpec = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

type WireFunctionCall = { name?: string; arguments?: string | Record<string, unknown> };

type WireToolCall = {
  /** 流式增量里用它认"这坨是第几个调用" */
  index?: number;
  id?: string;
  type?: string;
  function?: WireFunctionCall;
};

type WireMessage = {
  content?: string | null;
  tool_calls?: WireToolCall[];
  /** 极老的单调用字段，个别中转还在用 */
  function_call?: WireFunctionCall;
};

type WireChoice = {
  message?: WireMessage;
  delta?: WireMessage;
  finish_reason?: string | null;
};

type WireBody = {
  choices?: WireChoice[];
  error?: { message?: string } | string;
};

/** 一个"拼好了的"工具调用（名字 + 参数 JSON 文本） */
export type ParsedToolCall = { name: string; args: string };

/** 内部沿用短名 */
type ParsedCall = ParsedToolCall;

/* ────────────────────────────────── 小工具 ────────────────────────────────── */

/** 截断成 `max` 字以内（省略号算在 `max` 里面 —— 界面上写了"400 字以内"就得真是 400 以内） */
function clip(text: string, max: number): string {
  const s = text ?? "";
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

function looksLikeHtml(text: string): boolean {
  return /^\s*</.test(text ?? "");
}

/** 把上游回的 body 变成一句人话（JSON 的 error 字段优先，其次原文前 200 字） */
function bodyDigest(body: string): string {
  const text = (body ?? "").trim();
  if (!text) return "（对方没回内容）";
  if (looksLikeHtml(text)) {
    return `（回的是网页 HTML，不是接口数据）：${clip(text, ERROR_BODY_CHARS)}`;
  }
  try {
    const j = JSON.parse(text) as WireBody & { message?: string };
    if (typeof j.error === "string") return clip(j.error, ERROR_BODY_CHARS);
    if (j.error && typeof j.error.message === "string") {
      return clip(j.error.message, ERROR_BODY_CHARS);
    }
    if (typeof j.message === "string") return clip(j.message, ERROR_BODY_CHARS);
  } catch {
    /* 不是 JSON：往下贴原文 */
  }
  return clip(text, ERROR_BODY_CHARS);
}

function argsText(fn: WireFunctionCall | undefined): string {
  const a = fn?.arguments;
  if (typeof a === "string") return a;
  if (a && typeof a === "object") return JSON.stringify(a);
  return "";
}

/**
 * 从一条 assistant 消息里读结构化工具调用。
 *
 * 要求**必须有函数名**才算数：`tool_calls: [{}]` 这种空壳看起来"有 tool_calls"，
 * 其实根本没法用 —— 探测一旦把它算通过，用户就会在真机上撞墙。
 * （参数允许是空的：有的上游会把无参调用的 arguments 留空。）
 */
function readToolCalls(msg: WireMessage | undefined): ParsedCall[] {
  if (!msg) return [];
  const out: ParsedCall[] = [];
  for (const c of msg.tool_calls ?? []) {
    const name = typeof c?.function?.name === "string" ? c.function.name.trim() : "";
    if (!name) continue;
    out.push({ name, args: argsText(c.function) });
  }
  if (
    out.length === 0 &&
    typeof msg.function_call?.name === "string" &&
    msg.function_call.name.trim()
  ) {
    out.push({ name: msg.function_call.name.trim(), args: argsText(msg.function_call) });
  }
  return out;
}

type BodyParse = {
  calls: ParsedCall[];
  /** 上游在 JSON 正文里回的错误（有的中转 HTTP 200 里塞 error） */
  apiError?: string;
  /** 压根不是 JSON（HTML 错误页、空正文…） */
  notJson: boolean;
  html: boolean;
  /** 纯文字回复（没调工具时它到底说了啥，方便诊断） */
  reply: string;
};

/** 解析一份**非流式**响应体 */
function parseChatBody(body: string): BodyParse {
  const text = (body ?? "").trim();
  if (!text) return { calls: [], notJson: true, html: false, reply: "" };
  let j: WireBody;
  try {
    j = JSON.parse(text) as WireBody;
  } catch {
    return { calls: [], notJson: true, html: looksLikeHtml(text), reply: "" };
  }
  if (j.error) {
    const m = typeof j.error === "string" ? j.error : (j.error.message ?? "上游报错");
    return { calls: [], apiError: m, notJson: false, html: false, reply: "" };
  }
  const msg = j.choices?.[0]?.message;
  return {
    calls: readToolCalls(msg),
    notJson: false,
    html: false,
    reply: typeof msg?.content === "string" ? msg.content : "",
  };
}

export type StreamParse = {
  calls: ParsedToolCall[];
  /** 流里出现的错误帧 */
  error?: string;
  /** 没调工具时它说了什么 */
  reply: string;
  /** 到底是不是 SSE（有的中转忽略 stream:true，直接回一整份 JSON） */
  sse: boolean;
};

/**
 * 解析 **SSE 流**：`tool_calls` 是**分片增量**传的——
 * 第一帧给 `id` 和函数名的一半，后面几帧往下续名字和 `arguments` 字符串。
 * 所以必须按 `index` 归并、把 name / arguments **字符串拼接**起来，
 * 只看某一帧是永远拼不出完整调用的。
 */
function parseStream(body: string): StreamParse {
  const raw = body ?? "";
  const dataLines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("data:"));

  // 没有 data: 前缀 —— 有的中转干脆无视 stream:true，回一整份非流式 JSON。
  // 这种情况按非流式解析，总比硬报"流式不支持"准确。
  if (dataLines.length === 0) {
    const p = parseChatBody(raw);
    return { calls: p.calls, error: p.apiError, reply: p.reply, sse: false };
  }

  const slots = new Map<number, ParsedCall>();
  let reply = "";
  let error: string | undefined;

  for (const line of dataLines) {
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let j: WireBody;
    try {
      j = JSON.parse(payload) as WireBody;
    } catch {
      continue; // 半截帧 / 心跳：跳过，别把整条流判死
    }
    if (j.error) {
      const m = typeof j.error === "string" ? j.error : (j.error.message ?? "上游报错");
      if (!error) error = m;
      continue;
    }
    const d = j.choices?.[0]?.delta;
    if (!d) continue;
    if (typeof d.content === "string") reply += d.content;

    const frames = d.tool_calls ?? [];
    for (const c of frames) {
      const keys = [...slots.keys()];
      // 有的上游只在第一帧给 index；后面缺 index 时续到最后一个槽位，
      // 否则每帧都会新建一个槽、拼不出完整调用。
      const idx =
        typeof c.index === "number" ? c.index : keys.length > 0 ? keys[keys.length - 1]! : 0;
      const slot = slots.get(idx) ?? { name: "", args: "" };
      const n = c.function?.name;
      if (typeof n === "string") slot.name += n;
      const a = c.function?.arguments;
      if (typeof a === "string") slot.args += a;
      else if (a && typeof a === "object") slot.args += JSON.stringify(a);
      slots.set(idx, slot);
    }
    // 极老的单调用增量字段
    if (frames.length === 0 && d.function_call) {
      const slot = slots.get(0) ?? { name: "", args: "" };
      if (typeof d.function_call.name === "string") slot.name += d.function_call.name;
      const a = d.function_call.arguments;
      if (typeof a === "string") slot.args += a;
      slots.set(0, slot);
    }
  }

  const calls = [...slots.values()]
    .map((c) => ({ name: c.name.trim(), args: c.args }))
    .filter((c) => c.name.length > 0);
  return { calls, error, reply, sse: true };
}

/**
 * 只给**验收脚本**用：把一段流式文本（SSE，或者被中转当成非流式回的一整份 JSON）
 * 直接解析成拼装好的工具调用。
 *
 * 生产代码走 `probeToolCalling` 就够了。导出它是因为验收脚本要断言
 * 「分片的名字 / 分片的 arguments 真的被拼成了一次完整调用」——
 * 只看 `streamToolCall` 那个布尔值，是验不出这个的。
 */
export function parseSseToolCalls(body: string): StreamParse {
  return parseStream(body);
}

/* ────────────────────────────────── 发请求 ────────────────────────────────── */

type Attempt = {
  /** HTTP 2xx */
  ok: boolean;
  /** HTTP 状态码；0 = 压根没连上 */
  status: number;
  body: string;
  /** 网络层失败的人话原因（连不上 / 超时） */
  transportError?: string;
  timedOut?: boolean;
};

async function postChat(
  base: string,
  key: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<Attempt> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    if (ctrl.signal.aborted) {
      const secs = Math.round(timeoutMs / 1000);
      return {
        ok: false,
        status: 0,
        body: "",
        timedOut: true,
        transportError: `等了 ${secs} 秒上游也没回（超时）—— 换条线路或别用这家吧`,
      };
    }
    const msg = (err as Error)?.message || "网络错误";
    return {
      ok: false,
      status: 0,
      body: "",
      transportError: `连不上上游：${msg}（检查地址、密钥、以及这台设备能不能上网）`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function httpErrorMessage(a: Attempt): string {
  if (a.transportError) return a.transportError;
  return `上游 HTTP ${a.status}：${bodyDigest(a.body)}`;
}

/**
 * 拼一个"全不通过"的结果 —— 界面兜底用（探测本身不抛异常，但界面不该赌这一点）。
 */
export function failedProbeResult(error: string): ToolProbeResult {
  return {
    ok: false,
    httpOk: false,
    nonStreamToolCall: false,
    streamToolCall: false,
    multiToolCall: false,
    latencyMs: 0,
    error,
    rawSnippet: "",
  };
}

/* ────────────────────────────────── 主函数 ────────────────────────────────── */

/**
 * 探一把：这把上游到底支不支持原生 `tools`？
 *
 * 永远 resolve（不抛）；任何失败都落在返回值里。
 *
 * @param opts.baseUrl 用户在设置里填的上游地址（可带 `/v1`，末尾斜杠会去掉）
 * @param opts.apiKey  用户的 key（只在本机这次请求里用，不发往别处）
 * @param opts.model   上游的**真实模型名**
 * @param opts.timeoutMs 单请求超时，默认 20 秒（验收脚本会调小，免得跑一分钟）
 */
export async function probeToolCalling(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}): Promise<ToolProbeResult> {
  const started = Date.now();
  const base = (opts.baseUrl ?? "").trim().replace(/\/+$/, "");
  const key = (opts.apiKey ?? "").trim();
  const model = (opts.model ?? "").trim();
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;

  const snippets: string[] = [];
  const problems: string[] = [];
  const remember = (a: Attempt) => {
    if (a.body) snippets.push(clip(a.body, SNIPPET_CHARS));
  };

  // 前置条件没填全就别发了 —— 发出去只会得到一句看不懂的英文报错
  if (!base) {
    return failedProbeResult(
      "还没填上游地址：去「我的 → 模型与用量 → 自定义上游」填一个 OpenAI 兼容地址。",
    );
  }
  if (!key) return failedProbeResult("还没填上游密钥：去「我的 → 模型与用量 → 自定义上游」填上。");
  if (!model) {
    return failedProbeResult("还没填上游模型名：点上面的「拉取可用模型」问对方要，或者手动填。");
  }

  /**
   * `tool_choice` 是个"锦上添花"的字段：绝大多数实现支持，但个别中转一看见它就 400。
   * 一旦探到这种情况就**整轮摘掉它**再发，免得把"其实支持工具"误判成"不支持"。
   */
  let toolChoiceOk = true;
  const payloadFor = (stream: boolean, tools: WireToolSpec[], content: string) => {
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content }],
      stream,
      tools,
      max_tokens: 512,
    };
    if (toolChoiceOk) body.tool_choice = "auto";
    return body;
  };

  /* ① 非流式 + 一个工具 */
  let first = await postChat(base, key, payloadFor(false, [TIME_TOOL], ASK_ONE), timeoutMs);
  remember(first);
  if (!first.ok && first.status === 400 && /tool_choice|tool choice/i.test(first.body)) {
    toolChoiceOk = false;
    first = await postChat(base, key, payloadFor(false, [TIME_TOOL], ASK_ONE), timeoutMs);
    remember(first);
  }

  const httpOk = first.ok;
  if (!first.ok) problems.push(httpErrorMessage(first));
  const p1 = first.ok ? parseChatBody(first.body) : null;
  const callsOne = p1?.calls ?? [];
  const nonStreamToolCall = callsOne.length > 0;
  if (p1) {
    if (p1.apiError) {
      problems.push(`上游 HTTP 200，但正文里报了错：${clip(p1.apiError, ERROR_BODY_CHARS)}`);
    } else if (p1.notJson) {
      problems.push(
        `上游回了 200，但正文不是 JSON${p1.html ? "（是个网页，多半是网关的错误页）" : ""}：${clip(first.body, ERROR_BODY_CHARS)}`,
      );
    }
  }

  /**
   * 连都没连上（超时 / 地址错 / key 错 / 被限流）就没必要再发后两条了 ——
   * 三条各等 20 秒的话用户要对着转圈等一分钟，那是折磨不是探测。
   * 400 则继续：万一是"只有非流式认 tools"或者"流式那条路好使"呢。
   */
  const unreachable =
    !first.ok &&
    (first.status === 0 ||
      first.status === 401 ||
      first.status === 403 ||
      first.status === 404 ||
      first.status === 429);

  /* ② 流式 + 一个工具（tool_calls 是分片增量，看能不能拼回来） */
  let streamToolCall = false;
  if (!unreachable) {
    const second = await postChat(base, key, payloadFor(true, [TIME_TOOL], ASK_ONE), timeoutMs);
    remember(second);
    if (!second.ok) problems.push(httpErrorMessage(second));
    else {
      const p2 = parseStream(second.body);
      streamToolCall = p2.calls.length > 0;
      if (p2.error) problems.push(`流式响应里上游报错：${clip(p2.error, ERROR_BODY_CHARS)}`);
    }
  }

  /* ③ 非流式 + 两个工具（看一次能不能返回多个 tool_call） */
  let callsTwo: ParsedCall[] = [];
  if (!unreachable) {
    const third = await postChat(
      base,
      key,
      payloadFor(false, [TIME_TOOL, TEMPERATURE_TOOL], ASK_TWO),
      timeoutMs,
    );
    remember(third);
    if (!third.ok) problems.push(httpErrorMessage(third));
    else {
      const p3 = parseChatBody(third.body);
      callsTwo = p3.calls;
      if (p3.apiError)
        problems.push(`上游 HTTP 200，但正文里报了错：${clip(p3.apiError, ERROR_BODY_CHARS)}`);
      else if (p3.notJson) {
        problems.push(`上游回了 200，但正文不是 JSON：${clip(third.body, ERROR_BODY_CHARS)}`);
      }
    }
  }

  const multiToolCall = callsTwo.length >= 2 || callsOne.length >= 2;
  const ok = nonStreamToolCall || streamToolCall || multiToolCall;

  /**
   * `error` 的含义：**失败原因**。三条都没通过时它是主因；
   * 部分通过时（比如流式好使、非流式不行）也把那条毛病说清楚，别让用户以为全绿。
   */
  let error: string | undefined;
  if (!ok) {
    error =
      problems[0] ??
      "上游收下了 tools 参数、也没报错，但三条请求都没返回结构化的 tool_call —— " +
        "它多半把工具调用当普通文字回了（或者这个模型压根没练过工具调用）。";
  } else if (problems.length > 0) {
    error = problems[0];
  }

  return {
    ok,
    httpOk,
    nonStreamToolCall,
    streamToolCall,
    multiToolCall,
    latencyMs: Date.now() - started,
    error,
    rawSnippet: clip(snippets.join("\n---\n"), SNIPPET_CHARS),
  };
}
