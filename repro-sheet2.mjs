import { chromium, devices } from "playwright";

/** 真实手势复现：触摸滑动 / 滚轮 / 双向，看思考链弹层会不会消失。 */
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8080";

const now = Date.now();
const messages = [];
for (let i = 0; i < 14; i++) {
  messages.push({
    id: `u${i}`, role: "user", content: `第 ${i + 1} 个问题，撑长一点好滚动。`,
    thinking: "", thinkingDurationMs: 0, createdAt: now - (30 - i) * 60000,
  });
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
// 用真机的触摸参数（有 hasTouch），这样 touchscreen 手势才有效
const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

await page.addInitScript((snap) => {
  const req = indexedDB.open("qidao-store", 1);
  req.onupgradeneeded = () => {
    if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
  };
  req.onsuccess = () => {
    const tx = req.result.transaction("kv", "readwrite");
    tx.objectStore("kv").put(JSON.stringify(snap), "aster-app");
  };
}, snapshot);

await page.goto(BASE + "/", { waitUntil: "commit", timeout: 30000 });
await page.waitForTimeout(3500);

async function openSheet() {
  await page.getByRole("button", { name: /已思考/ }).last().click();
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (!d) return { found: false };
    const p = d.lastElementChild?.getBoundingClientRect();
    return { found: true, dialogTop: Math.round(d.getBoundingClientRect().top), panelTop: p ? Math.round(p.top) : null };
  });
}

async function probe(label) {
  const st = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-modal="true"]');
    const sc = document.querySelector(".overflow-y-auto");
    if (!d) return { found: false, scrollTop: sc ? sc.scrollTop : null };
    const p = d.lastElementChild?.getBoundingClientRect();
    const r = d.getBoundingClientRect();
    return {
      found: true,
      dialogTop: Math.round(r.top), dialogH: Math.round(r.height),
      panelTop: p ? Math.round(p.top) : null,
      panelH: p ? Math.round(p.height) : null,
      scrollTop: sc ? Math.round(sc.scrollTop) : null,
    };
  });
  console.log(`  ${label}: ${st.found ? `弹层 top=${st.dialogTop} 高=${st.dialogH} / 面板 top=${st.panelTop} 高=${st.panelH}` : "❌ 弹层不在 DOM 里"}  (消息区 scrollTop=${st.scrollTop})`);
  return st;
}

console.log("=== 打开弹层 ===");
console.log(" ", JSON.stringify(await openSheet()));

// 1) 触摸滑动：从消息区中间往上滑（内容往上走）
console.log("\n=== 1. 触摸上滑（真实手指） ===");
for (let k = 0; k < 3; k++) {
  await page.touchscreen.tap(195, 300);
  await page.mouse.move(195, 500);
  await page.mouse.down();
  await page.mouse.move(195, 250, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}
await probe("上滑 3 次后");

// 2) 在弹层自己身上滑（触摸滚动思考内容）
console.log("\n=== 2. 在弹层面板上滑动 ===");
for (let k = 0; k < 3; k++) {
  await page.mouse.move(195, 780);
  await page.mouse.down();
  await page.mouse.move(195, 700, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}
await probe("面板上滑 3 次后");

// 3) 滚轮
console.log("\n=== 3. 滚轮 ===");
await page.mouse.move(195, 400);
await page.mouse.wheel(0, -600);
await page.waitForTimeout(500);
await probe("滚轮上滚 600 后");
await page.mouse.wheel(0, 1200);
await page.waitForTimeout(500);
await probe("滚轮下滚 1200 后");

// 4) 顶部下拉（很多「一滑就没了」是这种：往下拉触发关闭/回弹）
console.log("\n=== 4. 从顶部往下拉 ===");
await page.mouse.move(195, 200);
await page.mouse.down();
await page.mouse.move(195, 700, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(600);
await probe("下拉后");

await page.screenshot({ path: "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots\\sheet-gesture-end.png" });
await browser.close();
