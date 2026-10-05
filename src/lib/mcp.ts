import { accessTokenFor, discover } from "./mcp-oauth";
import type { McpOAuth, McpServer, McpTool } from "./types";

/**
 * 默认不再预置任何 MCP 服务器。
 *
 * 以前这里写死了 6 条（长期记忆 / 网页抓取 / 工作区文件 / GitHub …），
 * 每条都只有名字和描述、背后没有任何连接，开关也只改本地布尔值 ——
 * 属于「能看不能用」。现在改成空列表，由用户在「工具 → MCP」里
 * 填自己的真实配置，并能用真实握手测试连通性。
 */
export const DEFAULT_MCP: McpServer[] = [];

/**
 * ── 为什么只支持 HTTP 一种传输方式 ────────────────────────────────
 *
 * 用户的要求："假的和实现不了的就不留了，别误导"。
 *
 *   · `stdio` —— **实现不了**。它要让服务端起一个本地子进程，
 *     浏览器和手机 App 都没有这个能力。摆在选项里只会让人以为能用。
 *   · `sse`（老的 HTTP+SSE 那版协议）—— **删掉了**。按真协议写是能写
 *     （先 GET 挂着长连接，等服务端推 endpoint 事件，再往那儿 POST），
 *     但这台机器上**没法实测**：沙箱出不了网，手里也没有老式 SSE 服务器
 *     可以连。按项目的规矩"看不到截图就别说完事"，留一个没验证过的
 *     传输方式，就是用户最反感的"看起来能用、其实不行"。
 *     以后真要支持，拿一台真服务器验过再加回来。
 *
 * 所以只剩 `http`（Streamable HTTP）—— 现在服务端的主流形式，
 * 而且是**浏览器和手机 App 能直连**的那种，能端到端验证。
 */

/** 客户端自报家门，服务端会记下来，也会在它自己的日志里显示 */
const CLIENT_INFO = { name: "qidao", version: "1.0.0" };

/**
 * 我们想用的协议版本。
 *
 * 服务端不认这个版本时**不是报错**，而是按协议回一个"反报价"
 * （counter-offer，通常是它支持的最新版）。所以下面以**服务端回的那个**为准，
 * 后面的请求都带它 —— 这正是之前漏掉的一环。
 */
const WANT_PROTOCOL = "2025-06-18";

/**
 * 一次探测最多等多久。
 *
 * 为什么要写死超时：这个 App 在语音那批 bug 上栽过一次 ——
 * 「没有超时」会让界面永远转圈，用户只能杀掉 App。
 * 探测同样是网络请求，一样要有底线。
 */
const TIMEOUT_MS = 20000;

/** 工具调用最多等多久（工具可能真的在干活，比握手宽松些） */
const TOOL_TIMEOUT_MS = 45000;

/** 工具返回的内容最多留多长 —— 再长就截断，否则会灌爆提示词和界面 */
const MAX_TOOL_TEXT = 2000;

/* ────────────────────────── 类型 ────────────────────────── */

type RpcMessage = {
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string } | null;
};

export type McpProbe = {
  ok: boolean;
  /** 给人看的多行说明（直接显示在界面上） */
  message: string;
  /** 真正从 tools/list 拿到的工具定义（名字 + 说明 + 参数结构） */
  tools: McpTool[];
  serverName?: string;
  serverVersion?: string;
  /** 跟服务端协商出来的协议版本 */
  protocolVersion?: string;
  /**
   * 对方要求认证，而且它是标准 OAuth 服务 → 界面给一个「去授权」的入口。
   * 只是"要令牌"还不够 —— 还得确认对方有 OAuth 元数据，否则只能手填令牌。
   */
  needsAuth?: boolean;
  /** 探测过程中续期出来的新令牌，由调用方写回记录（本文件不碰 store，避免循环依赖） */
  oauthPatch?: Partial<McpOAuth>;
};

/** 调工具的结果（给模型看的那份文本也在这里） */
export type ToolCallResult = {
  ok: boolean;
  text: string;
  oauthPatch?: Partial<McpOAuth>;
};

