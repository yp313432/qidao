import { chromium, devices } from "playwright";

/**
 * 回归：长按气泡 → App 内卡片（引用/复制/修改/重新生成）。
 *
 * 真机上踩了两回「长按自己的消息没有卡片，只有触感」，根因是：
 * 气泡上有 `select-none`，安卓长按它 → `contextmenu` 不来、pointer 序列却被 `pointercancel` 掉，
 * 于是"计时器"和"contextmenu"两条路一起死。
 * 所以这里**故意先 pointercancel 再等** —— 必须仍然出卡片，否则就是又退回老 bug 了。
 */
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8080";
const MINE = "长按我这一条试试看";
const HIS = "好，我记住了。";

const now = Date.now();
const snapshot = {
  state: {
    conversations: [
      {
        id: "conv-lp",
        title: "长按测试",
        messages: [
          { id: "u1", role: "user", content: MINE, thinking: "", thinkingDurationMs: 0, createdAt: now - 60000 },
          { id: "a1", role: "assistant", content: HIS, thinking: "", thinkingDurationMs: 0, createdAt: now - 30000 },
        ],
        createdAt: now - 3600000,
        updatedAt: now,
        pinned: false,
        incognito: false,
      },
    ],
    activeId: "conv-lp",
    settings: { displayName: "yan", aiName: "星芒", showThinking: false, chatFontSize: "normal" },
  },
  version: 1,
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
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

const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message.split("\n")[0].slice(0, 140)));
page.on("console", (m) => {
  if (m.type() === "error" && !/ERR_BLOCKED_BY_RESPONSE|NotSameOrigin/.test(m.text())) {
    errors.push("CONSOLE " + m.text().slice(0, 140));
  }
});

await page.goto(BASE + "/", { waitUntil: "commit", timeout: 30000 });
await page.waitForTimeout(3200);

/** 兜底：如果落在列表页，点进对话 */
const enterChat = async () => {
  if (await page.getByText(MINE).first().isVisible().catch(() => false)) return;
  await page.getByText("长按测试").first().click().catch(() => {});
  await page.waitForTimeout(900);
};
await enterChat();

const ok = (b) => (b ? "✅" : "❌");
let bad = 0;
const check = (name, pass, extra = "") => {
  if (!pass) bad++;
  console.log(`  ${ok(pass)} ${name}${extra ? " · " + extra : ""}`);
};

/** 在"我的气泡"或"他的气泡"上派发一串 pointer 事件（模拟安卓那套序列） */
const fire = (text, kind, extra = {}) =>
  page.evaluate(
    ([text, kind, extra]) => {
      const li = Array.from(document.querySelectorAll("li")).find((n) => n.textContent?.includes(text));
      const bubble = li?.querySelector("div[class*='bg-chip']");
      if (!bubble) return "no-bubble";
      const r = bubble.getBoundingClientRect();
      const init = {
        bubbles: true,
        cancelable: true,
        clientX: Math.round(r.left + r.width / 2),
        clientY: Math.round(r.top + r.height / 2),
        pointerId: 1,
        pointerType: "touch",
        isPrimary: true,
        ...extra,
      };
      bubble.dispatchEvent(new PointerEvent(kind, init));
      return "ok";
    },
    [text, kind, extra],
  );

const menuOpen = () =>
  page.evaluate(() => /引用这一句/.test(document.body.innerText ?? ""));
const closeMenu = async () => {
  await page.mouse.click(8, 420);
  await page.waitForTimeout(350);
};

console.log("=== 1. 长按自己的消息：中途被 pointercancel 也必须出卡片（真机那个 bug）===");
await fire(MINE, "pointerdown");
await page.waitForTimeout(120);
await fire(MINE, "pointercancel");
// 长按判定 600ms（用户 m01498 第 5 条要求放长，以前 380ms 太灵敏）→ 等够 700ms
await page.waitForTimeout(700);
check("出了卡片", await menuOpen());
check("卡片里有「引用这一句」/「复制」/「修改」", await page.evaluate(() => {
  const t = document.body.innerText ?? "";
  return /引用这一句/.test(t) && /复制/.test(t) && /修改/.test(t);
}));
await closeMenu();
check("点空白关掉了", !(await menuOpen()));

console.log("=== 2. 滑列表（手指移动过）不该弹卡片 ===");
await fire(MINE, "pointerdown");
await page.waitForTimeout(60);
await fire(MINE, "pointermove", { clientX: 999 });
await fire(MINE, "pointermove", { clientY: 999 });
await page.waitForTimeout(700);
check("没弹卡片", !(await menuOpen()));
await fire(MINE, "pointercancel");
await page.waitForTimeout(200);

console.log("=== 3. 轻点一下不该弹卡片 ===");
await fire(MINE, "pointerdown");
await page.waitForTimeout(90);
await fire(MINE, "pointerup");
await page.waitForTimeout(750);
check("没弹卡片", !(await menuOpen()));

console.log("=== 3b. 停在界面上不动、但没到 600ms 就松手 → 不该弹（用户嫌太灵敏）===");
await fire(MINE, "pointerdown");
await page.waitForTimeout(450);
await fire(MINE, "pointerup");
await page.waitForTimeout(400);
check("450ms 松手不弹卡片", !(await menuOpen()));

console.log("=== 4. 他的消息长按：也要出卡片，且带「重新生成」 ===");
await fire(HIS, "pointerdown");
await page.waitForTimeout(750);
const hisOpen = await menuOpen();
check("出了卡片", hisOpen);
if (hisOpen) check("带「重新生成」", await page.evaluate(() => /重新生成/.test(document.body.innerText ?? "")));
await closeMenu();

console.log("=== 5. 控制台 / 运行时报错 ===");
check("没有页面报错", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
console.log("--------------------------------------------------------------------------");
console.log(bad === 0 ? `全部通过（0 个失败）` : `有 ${bad} 个失败`);
process.exit(bad === 0 ? 0 : 1);
