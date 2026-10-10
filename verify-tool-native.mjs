/**
 * 验收脚本：**P2 —— 内部动作真的走原生 `tools`（function calling）**。
 *
 * ── 这一轮要证明什么 ────────────────────────────────────────────
 *
 * 以前：模型把动作写在正文的 ```qidao 代码块里，客户端扫出来执行 ——
 * 发出去就完事，**模型永远收不到结果**（用户原话："每次调用工具他说他没有回执，
 * 不知道自己到底用没用"）。
 *
 * 现在（P2）：动作定义当 `tools` 发给上游 → 模型选一个 function →
 * 过动作闸门真执行 → 结果以 `role:"tool"` **回灌** → 自动再发一轮让它接着说。
 *
 * 所以这个脚本要端到端证明 **六件事**（少一件都不能算接上了）：
 *   ① 请求里**真的带上了 70 个内部动作里该发的那些 tools**（不是只有提示词里那段文字）
 *   ② 流式下**分片**的 `tool_calls` 被拼成了完整调用（不是只读第一个 chunk）
 *   ③ 动作**真被执行**了（数据/页面真的变了 —— 这里验"真的切了页面"）
 *   ④ 结果**真的回灌**进下一轮请求（`role:"tool"` + 对得上的 `tool_call_id`）
 *   ⑤ 走的 tools 时**提示词自动变薄**（不再列 70 个动作的散文清单）
 *   ⑥ 上游**不认 tools** 时**自动降级**回文本协议，而且提示词**自动补回**那份清单
 *
 * ── 怎么做到"真的端到端" ────────────────────────────────────────
 *
 * 起一个**本地假上游**（假上游的模式写在地址里，跟 verify-tool-probe 一路）：
 *   · 主路径（`/native`）：第一轮回一个 `navigate` 的 tool_call（**故意分片**），
 *     第二轮（收到 tool 回灌之后）回正文
 *   · 降级路径（`/notools`）：收到 tools 就回 400「tools is not supported」，
 *     摘掉 tools 之后回一个正文里带 ```qidao 动作块的老式回复
 *
 * 假上游**能被 dev server 访问到**（关键）—— 这样系统提示词是**我们自己的代码在
 * 服务端拼出来的那一份**，假上游把它整段记下来，我就能断言"提示词里到底写了什么"。
 * （如果用 page.route 拦 /api/chat，就永远看不到系统提示词 —— 见坑 #18。）
 *
 * 跑法（要完整权限；dev server 要在 8080）：
 *   node verify-tool-native.mjs
 * 退出码非 0 = 有断言没过。截图写到 preview-shots/（每轮都要真的看！）。
 */
import { createServer } from "node:http";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
const UP_PORT = 4640;
const UP_BASE = `http://127.0.0.1:${UP_PORT}`;
const SHOTS = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";

/** 假上游收到的每一轮请求（系统提示词和回灌都在里面） */
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
 * 分片的 tool_call：名字切两段、参数切三段，**后半段故意不给 index**。
 * 真实中转就是这么给的 —— 只读某一帧永远拼不出完整调用。
 */
