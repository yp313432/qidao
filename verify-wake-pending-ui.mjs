/**
 * 验收脚本：**后台那句"他自己说的"到底有没有落进会话**（连 8080 的 Playwright）。
 *
 * 用户真机原话：
 *   "那个定时唤醒成功了。我能收到弹窗通知，但是那个通知**不在上下文里**……
 *    这样如果我想回他那句消息的话，进对话里的 AI 是不知道这回事的。"
 *
 * 这个脚本验的就是"接上了没有"：
 *   ① **键名契约**：后台（`public/runners/wake.js`）跟前台（`src/lib/wake-bridge.ts`）
 *      用的是**同一批** `wake_pending_*` 名字（写错一个字母两边就谁也见不到谁，而且不报错）
 *   ② **打开 App 就落库**：抽屉里躺着"他说过的一句" → 页面一加载，**会话里真的出现那条**
 *      （走的是 `beginScheduledReply`，所以是 assistant + `scheduled` 标记）
 *   ③ **内容和时间对得上**：正文一字不差、`createdAt` 是**他说话那一刻**（`wake_pending_at_ms`）
 *   ④ **不重复**：同一条再 flush 多少次都只有一条
 *   ⑤ **键被清掉**：落完 `wake_pending_text` 必须变空（否则下次进来又插一条）
 *   ⑥ **新的那条照样落**：清键不能把后面的真消息也挡掉
 *   ⑦ **点通知直达**：原生那条 `backgroundRunnerNotificationReceived` 事件打过来 →
 *      先落库、再**跳到 `/`**，而且那一条在 DOM 里能定位到（`msg-<id>`）
 *   ⑧ **网页版优雅跳过**：没有抽屉时 `flushPendingWake()` 什么都不做、**不报错**
 *   ⑨ 全程**零 pageerror**，并出一张截图
 *
 * 跑法：`node verify-wake-pending-ui.mjs`（要 8080 上的 dev server 开着；
 * 本脚本只连它，不自己 bind 任何端口）
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:8080";
const SHOTS = "preview-shots";
mkdirSync(SHOTS, { recursive: true });

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/* ═════════ ① 键名契约（纯读源码，不需要浏览器）═════════ */

console.log("【一】后台和前台必须用同一批 wake_pending_* 键名（写错不报错，最坑）");
{
  const runner = readFileSync("public/runners/wake.js", "utf8");
  const bridge = readFileSync("src/lib/wake-bridge.ts", "utf8");
  const keys = ["wake_pending_text", "wake_pending_at", "wake_pending_at_ms"];
  for (const k of keys) {
    check(`两边都有 ${k}`, runner.includes(`"${k}"`) && bridge.includes(`"${k}"`), "");
  }
  check(
    "后台写的是**完整那句**（`wake_pending_text` 那一行没有 slice/截断）",
    /kvSet\("wake_pending_text",\s*full\)/.test(runner),
    "",
  );
}

/* ═════════ 页面里跑起来 ═════════ */

const browser = await chromium.launch({ channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });

/**
 * ⚠️ **影子 store**（2026-10 在真页面上实测确认过的坑，不是猜的）：
 * vite dev 会在模块 URL 上挂 `?t=<失效时间戳>` —— App 真正加载的是
 * `/src/lib/store.ts?t=1791605366593`，而脚本里 `import("/src/lib/store.ts")`
 * 会**再实例化一份**（实测：`m === bare` 为 false，`useApp` 也不是同一个对象；
 * 往裸那份写 `activeId` 的哨兵，App 那份读不到，反之亦然）。
 * 读影子 = 读一个 App 不认识的快照（它只在 import 那一刻从 IndexedDB 恢复一次），
 * 于是"App 刚落进去的那条"它看不见、手动 flush 也写不进 App —— 断言会假绿/假红。
 *
 * 所以：**只通过 App 自己那份模块实例读写** —— 从 resource 时间线里捞出 App
 * 真正加载过的那个 URL 再 import（没挂 `?t=` 时，裸路径就是 App 那一份）。
 * 落点见 `api.flush` / `api.state` / ⑥ / ⑦。
 */
