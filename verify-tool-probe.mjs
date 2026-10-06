/**
 * 验收脚本：**上游工具调用探测**（P1）—— `src/lib/tool-probe.ts`。
 *
 * 纯 node，不需要浏览器、不需要真上游：
 * 起一个**假上游**（127.0.0.1:4631），按 URL 里的模式名扮演 7 种上游 + 2 种额外情况，
 * 然后断言 `probeToolCalling()` 对每一种的判断都对 ——
 * 尤其「不通过」必须是**不通过**：解析不到、被吞成普通文字、HTML 错误页、超时，
 * 一个都不许被当成通过（否则用户会照着探测结果去改架构，然后在真机上撞墙）。
 *
 * 假上游怎么选模式：探测只会 POST 到 `${base}/chat/completions`，
 * 而 base 是任意的 —— 所以用 `http://127.0.0.1:4631/m3` 这种带路径的地址当开关。
 * 顺手也验了「base 带 `/v1`」「base 末尾带斜杠」这两种真实填法。
 *
 * 跑法：
 *   node --experimental-strip-types verify-tool-probe.mjs
 * （node 22.6+ 支持；node 23+ 默认就能跑 TS，不加这个标志也行）
 * 退出码 0 = 全过；非 0 = 有断言失败。
 */
import { createServer } from "node:http";
import { failedProbeResult, parseSseToolCalls, probeToolCalling } from "./src/lib/tool-probe.ts";

const HOST = "127.0.0.1";
const PORT = 4631;
const ORIGIN = `http://${HOST}:${PORT}`;
const KEY = "probe-key-abc";
const MODEL = "probe-model-x";

/* ──────────────────────────── 断言小工具 ──────────────────────────── */

let passed = 0;
/** @type {string[]} */
const failures = [];

