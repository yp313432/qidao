import { chromium } from "playwright";

/**
 * 复现「思考链弹层一滑就消失」。
 * 往 IndexedDB 里塞一段带思考链的对话，点开弹层，滚动消息区，看弹层去哪了。
 */
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8080";

const now = Date.now();
const messages = [];
for (let i = 0; i < 14; i++) {
  messages.push({
    id: `u${i}`,
    role: "user",
    content: `这是第 ${i + 1} 个问题，用来把对话撑长，好让我能滚动看看。`,
    thinking: "",
    thinkingDurationMs: 0,
    createdAt: now - (30 - i) * 60000,
  });
  messages.push({
    id: `a${i}`,
    role: "assistant",
    content: `第 ${i + 1} 个回答。内容随便写一点，主要是把高度撑起来。`,
    thinking: `这是第 ${i + 1} 条的思考过程。\n我要先判断用户到底想问什么，再组织回答的结构。\n这里故意写长一点，方便观察弹层。`,
    thinkingDurationMs: 4200,
    createdAt: now - (30 - i) * 60000 + 30000,
  });
}

const snapshot = {
  state: {
    conversations: [
      {
        id: "conv-test",
        title: "思考链测试",
        messages,
        createdAt: now - 3600000,
        updatedAt: now,
        pinned: false,
        incognito: false,
      },
    ],
    activeId: "conv-test",
    settings: { displayName: "yan", aiName: "星芒", showThinking: true, chatFontSize: "normal" },
  },
  version: 1,
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
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

const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message.split("\n")[0].slice(0, 140)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("CONSOLE " + m.text().slice(0, 140));
});

await page.goto(BASE + "/", { waitUntil: "commit", timeout: 30000 });
await page.waitForTimeout(3500);

const thinkButtons = await page.getByRole("button", { name: /已思考|正在思考/ }).count();
console.log("带思考链的消息按钮数:", thinkButtons);
if (thinkButtons === 0) {
  console.log("❌ 没渲染出思考链按钮，后面的测不了。body 开头：");
  console.log((await page.evaluate(() => document.body.innerText)).slice(0, 300));
  await browser.close();
  process.exit(0);
}

// 点最后一个「已思考」，让弹层出现在靠下的位置
await page.getByRole("button", { name: /已思考/ }).last().click();
await page.waitForTimeout(700);

const before = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  if (!dialog) return { found: false };
  const r = dialog.getBoundingClientRect();
  const panel = dialog.lastElementChild;
  const pr = panel?.getBoundingClientRect();
  // 往上找：谁是它的定位参照？有没有裁剪祖先？
  const chain = [];
  let el = dialog.parentElement;
  while (el && chain.length < 8) {
    const cs = getComputedStyle(el);
    chain.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || "").toString().slice(0, 70),
      transform: cs.transform,
      filter: cs.filter,
      backdrop: cs.backdropFilter,
      overflow: cs.overflow,
      contain: cs.contain,
    });
    el = el.parentElement;
  }
  return {
    found: true,
    dialogTop: Math.round(r.top),
    dialogH: Math.round(r.height),
    panelTop: pr ? Math.round(pr.top) : null,
    scrollY: Math.round(window.scrollY),
    chain,
  };
});
console.log("\n=== 打开后 ===");
console.log(`  弹层 top=${before.dialogTop} 高=${before.dialogH} 面板 top=${before.panelTop}`);
console.log("  祖先链（找定位参照 / 裁剪）:");
for (const c of before.chain ?? []) {
  console.log(
    `   · <${c.tag}> transform=${c.transform} filter=${c.filter} backdrop=${c.backdrop} overflow=${c.overflow} contain=${c.contain}`,
  );
  console.log(`     class="${c.cls}"`);
}

await page.screenshot({ path: "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots\\sheet-before-scroll.png" });

// 找到真正的滚动容器并滚它
const scrolled = await page.evaluate(() => {
  const sc = document.querySelector(".overflow-y-auto");
  if (!sc) return null;
  const before = sc.scrollTop;
  sc.scrollTop = Math.max(0, sc.scrollTop - 400);
  return { before, after: sc.scrollTop };
});
await page.waitForTimeout(700);

const after = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  if (!dialog) return { found: false };
  const r = dialog.getBoundingClientRect();
  const panel = dialog.lastElementChild;
  const pr = panel?.getBoundingClientRect();
  return {
    found: true,
    dialogTop: Math.round(r.top),
    dialogH: Math.round(r.height),
    panelTop: pr ? Math.round(pr.top) : null,
  };
});

console.log("\n=== 滚动后 ===");
console.log("  滚动容器:", JSON.stringify(scrolled));
console.log(
  after.found
    ? `  弹层还在：top=${after.dialogTop} 高=${after.dialogH} 面板 top=${after.panelTop}`
    : "  ❌ 弹层从 DOM 里消失了",
);

await page.screenshot({ path: "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots\\sheet-after-scroll.png" });
console.log("\n控制台错误:", errors.length ? [...new Set(errors)].join(" | ") : "(none)");
await browser.close();