const FRAGMENTED_NAVIGATE = [
  frame({ role: "assistant", content: "好，我先带你过去。" }),
  frame({
    tool_calls: [
      { index: 0, id: "call_nav_1", type: "function", function: { name: "navig", arguments: "" } },
    ],
  }),
  frame({ tool_calls: [{ index: 0, function: { name: "ate", arguments: '{"pa' } }] }),
  frame({ tool_calls: [{ function: { arguments: 'th":"/play/le' } }] }),
  frame({ tool_calls: [{ function: { arguments: 'arn"}' } }] }),
  { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
];

/** 老协议：正文里带 ```qidao 动作块（降级之后应该走这条） */
const LEGACY_TEXT_REPLY = [
  "行，用老办法给你记一条。",
  "",
  "```qidao",
  '{"kind":"todo.add","text":"P2 验收写下的待办"}',
  "```",
].join("\n");

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
  log.rounds.push({ path: url.pathname, body, raw });
  console.log(
    `    [假上游] #${log.rounds.length} ${url.pathname} tools=${
      Array.isArray(body.tools) ? body.tools.length : 0
    } messages=${Array.isArray(body.messages) ? body.messages.length : 0} tool结果=${
      (Array.isArray(body.messages) ? body.messages : []).filter((m) => m?.role === "tool").length
    }`,
  );

  /** 这一轮有没有人在跟它说话（回灌的 tool 结果就在 messages 里） */
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const sawToolResult = msgs.some((m) => m && m.role === "tool");
  const mode = url.pathname.split("/")[1] || "native";

  if (mode === "notools" && Array.isArray(body.tools) && body.tools.length > 0) {
    // 上游明确不要 tools —— 客户端必须认出来、摘掉 tools 再发一次
    console.log(`    [假上游] → 不认 tools（400）`);
    res.writeHead(400, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify({ error: { message: "tools is not supported by this model" } }));
    return;
  }

  if (mode === "native" && !sawToolResult) {
    sse(res, FRAGMENTED_NAVIGATE);
    return;
  }
  if (mode === "native") {
    sse(res, [frame({ role: "assistant", content: "已经到玩乐页了，你看一眼。" })]);
    return;
  }
  /**
   * textmode：**认 tools，但回老协议的正文动作块**。
   * P3 那几条要的是"不发动作、只看这一轮带了哪些工具" ——
   * 用 native 会顺手把页面导航走，很难观察 tools 数。
   */
  console.log(`    [假上游] → 老协议正文（tools=${Array.isArray(body.tools) ? body.tools.length : 0}）`);
  sse(res, [frame({ role: "assistant", content: LEGACY_TEXT_REPLY })]);
});

await new Promise((r) => upstream.listen(UP_PORT, "127.0.0.1", r));
console.log(`假上游（dev server 能访问）  ${UP_BASE}\n`);

/* ───────────────── 浏览器 ───────────────── */

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const consoleErrors = [];
page.on("pageerror", (e) => console.log("  ⚠️ 页面报错:", e.message));
page.on("response", (r) => {
  if (r.status() >= 400) console.log(`  ⚠️ HTTP ${r.status()} ${r.url().slice(0, 120)}`);
});
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/** 等 hydration 完成（ThemeRoot 写的标记）—— 不然点了没反应（坑 #24） */
async function waitInteractive(p) {
  await p.waitForFunction(() => document.documentElement.dataset.theme !== undefined, {
    timeout: 60000,
  });
}

/** 写一份"自定义上游 + 强制走原生 + 允许闸门自动执行"的设置 */
async function seedApp({ mode, permissions, history }) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitInteractive(page);
  await page.evaluate(
    async ({ base, perms, seed }) => {
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
        // P3：默认按需注册（auto）
        toolCatalog: "auto",
        recentActions: [],
        permissions: { ...parsed.state.settings.permissions, ...perms },
      };
      /**
       * 每轮都从干净的对话开始（历史里别留上一轮的残留 —— 坑 #37：
       * 上一版脚本就是读到旧存档，在"上游 0 次请求"的情况下假绿了）。
       * `seed.length > 0` 时把它当成"已有的对话历史"写进去（用来验跨轮上下文）。
       */
      const conv = {
        id: "conv_verify",
        title: "验收",
        messages: seed ?? [],
        createdAt: 1,
        updatedAt: 2,
        pinned: false,
        incognito: false,
      };
      parsed.state.conversations = seed && seed.length ? [conv] : [];
      parsed.state.activeId = seed && seed.length ? "conv_verify" : null;
      parsed.state.pendingActions = [];
      parsed.state.actionLog = [];
      parsed.state.todos = [];
      await new Promise((res) => {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(JSON.stringify(parsed), "aster-app");
        tx.oncomplete = res;
      });
    },
    { base: `${UP_BASE}/${mode}/v1`, perms: permissions, seed: history },
  );
}

/**
 * 读库（真的落到 IndexedDB 里才算数 —— 内存里改了但没持久化也是错）
 * ⚠️ 必须**轮询等**：动作执行在流结束之后（闸门那边异步跑），
 * 刚看到文字就读库会读到"还没执行"——这正是坑 #20 那个"等 DOM 等价物"的坑。
 */
async function readTodos() {
  return page.evaluate(async () => {
    const db = await new Promise((res) => {
      const r = indexedDB.open("qidao-store", 1);
      r.onsuccess = () => res(r.result);
    });
    const raw = await new Promise((res) => {
      const tx = db.transaction("kv", "readonly");
      const g = tx.objectStore("kv").get("aster-app");
      g.onsuccess = () => res(g.result);
    });
    return JSON.parse(raw).state.todos ?? [];
  });
}