function check(name, cond, detail) {
  const ok = !!cond;
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(detail ? `${name} —— ${detail}` : name);
    console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ""}`);
  }
}

function describe(r) {
  return (
    `ok=${r.ok} httpOk=${r.httpOk} 非流式=${r.nonStreamToolCall} ` +
    `流式=${r.streamToolCall} 多工具=${r.multiToolCall} 耗时=${r.latencyMs}ms` +
    (r.error ? ` error=${JSON.stringify(r.error.slice(0, 120))}` : "")
  );
}

/* ─────────────────────── 假上游：9 种扮演方案 ─────────────────────── */

const reqLog = new Map(); // mode → 收到的请求

const json = (obj) => JSON.stringify(obj);

const TOOL_CALL = (id, name, args) => ({
  id,
  type: "function",
  function: { name, arguments: args },
});
const CALL_TIME = TOOL_CALL("call_a", "get_time", '{ "timezone": "Asia/Shanghai" }');
const CALL_TEMP = TOOL_CALL("call_b", "get_temperature", '{ "city": "杭州" }');

const asToolMessage = (calls) => ({
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: null, tool_calls: calls },
      finish_reason: "tool_calls",
    },
  ],
});
const asTextMessage = (text) => ({
  choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
});

/** 一帧 SSE（delta） */
const frame = (delta) =>
  `data: ${json({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;
const DONE_FRAME = "data: [DONE]\n\n";

/** 正常上游的流式：一帧就把整个调用给全 */
const SSE_SINGLE = [
  frame({ role: "assistant", content: "" }),
  frame({ tool_calls: [CALL_TIME] }),
  `data: ${json({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
  DONE_FRAME,
];

/**
 * 真实中转的流式：tool_calls 是**分片增量** ——
 * 函数名被切成 `get_` + `time`，arguments 也被切成三段。
 * 只按单帧看的话，拼出来是 `get_` 和 `{"timezone":`，等于没拿到调用。
 */
const SSE_FRAGMENTED = [
  frame({ role: "assistant", content: "" }),
  frame({
    tool_calls: [
      { index: 0, id: "call_a", type: "function", function: { name: "get_", arguments: "" } },
    ],
  }),
  frame({ tool_calls: [{ index: 0, function: { name: "time", arguments: '{"timezone":' } }] }),
  frame({ tool_calls: [{ index: 0, function: { arguments: '"Asia/Shanghai"}' } }] }),
  `data: ${json({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
  DONE_FRAME,
];

/** 模型只在流式里说了句人话，没有任何 tool_call */
const SSE_TEXT_ONLY = [
  frame({ role: "assistant", content: "现在" }),
  frame({ content: "大概是下午三点吧。" }),
  `data: ${json({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
  DONE_FRAME,
];

const HTML_ERROR_PAGE =
  "<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head>" +
  "<body><h1>502 Bad Gateway</h1><p>nginx</p></body></html>";

/**
 * 每种模式下假上游怎么回。
 * 真实上游支持得参差不齐，这里就照着"用户可能撞到的样子"扮演。
 */
function planFor(mode, payload) {
  const nTools = Array.isArray(payload.tools) ? payload.tools.length : 0;
  const isStream = payload.stream === true;
  /** 模型面对两个工具时才会返回两个调用（一个工具时返回一个） */
  const byToolCount = nTools >= 2 ? [CALL_TIME, CALL_TEMP] : [CALL_TIME];
  const ambiguous = payload.tool_choice !== undefined;

  switch (mode) {
    // ① 正常：非流式返回结构化 tool_call（流式也给）
    case "m1":
      return isStream
        ? { kind: "sse", frames: SSE_SINGLE }
        : { kind: "json", body: asToolMessage([CALL_TIME]) };
    // ② 正常：只有流式那条路给 tool_call（非流式把它当普通文字回了）
    case "m2":
      return isStream
        ? { kind: "sse", frames: SSE_FRAGMENTED, splitMidFrame: true }
        : { kind: "json", body: asTextMessage("现在大概是下午三点吧，我没法精确知道。") };
    // ③ 上游直接拒了 tools 参数
    case "m3":
      return {
        kind: "status",
        status: 400,
        body: { error: { message: "tools is not supported by this model" } },
      };
    // ④ 流式通了，但内容里根本没有 tool_call
    case "m4":
      return isStream
        ? { kind: "sse", frames: SSE_TEXT_ONLY }
        : { kind: "json", body: asTextMessage("现在大概是下午三点吧。") };
    // ⑤ 一次返回两个 tool_call
    case "m5":
      return isStream
        ? { kind: "sse", frames: SSE_SINGLE }
        : { kind: "json", body: asToolMessage(byToolCount) };
    // ⑥ 回的是 HTML 错误页（还不是 JSON）—— 最容易骗过"看状态码"的探测
    case "m6":
      return { kind: "html" };
    // ⑦ 一个字都不回（真机上就是转圈转到用户放弃）
    case "m7":
      return { kind: "hang" };
    // ⑧ 额外：key 不对
    case "m8":
      return { kind: "status", status: 401, body: { error: { message: "invalid api key" } } };
    // ⑨ 额外：支持 tools，但一看见 tool_choice 就 400（探测该摘掉它重试，不能误判成不支持）
    case "m9":
      if (ambiguous)
        return {
          kind: "status",
          status: 400,
          body: { error: { message: "tool_choice is not supported" } },
        };
      return isStream
        ? { kind: "sse", frames: SSE_FRAGMENTED }
        : { kind: "json", body: asToolMessage(byToolCount) };
    default:
      return { kind: "status", status: 404, body: { error: { message: `unknown mode ${mode}` } } };
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });
}

function sendSse(res, frames, splitMidFrame) {
  res.writeHead(200, {
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

function sendJson(res, status, body) {
  const text = json(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(text);
}

const sockets = new Set();
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", ORIGIN);
  // 路径长这样：`/m3/chat/completions` 或 `/v1/m1/chat/completions`
  // → 模式名就是 `chat` 前面那一段（先切掉最后两段固定路径）
  const parts = url.pathname.split("/").filter(Boolean);
  const tail = parts.slice(-2).join("/");
  const mode =
    tail === "chat/completions" && parts.length >= 3 ? parts[parts.length - 3] : "(none)";
  const raw = await readBody(req);
  let payload = {};
  try {
    payload = JSON.parse(raw) ?? {};
  } catch {
    payload = {};
  }

  const log = reqLog.get(mode) ?? [];
  log.push({
    method: req.method,
    path: url.pathname,
    authorization: req.headers.authorization ?? "",
    contentType: req.headers["content-type"] ?? "",
    payload,
    raw,
  });
  reqLog.set(mode, log);

  const plan = planFor(mode, payload);
  if (plan.kind === "hang") return; // 不回：让探测那边自己超时
  if (plan.kind === "json") return sendJson(res, 200, plan.body);
  if (plan.kind === "status") return sendJson(res, plan.status, plan.body);
  if (plan.kind === "html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
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

/* ───────────────────────────── 开跑 ───────────────────────────── */

/** 跑一次探测，顺手把"抛异常"也抓下来（探测本身承诺永不抛） */
async function runProbe(baseSuffix, timeoutMs = 4000) {
  const base = `${ORIGIN}${baseSuffix}`;
  const started = Date.now();
  let result;
  let threw = null;
  try {
    result = await probeToolCalling({ baseUrl: base, apiKey: KEY, model: MODEL, timeoutMs });
  } catch (err) {
    threw = err;
  }
  return { base, result, threw, elapsed: Date.now() - started };
}

const hits = (mode) => reqLog.get(mode) ?? [];

async function main() {
  await new Promise((resolve) => server.listen(PORT, HOST, resolve));
  console.log(`假上游起来了：${ORIGIN}（模式写在地址里，例如 ${ORIGIN}/m3）\n`);

  /* ───────── 纯解析：分片拼装（不经过网络，直接喂文本） ───────── */

  console.log("【0】解析层：分片增量必须被拼成一次完整调用");
  const fragText = SSE_FRAGMENTED.join("");
  const frag = parseSseToolCalls(fragText);
  check("分片流式：识别出 1 个调用", frag.calls.length === 1, `实际 ${frag.calls.length}`);
  check(
    "分片流式：函数名 `get_` + `time` 拼成了 get_time",
    frag.calls[0]?.name === "get_time",
    `实际 ${JSON.stringify(frag.calls[0]?.name)}`,
  );
  check(
    "分片流式：arguments 三帧拼成了完整 JSON",
    (() => {
      try {
        return JSON.parse(frag.calls[0]?.args ?? "").timezone === "Asia/Shanghai";
      } catch {
        return false;
      }
    })(),
    `实际 ${JSON.stringify(frag.calls[0]?.args)}`,
  );
  check("分片流式：认出这是 SSE", frag.sse === true);

  const noIndex = parseSseToolCalls(
    frame({ tool_calls: [{ index: 0, id: "c1", function: { name: "get_time", arguments: "" } }] }) +
      frame({ tool_calls: [{ function: { arguments: '{"timezone":' } }] }) +
      frame({ tool_calls: [{ function: { arguments: '"Asia/Shanghai"}' } }] }) +
      DONE_FRAME,
  );
  check(
    "后续帧没带 index 也能续到同一个调用（不能被拆成好几个）",
    noIndex.calls.length === 1 && noIndex.calls[0]?.name === "get_time",
    `实际 ${JSON.stringify(noIndex.calls)}`,
  );

  const shell = parseSseToolCalls(frame({ tool_calls: [{}] }) + DONE_FRAME);
  check(
    "空壳 tool_calls:[{}] 不算通过（没有函数名就等于没有）",
    shell.calls.length === 0,
    `实际 ${JSON.stringify(shell.calls)}`,
  );

  const wholeJson = parseSseToolCalls(json(asToolMessage([CALL_TIME])));
  check(
    "中转无视 stream:true、直接回一整份 JSON 时也能认出来",
    wholeJson.calls.length === 1 && wholeJson.sse === false,
    `实际 ${JSON.stringify(wholeJson.calls)} sse=${wholeJson.sse}`,
  );

  const legacy = parseSseToolCalls(
    frame({ function_call: { name: "get_time", arguments: '{"timezone":"Asia/Shanghai"}' } }) +
      DONE_FRAME,
  );
  check(
    "老式 function_call 字段也认",
    legacy.calls.length === 1,
    `实际 ${JSON.stringify(legacy.calls)}`,
  );

  const htmlStream = parseSseToolCalls(HTML_ERROR_PAGE);
  check(
    "HTML 错误页喂进解析层：0 调用、不抛",
    htmlStream.calls.length === 0 && htmlStream.sse === false,
  );

  const errFrame = parseSseToolCalls(
    frame({ content: "hi" }) + `data: ${json({ error: { message: "内部错误" } })}\n\n` + DONE_FRAME,
  );
  check(
    "流里的错误帧被读出来（不当成「有调用」）",
    errFrame.calls.length === 0 && /内部错误/.test(errFrame.error ?? ""),
    `实际 ${JSON.stringify(errFrame.error)}`,
  );

  /* ───────── 走网络：7 种上游 + 2 种额外情况 ───────── */

  console.log("\n【1】正常非流式 + tool_call ✅（base 带 /v1）");
  const r1 = await runProbe("/v1/m1");
  check("没抛异常", r1.threw === null, String(r1.threw));
  check("ok / httpOk 都是 true", r1.result.ok && r1.result.httpOk, describe(r1.result));
  check("非流式：认出 tool_call", r1.result.nonStreamToolCall, describe(r1.result));
  check("流式：也认出 tool_call", r1.result.streamToolCall, describe(r1.result));
  check(
    "没有把「只回一个调用」误判成多工具",
    r1.result.multiToolCall === false,
    describe(r1.result),
  );
  check(
    "rawSnippet 非空且不超过 400 字",
    r1.result.rawSnippet.length > 0 && r1.result.rawSnippet.length <= 400,
  );

  console.log("\n【1b】请求本身发得对不对（照抄 chat-client 那一套）");
  const m1 = hits("m1");
  check("一共发了 3 条请求", m1.length === 3, `实际 ${m1.length}`);
  const [q1, q2, q3] = m1;
  check(
    "地址拼法是 base + /chat/completions",
    q1?.path === "/v1/m1/chat/completions",
    `实际 ${q1?.path}`,
  );
  check("方法是 POST", q1?.method === "POST", `实际 ${q1?.method}`);
  check(
    "头里带 Authorization: Bearer <key>",
    q1?.authorization === `Bearer ${KEY}`,
    `实际 ${q1?.authorization}`,
  );
  check(
    "头里带 Content-Type: application/json",
    /application\/json/.test(q1?.contentType ?? ""),
    `实际 ${q1?.contentType}`,
  );
  check(
    "体里带 model（用用户填的真实模型名）",
    q1?.payload.model === MODEL,
    `实际 ${JSON.stringify(q1?.payload.model)}`,
  );
  check("第 1 条 stream=false", q1?.payload.stream === false);
  check("第 2 条 stream=true", q2?.payload.stream === true);
  check("第 3 条 stream=false", q3?.payload.stream === false);
  check(
    "messages 是 [{role:'user', content}]",
    q1?.payload.messages?.[0]?.role === "user" &&
      typeof q1?.payload.messages?.[0]?.content === "string",
  );
  check(
    "提示词里明确点名了要调用的工具",
    /get_time/.test(q1?.payload.messages?.[0]?.content ?? ""),
  );
  check(
    "tools 是标准形状（type=function + function.name/description/parameters）",
    q1?.payload.tools?.[0]?.type === "function" &&
      q1?.payload.tools?.[0]?.function?.name === "get_time" &&
      typeof q1?.payload.tools?.[0]?.function?.description === "string" &&
      q1?.payload.tools?.[0]?.function?.parameters?.type === "object",
    JSON.stringify(q1?.payload.tools?.[0])?.slice(0, 160),
  );
  check(
    "第 1、2 条各带 1 个工具",
    q1?.payload.tools?.length === 1 && q2?.payload.tools?.length === 1,
  );
  check(
    "第 3 条带 2 个工具（get_time + get_temperature）",
    q3?.payload.tools?.length === 2 &&
      q3?.payload.tools?.[0]?.function?.name === "get_time" &&
      q3?.payload.tools?.[1]?.function?.name === "get_temperature",
    JSON.stringify(q3?.payload.tools?.map((t) => t?.function?.name)),
  );
  check("第 3 条提示词明说「同时调用两个」", /同时/.test(q3?.payload.messages?.[0]?.content ?? ""));

  console.log("\n【2】正常流式：SSE 分片里拼出 tool_call ✅（base 末尾带斜杠）");
  const r2 = await runProbe("/m2/");
  check("没抛异常", r2.threw === null, String(r2.threw));
  check("ok=true", r2.result.ok === true, describe(r2.result));
  check(
    "非流式：这条上游不给结构化调用 → 不通过",
    r2.result.nonStreamToolCall === false,
    describe(r2.result),
  );
  check(
    "流式：分片拼出了 tool_call → 通过",
    r2.result.streamToolCall === true,
    describe(r2.result),
  );
  check("部分通过时不留 error（别吓用户）", r2.result.error === undefined, describe(r2.result));
  check(
    "末尾斜杠没有拼出双斜杠",
    hits("m2").every((h) => h.path === "/m2/chat/completions"),
    JSON.stringify(hits("m2").map((h) => h.path)),
  );

  console.log("\n【3】上游 400：tools is not supported ❌");
  const r3 = await runProbe("/m3");
  check("没抛异常", r3.threw === null, String(r3.threw));
  check("ok=false", r3.result.ok === false, describe(r3.result));
  check("httpOk=false（400 就是没成功）", r3.result.httpOk === false, describe(r3.result));
  check(
    "三个布尔全是 false（一个都不许漏判成通过）",
    !r3.result.nonStreamToolCall && !r3.result.streamToolCall && !r3.result.multiToolCall,
    describe(r3.result),
  );
  check("error 里带 HTTP 码 400", /400/.test(r3.result.error ?? ""), describe(r3.result));
  check(
    "error 里带上游原话",
    /tools is not supported/i.test(r3.result.error ?? ""),
    describe(r3.result),
  );
  check(
    "error 里是上游的 error.message（不是一堆 HTML/堆栈）",
    !/[<>]/.test(r3.result.error ?? ""),
    describe(r3.result),
  );
  check("400 不值得早停，三条都发了", hits("m3").length === 3, `实际 ${hits("m3").length}`);

  console.log("\n【4】流式通了但没有 tool_call（只说了句人话）❌");
  const r4 = await runProbe("/m4");
  check("没抛异常", r4.threw === null, String(r4.threw));
  check("ok=false", r4.result.ok === false, describe(r4.result));
  check("httpOk=true（HTTP 是成功的）", r4.result.httpOk === true, describe(r4.result));
  check(
    "三个布尔全是 false",
    !r4.result.nonStreamToolCall && !r4.result.streamToolCall && !r4.result.multiToolCall,
    describe(r4.result),
  );
  check(
    "error 讲人话（不是空的、也不是英文堆栈）",
    /tool_call|普通文字/.test(r4.result.error ?? ""),
    describe(r4.result),
  );
  check(
    "rawSnippet 留下了它到底回了什么",
    /三点/.test(r4.result.rawSnippet),
    JSON.stringify(r4.result.rawSnippet.slice(0, 120)),
  );

  console.log("\n【5】一次返回两个 tool_call ✅");
  const r5 = await runProbe("/m5");
  check("没抛异常", r5.threw === null, String(r5.threw));
  check("ok=true", r5.result.ok === true, describe(r5.result));
  check("多工具：通过", r5.result.multiToolCall === true, describe(r5.result));
  check(
    "非流式/流式也都通过",
    r5.result.nonStreamToolCall && r5.result.streamToolCall,
    describe(r5.result),
  );

  console.log("\n【6】回的是 HTML 错误页（不是 JSON）❌");
  const r6 = await runProbe("/m6");
  check("没抛异常", r6.threw === null, String(r6.threw));
  check("ok=false（HTML 绝不能被当成通过）", r6.result.ok === false, describe(r6.result));
  check(
    "三个布尔全是 false",
    !r6.result.nonStreamToolCall && !r6.result.streamToolCall && !r6.result.multiToolCall,
    describe(r6.result),
  );
  check("error 指出回的是网页", /网页|HTML/i.test(r6.result.error ?? ""), describe(r6.result));
  check(
    "error 不超过 200 字（别把整页 HTML 糊用户脸上）",
    (r6.result.error ?? "").length <= 200,
    `${(r6.result.error ?? "").length} 字`,
  );
  check(
    "rawSnippet 带上了原始 HTML 片段",
    /<!DOCTYPE|<html/i.test(r6.result.rawSnippet),
    JSON.stringify(r6.result.rawSnippet.slice(0, 80)),
  );
  check(
    "rawSnippet 截断到 400 字以内",
    r6.result.rawSnippet.length <= 400,
    `${r6.result.rawSnippet.length} 字`,
  );

  console.log("\n【7】超时（上游一个字都不回）→ 走 error 分支，不卡死");
  const t7 = Date.now();
  const r7 = await runProbe("/m7", 1200);
  const el7 = Date.now() - t7;
  check("没抛异常", r7.threw === null, String(r7.threw));
  check(
    "ok=false / httpOk=false",
    r7.result.ok === false && r7.result.httpOk === false,
    describe(r7.result),
  );
  check(
    "三个布尔全是 false",
    !r7.result.nonStreamToolCall && !r7.result.streamToolCall && !r7.result.multiToolCall,
    describe(r7.result),
  );
  check("error 明说是超时", /超时/.test(r7.result.error ?? ""), describe(r7.result));
  check("在 1.2 秒的超时设置下很快返回（没等到 20 秒默认值）", el7 < 6000, `实际 ${el7}ms`);
  check(
    "连通都没连通就不必再发后两条（只收到 1 个请求）",
    hits("m7").length === 1,
    `实际 ${hits("m7").length}`,
  );
  check(
    "超时情形没有可看的正文时 rawSnippet 是空串、不炸",
    typeof r7.result.rawSnippet === "string",
  );

  console.log("\n【8】额外：key 不对（401）❌");
  const r8 = await runProbe("/m8");
  check("没抛异常", r8.threw === null, String(r8.threw));
  check("ok=false", r8.result.ok === false, describe(r8.result));
  check("error 里带 401", /401/.test(r8.result.error ?? ""), describe(r8.result));
  check("401 没必要再试（只收到 1 个请求）", hits("m8").length === 1, `实际 ${hits("m8").length}`);

  console.log("\n【9】额外：支持 tools 但一看见 tool_choice 就 400（该摘掉重试，不能误判）");
  const r9 = await runProbe("/m9");
  check("没抛异常", r9.threw === null, String(r9.threw));
  check("ok=true（摘掉 tool_choice 之后照样能测出来）", r9.result.ok === true, describe(r9.result));
  check(
    "非流式/流式/多工具 三项全过",
    r9.result.nonStreamToolCall && r9.result.streamToolCall && r9.result.multiToolCall,
    describe(r9.result),
  );
  const m9 = hits("m9");
  check(
    "第一条请求带 tool_choice，重试的那条不带",
    m9[0]?.payload?.tool_choice !== undefined && m9[1]?.payload?.tool_choice === undefined,
    JSON.stringify(m9.map((h) => h.payload?.tool_choice)),
  );
  check(
    "摘掉之后后两条也不再带 tool_choice",
    m9.slice(1).every((h) => h.payload?.tool_choice === undefined),
    JSON.stringify(m9.map((h) => h.payload?.tool_choice)),
  );

  console.log("\n【10】界面兜底：failedProbeResult 是完整的「全不通过」");
  const fb = failedProbeResult("测试用失败");
  check(
    "形状完整、字段都对",
    fb.ok === false &&
      fb.httpOk === false &&
      !fb.nonStreamToolCall &&
      !fb.streamToolCall &&
      !fb.multiToolCall &&
      fb.latencyMs === 0 &&
      fb.error === "测试用失败" &&
      fb.rawSnippet === "",
    JSON.stringify(fb),
  );

  console.log("\n【11】跨模式体检：每个结果都不许抛、rawSnippet 不超过 400 字");
  const all = [r1, r2, r3, r4, r5, r6, r7, r8, r9];
  check(
    "9 次探测全都没抛异常",
    all.every((r) => r.threw === null),
  );
  check(
    "9 个 rawSnippet 都 ≤ 400 字",
    all.every((r) => r.result.rawSnippet.length <= 400),
  );
  check(
    "9 个结果都带 latencyMs（数字、非负）",
    all.every((r) => typeof r.result.latencyMs === "number" && r.result.latencyMs >= 0),
  );
  check(
    "通过 / 不通过的结论分布符合预期",
    [r1, r2, r4, r5, r6, r7, r8, r9].map((r) => r.result.ok).join(",") ===
      "true,true,false,true,false,false,false,true",
    [r1, r2, r4, r5, r6, r7, r8, r9].map((r) => r.result.ok).join(","),
  );

  /* ──────────────────────── 收尾 ──────────────────────── */

  console.log(`\n${"─".repeat(72)}`);
  if (failures.length === 0) {
    console.log(`全部通过：${passed} 项断言 ✅`);
  } else {
    console.log(`通过 ${passed} 项，失败 ${failures.length} 项 ❌`);
    for (const f of failures) console.log(`  · ${f}`);
  }
  console.log(
    "结论汇总：" +
      [
        ["m1 正常非流式", r1.result.ok],
        ["m2 只有流式给调用", r2.result.ok],
        ["m3 400 不支持 tools", r3.result.ok],
        ["m4 流式但没调用", r4.result.ok],
        ["m5 两个调用", r5.result.ok],
        ["m6 HTML 错误页", r6.result.ok],
        ["m7 超时", r7.result.ok],
        ["m8 401", r8.result.ok],
        ["m9 tool_choice 被拒", r9.result.ok],
      ]
        .map(([k, v]) => `${k}=${v ? "通过" : "不通过"}`)
        .join(" · "),
  );
}

try {
  await main();
} catch (err) {
  console.error("验收脚本自己崩了：", err);
  failures.push(`脚本异常：${err?.message ?? err}`);
} finally {
  for (const s of sockets) s.destroy();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

process.exit(failures.length === 0 ? 0 : 1);
