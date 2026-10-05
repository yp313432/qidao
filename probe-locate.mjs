/**
 * 单独诊断"自动刷新"这条路：
 *   ① 系统定位（GPS/WiFi）能不能拿到坐标
 *   ② IP 定位能不能认出城市
 *   ③ 和风能不能查天气
 * 每一步都打印真实结果，不猜。
 *
 * 用法：$env:QW_KEY="..."; $env:QW_HOST="..."; node probe-locate.mjs
 */
import { chromium } from "playwright";
const BASE = "http://127.0.0.1:8080";
const KEY = process.env.QW_KEY ?? "";
const HOST = process.env.QW_HOST ?? "";

const browser = await chromium.launch({ channel: "msedge" });
/*
  这里**故意不给定位权限、也不给模拟坐标** ——
  模拟用户室内"GPS 拿不到"的情况，专门看 IP 兜底能不能接上。
*/
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
const net = [];
page.on("response", (r) => {
  const u = r.url();
  if (/pconline|ipapi|baidu|qweatherapi/.test(u)) {
    net.push(`${r.status()} ${u.replace(KEY, "<key>").slice(0, 110)}`);
  }
});
page.on("requestfailed", (r) => {
  const u = r.url();
  if (/pconline|ipapi|baidu|qweatherapi/.test(u)) {
    net.push(`FAILED(${r.failure()?.errorText}) ${u.slice(0, 100)}`);
  }
});

await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);

// 写入设置：开通开关 + 填和风（**故意不填手动地点**，走自动那条路）
await page.evaluate(
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
    const p = JSON.parse(raw);
    p.state.settings = {
      ...p.state.settings,
      geoEnabled: true,
      qweatherKey: key,
      qweatherHost: host,
      manualPlace: "",        // ← 故意留空，逼它走自动定位
      geoLabel: "",
      geoAt: 0,
      geoPlaceId: "",
      weatherText: "",
      weatherAt: 0,
    };
    await new Promise((res) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(JSON.stringify(p), "aster-app");
      tx.oncomplete = res;
    });
  },
  { key: KEY, host: HOST },
);

await page.goto(BASE + "/system", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);

console.log("=== 点「刷新」，走自动定位 ===");
const btn = await page.$('button:has-text("刷新")');
if (!btn) {
  console.log("没找到刷新按钮");
} else {
  await btn.click();
  // 系统定位最长 30 秒 + IP 最多 12 秒，等够
  await page.waitForTimeout(45000);
  const out = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("天气与定位");
    return { 片段: i >= 0 ? t.slice(i, i + 480) : "(没找到)" };
  });
  console.log(out.片段);
}

console.log("\n=== 相关网络请求 ===");
for (const n of net) console.log("  " + n);
if (net.length === 0) console.log("  （一个都没发出去 —— 说明卡在更前面）");

await page.screenshot({ path: "C:/Users/yanping/Desktop/ds-workspace/preview-shots/probe-locate.png", timeout: 60000 });
await browser.close();
