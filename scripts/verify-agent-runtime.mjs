import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createTerminalRuntime, startMcpBridge, TERMINAL_NAME } from "../public/bridges/qidao-mcp-bridge.mjs";
import { chatError, formatChatError, upstreamError } from "../src/lib/chat-errors.ts";
import { termuxConfig, termuxTerminal } from "../src/lib/mcp-config.ts";
import { once } from "node:events";

registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@capacitor/core") return { shortCircuit: true, url: "data:text/javascript,export const Capacitor = {isNativePlatform:()=>false};" };
  if (specifier === "@/lib/utils") return { shortCircuit: true, url: "data:text/javascript,export const uid = () => 'fixture';" };
  if (specifier.startsWith("@/")) return { shortCircuit: true, url: new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href };
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });

test("diagnostics preserve upstream metadata and classify reasoning failures before retry/fallback", async () => {
  const error = upstreamError(400, JSON.stringify({ error: { type: "invalid_request_error", code: "invalid_messages", message: "The reasoning_content in the thinking mode must be passed back to the API. invalid tool messages" }, request_id: "request-123" }));
  assert.match(error, /HTTP 400/); assert.match(error, /request_id=request-123/); assert.match(error, /code=invalid_messages/);
  assert.equal(chatError(error).retryable, false); assert.match(chatError(error).category, /接口协议错误/);
  const { looksLikeToolsUnsupported } = await import("../src/lib/tool-wire.ts");
  assert.equal(looksLikeToolsUnsupported(400, error), false);
  assert.equal(chatError("HTTP 401\ninvalid api key").category, "认证失败");
  assert.equal(chatError("HTTP 429\nrate_limit").retryable, true);
  assert.equal(chatError("HTTP 402\ninsufficient_balance").retryable, false);
  assert.match(chatError("HTTP 400\ncontext_length_exceeded").category, /上下文/);
  assert.equal(chatError("HTTP 503\nservice unavailable").retryable, true);
  const display = formatChatError(`${error}\nAuthorization: Bearer private-authorization\napi_key=sk-123456789abcdef`, 0);
  assert.doesNotMatch(display, /private-authorization|123456789abcdef/);
  assert.match(display, /未自动重试/); assert.doesNotMatch(display, /网络不通/);
});

test("ordinary assistant thinking survives history and prompt assembly across user turns", async () => {
  const { historyForApi } = await import("../src/lib/chat-client.ts");
  const { assembleMessages } = await import("../src/lib/prompt.ts");
  const history = historyForApi([
    { role: "user", content: "第一问", thinking: "" },
    { role: "assistant", content: "第一答", thinking: "原始思考，不能丢失" },
    { role: "assistant", content: "", thinking: "", requestError: "HTTP 400" },
    { role: "user", content: "第二问", thinking: "" },
  ], { autoCompact: false });
  assert.equal(history.length, 3);
  assert.equal(history[1].reasoning_content, "原始思考，不能丢失");
  const messages = assembleMessages({ model: "sonnet", style: "concise", aiName: "小克", tools: [], context: {} }, history);
  assert.equal(messages.find((m) => m.role === "assistant").reasoning_content, "原始思考，不能丢失");
  assert.equal(messages.at(-1).role, "user");
});

test("server JSON failure retains status and never falls through to a second direct request", async () => {
  const { streamChat, makeServerRound } = await import("../src/lib/chat-client.ts");
  const real = globalThis.fetch; const seen = [];
  globalThis.fetch = async (url) => { seen.push(url); return Response.json({ error: 'HTTP 400\nreasoning_content missing', toolsUnsupported: false }, { status: 400 }); };
  try {
    const errors = [];
    await streamChat({ messages: [{ role: "user", content: "test" }] }, (d) => { if (d.error) errors.push(d.error); });
    assert.deepEqual(seen, ["/api/chat"]); assert.match(errors[0], /HTTP 400/);
    const result = await makeServerRound({ messages: [] })({ messages: [], tools: [], onDelta() {} });
    assert.match(result.error, /reasoning_content/); assert.equal(result.toolsRejected, false);
    globalThis.fetch = async () => Response.json({ error: 'tools not supported', toolsUnsupported: true }, { status: 400 });
    const unsupported = await makeServerRound({ messages: [] })({ messages: [], tools: [], onDelta() {} });
    assert.equal(unsupported.toolsRejected, true);
  } finally { globalThis.fetch = real; }
});

