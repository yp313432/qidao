/**
 * 分片 tool_calls 装配层 —— 把流式响应里一帧一帧的 `delta` 拼成**完整的**工具调用。
 *
 * 为什么单独一个模块：`tool_calls` 是**分片增量**传的 ——
 * 函数名可能被切成 `get_` + `time`，`arguments` 的 JSON 文本也可能被切成三段，
 * 而且**后半段经常不带 `index`**。只看某一帧永远拼不出一个能用的调用，
 * 所以主链路（chat-client）要一边收帧一边往累加器里喂，收完流再问它要结果。
 *
 * 这里的语义是**照着 `src/lib/tool-probe.ts`（上一个窗口真机实测出来的规则）抄的**，
 * 一个字都不自己发明：
 *   · 按 `index` 归并；缺 `index` 的帧**续到最后一个槽位**（否则每帧新建槽，永远拼不出来）
 *   · `name` / `arguments` 都是**字符串拼接**（不是覆盖）
 *   · `arguments` 是对象时先 `JSON.stringify` 再拼
 *   · **没有函数名的空壳**（`tool_calls: [{}]`）不算调用 —— 用 `dropped()` 报出丢掉了几个
 *   · 认老式 `function_call`（仅当这一帧没有 `tool_calls` 时）
 *   · 中转无视 `stream:true`、直接回一整份非流式 JSON 时，按非流式解析并把 `sse` 置 false
 *   · HTML 错误页 / 空 body / 破 JSON / 错误帧 —— **永不抛异常**
 *
 * ⚠️ 这个文件必须能在**纯 node** 里跑（`verify-tool-calls.mjs` 用
 * `node --experimental-strip-types` 直接跑它）：所以**零 import** ——
 * 不 import 任何东西、不用路径别名 `@/…`、不碰任何浏览器 API、不依赖 DOM 类型。
 * 别为了好看加 import。
 */

/* ────────────────────────── 线上格式（OpenAI 兼容） ────────────────────────── */

/** 流式增量里的一个 tool_call：可能只有半截名字 / 半截参数，甚至只是个空壳 */
export type WireToolCall = {
  /** 流式增量里用它认"这坨是第几个调用"；很多上游只在第一帧给 */
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string | Record<string, unknown> };
};

/** 拼好的一个工具调用：`name` 完整、`args` 是完整的 JSON 文本（可能是空串） */
export type AssembledToolCall = { index: number; id?: string; name: string; args: string };

/**
 * 流式累加器：把每一帧的 `delta` 喂进来，收完流之后问它要拼好的调用。
 *
 * 典型用法（主链路）：
 * ```ts
 * const acc = createDeltaAccumulator();
 * // 边收边喂（每一帧 SSE 的 delta 原样丢进来）
 * acc.push({ tool_calls: [{ index: 0, function: { name: "get_", arguments: '{"time' } }] });
 * // 收完流：
 * const calls = acc.calls(); // [{ index, id, name: "get_time", args: '{"timezone":"Asia/Shanghai"}' }]
 * const lost = acc.dropped(); // 这一轮里有几个"没有函数名"的空壳被丢掉了
 * ```
 */
export type DeltaAccumulator = {
  push(delta: {
    content?: string | null;
    tool_calls?: WireToolCall[];
    function_call?: { name?: string; arguments?: string | Record<string, unknown> };
  }): void;
  calls(): AssembledToolCall[];
  dropped(): number;
};

/** 一个槽位：某个 `index` 上正在拼的那个调用 */
type Slot = { index: number; id: string; name: string; args: string };

type WireFunctionCall = { name?: string; arguments?: string | Record<string, unknown> };

type WireMessage = {
  content?: string | null;
  tool_calls?: WireToolCall[];
  /** 极老的单调用字段，个别中转还在用 */
  function_call?: WireFunctionCall;
};

type WireChoice = {
  index?: number;
  message?: WireMessage;
  delta?: WireMessage;
  finish_reason?: string | null;
};

type WireBody = {
  choices?: WireChoice[];
  error?: { message?: string } | string;
};

/* ────────────────────────────────── 小工具 ────────────────────────────────── */

function looksLikeHtml(text: string): boolean {
  return /^\s*</.test(text ?? "");
}

/** 参数文本：字符串直接用；对象先 stringify；其余当空串（无参调用是允许的） */
function argsText(fn: WireFunctionCall | undefined): string {
  const a = fn?.arguments;
  if (typeof a === "string") return a;
  if (a && typeof a === "object") return JSON.stringify(a);
  return "";
}

