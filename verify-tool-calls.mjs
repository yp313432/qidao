/**
 * 验收脚本：**分片 tool_calls 装配层**（M1）—— `src/lib/tool-calls.ts` + `fake-upstream.mjs`。
 *
 * ── 这一轮要证明什么 ────────────────────────────────────────────
 *
 * 前面的窗口已经实测出"上游的流式 tool_calls 是**分片增量**"：函数名可能被切成
 * `get_` + `time`，`arguments` 的 JSON 文本可能被切成三段，而且**后半段经常不带 index**。
 * 这一轮把这条规则从"探测用的临时解析"提成**生产用的累加器**，所以要证明：
 *
 *   ① 分片能拼成**完整**调用（名字要接上、参数要接成合法 JSON）——
 *      不是"看起来有 tool_call"就算，光有布尔值没用
 *   ② 一次两个调用时**不会串味**（第 2 个的参数不许跑到第 1 个身上）
 *   ③ 空壳 `tool_calls:[{}]`（没有函数名）**不算调用**，但要被 `dropped()` 计数
 *      ④ 中转无视 `stream:true`、直接回一整份非流式 JSON 时也能解析（`sse:false`）
 *      ⑤ 上游只说了句人话（没有任何 tool_call）时：calls 0、正文还在、不算失败
 *      ⑥ HTML 错误页 / 空 body / 破 JSON / 错误帧 —— **永不抛**、calls 0
 *      ⑦ 真走一遍 HTTP：宿主确实收到了 `tools`、`Authorization: Bearer <key>`、
 *      `stream:true`；而且把**同一个响应体**逐帧喂给生产用的 `createDeltaAccumulator()`，
 *      结论与验收用的 `parseSseToolCalls()` **完全一致**
 *      ⑧ 上游 400 "tools is not supported" 时能读出那句原话（主链路要靠它判断降级）
 *
 * ── 怎么做到"真的" ──────────────────────────────────────────────
 *
 * 用 `fake-upstream.mjs` 起一个**本地假上游**（默认 127.0.0.1:4632，模式写在路径里），
 * **不连外网、不花任何额度、不起浏览器**（队友沙箱起不了浏览器，全是纯 node）。
 * 真 fetch 走一遍 HTTP，再用**同一份响应体**分别过解析器和累加器 ——
 * 这样"验收用的解析"和"生产用的拼装"就不会各说各话。
 *
 * 跑法：
 *   node --experimental-strip-types verify-tool-calls.mjs
 * 退出码 0 = 全过；非 0 = 有断言失败。
 */
import { MODES, startFakeUpstream } from "./fake-upstream.mjs";
import { createDeltaAccumulator, parseSseToolCalls } from "./src/lib/tool-calls.ts";

const KEY = "tool-calls-test-key";
const MODEL = "tool-calls-model-x";
/** 端口按顺序试：默认 4632，被占了就往后挪（不和外网/别的验收脚本抢） */
const PORTS = [4632, 4633, 4634, 4635, 4636];

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

const j = (v) => JSON.stringify(v);
const same = (a, b) => j(a) === j(b);

/** 跑一段可能抛的代码：抛了就算失败，但脚本继续（不让一个崩点吃掉后面所有断言） */
function checkNoThrow(label, fn) {
  try {
    const value = fn();
    check(`${label}：不抛异常`, true);
    return value;
  } catch (err) {
    check(`${label}：不抛异常`, false, `抛了 ${err?.name ?? "Error"}: ${err?.message ?? err}`);
    return null;
  }
}

/** 一段响应文本 → 逐帧喂进累加器（模拟主链路边收边喂）。返回喂进去的帧数。 */
function feedByFrames(text, acc) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("data:"));
  let fed = 0;
  for (const line of lines) {
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let obj;
    try {
      obj = JSON.parse(payload);
    } catch {
      continue; // 半截帧：跳过
    }
    if (!obj || typeof obj !== "object" || obj.error) continue;
    const d = obj.choices?.[0]?.delta;
    if (!d) continue;
    acc.push(d);
    fed += 1;
  }
  return fed;
}

/* ──────────────────────────── 本地构造的小样本 ──────────────────────────── */