/* ────────────────────────── 小工具 ────────────────────────── */

/** 把「每行一个 Key: Value」解析成请求头。空行 / 没有冒号的行直接跳过。 */
function parseHeaders(text: string): Headers {
  const headers = new Headers();
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return headers;
}

/** 拼一个 JSON-RPC 请求体。`id` 省略 = 通知（notification）。 */
function rpc(method: string, id?: number): string {
  return JSON.stringify(
    id === undefined
      ? { jsonrpc: "2.0", method }
      : {
          jsonrpc: "2.0",
          id,
          method,
          params:
            method === "initialize"
              ? { protocolVersion: WANT_PROTOCOL, capabilities: {}, clientInfo: CLIENT_INFO }
              : {},
        },
  );
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 800);
  } catch {
    return "";
  }
}

/** 把一段文本按 JSON 解析后塞进结果里（单个对象或批次数组都吃）。 */
function pushJson(out: RpcMessage[], text: string) {
  let v: unknown;
  try {
    v = JSON.parse(text) as unknown;
  } catch {
    return;
  }
  if (Array.isArray(v)) out.push(...(v as RpcMessage[]));
  else if (v && typeof v === "object") out.push(v as RpcMessage);
}

/** 从一段可能是 JSON、也可能是 SSE 的响应体里，把 JSON-RPC 消息挑出来。 */
function messagesOf(text: string): RpcMessage[] {
  const trimmed = text.trim();
  const out: RpcMessage[] = [];

  /*
    情况一：SSE 事件流。
    Streamable HTTP **允许**用事件流回一条响应（服务端自己选，客户端必须都认）。
    注意这跟上面删掉的「SSE 传输方式」不是一回事：这是同一个 POST 的响应格式，
    不是另开一条长连接，所以照样要走我们这套一次性请求。
  */
  if (trimmed.startsWith("event:") || /(^|\n)data:/.test(trimmed)) {
    for (const chunk of trimmed.replace(/\r\n/g, "\n").split("\n\n")) {
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("\n");
      // 解析不出来的（比如服务端先推的一条通知）直接跳过
      if (data) pushJson(out, data);
    }
    return out;
  }

  // 情况二：普通 JSON
  pushJson(out, trimmed);
  return out;
}

/** 在解析出来的消息里找 id 对得上的那条。 */
function pick(messages: RpcMessage[], id: number): RpcMessage | null {
  return (
    messages.find((m) => m.id === id) ??
    messages.find((m) => m.result !== undefined || m.error) ??
    null
  );
}

function rpcErrorText(msg: RpcMessage | null): string {
  if (!msg) return "对方回了一段看不懂的内容（既不是 JSON-RPC，也解析不出结果）";
  if (msg.error) {
    const code = msg.error.code === undefined ? "" : `（${msg.error.code}）`;
    return `对方返回错误${code}：${msg.error.message ?? "没说原因"}`;
  }
  return "对方回了话，但没有 result 也没有 error";
}

/**
 * HTTP 层的错误 → 说人话。
 *
 * 这里每一条都是「用户看到之后知道该去改什么」的，不是把状态码甩脸上。
 */
function httpFailure(status: number, body: string): string {
  const detail = body.trim() ? `\n${body.trim()}` : "";
  if (status === 401 || status === 403) {
    return `HTTP ${status} —— 对方要求认证。\n回到编辑页，在「请求头」里加一行：Authorization: Bearer <你的令牌>${detail}`;
  }
  if (status === 404) {
    return `HTTP 404 —— 这个地址上没有 MCP 服务。\n检查地址是不是写全了（很多服务是 https://xxx/mcp，不是根路径）。${detail}`;
  }
  if (status === 405) {
    return `HTTP 405 —— 对方不接受 POST。\n这多半是一个「老式 SSE」服务，栖岛现在不支持它（见 lib/mcp.ts 开头的说明）。${detail}`;
  }
  if (status === 406 || status === 415) {
    return `HTTP ${status} —— 对方不接受我们的请求格式或协议版本。\n可能是这个服务只支持更新的 MCP 协议。${detail}`;
  }
  return `HTTP ${status}${detail}`;
}