async function waitTodo(needle, timeoutMs = 30000) {
  const until = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < until) {
    last = await readTodos();
    if (last.some((t) => String(t.text).includes(needle))) return last;
    await page.waitForTimeout(300);
  }
  return last;
}

async function say(text, expectInStore, opts = {}) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitInteractive(page);
  /**
   * ⚠️ 这里必须清一遍对话：上一轮跑完的东西还在 IndexedDB 里，
   * store 恢复出来之后**旧的助手回复也在** —— 直接断言"库里有那句话"会读到
   * 上一轮的残留（第一版脚本就这么被骗过一次：上游 0 次请求却"通过"了）。
   *
   * `keepHistory: true` 时**不清**（P3 那几条要拿"已有的对话历史"当上下文）。
   */
  if (!opts.keepHistory) {
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
      parsed.state.conversations = [];
      parsed.state.activeId = null;
      parsed.state.pendingActions = [];
      parsed.state.actionLog = [];
      await new Promise((res) => {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(JSON.stringify(parsed), "aster-app");
        tx.oncomplete = res;
      });
    });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await waitInteractive(page);
  }
  await page.click("textarea");
  await page.fill("textarea", text);
  await page.keyboard.press("Enter");
  if (!expectInStore) return true;
  /**
   * 断言"他第二段话说出来了"要看**库里那条消息**，不能看 DOM ——
   * 原生那条路第一轮就会 `navigate` 走掉，聊天页已经不在屏幕上了（DOM 里自然找不到）。
   */
  try {
    await page.waitForFunction(
      (needle) =>
        (async () => {
          const db = await new Promise((res) => {
            const r = indexedDB.open("qidao-store", 1);
            r.onsuccess = () => res(r.result);
          });
          const raw = await new Promise((res) => {
            const tx = db.transaction("kv", "readonly");
            const g = tx.objectStore("kv").get("aster-app");
            g.onsuccess = () => res(g.result);
          });
          const st = JSON.parse(raw).state;
          const conv = st.conversations.find((c) => c.id === st.activeId);
          const last = conv?.messages?.[conv.messages.length - 1];
          return Boolean(last && String(last.content).includes(needle));
        })(),
      expectInStore,
      { timeout: 60000 },
    );
    return true;
  } catch {
    return false;
  }
}

/* ═══════════ 一、原生 tools：真发 tools → 真执行 → 真回灌 ═══════════ */

console.log("【一】原生 tools 那条路");
log.rounds.length = 0;
await seedApp({
  mode: "native",
  // 导航 + 记待办都放行（不然闸门卡片要人点，脚本里没人点）
  permissions: { navigate: "allow", todo_add: "allow", state_report: "allow", emotion_report: "allow" },
});
const sawReply = await say("带我去玩乐页", "已经到玩乐页了");
check("① 模型第二轮的话出现在界面上（说明它读到了工具结果）", sawReply);
await page.screenshot({ caret: "initial", path: `${SHOTS}\\p2-native-done.png` });

/** 等两轮都真的到了假上游再断言（否则会读到"请求还在路上"这种假失败） */
for (let i = 0; i < 80 && log.rounds.length < 2; i += 1) await page.waitForTimeout(250);

const round1 = log.rounds[0] ?? {};
const r1body = round1.body ?? {};
check(
  "② 第一轮请求真的带了 tools（内部动作，70 个里的绝大部分）",
  Array.isArray(r1body.tools) && r1body.tools.length >= 60,
  `tools=${Array.isArray(r1body.tools) ? r1body.tools.length : "没有"}`,
);
check(
  "③ tools 里是 OpenAI 那套 function 定义（type/name/parameters）",
  (() => {
    const t = (r1body.tools ?? [])[0];
    return (
      t?.type === "function" &&
      typeof t.function?.name === "string" &&
      t.function.parameters?.type === "object"
    );
  })(),
  JSON.stringify((r1body.tools ?? [])[0] ?? {}).slice(0, 120),
);
check("④ 其中一个叫 navigate（点号换成了下划线）", (r1body.tools ?? []).some((t) => t.function?.name === "navigate"));