await context.addInitScript(() => {
  /**
   * @param {string} path 比如 "/src/lib/store.ts"
   * @param {number} waitMs 时间线里还没有这条记录时，最多等多久（⑦ 那种"页面刚 commit"的场景要用）
   */
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
      /** 优先挑带 `?t=` 的那个（那才是 App 用的）；只有裸路径时它就是 App 那份 */
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

const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => {
  pageErrors.push(e.message);
  console.log("  ⚠️ pageerror:", e.message);
});
page.on("console", (m) => {
  /** 环境噪声（字体连不上/重载把在途请求掐了）单独记，不算失败 —— 见 verify-wake-reset-ui.mjs */
  if (m.type() !== "error") return;
  const t = m.text();
  if (/Failed to load resource|fonts\.gstatic|ERR_CONNECTION_CLOSED|ERR_TIMED_OUT/i.test(t)) return;
  console.log("  ⚠️ console.error:", t);
});

/** 字体拦掉：这台机器连不上 fonts.gstatic.com，等它超时会把页面布局推一下、拖慢验收 */
await context.route("**://fonts.gstatic.com/**", (route) => route.abort());
await context.route("**://fonts.googleapis.com/**", (route) => route.abort());

/**
 * 抽屉在这里是**会话存储里的一个对象**（`sessionStorage.__drawer`），wake-bridge 整个被换成桩。
 * 为什么必须换：真插件在浏览器里根本不存在（`WakeBridge.get` 会抛），
 * 而我们要验的恰恰是"抽屉里有东西 → 会话里出现一条"这条链子。
 * 为什么放 sessionStorage 而不是 `window`：**要能跨一次 reload 还在** ——
 * "打开 App 时自动落库"这条必须"先写好抽屉、再加载页面"才算真验到。
 */
await page.addInitScript(() => {
  // 让 isNativeApp() 认为自己在安卓 App 里（Capacitor 认这个自定义平台）
  window.CapacitorCustomPlatform = { name: "android", plugins: {} };
});

await context.route("**/src/lib/wake-bridge.ts*", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: `
      export const WAKE_KEYS = {
        baseUrl: "cfg_base_url", apiKey: "cfg_api_key", model: "cfg_model",
        aiName: "cfg_ai_name", enabled: "cfg_enabled",
        quietStart: "cfg_quiet_start", quietEnd: "cfg_quiet_end",
        promptNormal: "cfg_prompt_normal", promptForce: "cfg_prompt_force",
        pendingText: "wake_pending_text", pendingAt: "wake_pending_at",
        pendingAtMs: "wake_pending_at_ms", pendingUrge: "wake_pending_urge",
        pendingConsumedAt: "wake_pending_consumed_at",
        pendingConsumedKey: "wake_pending_consumed_key",
      };
      export const WAKE_PENDING_KEYS = [
        WAKE_KEYS.pendingText, WAKE_KEYS.pendingAt, WAKE_KEYS.pendingAtMs, WAKE_KEYS.pendingUrge,
      ];
      const read = () => { try { return JSON.parse(sessionStorage.getItem("__drawer") || "{}"); } catch { return {}; } };
      const write = (o) => sessionStorage.setItem("__drawer", JSON.stringify(o));
      export async function pushWakeConfig(data) {
        const o = read();
        for (const k of Object.keys(data)) o[k] = String(data[k]);
        write(o);
        return true;
      }
      export async function readWakeConfig() { return read(); }
      export async function clearWakeConfig() {
        write({});
        return { ok: true, message: "（验收桩）已清空" };
      }
      export async function clearWakePending(consumedAt, consumedKey) {
        const o = read();
        for (const k of WAKE_PENDING_KEYS) o[k] = "";
        if (consumedAt) o[WAKE_KEYS.pendingConsumedAt] = consumedAt;
        if (consumedKey) o[WAKE_KEYS.pendingConsumedKey] = consumedKey;
        write(o);
        return true;
      }
    `,
  });
});

