import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.QIDAO_TEST_BASE || "http://127.0.0.1:8080";
const frame = (delta, finish_reason = null) => ({ choices: [{ index: 0, delta, finish_reason }] });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let scenario = "queue";
const requests = [];
const upstream = createServer(async (req, res) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push(body);
  const used = body.messages.filter((m) => m.role === "tool").length;
  const frames = [];
  if (scenario === "queue" || scenario === "pagequeue") {
    await sleep(scenario === "pagequeue" ? 1800 : 900);
    frames.push(frame({ content: "收到。会一起考虑。" }));
  } else if (!used) {
    const name = scenario === "cleanup" ? "emotion_report" : "sticker_send";
    const args = scenario === "cleanup" ? { primaryEmotion: "被看穿的心慌", group: "flutter", intensity: 0.4, confidence: 0.6 } : { feel: "开心" };
    const count = scenario === "stickers" ? 2 : 1;
    frames.push(frame({ tool_calls: Array.from({ length: count }, (_, index) => ({ index, id: `action_${index}`, type: "function",
      function: { name, arguments: JSON.stringify(args) } })) }));
  } else {
    await sleep(scenario === "stickers" ? 1200 : 30);
    frames.push(frame({ content: scenario === "cleanup"
      ? '我在听。{"primaryEmotion":"开心","intensity":0.5}<emotion>开心</emotion>[表情包]慢慢说。'
      : scenario === "empty" ? "表情库暂时没有图片，先陪你聊聊。" : scenario === "disabled" ? "你关闭了 AI 发表情，先陪你聊聊。" : "[表情包]" }));
  }
  frames.push(frame({}, !used && scenario !== "queue" && scenario !== "pagequeue" ? "tool_calls" : "stop"));
  res.writeHead(200, { ...cors, "content-type": "text/event-stream" });
  for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`);
  res.end("data: [DONE]\n\n");
});
await new Promise((resolve) => upstream.listen(4650, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
async function open(query = "") {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.error("BROWSER ERROR", error.stack); });
  page.on("console", (message) => { if (message.type() === "error") console.error("BROWSER CONSOLE", message.text()); });
  await page.goto(`${base}/scripts/chat-delivery-fixture.html${query}`);
  try { await page.getByTestId("busy").waitFor(); }
  catch (error) { console.error("FIXTURE CONTENT", await page.locator("body").innerText()); throw error; }
  return { context, page, errors };
}
const stored = async (page) => JSON.parse(await page.getByTestId("messages").textContent());
async function send(page, text) {
  await page.getByRole("textbox").fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
}
async function idle(page, assistants) {
  await page.waitForFunction((count) => document.querySelector('[data-testid="busy"]')?.textContent === "idle"
    && JSON.parse(document.querySelector('[data-testid="messages"]')?.textContent || "[]").filter((m) => m.role === "assistant").length === count,
  assistants, { timeout: 30000 });
}
try {
  {
    const { context, page, errors } = await open();
    await page.getByRole("button", { name: "演示逐条发送" }).click();
    const bubbles = page.getByTestId("pace").locator('[data-role="ai"]');
    await bubbles.first().waitFor();
    assert.equal(await bubbles.count(), 1);
    const firstAt = Date.now();
    await page.waitForTimeout(200); assert.equal(await bubbles.count(), 1);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="pace"] [data-role="ai"]').length === 2);
    const secondAt = Date.now(); assert.ok(secondAt - firstAt >= 400);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="pace"] [data-role="ai"]').length === 3);
    assert.ok(Date.now() - secondAt >= 700);
    await page.getByRole("button", { name: "慢一点", exact: true }).click();
    assert.equal(await page.getByTestId("pace-setting").textContent(), "90");
    // Revision must discard queued old text instead of appending both versions.
    await page.getByRole("button", { name: "修订回复" }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="pace"] [data-role="ai"]')?.textContent === "换个说法。");
    assert.equal(await bubbles.count(), 1);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="pace"] [data-role="ai"]').length === 2);
    assert.equal((await bubbles.allTextContents()).join(""), "换个说法。新的补充。");
    await page.getByRole("switch", { name: "逐条发送", exact: true }).click();
    assert.equal(await page.getByRole("switch", { name: "智能发送节奏" }).count(), 0);
    if (process.env.QIDAO_SHOTS) {
      await mkdir(process.env.QIDAO_SHOTS, { recursive: true });
      await page.screenshot({ path: `${process.env.QIDAO_SHOTS}/chat-delivery-mobile.png`, fullPage: true });
      if (process.env.QIDAO_SCREENSHOT_PREVIEW) console.log("QIDAO_PREVIEW " + JSON.stringify({ name: "chat-delivery-mobile", base64: (await page.screenshot({ type: "jpeg", quality: 55, fullPage: true })).toString("base64") }));
    }
    assert.deepEqual(errors, []); await context.close();
    console.log("PASS real bubbles: sentence timing, setting changes, obsolete drafts cancelled");
  }
  {
    const { context, page, errors } = await open("?history");
    assert.equal(await page.getByTestId("pace").locator('[data-role="ai"]').count(), 3);
    await page.setViewportSize({ width: 1280, height: 900 });
    if (process.env.QIDAO_SHOTS) await page.screenshot({ path: `${process.env.QIDAO_SHOTS}/chat-delivery-desktop.png`, fullPage: true });
    if (process.env.QIDAO_SCREENSHOT_PREVIEW) console.log("QIDAO_PREVIEW " + JSON.stringify({ name: "chat-delivery-desktop", base64: (await page.screenshot({ type: "jpeg", quality: 55, fullPage: true })).toString("base64") }));
    assert.deepEqual(errors, []); await context.close();
    console.log("PASS history bubbles: immediately visible without replay");
  }
  {
    scenario = "queue"; requests.length = 0;
    const { context, page, errors } = await open();
    await send(page, "第一条");
    await send(page, "紧接着补充");
    await page.waitForFunction(() => document.querySelector('[data-testid="chat"] [data-role="assistant"]'));
    for (let i = 0; i < 100 && !requests.length; i++) await sleep(20);
    assert.equal(requests.length, 1);
    assert.match(requests[0].messages.at(-1).content, /第一条[\s\S]*紧接着补充/);
    assert.equal(await page.getByRole("textbox").isEnabled(), true);
    await send(page, "回复中补充一");
    await send(page, "回复中补充二");
    await page.getByText("已收下 2 条，合并后自动处理", { exact: true }).waitFor();
    assert.equal(requests.length, 1, "active request must not be restarted");
    await idle(page, 2);
    assert.equal(requests.length, 2);
    assert.match(requests[1].messages.at(-1).content, /回复中补充一[\s\S]*回复中补充二/);
    assert.equal((await stored(page)).filter((m) => m.role === "user").length, 4);
    assert.deepEqual(errors, []); await context.close();
    console.log("PASS real input: rapid sends merge, supplements queue, no restart or lost user bubbles");
  }
  for (scenario of ["cleanup", "stickers", "empty", "disabled"]) {
    requests.length = 0;
    const { context, page, errors } = await open(scenario === "empty" ? "?empty" : scenario === "disabled" ? "?no-stickers" : "");
    await send(page, scenario === "cleanup" ? "记下你的情绪，再陪我聊聊。" : "给我发两张开心的表情。" );
    if (scenario === "stickers") {
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="sticker"]').length === 2);
      assert.equal(await page.getByTestId("busy").textContent(), "busy", "images should arrive before the final text request completes");
    }
    await idle(page, 1);
    const message = (await stored(page)).find((m) => m.role === "assistant");
    assert.equal(requests.length, 2);
    if (scenario === "cleanup") {
      assert.equal(message.content, "我在听。慢慢说。");
      assert.equal(JSON.parse(await page.getByTestId("emotions").textContent()).length, 1, "real emotion action still records state");
    } else if (scenario === "stickers") {
      assert.equal(message.content, "");
      assert.equal(message.attachments.length, 2);
      assert.ok(message.attachments.some((a) => a.mime === "image/gif"));
      assert.ok(await page.getByTestId("sticker").evaluateAll((images) => images.every((img) => img.complete && img.naturalWidth > 0)));
      assert.equal(await page.getByTestId("chat").innerText(), "给我发两张开心的表情。" );
    } else {
      assert.equal(await page.getByTestId("sticker").count(), 0);
      assert.match(requests[1].messages.find((m) => m.role === "tool").content, /失败/);
      if (scenario === "disabled") assert.equal(requests[0].tools.some((t) => t.function.name === "sticker_send"), false);
    }
    assert.deepEqual(errors, []); await context.close();
    console.log(`PASS real chat/actions: ${scenario}`);
  }
  {
    scenario = "pagequeue"; requests.length = 0;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(); const errors = [];
    page.on("pageerror", (e) => { errors.push(e.message); console.error("FULL PAGE ERROR", e.stack); });
    await page.goto(`${base}/scripts/chat-page-fixture.html?settings`);
    const switches = [["逐条发送", "segmentPacing"], ["智能发送节奏", "segmentSmartDelay"], ["合并发送", "mergeSend"],
      ["回复时允许补充消息", "replyWhileBusy"], ["自动清理内部标记", "assistantAutoClean"], ["AI 主动发表情", "aiStickers"], ["按标点分句", "segmentReply"]];
    // Switch nested choices off before hiding their parent.
    for (const [label, key] of [switches[1], switches[0], ...switches.slice(2)]) {
      await page.getByRole("switch", { name: label, exact: true }).click();
      assert.equal(await page.evaluate((k) => window.qidaoFixture.read().settings[k], key), false);
    }
    await page.waitForTimeout(700); await page.reload();
    await page.getByRole("switch", { name: "按标点分句", exact: true }).waitFor();
    for (const [, key] of switches) assert.equal(await page.evaluate((k) => window.qidaoFixture.read().settings[k], key), false, `${key} persists`);
    for (const [label] of [switches.at(-1), switches[0], switches[1], ...switches.slice(2, -1)]) {
      await page.getByRole("switch", { name: label, exact: true }).click();
    }
    if (process.env.QIDAO_SHOTS) await page.screenshot({ path: `${process.env.QIDAO_SHOTS}/conversation-settings-mobile.png`, fullPage: true });
    await page.evaluate(() => window.qidaoFixture.navigate("/"));
    const input = page.getByRole("textbox", { name: "消息输入框", exact: true });
    await input.tap(); await page.keyboard.insertText("先听我说");
    await page.getByRole("button", { name: "发送", exact: true }).tap();
    for (let n = 0; n < 100 && !requests.length; n++) await sleep(20);
    assert.equal(requests.length, 1);
    assert.equal(await input.isEnabled(), true);
    // Native-like touch and key insertion, including hit testing: fill() alone cannot establish focusability.
    await input.tap();
    assert.equal(await input.evaluate((el) => document.activeElement === el), true);
    await page.keyboard.insertText("回复期间补充第一条");
    await page.keyboard.press("Enter");
    assert.equal(await input.evaluate((el) => document.activeElement === el), true);
    await page.keyboard.insertText("回复期间补充第二条");
    await page.getByRole("button", { name: "发送", exact: true }).tap();
    await page.waitForFunction(() => window.qidaoFixture.read().messages.filter((m) => m.role === "assistant" && m.content).length === 2,
      undefined, { timeout: 30000 });
    assert.equal(requests.length, 2);
    assert.match(requests[1].messages.at(-1).content, /回复期间补充第一条[\s\S]*回复期间补充第二条/);
    assert.equal(await page.evaluate(() => window.qidaoFixture.read().messages.filter((m) => m.role === "user").length), 3);
    // Opting out blocks the real chat input while replying and restores it afterwards.
    await page.evaluate(() => window.qidaoFixture.navigate("/chat-settings"));
    await page.getByRole("switch", { name: "回复时允许补充消息", exact: true }).click();
    await page.evaluate(() => window.qidaoFixture.navigate("/"));
    await input.tap(); await page.keyboard.insertText("这次等你回复完"); await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="消息输入框"]')?.disabled === true);
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="消息输入框"]')?.disabled === false,
      undefined, { timeout: 30000 });
    assert.deepEqual(errors, []); await context.close();
    console.log("PASS full app shell: conversation switches persist, touch/keyboard supplements work, opt-out blocks only active replies");
  }
} finally {
  await browser.close();
  await new Promise((resolve) => upstream.close(resolve));
}
