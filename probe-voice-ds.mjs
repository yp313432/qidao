/**
 * 测百炼那一档：切到「3 · 百炼」、地址自动变、捏嗓子面板能展开。
 *
 * 注意：语音区在 `/system` 路由（不是 /me）。
 * 点击用 DOM dispatch —— locator.click 在这个玻璃卡片里常被遮罩吃掉。
 */
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 120));
});

await page.goto("http://localhost:8080/system", { waitUntil: "load", timeout: 90000 });
await page.waitForTimeout(2500);

const clickText = async (t) =>
  page.evaluate((text) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(text));
    if (!b) return false;
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  }, t);

console.log("tab3 clicked:", await clickText("3 · 百炼"));
await page.waitForTimeout(800);

const state = await page.evaluate(() => {
  const txt = document.body.innerText;
  const inputs = [...document.querySelectorAll('input[type="text"]')].map((i) => i.value);
  return {
    hasDesign: txt.includes("捏一个嗓子"),
    hasEmotion: txt.includes("按情绪念"),
    hasAsrField: txt.includes("转文字"),
    textInputs: inputs.slice(0, 3),
  };
});
console.log(JSON.stringify(state));

console.log("design clicked:", await clickText("捏一个嗓子"));
await page.waitForTimeout(600);

const design = await page.evaluate(() => {
  const ta = document.querySelector("textarea");
  const txt = document.body.innerText;
  return {
    hasTextarea: Boolean(ta),
    placeholder: (ta?.getAttribute("placeholder") ?? "").slice(0, 24),
    hasMakeButton: txt.includes("造一个，先听听"),
  };
});
console.log(JSON.stringify(design));

await page.evaluate(() => {
  const t = [...document.querySelectorAll("*")].find(
    (el) => el.children.length === 0 && el.textContent?.trim() === "捏一个嗓子",
  );
  t?.scrollIntoView({ block: "center" });
});
await page.waitForTimeout(500);
await page.screenshot({ path: "shot-voice-ds.png" });
console.log("errors:", errors);
await browser.close();
