/**
 * 验收脚本（Playwright，连 8080）：**主动感知动作在真界面上的闭环**。
 *
 * 纯 node 那一半（`verify-sense.mjs`）测的是"判定与措辞"；这个脚本测**端到端**：
 *
 *   假上游发一次 `sense_device` / `sense_notifications` 的 tool_call
 *     → 客户端过闸门真执行（走 `lib/sense.ts` → `sense-core.ts`）
 *       → 结果以 role:"tool" 回灌（下一轮请求里能看到那行 JSON）
 *         → 界面上那一栏「动手 N 次」点开有回话
 *
 * 两趟（**网页版** —— 没有原生插件，正是要验的降级路径）：
 *   A. 「放个歌听」→ 只发「媒体」组 + 常驻；**断言 A 组三个感知在里面、B 组三个不在**
 *      （这一条同时验了"注册策略"：A 组常驻、B 组按需）
 *      → 假上游调 `sense_device` → 断言结果是**如实跳过**（ok:true 但 battery=null
 *        + 明说网页版读不到），不是编的 100%
 *   B. 「我刚收到什么通知吗」→ 断言 `sense_notifications` 这次**按需**进了 tools
 *      → 假上游调它 → 断言结果是 **ok:false + 明说网页版没有这个能力**
 *
 * 跑法（dev server 要在 8080）：
 *   node verify-sense-ui.mjs
 * 截图写到 preview-shots/（每轮都要真的看）。
 */
import { createServer } from "node:http";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
const UP_PORT = 4646;
const UP_BASE = `http://127.0.0.1:${UP_PORT}`;
const SHOTS = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";

/** 假上游收到的每一轮请求（tools 清单 + 回灌都在里面） */
const log = { rounds: [] };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });

const sse = (res, frames) => {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "access-control-allow-origin": "*",
  });
  for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
};

const frame = (delta) => ({ choices: [{ index: 0, delta, finish_reason: null }] });

/**
 * 分片的 tool_call（跟 verify-tool-native 一样）：名字切两段。
 * 感知动作的工具名是 `sense_device` 这种 —— 顺带验一下下划线名字也被拼得对。
 */