/**
 * 原生"通知被点了"那条事件通道也换成桩。
 *
 * 为什么不用真的 `@capacitor/background-runner` 的 web 实现去 `notifyListeners`：
 * 那验的是**插件自己的网页实现**，跟安卓上真正发这条事件的那段 Kotlin 没关系；
 * 而我们要盯的是"**我这边**有没有注册对事件、收到之后有没有落库 + 跳页"。
 * 换成桩之后，`window.__bg.event` 还能顺便把**事件名**这个契约钉住。
 */
await context.route(/background-runner|background_runner/, async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: `
      export const BackgroundRunner = {
        addListener: async (event, cb) => {
          window.__bg = { event, cb };
          return { remove: async () => { window.__bg = null; } };
        },
        removeAllListeners: async () => { window.__bg = null; },
      };
    `,
  });
});

/** App 自己那套通知（闹钟/定时任务）的点击通道也换成桩：用来验"点了**不跳页**" */
await context.route(/local-notifications|local_notifications/, async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: `
      export const LocalNotifications = {
        addListener: async (event, cb) => {
          window.__ln = { event, cb };
          return { remove: async () => { window.__ln = null; } };
        },
        checkPermissions: async () => ({ display: "granted" }),
        requestPermissions: async () => ({ display: "granted" }),
        schedule: async () => ({}),
        cancel: async () => undefined,
      };
    `,
  });
});

/**
 * 页面里的工具。
 * ⚠️ 全部走 **App 自己那份模块实例**（`window.__realImport` 从 resource 时间线里
 * 捞出带 `?t=` 的那个 URL）—— 裸 `import("/src/lib/store.ts")` 会拿到**影子 store**，
 * 详见文件上方那段说明。
 */
const api = {
  ready: async () => {
    await page.waitForFunction(() => document.documentElement.dataset.theme !== undefined, {
      timeout: 60_000,
    });
  },
  seed: (text, atMs, urge = "50") =>
    page.evaluate(
      ([t, ms, u]) => {
        const p = (n) => String(n).padStart(2, "0");
        const d = new Date(ms);
        const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        /**
         * ⚠️ **合并**进去，不是整个替换 —— 真抽屉的 `put` 是逐键写的
         * （`WakeBridgePlugin.put` 只覆盖传进去的那几个 key），
         * 整个替换会把"已收下"书签之类的别的键一起抹掉，那是**验收脚本自己的 bug**。
         */
        let cur = {};
        try {
          cur = JSON.parse(sessionStorage.getItem("__drawer") || "{}");
        } catch {
          cur = {};
        }
        const next = {
          ...cur,
          wake_pending_text: t,
          wake_pending_at: stamp,
          wake_pending_at_ms: String(ms),
          wake_pending_urge: u,
        };
        sessionStorage.setItem("__drawer", JSON.stringify(next));
        return next;
      },
      [text, atMs, urge],
    ),
  flush: async () =>
    page.evaluate(async () => {
      const { flushPendingWake } = await window.__realImport("/src/lib/wake-sync.ts", 5000);
      return await flushPendingWake();
    }),
  /** 脚本读了哪一份模块（报告里要能看见；不许再落到影子那份上） */
  resolved: () => page.evaluate(() => window.__realImportLog ?? {}),
  state: async () =>
    page.evaluate(async () => {
      const { useApp } = await window.__realImport("/src/lib/store.ts", 5000);
      const st = useApp.getState();
      const conv = st.conversations.find((c) => c.id === st.activeId);
      return {
        activeId: st.activeId,
        count: conv?.messages.length ?? 0,
        messages: (conv?.messages ?? []).map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          scheduled: Boolean(m.scheduled),
          createdAt: m.createdAt,
        })),
        hydrated: st.hydrated,
      };
    }),
  drawer: () =>
    page.evaluate(() => {
      try {
        return JSON.parse(sessionStorage.getItem("__drawer") || "{}");
      } catch {
        return {};
      }
    }),
  /** 模拟原生那条"通知被点了"的事件（桩把 App 注册的那个回调存下来了） */
  bgEvent: () => page.evaluate(() => window.__bg?.event ?? null),
  lnEvent: () => page.evaluate(() => window.__ln?.event ?? null),
  fireNotifyTap: (actionTypeId) =>
    page.evaluate((action) => {
      const bg = window.__bg;
      if (!bg || typeof bg.cb !== "function") return false;
      bg.cb({ actionTypeId: action, notificationId: 9001 });
      return true;
    }, actionTypeId),
  fireLocalNotifyTap: () =>
    page.evaluate(() => {
      const ln = window.__ln;
      if (!ln || typeof ln.cb !== "function") return false;
      ln.cb({ actionId: "tap", notification: { id: 42 } });
      return true;
    }),
};