/**
 * 网络层失败 → 说人话。
 *
 * 浏览器里 `fetch` 抛 `TypeError: Failed to fetch` 时**看不出真实原因**
 * （跨域被拦、地址不通、证书不对，报的都是同一句）。所以这里把可能性列全，
 * 而不是含糊说一句"请求失败"。
 */
function networkFailure(err: unknown, url: string): string {
  const msg = (err as Error)?.message || String(err);
  if (/abort/i.test(msg)) {
    return `等太久没回应，先断了。\n对方可能很慢、也可能卡住了；网络不稳时也会这样。`;
  }
  const origin = typeof location === "undefined" ? "本 App" : location.origin;
  return [
    `连不上：${msg}`,
    "",
    "浏览器里看不到真实原因，只可能是这三样：",
    `1. 对方没开跨域（CORS）—— 手机上最常见的卡点。服务器要允许来自 ${origin} 的请求`,
    `2. 地址写错 / 服务没起来（先确认 ${url} 在浏览器里能打开）`,
    "3. 手机这边没网（或者是 https 证书有问题）",
  ].join("\n");
}

/* ────────────────────── 会话与请求头 ────────────────────── */

/**
 * 一次握手拿到的会话。
 *
 * `sessionId` 是**服务端有状态时**才给的；后面每个请求都要带回去
 * （旧代码漏的就是这一环）。`protocolVersion` 同样要带，且以服务端回的为准。
 */
type Session = {
  sessionId: string;
  protocolVersion: string;
  serverInfo?: { name?: string; version?: string };
  at: number;
};

/**
 * 会话缓存。
 *
 * 为什么需要：模型可能**连着调两次工具**，每次都重新握手（四个来回）
 * 又慢又啰嗦。同一条服务器短时间内复用会话。
 */
const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 5 * 60_000;

/**
 * 请求头就绪：解析用户填的，必要时补上 OAuth 令牌。
 *
 * ⚠️ 用户自己在「请求头」里写了 Authorization 就不覆盖 —— 那是手动令牌，
 * 优先级更高。
 */
async function headersFor(
  server: McpServer,
): Promise<{ headers: Headers; oauthPatch?: Partial<McpOAuth> }> {
  const headers = parseHeaders(server.headersText);
  let oauthPatch: Partial<McpOAuth> | undefined;
  if (!headers.has("authorization")) {
    const t = await accessTokenFor(server);
    if (t.token) headers.set("authorization", `Bearer ${t.token}`);
    if (t.patch) oauthPatch = t.patch;
  }
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  if (!headers.has("accept")) headers.set("accept", "application/json, text/event-stream");
  return { headers, oauthPatch };
}

type OpenResult =
  | { ok: true; session: Session; after: Headers; noteFailed: string }
  | { ok: false; status: number; message: string };

/**
 * 握手的前两步：`initialize` → `notifications/initialized`。
 *
 * 「测试连接」和「真调工具」**共用这一份** —— 这个 App 吃过"同一个零件
 * 长出多套写法"的苦，握手这种精细活更不能有第二份实现。
 *
 * ⚠️ 第 1 步**不能**提前带 `MCP-Protocol-Version`：协议是先协商再带的
 * （`verify-mcp.mjs` 专门盯着这条）。
 */
