import { chromium, devices } from "playwright";

/** 回归：滑动**不该**关；点背景 / 抓横条下滑**应该**关；弹层里应该能滚。 */
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8080";

const now = Date.now();
const messages = [];
for (let i = 0; i < 14; i++) {
  messages.push({ id: `u${i}`, role: "user", content: `第 ${i + 1} 个问题，撑长一点好滚动。`, thinking: "", thinkingDurationMs: 0, createdAt: now - (30 - i) * 60000 });
  messages.push({
    id: `a${i}`, role: "assistant", content: `第 ${i + 1} 个回答。`,
    thinking: Array.from({ length: 30 }, (_, k) => `第 ${i + 1} 条思考的第 ${k + 1} 行，够长才能滚。`).join("\n"),
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

const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message.split("\n")[0].slice(0, 140)));
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE " + m.text().slice(0, 140)); });

await page.goto(BASE + "/", { waitUntil: "commit", timeout: 30000 });
await page.waitForTimeout(3500);

const state = () => page.evaluate(() => {
  const d = document.querySelector('[role="dialog"][aria-modal="true"]');
  const sc = d?.querySelector(".overflow-y-auto");
  const panel = d?.lastElementChild;
  return {
    open: Boolean(d),
    innerScroll: sc ? Math.round(sc.scrollTop) : null,
    panelTop: panel ? Math.round(panel.getBoundingClientRect().top) : null,
  };
});
const openSheet = async () => {
  await page.getByRole("button", { name: /已思考/ }).last().click();
  await page.waitForTimeout(650);
};
const ok = (b) => (b ? "✅" : "❌");

console.log("=== 1. 滑动不该关（回归）===");
await openSheet();
for (let k = 0; k < 3; k++) {
  await page.mouse.move(195, 620);
  await page.mouse.down();
  await page.mouse.move(195, 250, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}
let s = await state();
console.log(`  遮罩上快速上滑 x3 → 还开着? ${ok(s.open)}`);

console.log("\n=== 2. 弹层内部应该能滚（滚思考内容）===");
const before = (await state()).innerScroll;
await page.mouse.move(195, 700);
await page.mouse.wheel(0, 300);
await page.waitForTimeout(400);
s = await state();
console.log(`  面板内滚轮 → 内部 scrollTop ${before} → ${s.innerScroll} ${ok((s.innerScroll ?? 0) > (before ?? 0))}`);

console.log("\n=== 3. 抓横条往下拖，应该关掉 ===");
const box = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"][aria-modal="true"]');
  const h = d?.firstElementChild?.nextElementSibling?.firstElementChild;
  const r = h?.getBoundingClientRect();
  return r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
});
console.log("  横条位置:", JSON.stringify(box));
if (box) {
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x, box.y + 60, { steps: 10 });
  await page.mouse.move(box.x, box.y + 200, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  s = await state();
  console.log(`  下滑 200px → 关掉了? ${ok(!s.open)}`);
}

console.log("\n=== 4. 点背景，应该关掉 ===");
if (!(await state()).open) await openSheet();
await page.mouse.click(195, 120);
await page.waitForTimeout(600);
s = await state();
console.log(`  点遮罩 → 关掉了? ${ok(!s.open)}`);

console.log("\n=== 5. 点关闭按钮，应该关掉 ===");
if (!(await state()).open) await openSheet();
await page.getByRole("button", { name: "关闭", exact: true }).last().click();
await page.waitForTimeout(600);
s = await state();
console.log(`  点 X → 关掉了? ${ok(!s.open)}`);

console.log("\n=== 6. 遮罩颜色应该是语义色，不是死黑 ===");
await openSheet();
const bg = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"][aria-modal="true"]');
  const b = d?.querySelector("button");
  return b ? getComputedStyle(b).backgroundColor : null;
});
console.log(`  遮罩 background-color = ${bg}`);
await page.screenshot({ path: "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots\\sheet-fixed.png" });

console.log("\n控制台错误:", errors.length ? [...new Set(errors)].join(" | ") : "(none)");
await browser.close();