const frameOf = (delta) =>
  `data: ${j({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;
const DONE = "data: [DONE]\n\n";

const HTML_ERROR_PAGE =
  "<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head>" +
  "<body><h1>502 Bad Gateway</h1><p>nginx</p></body></html>";

/** 非流式整份 JSON（协议给的形状；`tool_calls` 里没有 index，两项互相独立） */
const NON_STREAM_TWO = j({
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_a",
            type: "function",
            function: { name: "get_time", arguments: '{"timezone":"Asia/Shanghai"}' },
          },
          {
            id: "call_b",
            type: "function",
            function: { name: "get_temperature", arguments: '{"city":"杭州"}' },
          },
        ],
      },
      finish_reason: "tool_calls",
    },
  ],
});

const NON_STREAM_ONE = j({
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_a",
            type: "function",
            function: { name: "get_time", arguments: '{"timezone":"Asia/Shanghai"}' },
          },
        ],
      },
      finish_reason: "tool_calls",
    },
  ],
});

/* ──────────────────────────── 起假上游 ──────────────────────────── */

async function bootUpstream() {
  let lastErr;
  for (const p of PORTS) {
    try {
      return await startFakeUpstream({ port: p });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("假上游起不来");
}

const up = await bootUpstream();
const ORIGIN = `http://${up.host}:${up.port}`;

