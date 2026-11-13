import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
const base = process.env.QIDAO_TEST_BASE || "http://127.0.0.1:8080";
const upstream = createServer(async (req, res) => {
  const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "Mcp-Session-Id", "content-type": "application/json" };
  if (req.method === "OPTIONS") { res.writeHead(204, headers).end(); return; }
  let raw = ""; for await (const chunk of req) raw += chunk; const message = JSON.parse(raw);
  if (message.id == null) { res.writeHead(202, headers).end(); return; }
  res.writeHead(200, { ...headers, "Mcp-Session-Id": "community-ui" });
  res.end(JSON.stringify({ id: message.id, result: message.method === "initialize" ? { protocolVersion: "2025-06-18", serverInfo: { name: "社区测试" } } : { tools: [{ name: "echo", inputSchema: { type: "object", properties: {} } }] } }));
});
await new Promise((resolve) => upstream.listen(4651, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/scripts/chat-page-fixture.html?tools`);
  await page.getByRole("button", { name: "MCP", exact: true }).click();
  await page.getByText("导入社区 MCP 配置", { exact: true }).click();
  await page.getByRole("textbox", { name: "粘贴 mcpServers JSON 配置" }).fill(JSON.stringify({ mcpServers: { 社区测试: { type: "streamable_http", url: "http://127.0.0.1:4651/mcp" }, Termux测试: { command: "node", args: ["test.mjs"], env: { TEST_KEY: "kept" } } } }));
  await page.getByRole("button", { name: "导入配置", exact: true }).click();
  await page.getByRole("status").getByText(/已导入 2 个服务/).waitFor();
  assert.equal(await page.evaluate(() => window.qidaoFixture.read().mcp.find((m) => m.name === "Termux测试").env.TEST_KEY), "kept");
  await page.getByRole("button", { name: /^社区测试/ }).click();
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await page.getByText(/拿到 1 个工具/).first().waitFor();
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "SKILL.md", mimeType: "text/markdown", buffer: Buffer.from("---\nname: UI测试技能\ndescription: 测试按需加载\n---\n读取完成后回答测试成功。") });
  await page.getByRole("status").getByText(/已导入 1 个 Skill/).waitFor();
  const receipt = await page.evaluate(() => window.qidaoFixture.readSkill("UI测试技能"));
  assert.match(receipt, /读取完成后回答测试成功/);
  await page.getByRole("switch", { name: "启用 UI测试技能" }).click();
  assert.match(await page.evaluate(() => window.qidaoFixture.readSkill("UI测试技能")), /失败/);
  await page.waitForTimeout(1000); await page.reload();
  await page.getByRole("switch", { name: "启用 UI测试技能" }).waitFor();
  assert.equal(await page.getByRole("switch", { name: "启用 UI测试技能" }).getAttribute("aria-checked"), "false");
  const shots = process.env.QIDAO_SHOTS || "screenshots/community"; await mkdir(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/skills-mobile.png`, fullPage: true });
  console.log("QIDAO_PREVIEW " + JSON.stringify({ name: "skills-mobile", base64: (await page.screenshot({ type: "jpeg", quality: 55, fullPage: true })).toString("base64") }));
  await page.evaluate(() => window.qidaoFixture.navigate("/play/plugins/edit"));
  await page.getByRole("textbox", { name: "名字", exact: true }).fill("第三方网页");
  await page.getByRole("textbox", { name: "地址", exact: true }).fill("https://example.com");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  assert.equal(await page.evaluate(() => window.qidaoFixture.read().settings.customPlugins.at(-1).openMode), "browser");
  const popupPromise = page.waitForEvent("popup"); await page.getByRole("link", { name: /第三方网页/ }).click();
  const popup = await popupPromise; await popup.close();
  assert.equal(await page.locator("#plugin-frame").count(), 0, "third-party default never attempts iframe injection");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: `${shots}/plugins-desktop.png`, fullPage: true });
  console.log("QIDAO_PREVIEW " + JSON.stringify({ name: "plugins-desktop", base64: (await page.screenshot({ type: "jpeg", quality: 55, fullPage: true })).toString("base64") }));
  assert.deepEqual(errors, []); await context.close();
  console.log("PASS community UI: real MCP handshake, Skill persistence/read/disable, third-party browser opening");
} finally { await browser.close(); await new Promise((resolve) => upstream.close(resolve)); }