/* ────────────────────────────── 累加器（增量拼装） ────────────────────────────── */

/**
 * 创建一个**流式累加器**。
 *
 * 语义与 `tool-probe.ts` 的 `parseStream()` 完全一致（那是上个窗口实测出来的）：
 * `index` 有就按 `index` 归并，没有就续到**最后一个槽位**；
 * `name` / `arguments` 一律**字符串拼接**；空壳（没有函数名）最后被过滤掉。
 */
export function createDeltaAccumulator(): DeltaAccumulator {
  /** 槽位按 index 存；Map 的插入顺序就是 tool-probe 里 `keys` 的顺序 */
  const slots = new Map<number, Slot>();

  const newSlot = (index: number): Slot => {
    const slot: Slot = { index, id: "", name: "", args: "" };
    slots.set(index, slot);
    return slot;
  };

  const frameInto = (c: WireToolCall | undefined): void => {
    const keys = [...slots.keys()];
    // 有的上游只在第一帧给 index；后面缺 index 时续到最后一个槽位，
    // 否则每帧都会新建一个槽、拼不出完整调用。
    const idx =
      typeof c?.index === "number" ? c.index : keys.length > 0 ? keys[keys.length - 1] : 0;
    const slot = slots.get(idx) ?? newSlot(idx);

    const n = c?.function?.name;
    if (typeof n === "string") slot.name += n;

    const a = c?.function?.arguments;
    if (typeof a === "string") slot.args += a;
    else if (a && typeof a === "object") slot.args += JSON.stringify(a);

    // id 只认第一次拿到的非空值（后面几帧重复给同一个 id 不算变化）
    if (typeof c?.id === "string" && c.id && !slot.id) slot.id = c.id;
  };

  return {
    push(delta): void {
      const d = delta ?? {};
      const frames = d.tool_calls ?? [];
      for (const c of frames) frameInto(c);

      // 极老的单调用增量字段：**只有这一帧完全没有 tool_calls 时才认**（跟 tool-probe 一致）
      if (frames.length === 0 && d.function_call) {
        const slot = slots.get(0) ?? newSlot(0);
        const n = d.function_call.name;
        if (typeof n === "string") slot.name += n;
        const a = d.function_call.arguments;
        if (typeof a === "string") slot.args += a;
        else if (a && typeof a === "object") slot.args += JSON.stringify(a);
      }
    },

    /**
     * 到此刻为止拼好的调用（**快照**，可以反复叫）：
     * 名字拼完、`name` 去掉首尾空白、按 `index` 升序；**没有函数名的空壳不在这里**。
     */
    calls(): AssembledToolCall[] {
      const out: AssembledToolCall[] = [];
      for (const s of slots.values()) {
        const name = s.name.trim();
        if (!name) continue; // 空壳不算调用
        const call: AssembledToolCall = { index: s.index, name, args: s.args };
        if (s.id) call.id = s.id;
        out.push(call);
      }
      return out.sort((a, b) => a.index - b.index);
    },

    /**
     * 被**丢掉**的调用个数 —— 到此刻为止仍然**没有函数名**的槽位（空壳）有几个。
     *
     * 注意语义：它算的是"现在还是空壳"的个数，不是"曾经空过"。
     * 分片的名字后半截到达之前槽位是空的，那不算丢（名字补上就不算丢了）——
     * 只有收完流还是没名字的，才是真丢了、需要提醒用户。
     */
    dropped(): number {
      let n = 0;
      for (const s of slots.values()) if (s.name.trim().length === 0) n += 1;
      return n;
    },
  };
}

/* ──────────────────────────── 非流式响应（整份 JSON） ──────────────────────────── */

/**
 * 从一条 assistant 消息里读结构化工具调用（**非流式**那条路）。
 *
 * 非流式的 `tool_calls` **不带 `index`**、每一项都是**完整且互相独立**的调用，
 * 所以这里**不能**走"缺 index 就续到上一个槽位"的增量逻辑（那样两个调用会被并成一个）。
 * 要求**必须有函数名**才算数：`tool_calls: [{}]` 这种空壳根本没法用。
 */
