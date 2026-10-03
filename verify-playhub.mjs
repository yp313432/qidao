import { chromium, devices } from "playwright";

/** 玩乐区首页 + 新设置：截图并检查结构与动效。 */
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8080";
const OUT = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

// 先塞一个认识的日子，好看到「NNN DAYS TOGETHER」的真实样子
await page.addInitScript(() => {
  const req = indexedDB.open("qidao-store", 1);
  req.onupgradeneeded = () => {
    if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
  };
  req.onsuccess = () => {
    const tx = req.result.transaction("kv", "readwrite");
    tx.objectStore("kv").put(
      JSON.stringify({
        state: {
          settings: {
            displayName: "yueluo",
            aiName: "辰",
            togetherSince: "2025-05-01",
          },
        },
        version: 1,
      }),
      "aster-app",
    );
  };
});

const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message.split("\n")[0].slice(0, 130)));
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE " + m.text().slice(0, 130)); });

await page.goto(BASE + "/play", { waitUntil: "commit", timeout: 30000 });
await page.waitForTimeout(3000);

const info = await page.evaluate(() => {
  const txt = document.body.innerText;
  const cards = [...document.querySelectorAll("section")].map((s) => {
    const r = s.getBoundingClientRect();
    return { h: Math.round(r.height), t: (s.innerText || "").split("\n")[0].slice(0, 16) };
  });
  // 那几句英文有没有用上 script 字体
  const phrase = document.querySelector(".aster-phrase");
  const pf = phrase ? getComputedStyle(phrase).fontFamily : null;
  const pfItalic = phrase ? getComputedStyle(phrase).fontStyle : null;
  const phrases = document.querySelectorAll(".aster-phrase").length;
  // 六项橱窗
  const caseLinks = [...document.querySelectorAll('section a[href^="/play/"]')].map((a) =>
    a.getAttribute("href"),
  );
  return {
    有一起天数: /\d+\s*\n?\s*DAYS TOGETHER/i.test(txt) || txt.includes("DAYS TOGETHER"),
    天数文本: (txt.match(/(\d+)\s*\nDAYS TOGETHER/i) ?? [])[0] ?? null,
    顶部名字行: txt.split("\n").find((l) => l.includes("&")) ?? null,
    SINCE行: txt.split("\n").find((l) => /since/i.test(l)) ?? null,
    句子数: phrases,
    句子字体: pf,
    句子斜体: pfItalic,
    卡片: cards,
    橱窗入口: caseLinks,
  };
});
console.log(JSON.stringify(info, null, 2));
console.log(`  一起天数显示: ${info.有一起天数 ? "✅" : "❌"}`);
console.log(`  句子用了 script 字体: ${info.句子字体?.includes("Cormorant") ? "✅ Cormorant Garamond" : `⚠️ ${info.句子字体}`}`);
console.log(`  句子是斜体: ${info.句子斜体 === "italic" ? "✅" : "❌"} / 共 ${info.句子数} 句淡入淡出`);
console.log(`  橱窗六个入口: ${info.橱窗入口.length === 6 ? "✅ " + info.橱窗入口.join(" ") : `❌ ${info.橱窗入口.length} 个`}`);

// 截图分两种：
//  · live —— 让动画正常跑，能看到"当前在亮的那一句"
//  · 不能用 animations:"disabled" 截那几句英文！那会把 5 句全部强制到
//    满透明度、叠在一起变成一团乱码（第一次截就踩了这个坑）
await page.screenshot({ path: `${OUT}/play-hub-new.png`, timeout: 60000 });
await page.setViewportSize({ width: 390, height: 1400 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/play-hub-new-full.png`, timeout: 60000 });

// 设置里那个「认识的日子」
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(BASE + "/space", { waitUntil: "commit", timeout: 30000 });
await page.waitForTimeout(2200);
const hasSetting = await page.evaluate(() => document.body.innerText.includes("认识的日子"));
console.log(`  「我的空间」里有认识的日子设置: ${hasSetting ? "✅" : "❌"}`);

// 真机没照片时看不到"拍立得倾斜"的效果 —— 塞一张进那个 IndexedDB 再验一次
console.log("\n=== 塞一张照片，验拍立得倾斜 ===");
const photoInfo = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open("qidao-play-photos", 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains("photos")) r.result.createObjectStore("photos", { keyPath: "id" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  // 一张很小的测试图（纯色 canvas 转 blob）
  const c = document.createElement("canvas");
  c.width = 200;
  c.height = 200;
  const g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 200, 200);
  grd.addColorStop(0, "#9ec9d8");
  grd.addColorStop(1, "#e8c9b8");
  g.fillStyle = grd;
  g.fillRect(0, 0, 200, 200);
  const blob = await new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", 0.7));
  const thumb = c.toDataURL("image/jpeg", 0.7);
  await new Promise((res) => {
    const tx = db.transaction("photos", "readwrite");
    tx.objectStore("photos").put({ id: "test1", name: "t.jpg", thumb, addedAt: Date.now(), blob });
    tx.oncomplete = res;
  });
  return { ok: true };
});
// 注意：前面为了查「认识的日子」设置已经跳到 /space 了，
// 这里必须**先回 /play** 再 reload —— 否则刷的是设置页（第一次就踩了这个坑）。
await page.goto(BASE + "/play", { waitUntil: "commit", timeout: 30000 });
await page.waitForTimeout(2800);
const tilt = await page.evaluate(() => {
  const img = document.querySelector('img[alt=""]');
  if (!img) return { found: false };
  // 往上找出所有祖先，看谁带 rotate 类、谁的 computed transform 是真的
  const chain = [];
  let el = img;
  for (let i = 0; i < 5 && el; i++) {
    const cs = getComputedStyle(el);
    chain.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || "").toString().slice(0, 90),
      transform: cs.transform,
      rotate: cs.rotate,
    });
    el = el.parentElement;
  }
  return { found: true, chain };
});
console.log(`  找到照片: ${tilt.found ? "✅" : "❌"}`);
for (const c of tilt.chain ?? []) {
  console.log(`   <${c.tag}> rotate=${c.rotate} transform=${c.transform}`);
  console.log(`      class="${c.cls}"`);
}
const tilted = (tilt.chain ?? []).some(
  (c) => c.transform !== "none" || (c.rotate && c.rotate !== "none"),
);
console.log(`  真的倾斜了: ${tilted ? "✅" : "❌ 没有一层带旋转"}`);
await page.screenshot({ path: `${OUT}/play-hub-with-photo.png`, timeout: 60000 });

console.log("\n控制台错误:", errors.length ? [...new Set(errors)].join(" | ") : "(none)");
await browser.close();
