import { chromium, devices } from "playwright";

/** 干净实验：只滑动，绝不点击。分辨到底是「滑动导致」还是「点背景导致」。 */
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8080";

const now = Date.now();
const messages = [];
for (let i = 0; i < 14; i++) {
  messages.push({ id: `u${i}`, role: "user", content: `第 ${i + 1} 个问题，撑长一点好滚动。`, thinking: "", thinkingDurationMs: 0, createdAt: now - (30 - i) * 60000 });
  messages.push({
    id: `a${i}`, role: "assistant", content: `第 ${i + 1} 个回答，随便写点内容把高度撑起来。`,
    thinking: `第 ${i + 1} 条的思考过程。\n先判断用户想问什么，再组织结构。\n写长一点方便观察。`,
    thinkingDurationMs: 4200, createdAt: now - (30 - i) * 60000 + 30000,
  });
}
const snapshot = {
  state: {
    conversations: [{ id: "conv-test", title: "思考链测试", messages, createdAt: now - 3600000, updatedAt: now, pinned: false, incognito: false }],
    activeId: "conv-test",
    settings: { displayName: "yan", aiName: "星芒", showThinking: true, chatFontSize: "normal" },
  },
  version: 1,
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.addInitScript((snap) => {
  const req = indexedDB.open("qidao-store", 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv"); };
  req.onsuccess = () => {
    const tx = req.result.transaction("kv", "readwrite");
    tx.objectStore("kv").put(JSON.stringify(snap), "aster-app");
  };
}, snapshot);

await page.goto(BASE + "/", { waitUntil: "commit", timeout: 30000 });
await page.waitForTimeout(3500);

const present = () => page.evaluate(() => {
  const d = document.querySelector('[role="dialog"][aria-modal="true"]');
  const sc = document.querySelector(".overflow-y-auto");
  return { open: Boolean(d), scrollTop: sc ? Math.round(sc.scrollTop) : null };
});

await page.getByRole("button", { name: /已思考/ }).last().click();
await page.waitForTimeout(600);
console.log("打开后:", JSON.stringify(await present()));

// 纯滑动：down → move → up，中间不 tap
console.log("\n--- A. 在消息区（遮罩上）快速上滑，不点击 ---");
for (let k = 0; k < 3; k++) {
  await page.mouse.move(195, 600);
  await page.mouse.down();
  await page.mouse.move(195, 250, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  console.log(`  第 ${k + 1} 次上滑后:`, JSON.stringify(await present()));
}

if ((await present()).open) {
  console.log("\n--- B. 慢速拖动（模拟手指慢慢滑） ---");
  await page.mouse.move(195, 600);
  await page.mouse.down();
  await page.mouse.move(195, 560, { steps: 20 });
  await page.mouse.move(195, 400, { steps: 30 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  console.log("  慢速拖动后:", JSON.stringify(await present()));
}

if ((await present()).open) {
  console.log("\n--- C. 在弹层面板上滑（滚思考内容） ---");
  for (let k = 0; k < 4; k++) {
    await page.mouse.move(195, 800);
    await page.mouse.down();
    await page.mouse.move(195, 700, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  }
  console.log("  面板上滑 4 次后:", JSON.stringify(await present()));
}

console.log("\n--- D. 换一条消息点开，看滚动位置有没有被带走 ---");
if (!(await present()).open) {
  await page.getByRole("button", { name: /已思考/ }).last().click();
  await page.waitForTimeout(600);
}
console.log("  重新打开:", JSON.stringify(await present()));

await browser.close();
