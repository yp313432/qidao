import { chromium, devices } from "playwright";

/** 抽屉装饰：从顶部开始 / 无线条 / 更闪 / 行星更多更大 / 换主题会跟着变色 */
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8080";
const OUT = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";
const now = Date.now();

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

await page.addInitScript((t) => {
  const snapshot = {
    state: {
      conversations: [
        { id: "c1", title: "关于论文的压力", messages: [{ id: "m1", role: "assistant", content: "先别硬扛", thinking: "", thinkingDurationMs: 0, createdAt: t }], createdAt: t, updatedAt: t, pinned: true, incognito: false },
        { id: "c2", title: "晚上好", messages: [{ id: "m2", role: "assistant", content: "歌还停在那一首", thinking: "", thinkingDurationMs: 0, createdAt: t }], createdAt: t, updatedAt: t - 1000, pinned: false, incognito: false },
      ],
      activeId: "c1",
      settings: { displayName: "yan", aiName: "星芒", theme: "dawn" },
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

async function openDrawer() {
  await page.goto(BASE + "/", { waitUntil: "commit", timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.locator("header button").first().click();
  await page.waitForTimeout(1100);
}

await openDrawer();

const geo = await page.evaluate(() => {
  const aside = document.querySelector("aside.glass-panel");
  const ar = aside.getBoundingClientRect();
  const sky = aside.querySelector("[aria-hidden='true'].absolute");
  const sr = sky?.getBoundingClientRect();
  // 有没有横贯的分隔线（.glass-tray 那条 h-px）
  const divider = aside.querySelector(".glass-tray");
  const decor = getComputedStyle(document.documentElement).getPropertyValue("--decor").trim();
  const canvases = [...aside.querySelectorAll("canvas")].map((c) => `${c.width}x${c.height}`);
  const stars = aside.querySelectorAll(".aster-twinkle").length;
  const planets = aside.querySelectorAll("ellipse").length;
  return {
    抽屉顶: Math.round(ar.top),
    星野顶: sr ? Math.round(sr.top) : null,
    星野高: sr ? Math.round(sr.height) : null,
    分隔线: divider ? "还在 ❌" : "已去掉 ✅",
    decor变量: decor,
    画布: canvases,
    星星数: stars,
    星环数: planets,
  };
});
console.log("=== 几何 ===");
console.log(JSON.stringify(geo, null, 2));
console.log(`  星野从抽屉顶边开始（${geo.星野顶} = ${geo.抽屉顶}）: ${geo.星野顶 === geo.抽屉顶 ? "✅" : "❌"}`);
console.log(`  分隔线: ${geo.分隔线}`);
console.log(`  星星 ${geo.星星数} 颗 / 星环 ${geo.星环数} 个: ${geo.星星数 >= 8 && geo.星环数 >= 2 ? "✅ 够密了" : "❌ 还是空"}`);

await page.screenshot({ path: `${OUT}/decor2-drawer.png` });
const box = await page.locator("aside.glass-panel").boundingBox();
if (box) {
  await page.screenshot({ path: `${OUT}/decor2-top.png`, clip: { x: box.x, y: box.y, width: box.width, height: 170 } });
  await page.screenshot({ path: `${OUT}/decor2-bottom.png`, clip: { x: box.x, y: box.y + box.height - 165, width: box.width, height: 165 } });
}

// 换主题：装饰颜色必须跟着变（用户最在意的一条）
// 另加：球体色与文字色**互相独立**（用户："球体颜色和字体颜色做个切割"）
console.log("\n=== 换主题，装饰颜色是否跟着统一（球体色要独立可调）===");
const sample = async (theme) => {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const probe = (v) => {
      const el = document.createElement("span");
      el.style.color = `var(${v})`;
      el.style.display = "none";
      document.body.appendChild(el);
      const rgb = getComputedStyle(el).color;
      el.remove();
      return rgb;
    };
    return { 星野色: probe("--decor"), 球体色: probe("--decor-planet") };
  });
};
// 深色主题要同时把文字色翻成浅色（等价于用户在「文字颜色」里调浅）
for (const [theme, tone] of [["dawn", "dark"], ["ink", "light"]]) {
  await page.evaluate(({ t, tone }) => {
    document.documentElement.dataset.theme = t;
    const r = document.documentElement;
    if (tone === "light") {
      r.style.setProperty("--aster-fg", "#eceef2");
      r.style.setProperty("--aster-muted", "color-mix(in oklab, #eceef2 76%, transparent)");
      r.style.setProperty("--aster-subtle", "color-mix(in oklab, #eceef2 55%, transparent)");
    } else {
      r.style.removeProperty("--aster-fg");
      r.style.removeProperty("--aster-muted");
      r.style.removeProperty("--aster-subtle");
    }
  }, { t: theme, tone });
  await page.waitForTimeout(600);
  const s = await sample(theme);
  console.log(`  theme=${theme.padEnd(5)} 星野色 ${s.星野色}  球体色 ${s.球体色}`);
  await page.screenshot({ path: `${OUT}/decor2-theme-${theme}.png` });
}

// 界面上那个「小宇宙的星球颜色」开关：点了要真的生效，且不动正文
console.log("\n=== 界面开关：小宇宙的星球颜色 ===");
await page.goto(BASE + "/me", { waitUntil: "commit", timeout: 30000 });
await page.waitForTimeout(2200);
// 进「我的空间」（个性化在那里）
await page.getByRole("link", { name: /我的空间/ }).first().click();
await page.waitForTimeout(1500);
const hasControl = await page.evaluate(() =>
  document.body.innerText.includes("小宇宙的星球颜色"),
);
console.log(`  「我的空间」里有这个开关: ${hasControl ? "✅" : "❌"}`);

const readPlanet = () =>
  page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--decor-planet)";
    probe.style.display = "none";
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });

if (hasControl) {
  const before = await readPlanet();
  console.log(`  默认（跟随文字）: ${before}`);
  // 点「冷薄荷青」
  await page.getByRole("button", { name: "冷薄荷青" }).first().click();
  await page.waitForTimeout(600);
  const after = await readPlanet();
  const bodyColor = await page.evaluate(() => getComputedStyle(document.body).color);
  console.log(`  点「冷薄荷青」后: ${after}`);
  console.log(`  生效了: ${after !== before ? "✅" : "❌"}`);
  console.log(`  正文文字没被牵动: ${bodyColor === "rgb(28, 25, 23)" || bodyColor.includes("28") ? "✅" : `⚠️ ${bodyColor}`}`);
  await page.screenshot({
    path: `${OUT}/planet-tone-control.png`,
    fullPage: false,
  });
}
const split = await page.evaluate(() => {
  const r = document.documentElement;
  const before = getComputedStyle(document.body).color;
  r.style.setProperty("--decor-planet", "#3f7f9f"); // 故意换个冷青
  const probe = document.createElement("span");
  probe.style.color = "var(--decor-planet)";
  probe.style.display = "none";
  document.body.appendChild(probe);
  const planet = getComputedStyle(probe).color;
  probe.remove();
  const after = getComputedStyle(document.body).color;
  const svg = document.querySelector("aside .aster-orbit-slow")
    ? getComputedStyle(document.querySelector("aside .aster-orbit-slow").closest("svg")).color
    : null;
  return { 正文前: before, 正文后: after, 球体色: planet, 画布取到: svg };
});
console.log(JSON.stringify(split, null, 2));
console.log(`  正文文字没被牵动: ${split.正文前 === split.正文后 ? "✅ 切开了" : "❌ 还是联动"}`);
console.log(`  球体 SVG 拿到新色: ${split.画布取到 === split.球体色 ? "✅" : `❌ (${split.画布取到})`}`);
await page.screenshot({ path: `${OUT}/decor2-planet-split.png` });

console.log("\n控制台错误:", errors.length ? [...new Set(errors)].join(" | ") : "(none)");
await browser.close();