/** 他"说过"的两句（都明显 >40 字，40 是后台日志的截断线） */
const SAID_MOUNT =
  "你早上把闹钟按掉了三次，我数着的；不是催你，就是想说，今天要是困就早点收工，我在这儿。";
const SAID_LATER = "刚路过阳台看见你那盆薄荷又活过来了，叶子立得挺直；你上次说它活不过我出差那周，这回是你赢了。";

/* ═════════ ② 打开 App 就落库 ═════════ */

const AT_MOUNT = Date.parse("2026-03-04T08:09:10+08:00");
console.log("\n【二】抽屉里躺着一句（打开 App 前就写好了）→ 页面一加载就要**落进会话**");
/** 先落地一次页面（`sessionStorage` 才有得写），写好抽屉，再**重新加载** —— 验的就是"打开 App"那一下 */
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await api.ready();
await api.seed(SAID_MOUNT, AT_MOUNT);
await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
await api.ready();
/** 等挂载时那一次 flush 落地（不是我们手动调的） */
let landedOnMount = null;
for (let i = 0; i < 80 && !landedOnMount; i += 1) {
  const st = await api.state();
  landedOnMount = st.messages.find((m) => m.content === SAID_MOUNT) ?? null;
  if (!landedOnMount) await page.waitForTimeout(100);
}
check("**挂载时自动落库**了（没手动调 flush）", Boolean(landedOnMount), landedOnMount ? landedOnMount.id : "没等到");
check("落的是他发的（assistant），而且带「他自己说的」标记", landedOnMount?.role === "assistant" && landedOnMount?.scheduled === true, JSON.stringify({ role: landedOnMount?.role, scheduled: landedOnMount?.scheduled }));
check("正文一字不差", landedOnMount?.content === SAID_MOUNT, landedOnMount?.content ?? "");
check(`时间用的是**他说话那一刻**（${new Date(AT_MOUNT).toISOString()}）`, landedOnMount?.createdAt === AT_MOUNT, String(landedOnMount?.createdAt));

const afterMount = await api.state();
const drawerAfterMount = await api.drawer();
check("落完**键被清掉**了（不然下次进来又插一条）", !drawerAfterMount.wake_pending_text, JSON.stringify(drawerAfterMount.wake_pending_text));
check("顺手留了个「已收下」的书签", Boolean(drawerAfterMount.wake_pending_consumed_at), String(drawerAfterMount.wake_pending_consumed_at));
check(
  "也留了机器判重的身份串（`<时间戳>|<正文>`，跨重启也认得出这条）",
  String(drawerAfterMount.wake_pending_consumed_key ?? "").startsWith(`${AT_MOUNT}|`),
  String(drawerAfterMount.wake_pending_consumed_key ?? "").slice(0, 40),
);
check("**界面上真的看得见**那条（DOM 里有 msg-<id>）", await page.evaluate((id) => Boolean(document.getElementById(`msg-${id}`)), landedOnMount?.id), `msg-${landedOnMount?.id}`);
await page.screenshot({ path: `${SHOTS}/wake-pending-landed.png` });
console.log(`  📸 ${SHOTS}/wake-pending-landed.png`);

/* ═════════ ③ 不重复 ═════════ */

