import { chromium } from "playwright";

const base = "http://localhost:8080";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("CONSOLE " + m.text().slice(0, 120));
});

await page.goto(base + "/system", { waitUntil: "load", timeout: 90000 });
await page.waitForTimeout(1800);

// 滚到语音区
const sec = page.locator('text=语音服务').first();
await sec.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(600);

const tabs = await page.locator("text=1 · OpenAI 兼容").count();
const tab2 = await page.locator("text=2 · ElevenLabs").count();
const pickButtons = await page.locator('button:has-text("（点这里选）")').count();
console.log(JSON.stringify({ tabs, tab2, pickButtons }));

// 截图 A：语音模块
await sec.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: "shot-voice-a.png" });

// 点「合成」那一格 → 弹层
const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("（点这里选）"));
  if (!b) return false;
  b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return true;
});
console.log(JSON.stringify({ clicked }));
if (clicked) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: "shot-voice-b.png" });
  const sheetTitle = await page.locator("text=选转文字模型").count();
  console.log(JSON.stringify({ sheetTitle }));
  // 关掉
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.click(200, 80);
  await page.waitForTimeout(300);
}

// 切到 ElevenLabs
const el = page.locator("text=2 · ElevenLabs").first();
if (await el.count()) {
  await el.click({ force: true }).catch(() => {});
  await page.waitForTimeout(700);
  await sec.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shot-voice-c.png" });
}

console.log("errors:", JSON.stringify(errors.slice(0, 4)));
await browser.close();
