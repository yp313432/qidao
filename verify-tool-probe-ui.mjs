/**
 * Lead 补验 P1 的**界面交互层**（队友的沙箱起不了浏览器，这是唯一没验的部分）：
 *   ① 按钮在不在、点了有没有 loading
 *   ② 上游**支持** tools 时，三行结论是不是都"通过"（起一个本地假上游）
 *   ③ 上游**不通**时，是不是**人话报错**而不是崩掉（不弹红屏、没有 pageerror）
 *   ④ 原始片段能不能展开
 *
 * 跑法：node verify-tool-probe-ui.mjs
 */
import { createServer } from "node:http";
import { chromium } from "playwright";

const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";
const PORT = 4634;
let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/** 假上游：非流式/流式都回一个 get_time 的 tool_call，带 CORS */
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const want = body.includes('"stream":true');
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") return res.end();
    /* 带 /slow 的地址故意慢 1.2 秒 —— 不然本地假上游秒回，
       loading 态一闪而过，根本验不到（第一版就是这么假失败的） */
    const slow = req.url.includes("/slow");
    const reply = () => {
      const call = { id: "call_1", type: "function", function: { name: "get_time", arguments: "{}" } };
      if (!want) {
        res.setHeader("Content-Type", "application/json");
        return res.end(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "", tool_calls: [call] } }],
          }),
        );
      }
      res.setHeader("Content-Type", "text/event-stream");
      const frames = [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_time", arguments: "" } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] } }] },
      ];
      res.write(frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join(""));
      res.write("data: [DONE]\n\n");
      res.end();
    };
    if (slow) setTimeout(reply, 1200);
    else reply();
  });
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const browser = await chromium.launch({ channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

async function seed(baseUrl) {
  await page.goto(`${BASE}/usage`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.evaluate(async ([url]) => {
    const db = await new Promise((res) => {
      const r = indexedDB.open("qidao-store", 1);
      r.onsuccess = () => res(r.result);
    });
    const raw = await new Promise((res) => {
      const g = db.transaction("kv", "readonly").objectStore("kv").get("aster-app");
      g.onsuccess = () => res(g.result);
    });
    const p = JSON.parse(raw);
    // zustand persist 的形状是 { state: { settings, … } }（别的验收脚本也是这么读的）
    p.state.settings.customBaseUrl = url;
    p.state.settings.customApiKey = "probe-key";
    p.state.settings.upstreamModel = "test-model";
    await new Promise((res) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(JSON.stringify(p), "aster-app");
      tx.oncomplete = res;
    });
  }, [baseUrl]);
  await page.goto(`${BASE}/usage`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
}

/* ② 支持 tools 的上游（故意慢，好验 loading） */
await seed(`http://127.0.0.1:${PORT}/slow/v1`);
const btn = page.getByText("测一测这个上游支不支持工具调用");
check("① 按钮在页面上", (await btn.count()) > 0);
await btn.first().click();
await page.waitForTimeout(250);
const loadingText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
check("① 点了之后出现 loading 文案（按钮变「正在问上游…」）", loadingText.includes("正在问上游"), loadingText.slice(0, 90));
const disabledDuring = await page.locator("button:has-text('正在问上游')").isDisabled().catch(() => false);
check("① loading 期间按钮是禁用的（防止连点）", disabledDuring);
await page.waitForTimeout(4000);
const okText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
check("② 三行结论都渲染出来了", /工具调用|tools/i.test(okText) && /耗时|ms/i.test(okText), okText.slice(okText.indexOf("工具调用"), okText.indexOf("工具调用") + 120));
check("② 支持的上游 → 报「通过」（三行都通过）", (okText.match(/通过/g) ?? []).length >= 3, `"通过" 出现 ${(okText.match(/通过/g) ?? []).length} 次`);
const detailsCount = await page.locator("details").count();
check("① 原始片段放在可展开的 <details> 里", detailsCount >= 1, `${detailsCount} 个`);
await page.screenshot({ path: "preview-shots/tool-probe-ok.png", fullPage: true });

/* ③ 上游不通 */
await seed("http://127.0.0.1:9/v1");
await page.getByText("测一测这个上游支不支持工具调用").first().click();
await page.waitForTimeout(4000);
const badText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
check("③ 上游不通 → 报「不通过」而不是崩", /不通过|失败/.test(badText));
check("③ 给了人话原因（不是空白）", /失败|超时|连不上|拒绝|error|HTTP/i.test(badText.slice(badText.indexOf("工具调用"))));
check("④ 整个过程没有未捕获的 JS 报错", errors.length === 0, errors[0]?.slice(0, 90) ?? "");
await page.screenshot({ path: "preview-shots/tool-probe-fail.png", fullPage: true });

console.log("-".repeat(60));
console.log(`P1 界面补验：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
await browser.close();
server.close();
process.exit(bad === 0 ? 0 : 1);