const prompt1 = typeof r1body.messages?.[0]?.content === "string" ? r1body.messages[0].content : "";
check(
  "⑤ 提示词**变薄了**：不再列那份散文动作清单（kind: navigate 那种例子）",
  !prompt1.includes('"kind":"navigate"'),
  prompt1.includes('"kind":"navigate"') ? "清单还在，等于没省" : "",
);
check(
  "⑥ 提示词仍然讲了「用工具动手、别在正文写 JSON」（规矩那一段在）",
  prompt1.includes("调用工具") && prompt1.includes("不要") && prompt1.includes("JSON"),
  prompt1.includes("调用工具") ? "" : "prompt 里没找到「调用工具」，可能走了老协议那一份",
);

const navOk = await page.evaluate(() => location.pathname.startsWith("/play"));
const navTitle = await page.evaluate(() => document.querySelector("h1")?.innerText ?? "");
check(
  "⑦ 动作**真的被执行**了：页面真的切到了 /play（不是只弹了卡片）",
  navOk,
  `path=${await page.evaluate(() => location.pathname)} h1=${navTitle}`,
);

/* ── 关键证据：分片拼装 + 回灌 ── */
const round2 = log.rounds[1] ?? {};
const r2msgs = Array.isArray(round2.body?.messages) ? round2.body.messages : [];
const toolMsg = r2msgs.find((m) => m.role === "tool");
const assistantWithCalls = r2msgs.find(
  (m) => m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
);
check("⑧ 真的发出了第二轮请求（说明循环在跑）", log.rounds.length >= 2, `共 ${log.rounds.length} 轮`);
check(
  "⑨ 回灌的那条是 role:\"tool\"，而且带着 tool_call_id",
  Boolean(toolMsg?.tool_call_id),
  JSON.stringify(toolMsg ?? null).slice(0, 160),
);
check(
  "⑩ 分片被**拼全**了：assistant 那条里的函数名是 navigate、参数是完整 JSON",
  (() => {
    const c = assistantWithCalls?.tool_calls?.[0];
    if (!c) return false;
    if (c.function?.name !== "navigate") return false;
    try {
      return JSON.parse(c.function.arguments)?.path === "/play/learn";
    } catch {
      return false;
    }
  })(),
  JSON.stringify(assistantWithCalls?.tool_calls?.[0] ?? null).slice(0, 200),
);
check(
  "⑪ 回灌的内容是执行结果（人话），不是空壳",
  typeof toolMsg?.content === "string" && toolMsg.content.length > 3,
  JSON.stringify(toolMsg?.content ?? "").slice(0, 120),
);

/**
 * 「他动了什么手」要在界面上查得到（P5：失败不能是静默的）。
 * 注意这时候页面已经被 navigate 带到 /play 了，所以先回对话页再找那颗胶囊。
 */
await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await waitInteractive(page);
let processVisible = false;
try {
  await page.getByRole("button", { name: /动手 \d+ 次/ }).first().waitFor({ timeout: 20000 });
  processVisible = true;
} catch {
  processVisible = false;
}
check("⑲ 回复下面有「动手 N 次」那颗胶囊（能事后查他干了什么）", processVisible);
if (processVisible) {
  await page.getByRole("button", { name: /动手 \d+ 次/ }).first().click();
  const expanded = await page.evaluate(() => document.body.innerText);
  check(
    "⑳ 点开之后能看到调用明细（动作名 + 执行结果 + 参数）",
    expanded.includes("切换到页面") &&
      expanded.includes("/play/learn") &&
      expanded.includes('"path"'),
    expanded.split("\n").filter((l) => l.includes("动手")).join(" | ").slice(0, 120),
  );
  /**
   * ⭐ 这一条是**看截图才发现的**：第一版把 `{kind}` 直接丢给 `actionTitle()`，
   * 界面渲染成"切换到页面 undefined"。光断言"有那段文字"是抓不到的，
   * 所以这里显式钉一句"标题里不许出现 undefined"。
   */
  check(
    "㉑ 明细里没有 undefined（标题是用真参数拼的）",
    !/undefined/.test(expanded),
    expanded.split("\n").find((l) => l.includes("undefined")) ?? "",
  );
  await page.screenshot({ caret: "initial", path: `${SHOTS}\\p2-tool-process.png` });
}

/* ═══════════ 三、P3 按需注册：只发相关的那几组 ═══════════ */

