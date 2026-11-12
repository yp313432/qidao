import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.QIDAO_TEST_BASE || "http://127.0.0.1:8080";
const out = process.env.QIDAO_SHOTS || "/workspace/screenshots";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/src/lib/actions.ts*", (route) => route.fulfill({ contentType: "application/javascript",
      body: "export async function runAction() { return new Promise(() => {}); }" }));
    for (const [scene, label] of [["web", "网页搜索"], ["read", "读取网页"], ["mcp", "MCP · 记忆 / 检索"], ["http", "HTTP · 天气"]]) {
      await page.goto(`${base}/scripts/tool-progress-fixture.html?scene=${scene}`);
      await page.getByRole("dialog").waitFor();
      await page.waitForTimeout(500); // old global banner appeared after 400 ms
      assert.equal(await page.getByRole("status").innerText(), `第 1 步 · 正在执行 ${label}`);
      assert.equal(await page.getByText("⏳ 正在执行：", { exact: false }).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `${out}/tool-${scene}-${viewport.width}.png` });
    }
    await page.goto(`${base}/scripts/tool-progress-fixture.html?scene=mcp&mode=done`);
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: /小克.*调用了/ }).click();
    assert.match(await page.getByRole("dialog").innerText(), /上次聊到了周末散步/);
    await page.screenshot({ path: `${out}/tool-result-${viewport.width}.png` });
    await page.goto(`${base}/scripts/tool-progress-fixture.html?scene=mcp&mode=ask`);
    await page.getByRole("button", { name: "允许一次", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "拒绝", exact: true }).count(), 1);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("PASS tool progress: web/read/MCP/HTTP, live/history/permission, mobile/desktop, no page errors");
} finally { await browser.close(); }
