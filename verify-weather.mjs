/**
 * 验天气 + 定位（和风）这条链路真的通。
 *
 * 做法：把用户的 key/host 写进 IndexedDB 的设置里，然后打开页面看真的出不出天气。
 * 注意：**key 只写进浏览器本地库**，不落代码、不落仓库。
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
const OUT = "C:/Users/yanping/Desktop/ds-workspace/preview-shots";
/**
 * ⚠️ Key **绝不能写在这里**。
 *
 * 我犯过这个错：把用户的 key 硬编码进这个文件并推上了 GitHub。
 * key 是敏感数据，进了 git 历史就等于泄露（改掉再推也没用，历史里还在）。
 *
 * 所以现在从环境变量读，跑的时候临时给：
 *   $env:QW_KEY="..."; $env:QW_HOST="..."; node verify-weather.mjs
 * 不给就跳过"真调接口"那部分，只验界面。
 */
const KEY = process.env.QW_KEY ?? "";
const HOST = process.env.QW_HOST ?? "";

if (!KEY || !HOST) {
  console.log("没给 QW_KEY / QW_HOST，只做静态检查，不调接口。");
  console.log("要真验：$env:QW_KEY=\"...\"; $env:QW_HOST=\"...\"; node verify-weather.mjs");
  process.exit(0);
}

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));

// 观察真的有没有发请求给和风
const qhits = [];
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("qweatherapi.com")) qhits.push(u.replace(KEY, "<key>"));
});

await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);

// 1) 写设置：开开关 + 填 key/host + 手动地点
const wrote = await page.evaluate(
  async ({ key, host }) => {
    const db = await new Promise((res) => {
      const r = indexedDB.open("qidao-store", 1);
      r.onsuccess = () => res(r.result);
    });
    const raw = await new Promise((res) => {
      const tx = db.transaction("kv", "readonly");
      const g = tx.objectStore("kv").get("aster-app");
      g.onsuccess = () => res(g.result);
    });
    const parsed = JSON.parse(raw);
    parsed.state.settings = {
      ...parsed.state.settings,
      geoEnabled: true,
      qweatherKey: key,
      qweatherHost: host,
      manualPlace: "北京市朝阳区",
      weatherText: "",
      weatherAt: 0,
      geoPlaceId: "",
      geoLabel: "",
      geoAt: 0,
    };
    await new Promise((res) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(JSON.stringify(parsed), "aster-app");
      tx.oncomplete = res;
    });
    return { ok: true };
  },
  { key: KEY, host: HOST },
);
console.log("写入设置:", JSON.stringify(wrote));

// 2) 打开玩乐区首页 —— 它会在挂载时自动刷一次
console.log("\n=== 打开玩乐区首页 ===");
qhits.length = 0;
await page.goto(BASE + "/play", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(9000);

const hub = await page.evaluate(() => {
  const txt = document.body.innerText.replace(/\s+/g, " ");
  return { 正文: txt.slice(0, 200), 有天气行: /°C/.test(txt) };
});
console.log("  和风请求:", qhits.length ? qhits.join("\n            ") : "（没有）");
console.log("  页面里出现温度:", hub.有天气行 ? "✅" : "❌");
console.log("  正文:", hub.正文);
await page.screenshot({ path: `${OUT}/weather-hub.png`, timeout: 60000 });

// 3) 看设置页显示成什么样
console.log("\n=== 打开「系统 → 天气与定位」 ===");
qhits.length = 0;
await page.goto(BASE + "/system", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);
const sys = await page.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, " ");
  const i = t.indexOf("天气与定位");
  return { 片段: i >= 0 ? t.slice(i, i + 260) : "(没找到那一段)" };
});
console.log("  ", sys.片段);

// 点一次"刷新"看真实反馈
const btn = await page.$('button:has-text("刷新")');
if (btn) {
  await btn.click();
  await page.waitForTimeout(8000);
  const after = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("天气与定位");
    return i >= 0 ? t.slice(i, i + 300) : "";
  });
  console.log("\n  点「刷新」之后:", after);
  console.log("  和风请求:", qhits.length ? qhits.join("\n            ") : "（没有）");
}
await page.screenshot({ path: `${OUT}/weather-settings.png`, timeout: 60000 });

console.log("\n控制台错误:", errs.length ? [...new Set(errs)].join(" | ") : "(none)");
await browser.close();