function fragmentedCall(toolName, id) {
  const cut = Math.max(1, Math.floor(toolName.length / 2));
  return [
    frame({ role: "assistant", content: "我看一眼。" }),
    frame({
      tool_calls: [
        { index: 0, id, type: "function", function: { name: toolName.slice(0, cut), arguments: "" } },
      ],
    }),
    frame({ tool_calls: [{ index: 0, function: { name: toolName.slice(cut), arguments: "{}" } }] }),
    { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
  ];
}

const upstream = createServer(async (req, res) => {
  const url = new URL(req.url, `${UP_BASE}${req.url ?? ""}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify({ data: [{ id: "stub-model" }] }));
    return;
  }
  if (req.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
    res.writeHead(404, cors);
    res.end("not found");
    return;
  }

  const raw = await readBody(req);
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  log.rounds.push({ path: url.pathname, body });
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const sawToolResult = msgs.some((m) => m && m.role === "tool");
  console.log(
    `    [假上游] #${log.rounds.length} ${url.pathname} tools=${
      Array.isArray(body.tools) ? body.tools.length : 0
    } 回灌=${msgs.filter((m) => m?.role === "tool").length}`,
  );

  const mode = url.pathname.split("/")[1] || "sense-device";
  if (!sawToolResult) {
    sse(
      res,
      mode === "sense-notif"
        ? fragmentedCall("sense_notifications", "call_sense_notif_1")
        : fragmentedCall("sense_device", "call_sense_device_1"),
    );
    return;
  }
  sse(res, [frame({ role: "assistant", content: "看到了，我这就说。" })]);
});

await new Promise((r) => upstream.listen(UP_PORT, "127.0.0.1", r));
console.log(`假上游（dev server 能访问）  ${UP_BASE}\n`);

/* ───────────────── 浏览器 ───────────────── */

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

/**
 * ⚠️ **影子模块**（2026-10 在真页面上实测确认过）：vite dev 会在模块 URL 上挂
 * `?t=<失效时间戳>` —— App 真正加载的是 `/src/lib/sense.ts?t=...`，
 * 而脚本里 `import("/src/lib/sense.ts")` 会**再实例化一份**（`===` 都不相等）。
 * 下面【C】那一节直接调 `runSenseAction()` 验接线，所以必须走 App 自己那一份：
 * 从 resource 时间线里捞出 App 真正加载过的 URL 再 import（没挂 `?t=` 时裸路径就是它）。
 */
await page.addInitScript(() => {
  window.__realImport = async (path, waitMs = 0) => {
    const bare = new URL(path, location.origin).href;
    const tOf = (u) => {
      const m = /\?t=(\d+)/.exec(u);
      return m ? Number(m[1]) : -1;
    };
    const pick = () => {
      const hits = [...new Set(performance.getEntriesByType("resource").map((e) => e.name))]
        .filter((n) => n.split("?")[0] === bare)
        .sort((a, b) => tOf(b) - tOf(a));
      return hits.find((n) => tOf(n) >= 0) ?? (hits.length ? bare : null);
    };
    let url = pick();
    const deadline = Date.now() + waitMs;
    while (!url && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      url = pick();
    }
    url = url ?? bare;
    const seen = [...new Set(performance.getEntriesByType("resource").map((e) => e.name))]
      .filter((n) => n.split("?")[0] === bare);
    window.__realImportLog = { ...(window.__realImportLog ?? {}), [path]: { picked: url, seen } };
    return await import(/* @vite-ignore */ url);
  };
});

const pageErrors = [];
page.on("pageerror", (e) => {
  pageErrors.push(e.message);
  console.log("  ⚠️ 页面报错:", e.message);
});
page.on("console", (m) => {
  if (m.type() === "error") console.log("  ⚠️ console.error:", m.text().slice(0, 160));
});

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};
const note = (label, value) => console.log(`  ⚠️ ${label} → ${value}`);

async function waitInteractive(p) {
  await p.waitForFunction(() => document.documentElement.dataset.theme !== undefined, {
    timeout: 60000,
  });
}

/** 写一份「自定义上游 + 原生通道 + 感知类权限全放行」的设置（不然闸门卡片没人点） */
async function seedApp(mode) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitInteractive(page);
  await page.evaluate(
    async ({ base, perms }) => {
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
        customBaseUrl: base,
        customApiKey: "stub-key",
        upstreamModel: "stub-model",
        toolProtocol: "native",
        toolProbeOk: true,
        toolCatalog: "auto",
        recentActions: [],
        permissions: { ...parsed.state.settings.permissions, ...perms },
      };
      parsed.state.conversations = [];
      parsed.state.activeId = null;
      parsed.state.pendingActions = [];
      parsed.state.actionLog = [];
      await new Promise((res) => {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(JSON.stringify(parsed), "aster-app");
        tx.oncomplete = res;
      });
    },
    {
      base: `${UP_BASE}/${mode}/v1`,
      perms: {
        read_device: "allow",
        read_screen: "allow",
        read_notifications: "allow",
        read_usage: "allow",
        see_location: "allow",
      },
    },
  );
}

async function say(text) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitInteractive(page);
  await page.click("textarea");
  await page.fill("textarea", text);
  await page.keyboard.press("Enter");
}

/** 等这一趟跑完（假上游至少两轮） */
async function waitRounds(from) {
  for (let i = 0; i < 120 && log.rounds.length < from + 2; i += 1) await page.waitForTimeout(250);
  return log.rounds.slice(from);
}

/** 点开「动手 N 次」那一栏，把界面上的回话读出来 */
async function openProcess() {
  const btn = page.locator('button:has-text("动手")').last();
  if ((await btn.count()) === 0) return "";
  await btn.click();
  await page.waitForTimeout(300);
  return await page.evaluate(() => document.body.innerText);
}

/* ═══════════ A. 常驻的那三个 + 网页版如实跳过 ═══════════ */

console.log("【A】「放个歌听」→ 感知 A 组常驻、B 组不在；调用 sense_device 如实跳过");

await seedApp("sense-device");
log.rounds.length = 0;
await say("放个歌听");
const roundsA = await waitRounds(0);
check("A1 这一轮真的发出了请求（两轮：工具轮 + 收尾轮）", roundsA.length >= 2, `实际 ${roundsA.length}`);

const toolsA = (roundsA[0]?.body?.tools ?? []).map((t) => t?.function?.name);
check(
  "A2 A 组三个感知**常驻**（媒体话题下也在）：sense_time / sense_device / sense_place",
  ["sense_time", "sense_device", "sense_place"].every((n) => toolsA.includes(n)),
  `tools=${toolsA.length}，缺 ${["sense_time", "sense_device", "sense_place"].filter((n) => !toolsA.includes(n)).join(",") || "无"}`,
);
check(
  "A3 B 组三个**按需**（这句没提通知/前台/屏幕 → 定义没带）：sense_notifications / sense_foreground / sense_screen",
  ["sense_notifications", "sense_foreground", "sense_screen"].every((n) => !toolsA.includes(n)),
  ["sense_notifications", "sense_foreground", "sense_screen"].filter((n) => toolsA.includes(n)).join(",") || "都没带",
);
note("A-观察 这一轮发出去的动作数", `${toolsA.length}（全量 70，按需注册生效）`);

/**
 * 从回灌的 tool 消息里把那段 JSON 抠出来。
 *
 * 为什么要抠：闸门那条路会把它包一句人话（`按你的授权直接执行：…（这个动作确实执行了）`），
 * 这是**既有行为**（别的动作也一样），不是感知特有的 —— 所以这里只从第一个 `{`
 * 到最后一个 `}` 取那段结构，别动 agent loop。
 */
function jsonOf(content) {
  const s = String(content ?? "");
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch {
    return null;
  }
}

const r2A = roundsA[1]?.body?.messages ?? [];
const toolMsgA = r2A.find((m) => m?.role === "tool");
check("A4 结果以 role:\"tool\" 回灌了（带着 tool_call_id）", Boolean(toolMsgA?.tool_call_id), JSON.stringify(toolMsgA ?? {}).slice(0, 120));

const parsedA = jsonOf(toolMsgA?.content);
check(
  "A5 回灌里带着一段**合法 JSON**（结构化字段 + summary）",
  Boolean(parsedA) && typeof parsedA.summary === "string",
  String(toolMsgA?.content ?? "").slice(0, 160),
);
check(
  "A6 网页版**如实跳过**：ok=true 但 battery / charging 是 null（没有编 100% 在充电）",
  parsedA?.ok === true && parsedA?.battery === null && parsedA?.charging === null,
  JSON.stringify({ ok: parsedA?.ok, battery: parsedA?.battery, charging: parsedA?.charging }),
);
check(
  "A7 而且那句话里说清了网页版读不到、装成 App 才能看",
  String(parsedA?.summary ?? "").includes("网页版") && String(parsedA?.summary ?? "").includes("App"),
  String(parsedA?.summary ?? ""),
);

const textA = await openProcess();
check("A8 界面上「动手 N 次」点开有回话（这一栏永远有回话）", textA.includes("sense.device"), textA.includes("sense.device") ? "" : "没找到 sense.device 那一行");
check("A9 那一行是**人话标题**（不是 `做了「sense.device」（参数没读懂）`）", textA.includes("看一眼电量与网络"), "");
check("A10 没有 pageerror", pageErrors.length === 0, pageErrors.slice(0, 2).join(" / "));
await page.screenshot({ path: `${SHOTS}\\sense-actions.png`, caret: "initial" });
console.log(`   📸 ${SHOTS}\\sense-actions.png`);

/* ═══════════ B. 按需进来的 B 组 + 网页版如实失败 ═══════════ */

console.log("\n【B】「我刚收到什么通知吗」→ sense_notifications 按需进 tools；网页版如实失败");

const errorsBefore = pageErrors.length;
await seedApp("sense-notif");
log.rounds.length = 0;
await say("我刚收到什么通知吗");
const roundsB = await waitRounds(0);
const toolsB = (roundsB[0]?.body?.tools ?? []).map((t) => t?.function?.name);
check(
  "B1 提到通知 → `sense_notifications` 这次**按需**进了 tools",
  toolsB.includes("sense_notifications"),
  `tools=${toolsB.length}，含感知：${toolsB.filter((n) => n.startsWith("sense_")).join(",") || "无"}`,
);
/**
 * ⚠️ 这一条看着"多给了"，其实是规则**明写的纪律**（`tool-select.ts` 文件头第 1 条）：
 * 命中一组就发**整组**，不做"精确到单个动作"的吝啬匹配 —— 少给一个动作的代价
 * （他会说"我做不到"）比多发两个定义大得多。所以这里断言的是"整组一起来"，
 * 不是"只来一个"。
 */
check(
  "B2 同组一起来（宁可多给：提到通知时前台/屏幕的定义也跟着来，这是纪律不是漏筛）",
  toolsB.includes("sense_foreground") && toolsB.includes("sense_screen"),
  `tools=${toolsB.length}`,
);
check(
  "B3 这一轮只发「感知」组 + 常驻（10 个），不是全量 70 —— 按需注册真的在省",
  toolsB.length < 20,
  `tools=${toolsB.length}`,
);

const r2B = roundsB[1]?.body?.messages ?? [];
const toolMsgB = r2B.find((m) => m?.role === "tool");
const parsedB = jsonOf(toolMsgB?.content);
check(
  "B4 网页版**如实失败**：ok=false + reason=web + 明说网页版没有这个能力",
  parsedB?.ok === false && parsedB?.reason === "web" && String(parsedB?.summary ?? "").includes("网页版"),
  String(toolMsgB?.content ?? "").slice(0, 200),
);
check(
  "B5 失败一样带 summary（他读起来是一句人话，不是一串字段）",
  typeof parsedB?.summary === "string" && parsedB.summary.length > 8,
  String(parsedB?.summary ?? ""),
);
const textB = await openProcess();
check("B6 界面上也留了这一行回话", textB.includes("sense.notifications"), "");
/**
 * ⚠️ 这一条是**如实记录现状**，不是"通过"：`tool-loop` 的 `looksRefused()`
 * 只在消息 ≤48 字时判 ❌，而"权限没给要说清去哪个设置页"必然更长 ——
 * 所以那一行的图标会是 ✅ 而内容是 ok:false。
 * 语义不能改（任务边界），所以这里把事实打印出来（见报告）。
 */
const noticeLineB = textB.split("\n").find((l) => l.includes("sense.notifications")) ?? "";
note("B-观察 界面上那一行的图标与内容", noticeLineB.slice(0, 150));
check(
  "B7 没有新的 pageerror（网页版缺能力不许把页面弄崩）",
  pageErrors.length === errorsBefore,
  pageErrors.slice(errorsBefore).join(" / "),
);
await page.screenshot({ path: `${SHOTS}\\sense-actions-web-denied.png`, caret: "initial" });
console.log(`   📸 ${SHOTS}\\sense-actions-web-denied.png`);

/* ═══════════ C. 六个动作各跑一次（真实接线层，不是 core 的假数据） ═══════════ */

console.log("\n【C】真浏览器里把六个感知动作各跑一次（走 lib/sense.ts，不是喂假事实）");

await seedApp("sense-device");
const direct = await page.evaluate(async () => {
  const { runSenseAction } = await window.__realImport("/src/lib/sense.ts", 5000);
  const kinds = [
    "sense.time",
    "sense.device",
    "sense.place",
    "sense.notifications",
    "sense.foreground",
    "sense.screen",
  ];
  const out = {};
  for (const k of kinds) out[k] = await runSenseAction(k);
  return out;
});

const parsed = {};
for (const [kind, raw] of Object.entries(direct)) {
  try {
    parsed[kind] = JSON.parse(raw);
  } catch {
    parsed[kind] = null;
  }
  check(
    `C·${kind}：返回一行合法 JSON，里面有 summary`,
    Boolean(parsed[kind]) && typeof parsed[kind].summary === "string" && parsed[kind].summary.length > 0,
    String(raw).slice(0, 160),
  );
}
check(
  "C1 sense.time（网页版也有）：ok=true + 本地时间 + 周几",
  parsed["sense.time"]?.ok === true &&
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(parsed["sense.time"]?.time)) &&
    typeof parsed["sense.time"]?.weekday === "string",
  JSON.stringify(parsed["sense.time"] ?? null).slice(0, 160),
);
check(
  "C2 sense.device（网页版）：ok=true 但**电量是 null**（如实跳过，没编 100%）",
  parsed["sense.device"]?.ok === true && parsed["sense.device"]?.battery === null,
  JSON.stringify(parsed["sense.device"] ?? null).slice(0, 160),
);
check(
  "C3 sense.place（开关默认关着）：ok=false + 指到「我的 → 系统 → 天气与定位」",
  parsed["sense.place"]?.ok === false &&
    parsed["sense.place"]?.reason === "off" &&
    String(parsed["sense.place"]?.summary ?? "").includes("天气与定位"),
  JSON.stringify(parsed["sense.place"] ?? null).slice(0, 200),
);
for (const kind of ["sense.notifications", "sense.foreground", "sense.screen"]) {
  check(
    `C4 ${kind}（网页版没原生插件）：ok=false + reason=web + 明说网页版`,
    parsed[kind]?.ok === false &&
      parsed[kind]?.reason === "web" &&
      String(parsed[kind]?.summary ?? "").includes("网页版"),
    JSON.stringify(parsed[kind] ?? null).slice(0, 160),
  );
}
note(
  "C-观察 网页版这六句的原话",
  Object.entries(parsed)
    .map(([k, v]) => `${k}=${v?.summary ?? "?"}`)
    .join(" ｜ ")
    .slice(0, 300),
);
check(
  "C5 六个动作跑完没有 pageerror（读不到也不许把页面弄崩）",
  pageErrors.length === errorsBefore,
  pageErrors.slice(errorsBefore).join(" / "),
);

/* ───────────────── 收尾 ───────────────── */

console.log(`\n${"─".repeat(72)}`);
/** 脚本读的是哪一份模块实例 —— 打进输出里（不许落到影子那份上） */
note("C-观察 脚本读的模块实例", JSON.stringify(await page.evaluate(() => window.__realImportLog ?? {})));
check("总断言全部通过", bad === 0, `失败 ${bad} 项`);
console.log(bad === 0 ? "全部通过 ✅（真浏览器 + 真 dev server，网页版那条降级路径也走过了）" : `❌ ${bad} 项没过`);

await browser.close();
upstream.close();
process.exit(bad === 0 ? 0 : 1);