console.log("\n【三】P3 按需注册（只根据对话发需要的工具）");
/** 发一句话、拿回假上游收到的那一轮请求体（P3 那几条要看 tools 清单） */
async function sendAndCapture(text) {
  log.rounds.length = 0;
  await say(text, "用老办法给你记一条");
  for (let i = 0; i < 80 && log.rounds.length < 1; i += 1) await page.waitForTimeout(250);
  const body = log.rounds[0]?.body ?? {};
  return {
    body,
    sent: Array.isArray(body.tools) ? body.tools.map((t) => t.function?.name) : [],
    prompt: typeof body.messages?.[0]?.content === "string" ? body.messages[0].content : "",
  };
}

const allowAll = {
  navigate: "allow",
  todo_add: "allow",
  state_report: "allow",
  emotion_report: "allow",
  diary: "allow",
  media_search: "allow",
  media: "allow",
};

/**
 * A. **意思明确 + 命中两组** → 真的筛。
 * "帮我写今天的日记，顺便放首歌" = 记录（日记）+ 媒体（歌）两组命中。
 */
await seedApp({ mode: "textmode", permissions: allowAll });
const a = await sendAndCapture("帮我写今天的日记，顺便放首歌");
check(
  "㉒ 意思明确时 tools 数量**明显变少**（按需，不再全发）",
  a.sent.length > 0 && a.sent.length < 40,
  `发出去 ${a.sent.length} 个：${a.sent.slice(0, 10).join(",")}${a.sent.length > 10 ? ",…" : ""}`,
);
check(
  "㉓ 命中的两组**都在**（记录：diary.add / 媒体：media.playTrack）",
  a.sent.includes("diary_add") && a.sent.includes("media_playTrack"),
  `diary_add=${a.sent.includes("diary_add")} media_playTrack=${a.sent.includes("media_playTrack")}`,
);
check(
  "㉔ 常驻的四个一个都不少（情绪上报、导航、记忆、高亮）",
  ["emotion_report", "navigate", "memory_add", "ui_highlight"].every((n) => a.sent.includes(n)),
  a.sent
    .filter((n) => ["emotion_report", "navigate", "memory_add", "ui_highlight"].includes(n))
    .join(","),
);
check(
  "㉕ 不相干的组被砍掉了（这次没提学习/玩乐/数据）",
  !a.sent.includes("learn_addCard") && !a.sent.includes("play_gobang") && !a.sent.includes("data_reset"),
);
check(
  "㉖ 提示词里带了兜底规则（筛掉的动作 != 不存在，不许回答'我做不到'）",
  a.prompt.includes("按需") && a.prompt.includes("我做不到"),
);
check(
  "㉗ 提示词里有**全部动作名**清单（他要用的没带定义时能照名字写动作块）",
  a.prompt.includes("diary.add") && a.prompt.includes("media.playTrack"),
);
await page.screenshot({ caret: "initial", path: `${SHOTS}\\p3-selective.png` });

/**
 * B. **跨轮上下文**：这句话单独看什么关键词都没有，真正的意图在上一轮。
 * 只按最后一句筛会漏光 —— 所以 `recent` 也要参与判断。
 */
await seedApp({
  mode: "textmode",
  permissions: allowAll,
  history: (() => {
    const h = [
      { id: "u1", role: "user", content: "帮我写今天的日记", thinking: "", thinkingDurationMs: 0, createdAt: 1 },
      { id: "a1", role: "assistant", content: "好。", thinking: "", thinkingDurationMs: 0, createdAt: 2 },
    ];
    return h;
  })(),
});
await say("好", "用老办法给你记一条", { keepHistory: true });
for (let i = 0; i < 80 && log.rounds.length < 1; i += 1) await page.waitForTimeout(250);
const bSent = Array.isArray(log.rounds[0]?.body?.tools)
  ? log.rounds[0].body.tools.map((t) => t.function?.name)
  : [];
check(
  "㉘ 跨轮上下文也认：上一句说要写日记，这句只说'好' → diary.add 必须发",
  bSent.includes("diary_add"),
  bSent.includes("diary_add") ? "" : "漏了 diary_add —— 这是最严重的失败（他会说'我做不到'）",
);

/**
 * C. 反例：意思不明确 → **全发**（宁可这一轮不省，也不能漏）。
 * 这是"关键词写漏了"的安全网。
 */
await seedApp({ mode: "textmode", permissions: allowAll });
const c = await sendAndCapture("嗯，就这样");
check(
  "㉙ 意思不明确的短句 → **不筛**（安全网：全发）",
  c.sent.length >= 40,
  `发了 ${c.sent.length} 个`,
);

