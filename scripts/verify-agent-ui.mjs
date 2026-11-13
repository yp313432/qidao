import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, readFile } from "node:fs/promises";
import { startMcpBridge } from "../public/bridges/qidao-mcp-bridge.mjs";
const base = process.env.QIDAO_TEST_BASE || "http://127.0.0.1:8080";
const shots = process.env.QIDAO_SHOTS || "screenshots/agent";
let scenario = "error", lastJob;
const requests = [];
const upstream = createServer(async (req, res) => {
  const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "x-request-id", "content-type": "application/json" };
  if (req.method === "OPTIONS") { res.writeHead(204, headers).end(); return; }
  let raw = ""; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); requests.push(body);
  if (scenario === "error") {
    res.writeHead(400, { ...headers, "x-request-id": "reasoning-test-123" }).end(JSON.stringify({ error: { type: "invalid_request_error", code: "missing_reasoning", message: "The reasoning_content in the thinking mode must be passed back to the API." } })); return;
  }
  const used = body.messages.filter((m) => m.role === "tool").length;
  let delta = { content: scenario === "terminal" ? "Termux 检查和命令已完成。" : "收到你的问题。" };
  if (scenario === "terminal" && used < 4) {
    const tool = ["environment", "status", "execute", "status"][used];
    const name = body.tools.find((t) => t.function.name.startsWith("mcp_") && t.function.name.endsWith(`_${tool}`))?.function.name;
    if (!name) { res.writeHead(500, headers).end(JSON.stringify({ error: `Missing terminal tool ${tool}` })); return; }
    const args = tool === "environment" ? {} : tool === "execute" ? { command: "printf AI_TERMINAL_OK" } : { jobId: lastJob, waitMs: 20000 };
    delta = { tool_calls: [{ index: 0, id: `terminal_${used}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] };
  }
  res.writeHead(200, { ...headers, "content-type": "text/event-stream" });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: `原始思考${used}` } }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }] })}\n\n`);
  res.end("data: [DONE]\n\n");
});
upstream.listen(4650, "127.0.0.1"); await once(upstream, "listening");
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
let bridge;
async function send(page, text) {
  await page.getByRole("textbox", { name: "消息输入框", exact: true }).fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
}
async function idle(page) { await page.getByRole("button", { name: "停止回复", exact: true }).waitFor({ state: "hidden", timeout: 30000 }); }
async function shot(page, name) {
  await mkdir(shots, { recursive: true }); await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
  console.log("QIDAO_PREVIEW " + JSON.stringify({ name, base64: (await page.screenshot({ type: "jpeg", quality: 55, fullPage: true })).toString("base64") }));
}
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/scripts/chat-page-fixture.html`);
  await send(page, "测试截图里的接口错误");
  const errorCard = page.getByTestId("chat-request-error");
  await errorCard.waitFor(); await idle(page);
  assert.match(await errorCard.innerText(), /接口协议错误 · 思考内容缺失/);
  assert.match(await errorCard.innerText(), /HTTP 400/); assert.match(await errorCard.innerText(), /missing_reasoning/);
  assert.match(await errorCard.innerText(), /reasoning-test-123/); assert.match(await errorCard.innerText(), /未自动重试/);
  assert.equal(await errorCard.count(), 1); assert.equal(requests.length, 1, "deterministic 400 must not be retried");
  assert.equal(await page.getByText(/可能是：连接被掐断|地址\/密钥不对/).count(), 0);
  await shot(page, "reasoning-error-mobile");
  await page.setViewportSize({ width: 1280, height: 900 }); await shot(page, "reasoning-error-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  scenario = "chat";
  await send(page, "现在正常聊天");
  await page.waitForFunction(() => window.qidaoFixture.read().messages.some((m) => m.content === "收到你的问题。")); await idle(page);
  await send(page, "继续聊第二轮");
  await page.waitForFunction(() => window.qidaoFixture.read().messages.filter((m) => m.content === "收到你的问题。").length === 2); await idle(page);
  const replay = requests.at(-1).messages.find((m) => m.role === "assistant");
  assert.equal(replay.reasoning_content, "原始思考0");
  assert.doesNotMatch(JSON.stringify(requests.at(-1).messages), /missing_reasoning|reasoning-test-123/);

  await page.evaluate(() => window.qidaoFixture.navigate("/tools"));
  await page.getByRole("button", { name: "MCP", exact: true }).click();
  await page.getByText("让 AI 操作 Termux", { exact: true }).click();
  await page.getByRole("button", { name: "添加 Termux 控制", exact: true }).click();
  await page.getByRole("status").filter({ hasText: /已添加 Termux 控制入口/ }).waitFor();
  await page.getByText("Termux 首次连接与本地 MCP", { exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 Termux 配置", exact: true }).click();
  const download = await downloadPromise;
  const config = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(config.qidaoBridge.terminalEnabled, true);
  bridge = startMcpBridge(config); await once(bridge, "listening");
  // Simulate the native transport boundary: browser Origin is not forwarded by Android HTTP.
  // The real bridge, MCP handshake, subprocess and tool permission flow are still exercised.
  await page.route("http://127.0.0.1:8767/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST,DELETE,GET,OPTIONS" } }); return; }
    const headers = { ...request.headers() }; delete headers.origin; delete headers["content-length"]; delete headers.host;
    const response = await fetch(request.url(), { method: request.method(), headers, body: request.postData() || undefined });
    const body = await response.text();
    try { const data = JSON.parse(body); const output = data.result?.content?.[0]?.text; if (output) lastJob = JSON.parse(output).jobId || lastJob; } catch { /* handshake/errors */ }
    await route.fulfill({ status: response.status, headers: { ...Object.fromEntries(response.headers), "access-control-allow-origin": "*", "access-control-expose-headers": "Mcp-Session-Id" }, body });
  });
  await page.getByRole("button", { name: /^Termux 终端/ }).click();
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await page.getByText(/拿到 4 个工具/).first().waitFor();
  await shot(page, "termux-tools-mobile");
  await page.evaluate(() => window.qidaoFixture.navigate("/"));
  scenario = "terminal"; const before = requests.length;
  await send(page, "检查 Termux 环境并执行测试命令");
  for (let i = 0; i < 4; i++) {
    if (i === 2) {
      assert.match(await page.getByTestId("termux-command-preview").innerText(), /printf AI_TERMINAL_OK/);
      await shot(page, "termux-command-permission-mobile");
    }
    await page.getByRole("button", { name: "允许一次", exact: true }).click();
    for (let n = 0; n < 600 && requests.length < before + i + 2; n++) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(requests.length >= before + i + 2, "gated terminal result must return to the model");
  }
  await page.waitForFunction(() => window.qidaoFixture.read().messages.at(-1)?.content === "Termux 检查和命令已完成。", undefined, { timeout: 30000 }); await idle(page);
  const finalRequest = requests.at(-1), results = finalRequest.messages.filter((m) => m.role === "tool");
  assert.equal(results.length, 4); assert.match(results.at(-1).content, /AI_TERMINAL_OK/); assert.match(results.at(-1).content, /exitCode/);
  assert.ok(finalRequest.messages.filter((m) => m.tool_calls).every((m) => m.reasoning_content));
  const finalMessage = await page.evaluate(() => window.qidaoFixture.read().messages.at(-1));
  assert.equal(finalMessage.rounds.flatMap((r) => r.calls).length, 4); assert.equal(finalMessage.requestError, undefined);
  assert.deepEqual(errors, []);
  await context.close(); console.log("PASS agent UI: diagnostic card, no 400 retry, reasoning replay, Termux opt-in/export/handshake, four gated tools and real shell output");
} finally { await browser.close(); if (bridge) { bridge.closeAllConnections(); await new Promise((resolve) => bridge.close(resolve)); } upstream.closeAllConnections(); await new Promise((resolve) => upstream.close(resolve)); }