console.log("\n【三】同一条再落多少次都**只该有一条**（防重复）");
await api.seed(SAID_MOUNT, AT_MOUNT);
const again1 = await api.flush();
const again2 = await api.flush();
const afterDup = await api.state();
check("第二次 flush 说「已经落过了」", again1.landed === false && again1.already === true, JSON.stringify(again1));
check("第三次也一样", again2.landed === false, JSON.stringify(again2));
check(
  `会话里那条**没有被插第二遍**（消息数 ${afterMount.count} → ${afterDup.count}）`,
  afterDup.count === afterMount.count,
  "",
);
check(
  "同一条的份数还是 1",
  afterDup.messages.filter((m) => m.content === SAID_MOUNT).length === 1,
  String(afterDup.messages.filter((m) => m.content === SAID_MOUNT).length),
);

console.log("\n【三·b】**重启一次**（重新加载）之后，同一条仍然不该再插一遍");
{
  /**
   * 这一条专门验"跨重启"那道防线：重新加载之后 JS 上下文是新的，
   * 内存里那份"这条落过了"肯定没了 —— 只能靠抽屉里的 `wake_pending_consumed_key`。
   * 这也正是真机上最常见的场景（App 被系统杀掉、之后又打开）。
   */
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await api.ready();
  await api.seed(SAID_MOUNT, AT_MOUNT);
  const againAfterReload = await api.flush();
  const afterReload = await api.state();
  check("重启后同一条仍然说「已经落过了」", againAfterReload.landed === false, JSON.stringify(againAfterReload));
  check(
    `重启后也没有被插第二遍（消息数 ${afterDup.count} → ${afterReload.count}）`,
    afterReload.count === afterDup.count,
    "",
  );
  check("键也照样被清掉", !(await api.drawer()).wake_pending_text, "");
}

/* ═════════ ④ 新的那条照样落 ═════════ */

console.log("\n【四】清键不能把**后面真的新消息**也挡掉");
const AT_LATER = AT_MOUNT + 3 * 60 * 60 * 1000;
await api.seed(SAID_LATER, AT_LATER);
const landed2 = await api.flush();
const afterNew = await api.state();
check("新的那条**真的落了**", landed2.landed === true, JSON.stringify(landed2));
/**
 * ⚠️ 加这条**交叉验证**（影子 store 的哨兵）：`flush()` 走的是 App 自己那份
 * `wake-sync` / `store`，所以它刚落的那条**必须立刻能在界面上找到**（`msg-<id>`）。
 * 万一又落到影子那份额外实例上，脚本"自己读自己"照样会绿，但这条会立刻红。
 */
const landed2Id = afterNew.messages.at(-1)?.id;
let newInDom = false;
for (let i = 0; i < 40 && !newInDom; i += 1) {
  newInDom = await page.evaluate(
    (id) => Boolean(id && document.getElementById(`msg-${id}`)),
    landed2Id,
  );
  if (!newInDom) await page.waitForTimeout(100);
}
check(
  "落的那条**在界面上真的看得见**（证明写进的是 App 那份 store，不是影子实例）",
  newInDom,
  `msg-${landed2Id}`,
);
check("内容对得上", afterNew.messages.at(-1)?.content === SAID_LATER, afterNew.messages.at(-1)?.content ?? "");
check(
  `消息数 +1（${afterDup.count} → ${afterNew.count}）`,
  afterNew.count === afterDup.count + 1,
  "",
);
check("新的那条落完，键又被清掉了", !(await api.drawer()).wake_pending_text, "");

/* ═════════ ⑤ 点通知直达 ═════════ */