function readToolCalls(msg: WireMessage | undefined): AssembledToolCall[] {
  if (!msg) return [];
  const out: AssembledToolCall[] = [];
  const list = msg.tool_calls ?? [];
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i];
    const name = typeof c?.function?.name === "string" ? c.function.name.trim() : "";
    if (!name) continue;
    const call: AssembledToolCall = {
      index: typeof c?.index === "number" ? c.index : i,
      name,
      args: argsText(c?.function),
    };
    if (typeof c?.id === "string" && c.id) call.id = c.id;
    out.push(call);
  }
  if (
    out.length === 0 &&
    typeof msg.function_call?.name === "string" &&
    msg.function_call.name.trim()
  ) {
    out.push({ index: 0, name: msg.function_call.name.trim(), args: argsText(msg.function_call) });
  }
  return out;
}

type BodyParse = {
  calls: AssembledToolCall[];
  /** 上游在 JSON 正文里回的错误（有的中转 HTTP 200 里塞 error） */
  apiError?: string;
  /** 压根不是 JSON（HTML 错误页、空正文…） */
  notJson: boolean;
  html: boolean;
  /** 纯文字回复（没调工具时它到底说了啥，方便诊断） */
  reply: string;
};

/** 解析一份**非流式**响应体 —— 空 body / HTML / 破 JSON 都只是"没调用"，不抛 */
function parseChatBody(body: string): BodyParse {
  const text = (body ?? "").trim();
  if (!text) return { calls: [], notJson: true, html: false, reply: "" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { calls: [], notJson: true, html: looksLikeHtml(text), reply: "" };
  }
  // `JSON.parse("null")` / `"123"` 也会成功，但不是对象 —— 当成"不是接口数据"，别让它炸
  if (!parsed || typeof parsed !== "object") {
    return { calls: [], notJson: true, html: false, reply: "" };
  }

  const j = parsed as WireBody;
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

/* ──────────────────────────────── SSE 流解析 ──────────────────────────────── */

export type ParseSseResult = {
  /** 拼好的调用（`name` 完整、`args` 是完整 JSON 文本） */
  calls: { name: string; args: string }[];
  /** 流里 / 正文里出现的错误 */
  error?: string;
  /** 没调工具时它说了什么（正文增量拼起来的那句话） */
  reply: string;
  /** 到底是不是 SSE（有的中转忽略 stream:true，直接回一整份 JSON） */
  sse: boolean;
};

/**
 * 解析一段**流式响应文本**：`tool_calls` 是分片增量传的 ——
 * 第一帧给 `id` 和函数名的一半，后面几帧往下续名字和 `arguments` 字符串。
 *
 * 没有 `data:` 前缀时按**非流式**解析（`sse:false`）——
 * 有的中转干脆无视 `stream:true`，回一整份 JSON；总比硬报"流式不支持"准确。
 */
function parseStream(raw: string): ParseSseResult {
  const text = typeof raw === "string" ? raw : "";
  const dataLines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("data:"));

  // 没有 data: 前缀 —— 大概率是中转把流式当非流式回了
  if (dataLines.length === 0) {
    const p = parseChatBody(text);
    return {
      calls: p.calls.map((c) => ({ name: c.name, args: c.args })),
      error: p.apiError,
      reply: p.reply,
      sse: false,
    };
  }

  const acc = createDeltaAccumulator();
  let reply = "";
  let error: string | undefined;

  for (const line of dataLines) {
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue; // 半截帧 / 心跳：跳过，别把整条流判死
    }
    if (!parsed || typeof parsed !== "object") continue;

    const j = parsed as WireBody;
    if (j.error) {
      const m = typeof j.error === "string" ? j.error : (j.error.message ?? "上游报错");
      if (!error) error = m;
      continue;
    }
    const d = j.choices?.[0]?.delta;
    if (!d) continue;
    if (typeof d.content === "string") reply += d.content;
    acc.push(d);
  }

  return {
    calls: acc.calls().map((c) => ({ name: c.name, args: c.args })),
    error,
    reply,
    sse: true,
  };
}

/**
 * 把一段响应文本（SSE，或者被中转当成非流式回的一整份 JSON）解析成拼好的工具调用。
 *
 * **永不抛异常**：HTML 错误页、空 body、破 JSON、`data:` 后面跟着半截内容，
 * 全都落在返回值里（`calls: []` / `error` / `sse`），不会让调用方崩。
 */
export function parseSseToolCalls(body: string): ParseSseResult {
  return parseStream(body);
}