/* ═══════════ 四、上游不认 tools：自动降级 + 提示词自动补回 ═══════════ */
console.log("\n【四】上游不认 tools → 自动降级回文本协议");
log.rounds.length = 0;
await seedApp({
  mode: "notools",
  permissions: { navigate: "allow", todo_add: "allow", state_report: "allow", emotion_report: "allow" },
});
const sawLegacy = await say("帮我记个待办", "用老办法给你记一条");
check("⑫ 降级之后模型的话照常显示（对话没被这次报错打断）", sawLegacy);

/**
 * ⚠️ 等第一轮真的到了假上游再断言：`say()` 只保证"文字进了库"，
 * 而那一轮请求可能还在路上（dev server 冷启动时尤其慢 —— 坑 #24）。
 */
for (let i = 0; i < 80 && log.rounds.length < 1; i += 1) await page.waitForTimeout(250);
const nt = log.rounds[0] ?? {};
check(
  "⑬ 第一轮确实带了 tools（否则根本没触发降级）",
  Array.isArray(nt.body?.tools) && nt.body.tools.length > 0,
  `tools=${Array.isArray(nt.body?.tools) ? nt.body.tools.length : "没有"}`,
);
/**
 * ⚠️ 这里必须**等**那一轮重发落地：`say()` 等的是"文字进了库"，
 * 而那一刻降级重发可能还在路上（动作更是之后才执行）。
 * 直接读 log 会读到"只有一轮"——那是我自己读早了（坑 #20 的同一个道理）。
 */
for (let i = 0; i < 80; i += 1) {
  if (log.rounds.some((r) => !Array.isArray(r.body?.tools) || r.body.tools.length === 0)) break;
  await page.waitForTimeout(250);
}
const retry = log.rounds.find((r) => !Array.isArray(r.body?.tools) || r.body.tools.length === 0);
check(
  "⑭ 上游报 400 之后**自动摘掉 tools 重发了一次**",
  Boolean(retry),
  `共 ${log.rounds.length} 轮，路径=${log.rounds.map((r) => r.path).join(",")}`,
);
const retryPrompt =
  typeof retry?.body?.messages?.[0]?.content === "string" ? retry.body.messages[0].content : "";
check(
  "⑮ 重发的那一轮，提示词**把动作清单补回来了**（不然模型不知道该写动作块）",
  retryPrompt.includes('"kind":"navigate"') || retryPrompt.includes("qidao"),
  retryPrompt ? "" : "没拿到那一轮的提示词",
);
const todos = await waitTodo("P2 验收写下的待办");
check(
  "⑯ 降级那条路**动作照样执行了**（待办真的进了库 —— 老协议没坏）",
  todos.some((t) => String(t.text).includes("P2 验收写下的待办")),
  JSON.stringify(todos).slice(0, 200),
);
await page.screenshot({ caret: "initial", path: `${SHOTS}\\p2-fallback-done.png` });

/* ═══════════ 三、正文照常流式 + 控制台干净 ═══════════ */

console.log("\n【五】流式与干净度");
check("⑰ 整轮没有 hydration 不一致", consoleErrors.filter((t) => /hydration/i.test(t)).length === 0);
/**
 * ⚠️ 这条只筛"**app 自己的报错**"，不筛环境噪声。两类是**故意排除**的：
 *   · 上游那发 400（"不认 tools"）是这一轮**故意做出来的**，浏览器会记一条 Failed to load resource
 *   · `ERR_TIMED_OUT` 是沙箱/网络连不上外网（历史文档里记过：跟代码无关；用 git stash 对比基线也有）
 * 真出 app 的 bug 时，报的会是别的东西（hydration / TypeError / 未捕获异常），照样抓得住。
 */
const NOISE = /Failed to load resource|ERR_CONNECTION|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|Failed to fetch|Extensions|favicon|status of 400/i;
const badErrors = consoleErrors.filter((t) => !NOISE.test(t));
check(
  "⑱ 控制台没有 app 自己的报错（故意造的 400 与外网超时不算）",
  badErrors.length === 0,
  badErrors.slice(0, 2).map((t) => t.slice(0, 160)).join(" | "),
);

console.log("-".repeat(64));
console.log(`原生工具调用验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);

await browser.close();
upstream.close();
process.exit(bad === 0 ? 0 : 1);
