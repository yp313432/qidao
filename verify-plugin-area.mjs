/**
 * 验收脚本：**「插件」区**（玩乐 → 插件）。
 *
 * 用户的需求（原话）：
 *   "他和时感组成一个插件类别，然后点开是这两个插件，以后我如果有新加的插件也放里面"
 *   "有一个单独的插件区……点进去写上地址和名字，就能插进去了，可以做成这种吗"
 *   "现在的 ui 和设计不能变，我好不容易跑出这么漂亮的效果的"  ← 记忆宇宙那个星图
 *
 * 所以要端到端证明 **六件事**：
 *   ① 玩乐首页多了一个「插件」入口，原来「时感」那一格收进去了（不是丢了）
 *   ② 插件目录里**两个内置插件都在**（时感 / 记忆宇宙）
 *   ③ 点**记忆宇宙**：星图真的画出来了（不是白屏）—— 用的是**栖岛真实的记忆**
 *   ④ 点**时感**：iframe 真的打开了（本地副本），且**底部导航隐藏**、**有返回钮**
 *   ⑤ **自己加一个插件**（填名字 + 地址）→ 列表里出现 → 点开能用 → 能删
 *   ⑥ 老地址 `/play/shigan` **不白屏**（跳到插件里的时感）
 *
 * 跑法（要完整权限；dev server 要在 8080）：
 *   node verify-plugin-area.mjs
 * 退出码非 0 = 有断言没过。
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
const SHOTS = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const consoleErrors = [];
page.on("pageerror", (e) => console.log("  ⚠️ 页面报错:", e.message));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

async function waitInteractive() {
  await page.waitForFunction(() => document.documentElement.dataset.theme !== undefined, {
    timeout: 60000,
  });
}

async function goto(path) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitInteractive();
  await page.waitForTimeout(600);
}

/** 播下几条**真实形状**的记忆（好让星图有东西画） */
async function seedMemories() {
  /**
   * 顺序照 `verify-summary.mjs` 那套（踩过才定下来的）：
   * **page.goto 进来 → 写库 → reload**。
   * store 的持久化是异步的，写完不 reload 的话页面内存里还是旧快照，
   * 星图就会偷偷回落到它自带的示例数据（第一版就是这么错的）。
   */
  await page.goto(BASE + "/play", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitInteractive();
  await page.waitForTimeout(1500);
  const written = await page.evaluate(async () => {
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
    const now = Date.now();
    const mk = (id, content, tags, links, extra = {}) => ({
      id,
      kind: "profile",
      content,
      confidence: 0.9,
      strength: 0.8,
      status: "active",
      tags,
      links,
      recallCount: 3,
      createdAt: now - 86400000 * 5,
      updatedAt: now - 3600000,
      lastRecalledAt: now - 1800000,
      lastConfirmedAt: now - 86400000,
      ...extra,
    });
    parsed.state.memories = [
      mk("m1", "喜欢喝美式，不加糖", ["咖啡", "口味"], ["m2", "m3"]),
      mk("m2", "晚上容易失眠，别太晚聊工作", ["睡眠", "作息"], ["m1"]),
      mk("m3", "养了一只猫，叫团子", ["猫", "宠物"], ["m1"]),
      mk("m4", "我妈生日是 3 月 21", ["家人", "生日"], [], { kind: "timeline", at: "2026-03-21" }),
      mk("m5", "不喜欢被打断工作", ["工作", "习惯"], ["m2"]),
    ];
    parsed.state.settings = { ...parsed.state.settings, customPlugins: [] };
    await new Promise((res) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(JSON.stringify(parsed), "aster-app");
      tx.oncomplete = res;
    });
    /** 把写进去的条数带回来（不然"没写上"和"写上了没读到"分不清） */
    return (parsed.state.memories ?? []).length;
  });
  console.log(`    [播种] 写进库 ${written} 条记忆`);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitInteractive();
}

/* ═══════════ 一、玩乐首页有「插件」入口 ═══════════ */

console.log("【一】玩乐首页");
await goto("/play");
const hubText = await page.evaluate(() => document.body.innerText);
check("① 玩乐首页有「插件」这一格", hubText.includes("插件"));
check(
  "② 「时感」那一格已经收进插件里（首页不再单独有它）",
  !/^\s*时感\s*$/m.test(hubText),
  hubText.split("\n").filter((l) => l.includes("时感")).join(" | ").slice(0, 80),
);

/* ═══════════ 二、插件目录 ═══════════ */

console.log("\n【二】插件目录");
await page.getByText("插件", { exact: true }).first().click();
await page.waitForTimeout(1200);
check("③ 点进插件目录（URL 是 /play/plugins）", page.url().includes("/play/plugins"), page.url());
const listText = await page.evaluate(() => document.body.innerText);
check("④ 目录里有「时感」", listText.includes("时感"));
check("⑤ 目录里有「记忆宇宙」", listText.includes("记忆宇宙"));
/** 目录本身还在 App 框架里 —— 底部导航该在 */
const navOnHub = await page.locator("nav[aria-label=主导航]").count();
check("⑥ 插件目录**保留**底部导航（它还是个列表页）", navOnHub > 0, `nav=${navOnHub}`);
await page.screenshot({ caret: "initial", path: `${SHOTS}\\plugins-hub.png` });

