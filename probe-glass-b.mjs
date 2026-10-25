/**
 * B 档玻璃的落地检查：把几个"玻璃最密集"的页面各截一张，
 * 确认 token 改动**全局生效**（不是只有聊天页变了）。
 *
 * 用户 m11815：“记得做好适配哦，不要只改一些组件，其他的不改了”。
 */
import { chromium } from "playwright";

const BASE = process.env.QIDAO_BASE ?? "http://localhost:8080";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));

const pages = [
  ["chat", "/"],
  ["me", "/me"],
  ["system", "/system"],
  ["garden", "/play/garden"],
  ["tavolo", "/play/garden/tavolo"],
];

for (const [name, path] of pages) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `shot-glass-${name}.png` });
}

console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
