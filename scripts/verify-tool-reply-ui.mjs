import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";

const base = process.env.QIDAO_TEST_BASE || "http://127.0.0.1:8080";
const frame = (delta, finish_reason = null) => ({ choices: [{ index: 0, delta, finish_reason }] });
let scenario = "buffered";
const requests = [];
const finalText = "答案是 A。工具核对后补充了依据。";
const upstream = createServer(async (req, res) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push(body);
  const used = body.messages.filter((m) => m.role === "tool").length;
  const needsTool = scenario !== "repeat" && used < (scenario === "multiple" ? 2 : 1);
  const text = scenario === "repeat" ? "好。好。" : needsTool ? "答案是 A。" : finalText;
  const frames = [frame({ reasoning_content: needsTool ? "先核对事实。" : "根据核对结果回答。" })];
  const pieces = scenario === "streamed" ? text.match(/.{1,5}/g) : [text];
  if (scenario !== "tool-only" || !needsTool) for (const content of pieces) frames.push(frame({ content }));
  if (needsTool) frames.push(frame({ tool_calls: [{ index: 0, id: "check_" + used, type: "function",
    function: { name: "emotion_report", arguments: '{"primaryEmotion":"calm","note":"核对记录"}' } }] }));
  frames.push(frame({}, needsTool ? "tool_calls" : "stop"));
  res.writeHead(200, { ...cors, "content-type": "text/event-stream" });
  for (const f of frames) {
    res.write(`data: ${JSON.stringify(f)}\n\n`);
    if (scenario === "streamed") await new Promise((resolve) => setTimeout(resolve, 100));
  }
  res.end("data: [DONE]\n\n");
});
await new Promise((resolve) => upstream.listen(4649, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (scenario of ["buffered", "streamed", "multiple", "tool-only", "repeat"]) {
    requests.length = 0;
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/scripts/tool-reply-fixture.html`);
    await page.getByRole("button", { name: "开始复现" }).click();
    const expected = scenario === "repeat" ? "好。好。" : finalText;
    await page.waitForFunction((text) => document.querySelector('[data-testid="busy"]')?.textContent === "idle"
      && document.querySelector('[data-testid="reply"]')?.textContent === text, expected, { timeout: 30000 });
    const stored = JSON.parse(await page.getByTestId("message").innerText());
    assert.equal(stored.content, expected);
    assert.equal((stored.parts || []).join("\n").includes("答案是 A。答案是 A。"), false);
    const calls = stored.steps?.filter((s) => s.kind === "call").length || 0;
    assert.equal(calls, scenario === "repeat" ? 0 : scenario === "multiple" ? 2 : 1);
    if (scenario !== "repeat") {
      assert.equal(requests.length, calls + 1);
      assert.ok(requests[1].messages.some((m) => m.role === "assistant" && m.tool_calls?.length
        && m.content === (scenario === "tool-only" ? "" : "答案是 A。")));
      assert.match(stored.thinking, /先核对事实。/);
      assert.match(stored.thinking, /根据核对结果回答。/);
    }
    assert.deepEqual(errors, []);
    console.log(`PASS real chat hook: ${scenario}, one stored reply, ${calls} tool call(s)`);
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => upstream.close(resolve));
}
