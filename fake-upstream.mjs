/**
 * 本地假上游 —— 「OpenAI 兼容中转 + function calling」的**离线替身**。
 *
 * 为什么要有它：接原生 tools 这条路必须能在**不连外网、不花用户额度**的前提下
 * 反复验证 —— 尤其是"流式 tool_calls 是分片增量"这种真机才暴露的坑。
 * 这个假上游把各种上游的样子固定下来（正常 / 分片 / 两个调用 / 400 不支持 tools /
 * 只回正文 / HTML 错误页 / 一个字都不回），谁都能复现。
 *
 * 端口：默认 **127.0.0.1:4632**（`FAKE_UPSTREAM_PORT` 或 `port` 选项可改，传 0 则随机）。
 *
 * 模式写在**路径**里当开关（跟 verify-tool-probe.mjs 里的假上游一个套路）：
 *
 *   POST /<mode>/v1/chat/completions
 *   POST /<mode>/chat/completions
 *
 * 支持的 mode：
 *   · ok-single      SSE，一帧就给全一个 get_time 调用 → finish_reason:"tool_calls" → [DONE]
 *   · ok-fragmented  SSE，函数名切 "get_" + "time"，arguments 切 3 段，**后半段故意不给 index**
 *   · ok-two         SSE，一次两个调用（index 0 和 1），各自也分片
 *   · no-tools-400   HTTP 400，{"error":{"message":"tools is not supported by this model"}}
 *   · text-only      SSE，只有正文（"大概是下午三点吧。"），没有任何 tool_call
 *   · html-error     HTTP 502，content-type text/html，body 是一个 HTML 错误页
 *   · timeout        不响应、连接挂着（一个字节都不写，直到客户端断开）
 *
 * 每个 mode 收到的请求都记在内存里：完整请求体（解析后的对象 + 原始文本）、
 * `authorization` 头、`content-type`、以及**是不是流式**（`stream === true`）。
 *
 * 两种跑法：
 *   ① 当脚本直接跑（给 Playwright / 手工联调用）：
 *        node fake-upstream.mjs
 *      → 打印一行监听地址，保持不退出（Ctrl+C 停）。
 *   ② 在别的脚本里 import 出来自己起停（验收脚本就是这么用的）：
 *        import { startFakeUpstream } from "./fake-upstream.mjs";
 *        const up = await startFakeUpstream();     // → { url, hits, close, ... }
 *        ... await up.close();
 */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

export const HOST = "127.0.0.1";
export const PORT = 4632;

/** 支持的全部 mode（顺序固定，方便断言"一个都没漏"） */
export const MODES = [
  "ok-single",
  "ok-fragmented",
  "ok-two",
  "no-tools-400",
  "text-only",
  "html-error",
  "timeout",
];

/** 所有响应都带 CORS —— 浏览器里的"直连模式"要能直接打这个假上游 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "*",
};

const HTML_ERROR_PAGE =
  "<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head>" +
  "<body><h1>502 Bad Gateway</h1><p>nginx</p></body></html>";

/* ──────────────────────────── SSE 帧积木 ──────────────────────────── */

/** 一帧 SSE（delta） */
const frame = (delta) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;

