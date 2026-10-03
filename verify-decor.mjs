import { chromium, devices } from "playwright";

/** 抽屉上下装饰：存不存在 / 动不动 / 减弱动态效果时收不收 */
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8080";
const OUT = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";
const now = Date.now();

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const messages = (n, tag) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${tag}${i}`, role: i % 2 ? "assistant" : "user",
    content: `第 ${i + 1} 条，用来把列表撑长一点。`, thinking: "", thinkingDurationMs: 0, createdAt: now - i * 1000,
  }));

await page.addInitScript((t) => {
  const snapshot = {
    state: {
      conversations: [
        { id: "c1", title: "关于论文的压力", messages: [{ id: "m1", role: "assistant", content: "先别硬扛", thinking: "", thinkingDurationMs: 0, createdAt: t }], createdAt: t, updatedAt: t, pinned: true, incognito: false },
        { id: "c2", title: "晚上好", messages: [{ id: "m2", role: "assistant", content: "歌还停在那一首", thinking: "", thinkingDurationMs: 0, createdAt: t }], createdAt: t, updatedAt: t - 1000, pinned: false, incognito: false },
        { id: "c3", title: "新对话", messages: [], createdAt: t, updatedAt: t - 2000, pinned: false, incognito: false },
      ],
      activeId: "c1",
      settings: { displayName: "yan", aiName: "星芒" },
    },
    version: 1,
  };
  const req = indexedDB.open("qidao-store", 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv"); };
  req.onsuccess = () => {
    const tx = req.result.transaction("kv", "readwrite");
    tx.objectStore("kv").put(JSON.stringify(snapshot), "aster-app");
  };
}, now);

const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message.split("\n")[0].slice(0, 130)));
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE " + m.text().slice(0, 130)); });

await page.goto(BASE + "/", { waitUntil: "commit", timeout: 30000 });
await page.waitForTimeout(2500);
await page.locator("header button").first().click();
await page.waitForTimeout(1200);

const info = await page.evaluate(() => {
  const aside = document.querySelector("aside.glass-panel");
  const canvases = [...(aside?.querySelectorAll("canvas") ?? [])];
  const svgs = [...(aside?.querySelectorAll("svg") ?? [])];
  const twinkles = [...(aside?.querySelectorAll(".aster-twinkle") ?? [])];
  const anims = twinkles.map((e) => getComputedStyle(e).animationName);
  return {
    画布数: canvases.length,
    画布尺寸: canvases.map((c) => `${c.width}x${c.height}`),
    抽屉内SVG数: svgs.length,
    呼吸星星数: twinkles.length,
    星星动画: [...new Set(anims)],
    流星: aside?.querySelectorAll(".aster-meteor").length ?? 0,
    月亮: aside?.querySelectorAll(".aster-moon").length ?? 0,
    行星: aside?.querySelectorAll(".aster-orbit, .aster-orbit-slow").length ?? 0,
    装饰高度: [...(aside?.querySelectorAll("[aria-hidden='true'].relative") ?? [])].map((e) =>
      Math.round(e.getBoundingClientRect().height),
    ),
  };
});
console.log("=== 装饰是否存在 / 在动 ===");
console.log(JSON.stringify(info, null, 2));
console.log(`  粒子画布: ${info.画布数 >= 2 ? "✅ 上下各一个" : "❌"}`);
console.log(`  呼吸的星星: ${info.呼吸星星数} 颗，动画 ${info.星星动画.join(", ")} ${info.呼吸星星数 >= 4 ? "✅" : "❌"}`);
console.log(`  月亮 ${info.月亮} / 流星 ${info.流星} / 行星 ${info.行星} ${info.行星 >= 2 ? "✅" : "❌"}`);

await page.screenshot({ path: `${OUT}/decor-drawer-frame1.png` });
await page.waitForTimeout(1600);
await page.screenshot({ path: `${OUT}/decor-drawer-frame2.png` });

// 两帧是否有差异（证明是真的在动，不是静态画）
const diff = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stars = [...document.querySelectorAll(".aster-twinkle")];
  const a = stars.map((s) => getComputedStyle(s).opacity);
  await sleep(1300);
  const b = stars.map((s) => getComputedStyle(s).opacity);
  return { before: a, after: b, changed: a.some((v, i) => v !== b[i]) };
});
console.log(`  星星透明度在变（前 ${diff.before.slice(0, 3).join("/")} → 后 ${diff.after.slice(0, 3).join("/")}）: ${diff.changed ? "✅ 真在动" : "❌ 没动"}`);

// 裁一张上下装饰的特写，方便看质感
const aside = await page.locator("aside.glass-panel").boundingBox();
if (aside) {
  await page.screenshot({
    path: `${OUT}/decor-top.png`,
    clip: { x: aside.x, y: aside.y + 100, width: aside.width, height: 130 },
  });
  await page.screenshot({
    path: `${OUT}/decor-bottom.png`,
    clip: { x: aside.x, y: aside.y + aside.height - 150, width: aside.width, height: 150 },
  });
}

// 减弱动态效果：应该停住
console.log("\n=== 减弱动态效果（motion=off）时应该停 ===");
await page.evaluate(() => { document.documentElement.dataset.motion = "off"; });
await page.waitForTimeout(600);
const off = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stars = [...document.querySelectorAll(".aster-twinkle")];
  const a = stars.map((s) => getComputedStyle(s).opacity);
  await sleep(1200);
  const b = stars.map((s) => getComputedStyle(s).opacity);
  return { still: a.every((v, i) => v === b[i]), duration: stars[0] ? getComputedStyle(stars[0]).animationDuration : null };
});
console.log(`  动画时长 ${off.duration}、画面静止: ${off.still ? "✅ 会降级" : "❌ 还在动"}`);

console.log("\n控制台错误:", errors.length ? [...new Set(errors)].join(" | ") : "(none)");
await browser.close();
