/**
 * 验收脚本：工具区三个编辑器 + MCP 真握手。
 *
 * 为什么要写它（这一轮用户的要求）：
 *   1. "最下面的请求头输入框是不是被导航栏挡住了……直接改成独立页面、没有导航栏"
 *      → 所以要**量**：编辑器页面上不该有主导航，且输入框滚到可见时完整在屏内
 *   2. "mcp 到底行不行 / 为什么调用不了"
 *      → 所以要**真的走一遍握手**，而且每一步都要有证据：
 *          initialize → 服务端给会话号 → notifications/initialized → tools/list
 *        桩服务器会把收到的请求头记下来，脚本断言：
 *          · 第 2、3 个请求带上了 Mcp-Session-Id（这是之前漏掉的那一环）
 *          · 带上了协商出来的 MCP-Protocol-Version
 *          · 界面上出现"拿到 N 个工具"和工具名（而不是含糊的"握手成功"）
 *
 * 用本地桩服务器而不是连外网：沙箱里出网 TLS 是被挡的（实测 github.com 也连不上），
 * 拿公网服务当验收依据等于把环境噪声当成代码结论。
 *
 * 跑法（需要 dev server 在 8080，且要用完整权限，否则浏览器起不来）：
 *   node verify-mcp.mjs
 * 退出码非 0 = 有断言没过。
 */
import { createServer } from "node:http";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
const STUB_PORT = 4599;
const SHOTS = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";

/* ───────────────── 桩服务器：一个最小的真 MCP 服务端 ───────────────── */

/** 收到的每一个请求（用来断言客户端到底发了什么头） */
const seen = [];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  /*
    ⚠️ 这一条是浏览器特有的坑：跨域时**默认读不到**响应头，
    必须由服务端显式 expose，客户端才拿得到会话号。
    真 MCP 服务如果想让网页端连，也得这么干。
  */
  "Access-Control-Expose-Headers": "Mcp-Session-Id, MCP-Protocol-Version",
};

const stub = createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let msg = {};
    try {
      msg = JSON.parse(body);
    } catch {
      /* 忽略 */
    }
    seen.push({
      method: msg.method,
      session: req.headers["mcp-session-id"] ?? "",
      proto: req.headers["mcp-protocol-version"] ?? "",
    });

    if (msg.method === "initialize") {
      res.writeHead(200, {
        ...cors,
        "content-type": "application/json",
        "Mcp-Session-Id": "stub-session-abc",
        "MCP-Protocol-Version": "2025-06-18",
      });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "stub-mcp", version: "0.1.0" },
          },
        }),
      );
      return;
    }
    if (msg.method === "notifications/initialized") {
      res.writeHead(202, cors);
      res.end();
      return;
    }
    if (msg.method === "tools/list") {
      res.writeHead(200, { ...cors, "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            tools: [
              { name: "remember", description: "记一条" },
              { name: "recall", description: "想起来" },
            ],
          },
        }),
      );
      return;
    }
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "没有这个方法" } }));
  });
});

await new Promise((r) => stub.listen(STUB_PORT, "127.0.0.1", r));
console.log(`桩 MCP 服务器已起：http://127.0.0.1:${STUB_PORT}/mcp`);

/* ───────────────────────── 浏览器 ───────────────────────── */

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => console.log("  ⚠️ 页面报错:", e.message));

/**
 * 盯 hydration 不一致：这是 SSR 应用里最容易漏的一类错
 * （首帧读了 sessionStorage / Date.now / 随机数，服务端和客户端就渲染不一样）。
 * 功能看着还是好的，所以必须由脚本抓，不能靠肉眼。
 */
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/* 1. 先进工具页，并从列表走到 MCP 编辑器（走真实的点击路径，不直接输网址） */
await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("h1", { timeout: 20000 });

check("工具首页有主导航（这一页不该隐藏）", await page.locator('nav[aria-label="主导航"]').count() === 1);

await page.getByRole("button", { name: "MCP" }).click();
await page.getByText("添加 MCP 服务器").click();
await page.waitForURL("**/tools/mcp", { timeout: 20000 });
/*
  ⚠️ 这里必须等**编辑器自己的元素**出现，不能只等 "h1"。
  waitForURL 变了之后旧页面还在 DOM 上，此时 `waitForSelector("h1")`
  会立刻命中**上一页**的标题「工具」——
  第一次跑就是栽在这上面（"标题是添加 MCP 服务器"误报失败）。
*/
await page.getByPlaceholder("例如：Horizon / 我的记忆库").waitFor({ timeout: 20000 });

check("点「添加 MCP 服务器」跳到了独立页面 /tools/mcp", page.url().includes("/tools/mcp"));
check("编辑器页面**没有**底部导航", (await page.locator('nav[aria-label="主导航"]').count()) === 0);
check("标题是「添加 MCP 服务器」", (await page.locator("h1").innerText()).includes("添加 MCP 服务器"));
check("没有「传输方式」这一栏了（假的和实现不了的都撤了）", (await page.getByText("传输方式").count()) === 0);

/* 2. 量「请求头」输入框到底会不会被挡住 —— 三种屏高都要量（含键盘弹起）
 *
 * ⚠️ 这里**不能用** scrollIntoViewIfNeeded 来判断：它认为"已经可见"就停手，
 * 实测在 480 屏高时它滚到 scrollTop=24 就停了，textarea 还差 1px 没露全，
 * 于是报了个假失败（页面的滚动上限其实是 198，再多滚 1px 就全露了）。
 * 所以改成用户的真实动作：**把容器滚到底**，再量它有没有被压住。
 */