async function openSession(url: string, headers: Headers, signal: AbortSignal): Promise<OpenResult> {
  /* 第 1 步 · initialize */
  const initRes = await fetch(url, { method: "POST", headers, body: rpc("initialize", 1), signal });
  if (!initRes.ok) {
    return {
      ok: false,
      status: initRes.status,
      message: httpFailure(initRes.status, await safeText(initRes)),
    };
  }

  /**
   * 会话号：服务端有状态时会发，后面每个请求都要带回去（之前漏掉的就是它）。
   *
   * ⚠️ 浏览器特有的坑：跨域请求**默认读不到响应头**。服务端必须在
   * `Access-Control-Expose-Headers` 里把 `Mcp-Session-Id` 暴露出来，
   * 这段代码才拿得到它 —— 否则这里是空的，后面的 tools/list 就会被
   * 服务端当成"没带会话的新请求"拒掉。真连不通又查不出原因时，先看这个头。
   */
  const sessionId = initRes.headers.get("mcp-session-id") ?? "";

  const initMsg = pick(messagesOf(await initRes.text()), 1);
  if (!initMsg || initMsg.error) {
    return { ok: false, status: 200, message: rpcErrorText(initMsg) };
  }

  const result = (initMsg.result ?? {}) as {
    protocolVersion?: string;
    serverInfo?: { name?: string; version?: string };
  };
  /** 以**服务端回的版本**为准（它可能给我们一个反报价）。 */
  const protocolVersion =
    initRes.headers.get("mcp-protocol-version") || result.protocolVersion || WANT_PROTOCOL;

  const after = new Headers(headers);
  if (sessionId) after.set("mcp-session-id", sessionId);
  after.set("mcp-protocol-version", protocolVersion);

  /* 第 2 步 · notifications/initialized（无 id 的通知） */
  let noteFailed = "";
  try {
    const noteRes = await fetch(url, {
      method: "POST",
      headers: after,
      body: rpc("notifications/initialized"),
      signal,
    });
    if (!noteRes.ok) noteFailed = `（对方对 initialized 回了 HTTP ${noteRes.status}）`;
  } catch (err) {
    if (signal.aborted) throw err;
    noteFailed = `（initialized 没发出去：${(err as Error).message}）`;
  }

  return {
    ok: true,
    noteFailed,
    after,
    session: {
      sessionId,
      protocolVersion,
      serverInfo: result.serverInfo,
      at: Date.now(),
    },
  };
}

/* ────────────────────── 测试连接（握手 + 工具清单） ────────────────────── */

/**
 * 真发一次 MCP 握手（Streamable HTTP，四个来回）：
 *
 *   1. POST initialize               → 拿服务端身份 + **会话号** + 协商协议版本
 *   2. POST notifications/initialized → 通知（没有 id），告诉对方"我准备好了"
 *   3. POST tools/list                → **这才是"能用"的证据：它到底有哪些工具**
 *
 * 之前只做了第 1 步，还把服务端给的会话号丢掉了 —— 所以界面上的"握手成功"
 * 只代表"对方回了一句话"，不代表能用。
 */
