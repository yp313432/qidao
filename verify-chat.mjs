/**
 * 验两件事：
 *  ① 统计行显示「缓存命中率 xx%」而不是原始 token 数
 *  ② 气泡往两边展开（量气泡宽度占屏幕的比例）
 *
 * 办法：拦掉上游请求，返回一段**长回复**（这样才能看出气泡宽度）
 * 和一份带 cached 的用量，然后量 DOM。
 */
import { chromium } from "playwright";
const BASE = "http://127.0.0.1:8080";
const OUT = "C:/Users/yanping/Desktop/ds-workspace/preview-shots";

const THINKING = "先看看他问的什么。这条思考链只是为了让「点开看」出现。";
// 故意写长：一段正常长度的回复，用来观察气泡宽度
const REPLY =
  "你这句话我收到了，跟前面几句一样，转成字到了我这儿。\n\n" +
  "朗读我这边两条回执都写着「已执行」，但你也知道 —— 这个 App 里「发了」和「你真听见了」是两回事。我再发一声，你听这一次有没有：";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));

await page.route("**/mock.local/**", async (route) => {
  const chunks = [
    { choices: [{ delta: { reasoning_content: THINKING } }] },
    { choices: [{ delta: { content: REPLY } }] },
    // cached 4596 / prompt 5031 ≈ 91%
    {
      choices: [{ delta: {} }],
      usage: { prompt_tokens: 5031, completion_tokens: 279, total_tokens: 5310, prompt_cache_hit_tokens: 4596 },
    },
  ];
  await route.fulfill({
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
    body: chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n",
  });
});

await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);

// 配好假上游
await page.evaluate(async () => {
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
    showThinking: true,
    customBaseUrl: "https://mock.local/v1",
    customApiKey: "mock-key",
    upstreamModel: "mock-model",
  };
  await new Promise((res) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(JSON.stringify(parsed), "aster-app");
    tx.oncomplete = res;
  });
});

await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);

await page.click("textarea");
await page.fill("textarea", "你好，语音测试请问能听到吗？");
await page.keyboard.press("Enter");
await page.waitForTimeout(4500);

const info = await page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const rows = [...document.querySelectorAll("li")];
  const dump = rows.map((li) => {
    const lr = li.getBoundingClientRect();
    const av = li.querySelector("span.rounded-full, img, .rounded-full");
    const ar = av ? av.getBoundingClientRect() : null;
    const col = li.querySelector("div.min-w-0");
    const cr = col ? col.getBoundingClientRect() : null;
    const bubble = [...li.querySelectorAll("div.rounded-2xl")].find((el) =>
      /你这句话我收到了|语音测试/.test(el.innerText ?? ""),
    );
    const br = bubble ? bubble.getBoundingClientRect() : null;
    const txt = (li.innerText ?? "").replace(/\s+/g, " ").slice(0, 14);
    return {
      文字: txt,
      行: `${Math.round(lr.left)}→${Math.round(lr.right)}`,
      头像: ar ? `${Math.round(ar.left)}→${Math.round(ar.right)}` : "-",
      内容列: cr ? `${Math.round(cr.left)}→${Math.round(cr.right)} (宽${Math.round(cr.width)})` : "-",
      气泡: br ? `${Math.round(br.left)}→${Math.round(br.right)} (宽${Math.round(br.width)})` : "-",
    };
  });
  return { 屏宽: vw, 行: dump };
});
console.log("屏幕宽:", info.屏宽);
for (const r of info.行) {
  console.log(`\n  「${r.文字}」`);
  console.log(`     行    ${r.行}`);
  console.log(`     头像  ${r.头像}`);
  console.log(`     内容列 ${r.内容列}`);
  console.log(`     气泡  ${r.气泡}`);
}

const info2 = await page.evaluate(() => ({
  统计行: [...document.querySelectorAll("p")]
    .map((p) => p.innerText.replace(/\s+/g, " ").trim())
    .filter((t) => /输入 \d|缓存/.test(t)),
}));
console.log("\n统计行（应该出现「缓存命中率 xx%」）:");
for (const t of info2.统计行) console.log("  ·", t);

const hasRate = info2.统计行.some((t) => /缓存命中率 \d+%/.test(t));
console.log(`\n① 缓存命中率显示: ${hasRate ? "✅" : "❌"}`);
// 气泡是不是贴到内容列的两端（差 ≤ 6px 就算贴住）
const info3 = await page.evaluate(() => {
  const out = [];
  for (const li of document.querySelectorAll("li")) {
    const col = li.querySelector("div.min-w-0");
    const bubble = [...li.querySelectorAll("div.rounded-2xl")].find((el) =>
      /你这句话我收到了|语音测试/.test(el.innerText ?? ""),
    );
    if (!col || !bubble) continue;
    const c = col.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    out.push({ 左差: Math.round(b.left - c.left), 右差: Math.round(c.right - b.right), 宽: Math.round(b.width / c.width * 100) });
  }
  return out;
});
console.log("气泡相对**内容列**的余量（越接近 0 越贴边）:");
for (const b of info3) console.log("  ·", JSON.stringify(b));
const flush = info3.some((b) => b.左差 <= 6 && b.右差 <= 6);
console.log(`② 气泡已推到内容列两边: ${flush ? "✅" : "❌"}`);

await page.screenshot({ path: `${OUT}/chat-bubbles.png`, timeout: 60000 });
console.log("已存 preview-shots/chat-bubbles.png");
console.log("\n控制台错误:", errs.length ? [...new Set(errs)].join(" | ") : "(none)");
await browser.close();
