import { mkdirSync } from "node:fs";
import { chromium, devices } from "playwright";

/**
 * 统一验收：14 个二级页 + 首页。
 * 检查：有内容 / 控制台零错误 / 返回按钮尺寸是否统一 / 标题是否衬线 / 底部 tab 高亮。
 */
const OUT = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";
mkdirSync(OUT, { recursive: true });
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8080";

const PAGES = [
  { path: "/me", name: "me-hub", title: "我的", tab: "我的" },
  { path: "/core", name: "p-core", title: "AI 概览", tab: "我的" },
  { path: "/space", name: "p-space", title: "我的空间", tab: "我的" },
  { path: "/usage", name: "p-usage", title: "模型与用量", tab: "我的" },
  { path: "/data", name: "p-data", title: "数据", tab: "我的" },
  { path: "/system", name: "p-system", title: "系统", tab: "我的" },
  { path: "/permissions", name: "p-permissions", title: "AI 权限", tab: "我的" },
  { path: "/worldbook", name: "p-worldbook", title: "世界书", tab: "我的" },
  { path: "/inner", name: "p-inner", title: "内在", tab: "我的" },
  { path: "/memories", name: "p-memories", title: "记忆库", tab: "我的" },
  { path: "/memory", name: "p-memory", title: "上下文与内存", tab: "我的" },
  { path: "/alarms", name: "p-alarms", title: "闹钟", tab: "我的" },
  { path: "/tasks", name: "p-tasks", title: "定时任务", tab: "我的" },
  { path: "/env", name: "p-env", title: "环境自检", tab: "我的" },
  { path: "/tools", name: "p-tools", title: "工具", tab: "工具" },
  { path: "/play", name: "p-play", title: "玩乐", tab: "玩乐" },
];

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const errors = [];
const failed = [];
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message.split("\n")[0].slice(0, 130)));
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE " + m.text().slice(0, 130)); });
page.on("requestfailed", (r) => failed.push(r.url().replace(BASE, "").slice(0, 60)));

console.log("路径".padEnd(14) + "标题".padEnd(14) + "返回钮".padEnd(10) + "标题字体".padEnd(12) + "高亮".padEnd(8) + "结果");
console.log("-".repeat(78));

let problems = 0;
for (const p of PAGES) {
  errors.length = 0;
  await page.goto(BASE + p.path, { waitUntil: "commit", timeout: 30000 });
  await page.waitForTimeout(2200);

  const info = await page.evaluate(() => {
    const back = document.querySelector('a[aria-label^="返回"]');
    const br = back?.getBoundingClientRect();
    const icon = back?.querySelector("svg");
    const ir = icon?.getBoundingClientRect();
    const h1 = document.querySelector("header h1");
    const nav = document.querySelector('nav[aria-label="主导航"]');
    const activeLabel = nav?.querySelector('[aria-current="page"]')?.textContent?.trim() ?? null;
    return {
      chars: document.body.innerText.replace(/\s/g, "").length,
      backExists: Boolean(back),
      backSize: br ? `${Math.round(br.width)}x${Math.round(br.height)}` : null,
      iconSize: ir ? `${Math.round(ir.width)}px` : null,
      titleText: h1?.textContent?.trim() ?? null,
      titleFont: h1 ? getComputedStyle(h1).fontFamily.split(",")[0].replace(/"/g, "") : null,
      activeLabel,
      navShown: Boolean(nav),
    };
  });

  const backOK = info.backSize === "44x44" && info.iconSize === "24px";
  const fontOK = info.titleFont === "Source Serif 4";
  const hlOK = info.activeLabel === p.tab;
  const contentOK = info.chars > 30;
  const clean = errors.length === 0;
  const pass = backOK && fontOK && hlOK && contentOK && clean;
  if (!pass) problems++;

  console.log(
    p.path.padEnd(14) +
      String(info.titleText ?? "-").slice(0, 12).padEnd(14) +
      String(info.backSize ?? "无").padEnd(10) +
      String(info.titleFont ?? "-").slice(0, 10).padEnd(12) +
      String(info.activeLabel ?? "无").padEnd(8) +
      (pass ? "✅" : `❌${!contentOK ? " 无内容" : ""}${!backOK ? " 返回钮" : ""}${!fontOK ? " 字体" : ""}${!hlOK ? " 高亮" : ""}${!clean ? " 控制台" : ""}`),
  );
  if (errors.length) console.log("     控制台:", [...new Set(errors)].join(" | "));

  await page.screenshot({ path: `${OUT}/${p.name}.png`, animations: "disabled", timeout: 60000 });
}

console.log("-".repeat(78));
console.log(problems === 0 ? "✅ 全部通过：返回按钮 44x44 / 图标 24px / 标题衬线 / 二级页高亮正确 / 零控制台错误" : `❌ ${problems} 个页面有问题`);
console.log("加载失败请求:", failed.length ? [...new Set(failed)].join(", ") : "(none)");
await browser.close();