async function completed(runtime, job) {
  for (let i = 0; i < 20; i++) {
    const result = await runtime.call("status", { jobId: job.jobId, waitMs: 1000 });
    if (result.state !== "running") return result;
  }
  throw new Error("Job did not finish");
}

test("terminal returns actual stdout, stderr and exit code; rejects invalid directories", async () => {
  const runtime = createTerminalRuntime();
  try {
    const job = await runtime.call("execute", { command: "printf 'hello'; printf 'failure detail' >&2; exit 7" });
    assert.equal(job.state, "running");
    const result = await completed(runtime, job);
    assert.equal(result.exitCode, 7); assert.equal(result.state, "failed"); assert.equal(result.category, "command_exit");
    assert.equal(result.stdout, "hello"); assert.equal(result.stderr, "failure detail");
    const missing = await completed(runtime, await runtime.call("execute", { command: "qidao_missing_command_for_test" }));
    assert.equal(missing.category, "command_not_found");
    await assert.rejects(runtime.call("execute", { command: "true", cwd: "/qidao/nonexistent" }), /cwd_unavailable/);
    await assert.rejects(runtime.call("execute", { command: "true", cwd: "relative" }), /绝对路径/);
    await assert.rejects(runtime.call("status", { jobId: "unknown" }), /job_not_found/);
    const env = await completed(runtime, await runtime.call("environment"));
    assert.match(env.stdout, /System:.*Linux/); assert.match(env.stdout, /node: v/);
  } finally { runtime.close(); }
});

test("terminal bounds output, reports timeout/cancellation and closes running tasks", async () => {
  const runtime = createTerminalRuntime();
  try {
    const huge = await completed(runtime, await runtime.call("execute", { command: "head -c 100000 /dev/zero" }));
    assert.equal(huge.stdout.length, 65536); assert.equal(huge.truncated, true);
    const timeout = await completed(runtime, await runtime.call("execute", { command: "sleep 20", timeoutMs: 30 }));
    assert.equal(timeout.state, "timeout"); assert.equal(timeout.category, "timeout");
    const job = await runtime.call("execute", { command: "sleep 20" });
    await runtime.call("cancel", { jobId: job.jobId });
    assert.equal((await completed(runtime, job)).state, "cancelled");
    const closing = await runtime.call("execute", { command: "sleep 20" });
    runtime.close(); assert.equal((await completed(runtime, closing)).state, "cancelled");
    await assert.rejects(runtime.call("execute", { command: "true" }), /terminal_closed/);
  } finally { runtime.close(); }
});

test("terminal bridge requires opt-in and token, exposes real MCP execution and cancels on disconnect", async () => {
  const terminal = { ...termuxTerminal(), id: "terminal-test", tools: [] };
  const config = termuxConfig([terminal]); assert.equal(config.qidaoBridge.terminalEnabled, true);
  assert.equal(termuxConfig([{ ...terminal, enabled: false }]).qidaoBridge.terminalEnabled, undefined);
  const server = startMcpBridge(config, { port: 0 }); await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/mcp/${TERMINAL_NAME}`;
  let session;
  async function request(method, params) {
    const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${terminal.bridgeToken}`, "content-type": "application/json", ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    session = response.headers.get("mcp-session-id") || session;
    return response.json();
  }
  try {
    assert.equal((await fetch(url, { method: "POST" })).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers: { authorization: `Bearer ${terminal.bridgeToken}`, origin: "https://untrusted.example" } })).status, 403);
    assert.equal((await request("initialize")).result.serverInfo.name, "栖岛 Termux");
    assert.deepEqual((await request("tools/list")).result.tools.map((tool) => tool.name), ["environment", "execute", "status", "cancel"]);
    const job = JSON.parse((await request("tools/call", { name: "execute", arguments: { command: "printf '桥接执行成功'" } })).result.content[0].text);
    const status = await request("tools/call", { name: "status", arguments: { jobId: job.jobId, waitMs: 1000 } });
    assert.equal(JSON.parse(status.result.content[0].text).stdout, "桥接执行成功");
    assert.equal(JSON.parse(status.result.content[0].text).exitCode, 0);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  const disabled = startMcpBridge({ ...config, qidaoBridge: { ...config.qidaoBridge, terminalEnabled: false } }, { port: 0 }); await once(disabled, "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${disabled.address().port}/mcp/${TERMINAL_NAME}`, { method: "POST", headers: { authorization: `Bearer ${terminal.bridgeToken}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) });
    assert.equal(response.status, 502); assert.match(await response.text(), /terminal_disabled/);
  } finally { disabled.closeAllConnections(); await new Promise((resolve) => disabled.close(resolve)); }
});