export async function probeServer(server: McpServer): Promise<McpProbe> {
  const url = server.url.trim();
  if (!url) return { ok: false, tools: [], message: "还没填地址。" };

  /*
    历史数据兜底：界面已经不再提供 sse / stdio，
    但老记录里可能还存着。别假装能连，如实说清楚该怎么改。
  */
  if (server.transport !== "http") {
    return {
      ok: false,
      tools: [],
      message: [
        `这条记录是「${server.transport}」传输方式，栖岛现在不支持它。`,
        server.transport === "stdio"
          ? "stdio 要起本地进程，网页和手机 App 里做不到。"
          : "SSE 是老的传输方式，已经在客户端里去掉了。",
        "让对方给一个 HTTP（Streamable HTTP）地址，在编辑页改一下就能用。",
      ].join("\n"),
    };
  }

  const { headers, oauthPatch } = await headersFor(server);
  /** 探测失败的正常返回，顺带把续期出来的令牌带上 */
  const done = (r: McpProbe): McpProbe => (oauthPatch ? { ...r, oauthPatch } : r);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const signal = controller.signal;

  try {
    const opened = await openSession(url, headers, signal);
    if (!opened.ok) {
      /*
        401 = 对方要认证。这里多做一步：判断它是不是**标准 OAuth 服务**
        （有受保护资源元数据）。是的话界面上给「去授权」；不是就只能手填令牌。
        这两种情况的用户体验差很远，所以值得多花两个 GET 去分辨。

        ⚠️ 读不到 `WWW-Authenticate`（跨域响应只暴露白名单响应头），
        所以这里传进去的是 null，让 discover 按 RFC 9728 的规则猜地址。
      */
      let needsAuth = false;
      if (opened.status === 401) {
        try {
          await discover(server, null);
          needsAuth = true;
        } catch {
          /* 不是标准 OAuth 服务 —— 保持"只能手填令牌"的说法 */
        }
      }
      return done({
        ok: false,
        tools: [],
        needsAuth,
        message: needsAuth
          ? `${opened.message}\n\n不过它是标准 OAuth 服务 —— 回列表点「去授权」就行，不用手填令牌。`
          : opened.message,
      });
    }

    const { session, after, noteFailed } = opened;

    /* 第 3 步 · tools/list */
    const listRes = await fetch(url, {
      method: "POST",
      headers: after,
      body: rpc("tools/list", 2),
      signal,
    });
    if (!listRes.ok) {
      return done({
        ok: false,
        tools: [],
        message: `握手过了，但问不到工具清单。\n${httpFailure(listRes.status, await safeText(listRes))}`,
        serverName: session.serverInfo?.name,
        serverVersion: session.serverInfo?.version,
        protocolVersion: session.protocolVersion,
      });
    }

    const listMsg = pick(messagesOf(await listRes.text()), 2);
    if (!listMsg || listMsg.error) {
      return done({
        ok: false,
        tools: [],
        message: `握手过了，但拿不到工具清单：\n${rpcErrorText(listMsg)}`,
        serverName: session.serverInfo?.name,
        protocolVersion: session.protocolVersion,
      });
    }

    const tools = toolsOf(listMsg.result);
    // 会话留下来复用：模型接下来真调工具时不用重新握手
    sessions.set(server.id, session);
    return done({
      ok: true,
      tools,
      serverName: session.serverInfo?.name,
      serverVersion: session.serverInfo?.version,
      protocolVersion: session.protocolVersion,
      message: [
        `握手成功${session.serverInfo?.name ? ` · 服务端 ${session.serverInfo.name}${session.serverInfo.version ? ` ${session.serverInfo.version}` : ""}` : ""}`,
        `协议 ${session.protocolVersion}${session.sessionId ? ` · 会话 ${session.sessionId.slice(0, 12)}…` : "（对方无状态，没有会话号）"}`,
        tools.length
          ? `拿到 ${tools.length} 个工具：${tools.map((t) => t.name).slice(0, 12).join("、")}${tools.length > 12 ? " …" : ""}`
          : "连通，但这个服务器没暴露任何工具",
        noteFailed,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  } catch (err) {
    return done({ ok: false, tools: [], message: networkFailure(err, url) });
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/**
 * 把「工具数组」抹平成 `McpTool[]` —— **一处实现，谁都用它**。
 *
 * 要容忍两种历史形态：
 *   · 老存档：`["remember","recall"]`（只有名字，没有说明和参数）
 *   · 服务端 `tools/list` 的原样结果（对象数组）
 * 老数据不转的话：界面渲染出一排空白、提示词里写出一串 `- undefined`、
 * 模型更调不动。所以 store 的 `merge` 里也调它做一次迁移。
 */
export function normalizeTools(input: unknown): McpTool[] {
  if (!Array.isArray(input)) return [];
  const out: McpTool[] = [];
  for (const raw of input) {
    if (typeof raw === "string") {
      if (raw) out.push({ name: raw });
      continue;
    }
    const o = (raw ?? {}) as { name?: unknown; description?: unknown; inputSchema?: unknown };
    if (typeof o.name !== "string" || !o.name) continue;
    const tool: McpTool = { name: o.name };
    if (typeof o.description === "string") tool.description = o.description;
    if (o.inputSchema !== undefined) tool.inputSchema = o.inputSchema;
    out.push(tool);
  }
  return out;
}

function toolsOf(result: unknown): McpTool[] {
  return normalizeTools((result as { tools?: unknown })?.tools);
}

/* ────────────────────── 真调一个工具 ────────────────────── */

/**
 * 调一个 MCP 工具（JSON-RPC 的 `tools/call`）—— **"模型真能调用"落地的那一步**。
 *
 * 复用已握手的会话；会话过期（服务端重启、超时、无状态服务端换了实例）
 * 就**重新握手再试一次** —— 用户不该因为"会话过期"这种内部细节而失败一次。
 */
export async function callTool(
  server: McpServer,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<ToolCallResult> {
  const url = server.url.trim();
  if (!url) return { ok: false, text: "还没填地址。" };
  if (server.transport !== "http") {
    return { ok: false, text: `这条记录是「${server.transport}」传输方式，栖岛不支持它。` };
  }

  const { headers, oauthPatch } = await headersFor(server);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);
  const signal = controller.signal;

  const callBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: tool, arguments: args },
  });

  try {
    // 最多两次：第一次用缓存会话；失败就丢掉会话、重新握手再来一次
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const cached = attempt === 0 ? sessions.get(server.id) : undefined;
      let after: Headers;

      if (cached && Date.now() - cached.at < SESSION_TTL_MS) {
        after = new Headers(headers);
        if (cached.sessionId) after.set("mcp-session-id", cached.sessionId);
        after.set("mcp-protocol-version", cached.protocolVersion);
      } else {
        const opened = await openSession(url, headers, signal);
        if (!opened.ok) return { ok: false, text: opened.message, oauthPatch };
        sessions.set(server.id, opened.session);
        after = opened.after;
      }

      const res = await fetch(url, { method: "POST", headers: after, body: callBody, signal });
      const raw = await res.text();

      if (!res.ok) {
        // 会话过期时服务端常回 400/404 —— 丢掉缓存重来一次
        sessions.delete(server.id);
        if (attempt === 0) continue;
        return { ok: false, text: httpFailure(res.status, raw), oauthPatch };
      }

      const msg = pick(messagesOf(raw), 3);
      if (!msg) {
        return {
          ok: false,
          text: "对方回了一段看不懂的内容（既不是 JSON-RPC，也解析不出结果）",
          oauthPatch,
        };
      }
      if (msg.error) return { ok: false, text: rpcErrorText(msg), oauthPatch };

      return { ...callResultText(msg.result), oauthPatch };
    }
    return { ok: false, text: "重试之后还是没调成功。", oauthPatch };
  } catch (err) {
    return { ok: false, text: networkFailure(err, url), oauthPatch };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/**
 * 把 `tools/call` 的结果转成人能看的文本。
 *
 * MCP 的返回长这样：`{ content: [{type:"text",text:"…"}, …], isError?, structuredContent? }`。
 * `content` 里可能有图片等非文本块 —— 那种就说明一句"返回了图片"，别装作看不见。
 */
function callResultText(result: unknown): { ok: boolean; text: string } {
  const r = (result ?? {}) as { content?: unknown; isError?: unknown; structuredContent?: unknown };

  const parts: string[] = [];
  if (Array.isArray(r.content)) {
    for (const block of r.content) {
      const b = block as { type?: string; text?: string };
      if (b?.type === "text" && typeof b.text === "string") parts.push(b.text);
      else if (b?.type) parts.push(`（对方返回了一个 ${b.type} 类型的块，这里显示不了）`);
    }
  }
  // 有些服务端只在 structuredContent 里放结构化结果
  if (!parts.length && r.structuredContent !== undefined) {
    parts.push(JSON.stringify(r.structuredContent, null, 1));
  }
  if (!parts.length) parts.push("（工具跑完了，但没有返回任何内容）");

  let text = parts.join("\n").trim();
  if (text.length > MAX_TOOL_TEXT) text = `${text.slice(0, MAX_TOOL_TEXT)}\n…（结果太长，截断了）`;

  return { ok: r.isError !== true, text };
}