/** 对着某个 mode 发一次 POST（默认走 /chat/completions；shape="v1" 时走 /v1/...） */
async function postMode(mode, { shape = "plain", body, signal } = {}) {
  const suffix = shape === "v1" ? "/v1/chat/completions" : "/chat/completions";
  const url = `${up.base(mode)}${suffix}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
    },
    body: j(body ?? { model: MODEL, messages: [{ role: "user", content: "现在几点？" }] }),
    signal,
  });
  const text = await res.text();
  return { url, res, text };
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_time",
      description: "查当前时间",
      parameters: { type: "object", properties: { timezone: { type: "string" } } },
    },
  },
];

async function main() {
  console.log(`假上游起来了：${ORIGIN}（模式写在地址里，例如 ${ORIGIN}/ok-fragmented）`);
  console.log("生产模块：src/lib/tool-calls.ts（零 import，纯函数 + 累加器）\n");

  /* ═════════ 【0】假上游本身先自检 ═════════ */

  console.log("【0】假上游：7 种模式齐全，两种 URL 形状都能用");
  check(
    "7 种 mode 一个不少（ok-single / ok-fragmented / ok-two / no-tools-400 / text-only / html-error / timeout）",
    same(MODES, [
      "ok-single",
      "ok-fragmented",
      "ok-two",
      "no-tools-400",
      "text-only",
      "html-error",
      "timeout",
    ]),
    j(MODES),
  );

  const shapePlain = await postMode("ok-single", { body: { model: MODEL, stream: true } });
  check(
    "POST /<mode>/chat/completions 能用（200 + SSE）",
    shapePlain.res.status === 200 &&
      /text\/event-stream/.test(shapePlain.res.headers.get("content-type") ?? ""),
    `status=${shapePlain.res.status} ct=${shapePlain.res.headers.get("content-type")}`,
  );

  const shapeV1 = await postMode("ok-single", { shape: "v1", body: { model: MODEL, stream: true } });
  check(
    "POST /<mode>/v1/chat/completions 也能用（真实 base 常带 /v1）",
    shapeV1.res.status === 200,
    `status=${shapeV1.res.status}`,
  );
  check(
    "两种形状都记进了同一个 mode 的请求日志",
    up.hits("ok-single").length === 2,
    `实际 ${up.hits("ok-single").length}`,
  );

  const opt = await fetch(up.base("ok-single"), { method: "OPTIONS" });
  check("OPTIONS 预检回 204", opt.status === 204, `实际 ${opt.status}`);
  check(
    "OPTIONS 带你 access-control-allow-origin: *（浏览器直连要用）",
    opt.headers.get("access-control-allow-origin") === "*",
    `实际 ${j(opt.headers.get("access-control-allow-origin"))}`,
  );
  check(
    "SSE 响应也带 CORS 头",
    shapePlain.res.headers.get("access-control-allow-origin") === "*",
    `实际 ${j(shapePlain.res.headers.get("access-control-allow-origin"))}`,
  );

  /* ═════════ ① 分片拼装 ═════════ */

  console.log("\n【1】① 分片增量：函数名切成两半、arguments 切三段、后半段不给 index");
  const frag = await postMode("ok-fragmented", {
    body: { model: MODEL, stream: true, messages: [{ role: "user", content: "现在几点？" }] },
  });
  check("假上游回 200", frag.res.status === 200, `实际 ${frag.res.status}`);

  // 先证明"我们真的在考缺 index 这条路"：响应体里有不带 index 的 tool_calls 帧
  check(
    "响应体里确实存在**不带 index** 的 tool_calls 帧（否则这条断言等于没考）",
    /"tool_calls":\[\{"function"/.test(frag.text),
    frag.text.slice(0, 200),
  );
  check("响应体里名字是分两截给的（get_ / time）", /"name":"get_"/.test(frag.text) && /"name":"time"/.test(frag.text));
  check("响应体里有 [DONE] 收尾帧", /data: \[DONE\]/.test(frag.text));

  const fragParsed = checkNoThrow("分片响应体喂进 parseSseToolCalls", () =>
    parseSseToolCalls(frag.text),
  );
  check("分片：认出这是 SSE", fragParsed?.sse === true, `sse=${fragParsed?.sse}`);
  check(
    "分片：拼出 1 个调用（缺 index 的帧续到同一槽位，没被拆成好几个）",
    fragParsed?.calls.length === 1,
    `实际 ${j(fragParsed?.calls)}`,
  );
  check(
    "分片：函数名 `get_` + `time` 拼成了 get_time",
    fragParsed?.calls[0]?.name === "get_time",
    `实际 ${j(fragParsed?.calls[0]?.name)}`,
  );
  check(
    "分片：arguments 三段拼成合法 JSON，且 timezone === Asia/Shanghai",
    (() => {
      try {
        return JSON.parse(fragParsed?.calls[0]?.args ?? "").timezone === "Asia/Shanghai";
      } catch {
        return false;
      }
    })(),
    `实际 ${j(fragParsed?.calls[0]?.args)}`,
  );
  check(
    "分片：args 是逐字拼好的完整 JSON（不是半截）",
    fragParsed?.calls[0]?.args === '{"timezone":"Asia/Shanghai"}',
    `实际 ${j(fragParsed?.calls[0]?.args)}`,
  );

  /* ═════════ ② 一次两个 ═════════ */

  console.log("\n【2】② 一次两个调用：各自分片，名字/参数不许串味");
  const two = await postMode("ok-two", { body: { model: MODEL, stream: true } });
  const twoParsed = checkNoThrow("ok-two 响应体喂进 parseSseToolCalls", () =>
    parseSseToolCalls(two.text),
  );
  check("两个调用：认出 2 个", twoParsed?.calls.length === 2, `实际 ${j(twoParsed?.calls)}`);
  check(
    "第 1 个是 get_time（index 0）",
    twoParsed?.calls[0]?.name === "get_time",
    `实际 ${j(twoParsed?.calls[0]?.name)}`,
  );
  check(
    "第 2 个是 get_temperature（index 1）",
    twoParsed?.calls[1]?.name === "get_temperature",
    `实际 ${j(twoParsed?.calls[1]?.name)}`,
  );
  check(
    "两个的参数都是逐字正确的完整 JSON",
    twoParsed?.calls[0]?.args === '{"timezone":"Asia/Shanghai"}' &&
      twoParsed?.calls[1]?.args === '{"city":"杭州"}',
    `实际 ${j(twoParsed?.calls.map((c) => c.args))}`,
  );
  check(
    "没有串味：第 1 个里没有杭州、第 2 个里没有 timezone",
    !/杭州/.test(twoParsed?.calls[0]?.args ?? "") && !/timezone/.test(twoParsed?.calls[1]?.args ?? ""),
    j(twoParsed?.calls.map((c) => c.args)),
  );

  /* ═════════ ③ 空壳 ═════════ */

  console.log("\n【3】③ 空壳 tool_calls:[{}] 不算调用，但要被 dropped() 数出来");
  const shellText = frameOf({ tool_calls: [{}] }) + DONE;
  const shellParsed = checkNoThrow("空壳流喂进 parseSseToolCalls", () =>
    parseSseToolCalls(shellText),
  );
  check(
    "空壳：calls 长 0（没有函数名就等于没有调用）",
    shellParsed?.calls.length === 0,
    `实际 ${j(shellParsed?.calls)}`,
  );
  check("空壳：仍然是 SSE（不能因为没调用就说不是流式）", shellParsed?.sse === true);

  const accShell = createDeltaAccumulator();
  accShell.push({ tool_calls: [{}] });
  check("空壳：累加器 calls() 也是 0", accShell.calls().length === 0, j(accShell.calls()));
  check("空壳：dropped() === 1（丢了一个空壳，主链路可以据此提示）", accShell.dropped() === 1, `实际 ${accShell.dropped()}`);

  const accMix = createDeltaAccumulator();
  accMix.push({ tool_calls: [{}] });
  accMix.push({ tool_calls: [{ index: 1, function: { name: "get_time", arguments: "{}" } }] });
  check("空壳 + 真调用：只认 1 个调用", accMix.calls().length === 1, j(accMix.calls()));
  check("空壳 + 真调用：dropped() === 1", accMix.dropped() === 1, `实际 ${accMix.dropped()}`);

  const accEmptyArgs = createDeltaAccumulator();
  accEmptyArgs.push({
    tool_calls: [{ index: 0, id: "c0", function: { name: "ping", arguments: "" } }],
  });
  check(
    "参数为空字符串也**算**调用（无参工具是合法的）",
    accEmptyArgs.calls().length === 1 &&
      accEmptyArgs.calls()[0]?.name === "ping" &&
      accEmptyArgs.calls()[0]?.args === "",
    j(accEmptyArgs.calls()),
  );

  /* ═════════ ④ 非流式整份 JSON ═════════ */

  console.log("\n【4】④ 中转无视 stream:true、直接回一整份非流式 JSON");
  const wholeOne = checkNoThrow("单调用非流式体喂进 parseSseToolCalls", () =>
    parseSseToolCalls(NON_STREAM_ONE),
  );
  check(
    "非流式：识别出 1 个调用且 sse === false",
    wholeOne?.calls.length === 1 && wholeOne?.sse === false,
    `calls=${j(wholeOne?.calls)} sse=${wholeOne?.sse}`,
  );
  check(
    "非流式：name / args 都是完整的",
    wholeOne?.calls[0]?.name === "get_time" &&
      wholeOne?.calls[0]?.args === '{"timezone":"Asia/Shanghai"}',
    j(wholeOne?.calls[0]),
  );

  const wholeTwo = checkNoThrow("双调用非流式体喂进 parseSseToolCalls", () =>
    parseSseToolCalls(NON_STREAM_TWO),
  );
  check(
    "非流式两个调用：**不合并**（非流的 tool_calls 没有 index，不能按增量续槽）",
    wholeTwo?.calls.length === 2,
    `实际 ${j(wholeTwo?.calls)}`,
  );
  check(
    "非流式两个调用：名字/参数分别是 get_time / get_temperature",
    wholeTwo?.calls[0]?.name === "get_time" &&
      wholeTwo?.calls[1]?.name === "get_temperature" &&
      wholeTwo?.calls[1]?.args === '{"city":"杭州"}',
    j(wholeTwo?.calls),
  );

  /* ═════════ ⑤ text-only ═════════ */

  console.log("\n【5】⑤ 上游只说了句人话（没有任何 tool_call）");
  const textOnly = await postMode("text-only", { body: { model: MODEL, stream: true } });
  const textParsed = checkNoThrow("text-only 响应体喂进 parseSseToolCalls", () =>
    parseSseToolCalls(textOnly.text),
  );
  check("text-only：calls 长 0（没调用就是没调用）", textParsed?.calls.length === 0, j(textParsed?.calls));
  check("text-only：sse === true（确实是流式，只是没调工具）", textParsed?.sse === true);
  check(
    "text-only：正文增量被拼回来了（reply === 大概是下午三点吧。）",
    textParsed?.reply === "大概是下午三点吧。",
    `实际 ${j(textParsed?.reply)}`,
  );

  /* ═════════ ⑥ 坏输入永不抛 ═════════ */

  console.log("\n【6】⑥ HTML 错误页 / 空 body / 破 JSON / 错误帧 —— 永不抛、calls 0");
  const html = await postMode("html-error", { body: { model: MODEL, stream: true } });
  check("html-error：HTTP 502", html.res.status === 502, `实际 ${html.res.status}`);
  check(
    "html-error：content-type 是 text/html（不是 application/json）",
    /text\/html/.test(html.res.headers.get("content-type") ?? ""),
    `实际 ${j(html.res.headers.get("content-type"))}`,
  );
  check("html-error：body 真的是网页", /^\s*<!DOCTYPE/i.test(html.text), html.text.slice(0, 60));
  const htmlParsed = checkNoThrow("HTML 错误页喂进 parseSseToolCalls", () =>
    parseSseToolCalls(html.text),
  );
  check(
    "html-error：calls 0 且 sse === false（别把网页当流式）",
    htmlParsed?.calls.length === 0 && htmlParsed?.sse === false,
    `calls=${j(htmlParsed?.calls)} sse=${htmlParsed?.sse}`,
  );

  const emptyParsed = checkNoThrow("空 body 喂进 parseSseToolCalls", () => parseSseToolCalls(""));
  check("空 body：calls 0", emptyParsed?.calls.length === 0, j(emptyParsed?.calls));
  const blankParsed = checkNoThrow("只有空白/换行的 body", () => parseSseToolCalls("   \n\n\t "));
  check("只有空白：calls 0", blankParsed?.calls.length === 0, j(blankParsed?.calls));

  const brokenInputs = [
    ["data: {oops 半截 JSON", "data: {oops"],
    ["data: 后面跟着纯文字", "data: 这不是 JSON" + DONE],
    ["data: 后面跟着截断的对象", 'data: {"choices":[{"delta":'],
    ["data: 后面是 null", "data: null" + DONE],
    ["非 SSE 的破 JSON", "{不是 JSON"],
    ["JSON 但根本不是对象（null）", "null"],
    ["JSON 但根本不是对象（数字）", "12345"],
    ["JSON 但根本不是对象（数组）", "[]"],
    ["只有 [DONE]、没有任何内容", DONE],
    ["一串乱码", "§±∞≈ç√∫˜µ≤≥÷ 🐟🐟🐟" + "\n".repeat(20)],
    ["工具字段是 null", frameOf({ tool_calls: null }) + DONE],
    ["functions 字段是字符串", frameOf({ tool_calls: "oops" }) + DONE],
  ];
  let broke = null;
  const brokenResults = [];
  for (const [label, text] of brokenInputs) {
    try {
      const r = parseSseToolCalls(text);
      brokenResults.push([label, r]);
    } catch (err) {
      broke = `${label} → ${err?.name}: ${err?.message}`;
      break;
    }
  }
  check(
    "12 种坏输入一个都没抛异常",
    broke === null,
    broke ?? "",
  );
  check(
    "12 种坏输入全部 calls 0（宁可「没调用」，也不许瞎认）",
    brokenResults.length === brokenInputs.length &&
      brokenResults.every(([, r]) => r.calls.length === 0),
    j(brokenResults.map(([l, r]) => [l, r.calls.length])),
  );

  for (const [label, value] of [
    ["undefined", undefined],
    ["null", null],
    ["数字", 42],
  ]) {
    checkNoThrow(`类型不对的入参（${label}）`, () => parseSseToolCalls(value));
  }

  const errFrame = checkNoThrow("流里的错误帧", () =>
    parseSseToolCalls(
      frameOf({ content: "hi" }) + `data: ${j({ error: { message: "内部错误" } })}\n\n` + DONE,
    ),
  );
  check(
    "错误帧：读进 error、且不算「有调用」",
    errFrame?.calls.length === 0 && /内部错误/.test(errFrame?.error ?? ""),
    `calls=${j(errFrame?.calls)} error=${j(errFrame?.error)}`,
  );
  check("错误帧：reply 保留流里已经说出的正文", errFrame?.reply === "hi", j(errFrame?.reply));

  /* ═════════ ⑦ 真 fetch + 累加器一致性 ═════════ */

  console.log("\n【7】⑦ 真 fetch 走一遍：请求发得对 + 生产累加器与验收解析器结论一致");
  up.clear();
  const live = await postMode("ok-fragmented", {
    body: {
      model: MODEL,
      stream: true,
      messages: [{ role: "user", content: "现在几点？必须调用 get_time。" }],
      tools: TOOLS,
    },
  });
  check("真 fetch：HTTP 200", live.res.status === 200, `实际 ${live.res.status}`);

  const got = up.hits("ok-fragmented");
  check("宿主收到了这条请求（记了 1 条）", got.length === 1, `实际 ${got.length}`);
  const r0 = got[0];
  check(
    "收件地址就是 base + /chat/completions",
    r0?.path === "/ok-fragmented/chat/completions",
    `实际 ${j(r0?.path)}`,
  );
  check("方法是 POST", r0?.method === "POST", `实际 ${j(r0?.method)}`);
  check(
    "①宿主收到了 tools 字段（标准形状：type=function + function.name）",
    r0?.payload?.tools?.[0]?.type === "function" &&
      r0?.payload?.tools?.[0]?.function?.name === "get_time" &&
      typeof r0?.payload?.tools?.[0]?.function?.description === "string",
    j(r0?.payload?.tools?.[0]),
  );
  check(
    "②Authorization 头是 Bearer <key>",
    r0?.authorization === `Bearer ${KEY}`,
    `实际 ${j(r0?.authorization)}`,
  );
  check(
    "③宿主看到的是流式请求（stream:true）",
    r0?.payload?.stream === true && r0?.stream === true,
    `payload.stream=${j(r0?.payload?.stream)} 记录.stream=${j(r0?.stream)}`,
  );
  check("Content-Type 是 application/json", /application\/json/.test(r0?.contentType ?? ""), j(r0?.contentType));
  check("请求体完整记下来了（raw 非空、payload.model 对得上）", (r0?.raw?.length ?? 0) > 0 && r0?.payload?.model === MODEL);

  const accLive = createDeltaAccumulator();
  const fed = feedByFrames(live.text, accLive);
  check("逐帧喂进了累加器（至少 3 帧 delta）", fed >= 3, `实际 fed=${fed}`);
  const accCalls = accLive.calls();
  check("累加器：拼出 1 个调用", accCalls.length === 1, j(accCalls));
  check(
    "累加器：name / args 与验收解析器**完全一致**",
    same(
      accCalls.map((c) => ({ name: c.name, args: c.args })),
      fragParsed?.calls.map((c) => ({ name: c.name, args: c.args })),
    ),
    `acc=${j(accCalls)} parser=${j(fragParsed?.calls)}`,
  );
  check(
    "累加器：id 也认出来了（call_a），index 归位到 0",
    accCalls[0]?.id === "call_a" && accCalls[0]?.index === 0,
    j(accCalls[0]),
  );
  check("累加器：这一轮没有被丢掉的空壳（dropped() === 0）", accLive.dropped() === 0, `实际 ${accLive.dropped()}`);
  check(
    "累加器：同一份文本再喂一遍，结果仍然一致（calls() 是快照、可重复读）",
    same(accLive.calls(), accCalls),
    j(accLive.calls()),
  );

  const accTwo = createDeltaAccumulator();
  feedByFrames(two.text, accTwo);
  check(
    "累加器走 ok-two：2 个调用、id 分别是 call_a / call_b、顺序按 index",
    accTwo.calls().length === 2 &&
      accTwo.calls()[0]?.id === "call_a" &&
      accTwo.calls()[1]?.id === "call_b" &&
      accTwo.calls()[0]?.index === 0 &&
      accTwo.calls()[1]?.index === 1,
    j(accTwo.calls()),
  );
  check("累加器走 ok-two：第 2 个的参数没有串到第 1 个上", accTwo.calls()[0]?.args === '{"timezone":"Asia/Shanghai"}' && accTwo.calls()[1]?.args === '{"city":"杭州"}', j(accTwo.calls().map((c) => c.args)));

  const v1Live = await postMode("ok-fragmented", {
    shape: "v1",
    body: { model: MODEL, stream: true, tools: TOOLS },
  });
  check("base 带 /v1 的形状也 200", v1Live.res.status === 200, `实际 ${v1Live.res.status}`);
  check(
    "两笔请求都记在 ok-fragmented 下（路径分别是 /ok-fragmented/chat/completions 与 /ok-fragmented/v1/chat/completions）",
    up.hits("ok-fragmented").length === 2 &&
      up.hits("ok-fragmented")[1]?.path === "/ok-fragmented/v1/chat/completions",
    j(up.hits("ok-fragmented").map((h) => h.path)),
  );

  /* ═════════ ⑧ 400 降级信号 ═════════ */

  console.log("\n【8】⑧ 上游 400：能读出「tools is not supported by this model」（降级要靠它）");
  const bad = await postMode("no-tools-400", {
    body: { model: MODEL, stream: true, tools: TOOLS },
  });
  check("no-tools-400：HTTP 状态就是 400", bad.res.status === 400, `实际 ${bad.res.status}`);
  const badBody = (() => {
    try {
      return JSON.parse(bad.text);
    } catch {
      return null;
    }
  })();
  check(
    "no-tools-400：body 是 JSON 且 error.message 原话可读",
    badBody?.error?.message === "tools is not supported by this model",
    `实际 ${j(badBody)}`,
  );
  check(
    "no-tools-400：宿主也收到了 tools（证明这次 400 是「因为 tools」而不是别的原因）",
    Array.isArray(up.hits("no-tools-400")[0]?.payload?.tools),
    j(up.hits("no-tools-400")[0]?.payload?.tools),
  );
  check(
    "400 的正文喂进解析器也不抛（主链路可能会顺手解析它）",
    (() => {
      try {
        const r = parseSseToolCalls(bad.text);
        return r.calls.length === 0;
      } catch {
        return false;
      }
    })(),
  );

  /* ═════════ ⑨ timeout（挂着不回） ═════════ */

  console.log("\n【9】⑨ timeout：一个字都不回 —— 请求确实到了，客户端自己超时，不卡死");
  const t0 = Date.now();
  let timeoutErr = null;
  try {
    await fetch(`${up.base("timeout")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: j({ model: MODEL, stream: true, tools: TOOLS }),
      signal: AbortSignal.timeout(1200),
    });
  } catch (err) {
    timeoutErr = err;
  }
  const elapsed = Date.now() - t0;
  check(
    "timeout：客户端按 1.2 秒超时中断（抛的是超时/中断，不是别的东西）",
    timeoutErr !== null && /TimeoutError|AbortError/.test(timeoutErr?.name ?? ""),
    `err=${timeoutErr?.name}: ${timeoutErr?.message}`,
  );
  check("timeout：很快就返回了（没被挂死）", elapsed < 5000, `实际 ${elapsed}ms`);
  check(
    "timeout：假上游确实收到了这笔请求（挂着不等于没收到）",
    up.hits("timeout").length === 1,
    `实际 ${up.hits("timeout").length}`,
  );
  check(
    "timeout：没有正文时解析器给 calls 0（主链路该怎么兜底）",
    parseSseToolCalls("").calls.length === 0,
  );

  /* ═════════ 收尾 ═════════ */

  console.log("\n【10】跨模式体检");
  check("所有断言汇总后没有失败项", failures.length === 0, failures.slice(0, 3).join(" / "));
  check(
    "累加器工厂每次都是新实例（互不串数据）",
    (() => {
      const a = createDeltaAccumulator();
      a.push({ tool_calls: [{ index: 0, function: { name: "x", arguments: "{}" } }] });
      return createDeltaAccumulator().calls().length === 0 && a.calls().length === 1;
    })(),
  );
  check(
    "对象形式的 arguments 会被 JSON.stringify 后拼接（个别上游这么给）",
    (() => {
      const a = createDeltaAccumulator();
      a.push({ tool_calls: [{ index: 0, function: { name: "get_time", arguments: { timezone: "Asia/Shanghai" } } }] });
      return a.calls()[0]?.args === '{"timezone":"Asia/Shanghai"}';
    })(),
    j(
      (() => {
        const a = createDeltaAccumulator();
        a.push({ tool_calls: [{ index: 0, function: { name: "get_time", arguments: { timezone: "Asia/Shanghai" } } }] });
        return a.calls()[0]?.args;
      })(),
    ),
  );
  check(
    "老式 function_call 增量也认（没有 tool_calls 时）",
    (() => {
      const a = createDeltaAccumulator();
      a.push({ function_call: { name: "get_", arguments: '{"time' } });
      a.push({ function_call: { name: "time", arguments: 'zone":"Asia/Shanghai"}' } });
      return a.calls().length === 1 && a.calls()[0]?.name === "get_time";
    })(),
    (() => {
      const a = createDeltaAccumulator();
      a.push({ function_call: { name: "get_", arguments: '{"time' } });
      a.push({ function_call: { name: "time", arguments: 'zone":"Asia/Shanghai"}' } });
      return j(a.calls());
    })(),
  );
}

/* ──────────────────────────────── 开跑 ──────────────────────────────── */

try {
  await main();
} catch (err) {
  console.error("验收脚本自己崩了：", err);
  failures.push(`脚本异常：${err?.message ?? err}`);
} finally {
  await up.close();
}

console.log(`\n${"─".repeat(72)}`);
if (failures.length === 0) {
  console.log(`全部通过：${passed} 项断言 ✅（假上游 ${ORIGIN} 已停）`);
} else {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项 ❌`);
  for (const f of failures) console.log(`  · ${f}`);
}
process.exit(failures.length === 0 ? 0 : 1);