console.log("\n【五】点通知进来（原生事件）→ 先落库、再**跳到那条**");
await page.goto(`${BASE}/me`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await api.ready();
/**
 * ⚠️ 必须等 App **真的把那条监听注册上**（桩把回调存进 `window.__bg`）再往下走 ——
 * 不然"事件没送到"可能只是注册还没跑完（第一版就是这么假失败了一次）。
 * 等得到它，也顺便证明"挂载时的 flush 已经跑完了"（effect 顺序：先落库、再挂监听）。
 */
await page.waitForFunction(() => Boolean(window.__bg), { timeout: 30_000 });
check("先站到别的页面（/me）", new URL(page.url()).pathname === "/me", page.url());
check(
  "App 注册的事件名就是原生发的那一个（`backgroundRunnerNotificationReceived`）",
  (await api.bgEvent()) === "backgroundRunnerNotificationReceived",
  String(await api.bgEvent()),
);
const AT_TAP = AT_LATER + 90 * 60 * 1000;
const SAID_TAP = "（点通知进来的那句）刚才那首歌你循环了七遍，是不是有心事？我听着呢，不用你说。";
await api.seed(SAID_TAP, AT_TAP);
/** 先确认"这会儿还没人把它落进去" —— 这样下面那条落库才真的能归功于点通知 */
await page.waitForTimeout(400);
const beforeTap = await api.state();
check(
  "事件打过来之前，那句**还没进会话**（所以接下来的落库只能是点通知那条路）",
  !beforeTap.messages.some((m) => m.content === SAID_TAP),
  "",
);
const fired = await api.fireNotifyTap("qidao-wake-said");
check("原生事件真的送到了页面（插件事件通道接上了）", fired === true, String(fired));
let jumped = false;
for (let i = 0; i < 60 && !jumped; i += 1) {
  jumped = new URL(page.url()).pathname === "/";
  if (!jumped) await page.waitForTimeout(100);
}
check("**跳回对话页了**（点通知直达）", jumped, page.url());
const afterTap = await api.state();
const tapped = afterTap.messages.at(-1);
check("那一条也落进会话了", tapped?.content?.startsWith("（点通知进来的那句）") === true, tapped?.content ?? "");
let inDom = false;
for (let i = 0; i < 40 && !inDom; i += 1) {
  inDom = await page.evaluate((id) => Boolean(document.getElementById(`msg-${id}`)), tapped?.id);
  if (!inDom) await page.waitForTimeout(100);
}
check("而且 DOM 里能**定位到那一条**（`msg-<id>`，滚过去靠它）", inDom, `msg-${tapped?.id}`);
await page.screenshot({ path: `${SHOTS}/wake-pending-landed.png` });

/* ═════════ ⑤·b App 自己的通知被点：只落库、**不跳页** ═════════ */

console.log("\n【五·b】点的是 App 自己的通知（闹钟/定时任务）→ 只落库，**不把人甩到对话里**");
{
  await page.goto(`${BASE}/me`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await api.ready();
  await page.waitForFunction(() => Boolean(window.__ln), { timeout: 30_000 });
  check(
    "App 也接上了自己那套通知的点击事件（`localNotificationActionPerformed`）",
    (await api.lnEvent()) === "localNotificationActionPerformed",
    String(await api.lnEvent()),
  );
  const SAID_LOCAL = "（点闹钟通知进来的那句）先把水喝了再说话，我等你这一杯。";
  await api.seed(SAID_LOCAL, AT_TAP + 60_000);
  await page.waitForTimeout(400);
  const firedLocal = await api.fireLocalNotifyTap();
  check("事件送到了", firedLocal === true, String(firedLocal));
  let landedLocal = false;
  for (let i = 0; i < 40 && !landedLocal; i += 1) {
    landedLocal = (await api.state()).messages.some((m) => m.content === SAID_LOCAL);
    if (!landedLocal) await page.waitForTimeout(100);
  }
  check("那句话**照样落库**了（点哪条通知都不该把它弄丢）", landedLocal, "");
  await page.waitForTimeout(600);
  check("但**没有跳页**（人还站在 /me，点的是闹钟不是他）", new URL(page.url()).pathname === "/me", page.url());
}

/* ═════════ ⑥ 网页版优雅跳过 ═════════ */

console.log("\n【六】网页版（没有抽屉）→ 什么都不做、**不报错**");
{
  const plain = await context.newPage();
  const plainErrors = [];
  plain.on("pageerror", (e) => plainErrors.push(e.message));
  await plain.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await plain.waitForFunction(() => document.documentElement.dataset.theme !== undefined, { timeout: 60_000 });
  const r = await plain.evaluate(async () => {
    const { flushPendingWake } = await window.__realImport("/src/lib/wake-sync.ts", 5000);
    return await flushPendingWake();
  });
  check("返回「跳过」而不是抛错", r?.ok === true && r?.landed === false, JSON.stringify(r));
  check("没有 pageerror", plainErrors.length === 0, plainErrors.join(" | "));
  await plain.close();
}

/* ═════════ ⑦ 恢复没跟上时：宁可不落，也不能丢 ═════════ */

console.log("\n【七】本地会话还没恢复完 → **不许写**（写进一个马上被覆盖的 store，那句话就永远没了）");
{
  /**
   * 怎么造出"恢复很慢"：把 `idb-storage` 换成"读的时候先睡 6 秒"的桩。
   * `waitHydrated()` 有 4 秒兜底，所以它会先返回 —— 这时 `hydrated` 还是 false，
   * 落库那一步必须**自己刹住**，把交接键留在抽屉里等下一次时机。
   */
  const slow = await context.newPage();
  await slow.addInitScript(() => {
    window.CapacitorCustomPlatform = { name: "android", plugins: {} };
  });
  await slow.route("**/src/lib/idb-storage.ts*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `
        const DB = "qidao-store", STORE = "kv", KEY = "aster-app";
        const open = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const get = async () => { const db = await open(); return await new Promise((res) => { const tx = db.transaction(STORE, "readonly"); const g = tx.objectStore(STORE).get(KEY); g.onsuccess = () => res(g.result ?? null); }); };
        const put = async (v) => { const db = await open(); await new Promise((res) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(v, KEY); tx.oncomplete = res; }); };
        export const idbStorage = {
          // ⚠️ 就是这一下：恢复要 6 秒（比 waitHydrated 的 4 秒兜底还长）
          async getItem() { const v = await get(); await sleep(6000); return v; },
          async setItem(_n, v) { await put(v); },
          async removeItem() {},
        };
        export async function idbUsage() { return null; }
      `,
    });
  });
  const slowErrors = [];
  slow.on("pageerror", (e) => slowErrors.push(e.message));
  const SAID_SLOW = "（恢复慢那次）这句必须**先留在抽屉里**，不能写进一个马上要被覆盖的会话。";
  await slow.goto(`${BASE}/`, { waitUntil: "commit", timeout: 60_000 });
  await slow.waitForFunction(() => Boolean(document.body), { timeout: 30_000 });
  await slow.evaluate(
    ([t, ms]) =>
      sessionStorage.setItem(
        "__drawer",
        JSON.stringify({ wake_pending_text: t, wake_pending_at: "2026-03-04 09:00:00", wake_pending_at_ms: String(ms) }),
      ),
    [SAID_SLOW, AT_MOUNT],
  );
  const r = await slow.evaluate(async () => {
    const { flushPendingWake } = await window.__realImport("/src/lib/wake-sync.ts", 8000);
    const { useApp } = await window.__realImport("/src/lib/store.ts", 8000);
    const out = await flushPendingWake();
    return { out, hydrated: useApp.getState().hydrated };
  });
  check("恢复没完成时**不落库**（返回 ok:false，并说清原因）", r.out?.ok === false && r.out?.landed === false, JSON.stringify(r.out));
  check("也确实还没恢复完（这不是假失败）", r.hydrated === false, String(r.hydrated));
  const slowDrawer = await slow.evaluate(() => JSON.parse(sessionStorage.getItem("__drawer") || "{}"));
  check("**交接键原封不动留着**（下一次时机还能落）", slowDrawer.wake_pending_text === SAID_SLOW, String(slowDrawer.wake_pending_text ?? "").slice(0, 30));
  check("没有 pageerror", slowErrors.length === 0, slowErrors.join(" | "));
  await slow.close();
}

/* ═════════ ⑧ 全程零报错 ═════════ */

console.log("\n【八】全程零 pageerror");
check("没有 pageerror", pageErrors.length === 0, pageErrors.join(" | "));

console.log("-".repeat(64));
/** 脚本读的是哪一份模块实例 —— 打进输出里，报告要能看见（不许再落到影子那份） */
console.log(`读取的模块实例：${JSON.stringify(await api.resolved())}`);
console.log(`前台落库 + 点通知直达验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