/** 收尾帧（只有 finish_reason，没有 delta 内容） */
const finish = (reason) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: reason }] })}\n\n`;

const DONE_FRAME = "data: [DONE]\n\n";

const ROLE_FRAME = frame({ role: "assistant", content: "" });

/** 正常上游：一帧就把整个调用给全 */
const FRAMES_OK_SINGLE = [
  ROLE_FRAME,
  frame({
    tool_calls: [
      {
        index: 0,
        id: "call_a",
        type: "function",
        function: { name: "get_time", arguments: '{"timezone":"Asia/Shanghai"}' },
      },
    ],
  }),
  finish("tool_calls"),
  DONE_FRAME,
];

/**
 * 真实中转：tool_calls 是分片增量 ——
 * 函数名 `get_` + `time`，arguments 切 3 段，而且**第 2、3 帧故意不给 index**
 * （只按单帧看，或者每帧新建槽位，都永远拼不出完整调用）。
 */
const FRAMES_OK_FRAGMENTED = [
  ROLE_FRAME,
  frame({
    tool_calls: [
      {
        index: 0,
        id: "call_a",
        type: "function",
        function: { name: "get_", arguments: '{"time' },
      },
    ],
  }),
  // ↓ 缺 index：必须续到上一个槽位
  frame({ tool_calls: [{ function: { name: "time", arguments: 'zone":"Asia/' } }] }),
  frame({ tool_calls: [{ function: { arguments: 'Shanghai"}' } }] }),
  finish("tool_calls"),
  DONE_FRAME,
];

/** 一次两个调用（index 0 / 1），各自也分片 —— 顺序和内容都不许串 */
const FRAMES_OK_TWO = [
  ROLE_FRAME,
  frame({
    tool_calls: [
      {
        index: 0,
        id: "call_a",
        type: "function",
        function: { name: "get_", arguments: '{"time' },
      },
    ],
  }),
  frame({ tool_calls: [{ index: 0, function: { name: "time", arguments: 'zone":"Asia/' } }] }),
  frame({ tool_calls: [{ index: 0, function: { arguments: 'Shanghai"}' } }] }),
  frame({
    tool_calls: [
      {
        index: 1,
        id: "call_b",
        type: "function",
        function: { name: "get_temp", arguments: '{"city"' },
      },
    ],
  }),
  frame({ tool_calls: [{ index: 1, function: { name: "erature", arguments: ':"杭州"}' } }] }),
  finish("tool_calls"),
  DONE_FRAME,
];

/** 流式通了，但模型只说了句人话，没有任何 tool_call */
const FRAMES_TEXT_ONLY = [
  frame({ role: "assistant", content: "大概" }),
  frame({ content: "是下午三点吧。" }),
  finish("stop"),
  DONE_FRAME,
];

/**
 * 每种模式下假上游怎么回 —— 行为固定，不许含糊。
 * （`payload` 传进来是为了以后想按请求内容分支时不用改签名；现在固定。）
 */
function planFor(mode, payload) {
  void payload;
  switch (mode) {
    case "ok-single":
      return { kind: "sse", frames: FRAMES_OK_SINGLE };
    case "ok-fragmented":
      return { kind: "sse", frames: FRAMES_OK_FRAGMENTED, splitMidFrame: true };
    case "ok-two":
      return { kind: "sse", frames: FRAMES_OK_TWO };
    case "no-tools-400":
      return {
        kind: "status",
        status: 400,
        body: { error: { message: "tools is not supported by this model" } },
      };
    case "text-only":
      return { kind: "sse", frames: FRAMES_TEXT_ONLY };
    case "html-error":
      return { kind: "html", status: 502 };
    case "timeout":
      return { kind: "hang" };
    default:
      return {
        kind: "status",
        status: 404,
        body: { error: { message: `unknown mode ${mode}（可用：${MODES.join(", ")}）` } },
      };
  }
}

/**
 * 路径 → mode：
 *   `/ok-fragmented/chat/completions`      → ok-fragmented
 *   `/ok-fragmented/v1/chat/completions`   → ok-fragmented
 *   `/v1/ok-fragmented/chat/completions`   → ok-fragmented（也顺手容错）
 *   `/ok-fragmented/v1`                    → ok-fragmented（base 带 /v1 直发）
 */
export function modeFromPath(pathname) {
  const parts = String(pathname ?? "").split("/").filter(Boolean);
  if (parts.length >= 2 && parts[parts.length - 2] === "chat" && parts[parts.length - 1] === "completions") {
    parts.length -= 2;
  }
  while (parts[0] === "v1") parts.shift();
  if (parts[parts.length - 1] === "v1") parts.pop();
  return parts[0] ?? "(none)";
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
    req.on("error", () => resolve(b));
  });
}

function sendJson(res, status, body, extraHeaders) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    "content-type": "application/json; charset=utf-8",
    ...(extraHeaders ?? {}),
  });
  res.end(text);
}

function sendSse(res, frames, splitMidFrame) {
  res.writeHead(200, {
    ...CORS,
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  let i = 0;
  const tick = () => {
    if (i >= frames.length) {
      res.end();
      return;
    }
    const f = frames[i];
    i += 1;
    // 故意把一帧从中间切成两次 write —— 真机上 TCP 分片就是这样，
    // 客户端必须自己按行缓冲（只认到 `data:` 才解析）。
    if (splitMidFrame && f.length > 60) {
      const cut = Math.floor(f.length / 2);
      res.write(f.slice(0, cut));
      setTimeout(() => {
        res.write(f.slice(cut));
        setTimeout(tick, 3);
      }, 3);
    } else {
      res.write(f);
      setTimeout(tick, 3);
    }
  };
  tick();
}

/* ──────────────────────────── 假上游本体 ──────────────────────────── */

/**
 * 造一个假上游实例（**不自动 listen**）。
 *
 * @param {{ host?: string, port?: number }} [options] port 传 0 → 随机端口（验收脚本最爱）
 */
export function createFakeUpstream(options = {}) {
  const host = options.host ?? HOST;
  let port = options.port ?? PORT;

  /** mode → 收到的请求数组 */
  const requests = new Map();
  const sockets = new Set();

  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    const mode = modeFromPath(url.pathname);
    const raw = await readBody(req);

    let payload = {};
    try {
      payload = JSON.parse(raw) ?? {};
    } catch {
      payload = {};
    }

    const log = requests.get(mode) ?? [];
    log.push({
      mode,
      method: req.method,
      path: url.pathname,
      authorization: req.headers.authorization ?? "",
      contentType: req.headers["content-type"] ?? "",
      /** 是不是流式（假上游自己也记一份，断言时不用再解析 raw） */
      stream: payload.stream === true,
      payload,
      raw,
      at: Date.now(),
    });
    requests.set(mode, log);

    const plan = planFor(mode, payload);
    if (plan.kind === "hang") return; // 一个字都不回：让客户端自己超时
    if (plan.kind === "json") return sendJson(res, 200, plan.body);
    if (plan.kind === "status") return sendJson(res, plan.status, plan.body);
    if (plan.kind === "html") {
      res.writeHead(plan.status ?? 502, { ...CORS, "content-type": "text/html; charset=utf-8" });
      res.end(HTML_ERROR_PAGE);
      return;
    }
    if (plan.kind === "sse") return sendSse(res, plan.frames, plan.splitMidFrame);
    return sendJson(res, 500, { error: { message: "桩坏了" } });
  });

  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });

  const api = {
    server,
    get host() {
      return host;
    },
    get port() {
      return port;
    },
    /** 某个 mode 的 base（正好能当上游地址填进 App / 传给 chat-client） */
    base(mode) {
      return `http://${host}:${port}/${mode}`;
    },
    /** 等于 base(mode)，另一套命名，读起来顺 */
    url(mode) {
      return api.base(mode);
    },
    /** 某个 mode 收到的请求（数组，按时间顺序） */
    hits(mode) {
      return requests.get(mode) ?? [];
    },
    /** mode → 请求 的原始 Map（想自己遍历时用） */
    requests,
    clear() {
      requests.clear();
    },
    listen() {
      return new Promise((resolve, reject) => {
        const onError = (err) => reject(err);
        server.once("error", onError);
        server.listen(port, host, () => {
          server.removeListener("error", onError);
          const addr = server.address();
          if (addr && typeof addr === "object") port = addr.port;
          resolve(api);
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    },
  };

  return api;
}

/**
 * 起一个已经 listen 好的假上游（验收脚本一行搞定）。
 * @param {{ host?: string, port?: number }} [options]
 */
export async function startFakeUpstream(options = {}) {
  const up = createFakeUpstream(options);
  await up.listen();
  return up;
}

/* ──────────────────────── 直接跑：打印一行，保持不退出 ──────────────────────── */

const isDirectRun = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;

if (isDirectRun) {
  const wantPort = Number.parseInt(process.env.FAKE_UPSTREAM_PORT ?? String(PORT), 10);
  try {
    const up = await startFakeUpstream({ port: wantPort });
    console.log(
      `[fake-upstream] 监听 http://${up.host}:${up.port} —— 模式写在地址里，` +
        `例如 http://${up.host}:${up.port}/ok-fragmented/chat/completions（Ctrl+C 停）`,
    );
    console.log(`[fake-upstream] 可用模式：${MODES.join(" / ")}`);
  } catch (err) {
    console.error(`[fake-upstream] 起不来（端口 ${wantPort} 可能被占了）：`, err?.message ?? err);
    process.exit(1);
  }
}