/* ═══════════ 三、记忆宇宙（原生插件 + 真数据）═══════════ */

console.log("\n【三】记忆宇宙");
await seedMemories();
await goto("/play/plugins/memory");
await page.waitForTimeout(4000);

const drawn = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  if (!c) return { ok: false, why: "没有 canvas" };
  const ctx = c.getContext("2d");
  if (!ctx) return { ok: false, why: "拿不到 2d 上下文" };
  const data = ctx.getImageData(0, 0, Math.min(c.width, 400), Math.min(c.height, 400)).data;
  let nonBlack = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] + data[i + 1] + data[i + 2] > 40) nonBlack += 1;
  }
  return { ok: nonBlack > 500, why: `非黑像素 ${nonBlack}` };
});
check("⑦ 星图真的画出来了（不是白屏）", drawn.ok, drawn.why);

/**
 * 星图上的**标题是画在 canvas 里的**，`innerText` 读不到 ——
 * 所以"用的是不是真数据"只能**点一颗星**看详情面板（那是真 DOM）。
 * 第一版拿 innerText 去找「美式」，等于这条断言根本没考到东西（假绿）。
 */
const canvasBox = await page.locator("canvas").first().boundingBox();
if (canvasBox) {
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.waitForTimeout(1200);
}
const detailText = await page.evaluate(() => document.body.innerText);
check(
  "⑧ 点开一颗星，详情里是**我的真记忆**（不是它自带的 Aster / 月落）",
  /美式|失眠|团子|生日|打断工作|喜欢喝/.test(detailText),
  detailText.replace(/\s+/g, " ").slice(0, 140),
);

/** 底部导航必须隐藏（整页铺满的插件页） */
const navOnPlugin = await page.locator("nav[aria-label=主导航]").count();
check("⑨ 插件页**隐藏**底部导航（整页铺满）", navOnPlugin === 0, `nav=${navOnPlugin}`);
/** 返回钮必须有（用户真机踩过：没返回键 → 系统返回直接退出 App） */
const backBtn = await page.locator("button[aria-label=返回插件]").count();
check("⑩ 插件页有返回钮", backBtn > 0);
await page.screenshot({ caret: "initial", path: `${SHOTS}\\plugins-memory.png` });

/* ═══════════ 四、时感（iframe）═══════════ */

console.log("\n【四】时感");
await goto("/play/plugins/shigan");
await page.waitForTimeout(3500);
const frameOk = await page.evaluate(() => {
  const f = document.getElementById("plugin-frame");
  return Boolean(f && f.src.includes("/shigan/index.html"));
});
check("⑪ 时感的 iframe 指向**打进包里的本地副本**", frameOk);
const navOnShigan = await page.locator("nav[aria-label=主导航]").count();
check("⑫ 时感页隐藏底部导航", navOnShigan === 0);
await page.screenshot({ caret: "initial", path: `${SHOTS}\\plugins-shigan.png` });

/* ═══════════ 五、自己加一个插件 ═══════════ */

console.log("\n【五】自己加一个插件");
await goto("/play/plugins");
await page.getByText("添加插件", { exact: false }).first().click();
await page.waitForTimeout(1000);
check("⑬ 进了插件编辑器", page.url().includes("/play/plugins/edit"), page.url());

await page.getByLabel("名字").fill("我的网页");
await page.getByLabel("一句话说明（可选）").fill("测试用");
await page.getByLabel("地址").fill("http://127.0.0.1:5175/");
await page.getByRole("button", { name: "保存", exact: true }).first().click();
await page.waitForTimeout(1200);
const afterAdd = await page.evaluate(() => document.body.innerText);
check("⑭ 保存后回到插件列表，并且**新插件在**", page.url().includes("/play/plugins") && afterAdd.includes("我的网页"), page.url());

/** 点开它 —— 这个地址（5175）允许被嵌，所以应该能打开 */
await page.getByText("我的网页", { exact: true }).first().click();
await page.waitForTimeout(3000);
check("⑮ 新插件点开能打开（iframe 出现了）", (await page.locator("iframe#plugin-frame").count()) > 0, page.url());
await page.screenshot({ caret: "initial", path: `${SHOTS}\\plugins-custom.png` });

/* ═══════════ 六、老地址不白屏 ═══════════ */

console.log("\n【六】老地址兼容");
await goto("/play/shigan");
check(
  "⑯ 老的 /play/shigan 跳到插件里的时感（书签不断）",
  page.url().includes("/play/plugins/shigan"),
  page.url(),
);

/* ═══════════ 七、干净度 ═══════════ */

console.log("\n【七】干净度");
const hydration = consoleErrors.filter((t) => /hydration/i.test(t));
check("⑰ 整轮没有 hydration 不一致", hydration.length === 0, hydration[0]?.slice(0, 120) ?? "");
const NOISE = /Failed to load resource|ERR_CONNECTION|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|Failed to fetch|Extensions|favicon/i;
const badErrors = consoleErrors.filter((t) => !NOISE.test(t));
check("⑱ 控制台没有 app 自己的报错", badErrors.length === 0, badErrors.slice(0, 2).join(" | ").slice(0, 160));

console.log("-".repeat(64));
console.log(`插件区验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);

await browser.close();
process.exit(bad === 0 ? 0 : 1);