await page.getByPlaceholder("例如：Horizon / 我的记忆库").fill("桩服务器");
await page.getByPlaceholder("https://example.com/mcp").fill(`http://127.0.0.1:${STUB_PORT}/mcp`);

for (const h of [844, 620, 480]) {
  await page.setViewportSize({ width: 390, height: h });
  await page.waitForTimeout(200);
  const geom = await page.locator("textarea").first().evaluate((ta) => {
    // 找到真正能滚的那个祖先，滚到底
    let el = ta.parentElement;
    while (el) {
      const s = getComputedStyle(el);
      if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(s.overflowY)) {
        el.scrollTop = el.scrollHeight;
        break;
      }
      el = el.parentElement;
    }
    const r = ta.getBoundingClientRect();
    const scroller = el;
    return {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      vh: window.innerHeight,
      navH: document.querySelector('nav[aria-label="主导航"]')?.clientHeight ?? 0,
      /*
        输入框底边到**屏幕底边**还有多远。
        有滚动容器时 = 容器底边 - 输入框底边（滚到底的情况下这是留白）；
        内容没溢出（不用滚）时 = 视口底边 - 输入框底边。
        两种情况都回答同一个问题："它下面还有地方吗，还是贴着边/被压住"。
      */
      bottomGap: scroller
        ? Math.round(scroller.getBoundingClientRect().bottom - r.bottom)
        : Math.round(window.innerHeight - r.bottom),
    };
  });
  check(
    `屏高 ${h} 时「请求头」完整可见（没被任何东西压住）`,
    geom.bottom <= geom.vh && geom.top >= 0,
    `top=${geom.top} bottom=${geom.bottom} 视口高=${geom.vh} 导航高=${geom.navH} 底部留白=${geom.bottomGap}px`,
  );
  check(
    `屏高 ${h} 时滚到底还有底部留白（不贴着屏幕边）`,
    geom.bottomGap >= 8,
    `留白=${geom.bottomGap}px`,
  );
}

await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ caret: "initial", path: `${SHOTS}\\tools-mcp-editor.png` });

/* 3. 保存 → 回列表 */
await page.getByRole("button", { name: "保存" }).click();
await page.waitForURL("**/tools", { timeout: 20000 });
await page.waitForSelector("h1", { timeout: 20000 });
check("保存后回到工具页，且还停在 MCP 标签上", (await page.getByText("桩服务器").count()) > 0);

/* 4. 真握手 */
await page.getByRole("button", { name: "测试连接" }).click();
await page.waitForSelector("text=拿到 2 个工具", { timeout: 25000 });

const statusText = await page.locator("pre").last().innerText();
check("界面显示「拿到 2 个工具」", statusText.includes("拿到 2 个工具"));
check("工具名被列出来了（remember / recall）", (await page.getByText("remember").count()) > 0 && (await page.getByText("recall").count()) > 0);
check("状态标记为「连通」", (await page.getByText("连通", { exact: true }).count()) > 0);
await page.screenshot({ caret: "initial", path: `${SHOTS}\\tools-mcp-connected.png` });

/* 5. 握手过程本身对不对（这是"到底行不行"的硬证据） */
const init = seen.find((s) => s.method === "initialize");
const note = seen.find((s) => s.method === "notifications/initialized");
const list = seen.find((s) => s.method === "tools/list");
check("第 1 步 initialize 发到了", Boolean(init));
check("第 2 步 notifications/initialized 发到了", Boolean(note));
check("第 3 步 tools/list 发到了", Boolean(list));
check("第 2 步带上了服务端给的会话号（之前漏掉的就是这一环）", note?.session === "stub-session-abc", `实际="${note?.session}"`);
check("第 3 步也带上了会话号", list?.session === "stub-session-abc", `实际="${list?.session}"`);
check("第 3 步带上了协商出来的协议版本头", list?.proto === "2025-06-18", `实际="${list?.proto}"`);
check("第 1 步**没有**提前带协议版本头（协议是先协商再带的）", init?.proto === "", `实际="${init?.proto}"`);

/* 6. 另外两个编辑器也走一遍（同一套写法，不该只对 MCP 好使） */
await page.goto(`${BASE}/tools/http`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("h1", { timeout: 20000 });
check("/tools/http 也没有底部导航", (await page.locator('nav[aria-label="主导航"]').count()) === 0);
await page.screenshot({ caret: "initial", path: `${SHOTS}\\tools-http-editor.png` });

await page.goto(`${BASE}/tools/docs`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("h1", { timeout: 20000 });
check("/tools/docs 也没有底部导航", (await page.locator('nav[aria-label="主导航"]').count()) === 0);
check("/tools/docs 不再是 window.prompt 两次（有真标题栏）", (await page.getByText("新建文档").count()) > 0);
await page.screenshot({ caret: "initial", path: `${SHOTS}\\tools-docs-editor.png` });

/* 7. 返回钮回的是「工具」，不是「我的」 */
await page.locator('header a[aria-label^="返回"]').click();
await page.waitForURL("**/tools", { timeout: 20000 });
check("编辑器的返回钮回到 /tools（上一级）", new URL(page.url()).pathname === "/tools");

await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("h1", { timeout: 20000 });
await page.screenshot({ caret: "initial", path: `${SHOTS}\\tools-home.png` });

console.log("-".repeat(60));
const hydration = consoleErrors.filter((t) => /hydration/i.test(t));
check(
  "整轮没有 hydration 不一致（首帧别读 sessionStorage / Date.now / 随机数）",
  hydration.length === 0,
  hydration[0]?.replace(/\s+/g, " ").slice(0, 300) ?? "",
);
console.log(`MCP / 编辑器验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);

await browser.close();
stub.close();
process.exit(bad === 0 ? 0 : 1);
