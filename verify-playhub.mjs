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

console.log("\n控制台错误:", errors.length ? [...new Set(errors)].join(" | ") : "(none)");
await browser.close();
