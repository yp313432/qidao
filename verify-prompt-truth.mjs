/**
 * 验收脚本：**说明书写的是不是真的**（说明书 ↔ 代码对账）。
 *
 * ── 为什么必须有这个脚本 ──────────────────────────────────────
 *
 * `src/lib/manual.ts` 是要发给模型的"栖岛说明书"。它出过一个**很贵的错**：
 * 里面写着「真实调用 MCP 服务器上的工具（配置能存，但还没接上）」，
 * 同时又写着「遇到这些直接告诉他'这个还没做'」——
 * 等于**在指示模型否认自己已经会的能力**（MCP 工具上个窗口就接通了）。
 * 用户最烦的就是这个：明明会，却说不会。
 *
 * 教训（坑 #31）：**状态清单不要写死在提示词里**。这次改成了规则，
 * 但"页面地图""能力边界"这类**必须跟代码对账**的东西还在，
 * 所以用脚本盯住 —— 靠人记必然再错一次。
 *
 * ── 这个脚本检查什么 ──────────────────────────────────────────
 *
 * ① **权限名**：说明书里出现的每个《标题》/「标题」，如果是权限名，
 *    必须真的在 `lib/permissions.ts` 里 —— 写错就等于又造了一份过期清单
 * ② **页面路径**：说明书里出现的每个 `/xxx`，必须在**真实路由**里
 *    （从 `src/routes/_app/` 的文件名推出来）—— 地图错了就会带用户去错地方
 * ③ **过期说法**：不许再出现"还没接上 / 还没做 / 配置能存但"这类**会过期的断言**
 * ④ **分平台**：手机版（native）与网页版必须给出**不一样**的能力边界
 *    （手机版没有服务端，网页搜索/中转那条在手机上不存在）
 * ⑤ **那份清单真的删了**：说明书里不许再有一份"目前还没做的"清单
 *
 * 跑法（要完整权限；dev server 要在 8080）：
 *   node verify-prompt-truth.mjs
 * 退出码非 0 = 说明书写了跟代码对不上的东西。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/* ───────── 一、从代码里推出"真话"（路由 + 权限名） ───────── */

/**
 * 真实路由：把 `src/routes/_app/` 下的文件名按 TanStack 的规则翻成路径。
 *   `index.tsx` → `/`        `tools/index.tsx` → `/tools`
 *   `play.days.tsx` → `/play/days`   `tools/http.tsx` → `/tools/http`
 *   ⚠️ **`xxx.index.tsx` 也要算**（`play.games.index.tsx` → `/play/games`）——
 *      第一版漏了这种"索引路由"，于是把真页面报成了"查无此路"（假红）。
 */
function realRoutes() {
  const root = join(process.cwd(), "src", "routes", "_app");
  const out = new Set(["/", "/me", "/play", "/tools"]);
  /** `a.b.c` → `/a/b/c`；末尾的 `index` 去掉 */
  const toPath = (dotted) => {
    const parts = dotted.split(".").filter((p) => p && p !== "index");
    return parts.length ? `/${parts.join("/")}` : "/";
  };
  const walk = (dir, prefix) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        out.add(toPath(`${prefix}${e.name}`));
        walk(p, `${prefix}${e.name}.`);
        continue;
      }
      if (!e.name.endsWith(".tsx")) continue;
      out.add(toPath(`${prefix}${e.name.replace(/\.tsx$/, "")}`));
    }
  };
  walk(root, "");
  return out;
}

const { PERMISSIONS } = await import("./src/lib/permissions.ts").catch(() => ({ PERMISSIONS: null }));
const routes = realRoutes();
const permTitles = new Set((PERMISSIONS ?? []).map((p) => p.title));

/* ───────── 二、取两端的说明书文本 ───────── */

const browser = await chromium.launch({ channel: "msedge" });

/** 在浏览器里真调 `buildManual()`（网页版 / 假装自己是手机版） */
async function manualText(native) {
  const page = await browser.newPage();
  if (native) {
    // Capacitor 判断平台靠这个 —— 在页面脚本跑之前注入（见 verify-mcp-oauth-app.mjs 的做法）
    await page.addInitScript(() => {
      globalThis.CapacitorCustomPlatform = { name: "android" };
    });
  }
  await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(800);
  const text = await page.evaluate(async () => {
    const { buildManual } = await import("/src/lib/manual.ts");
    const { PERMISSIONS } = await import("/src/lib/permissions.ts");
    return buildManual({
      permissions: {},
      titles: PERMISSIONS.map((p) => ({ id: p.id, title: p.title })),
      displayName: "yan",
      aiName: "星芒",
    });
  });
  await page.close();
  return text;
}

const web = await manualText(false);
const app = await manualText(true);

/* ───────── 三、① 权限名对账 ───────── */

console.log("【一】说明书里提到的权限名，代码里真的有");
/** 说明书用《》或「」引用名字；只有"像权限名"的（命中 PERMISSIONS 的全部标题集合之外）才可疑 */
const QUOTED = /[《「]([^》」]{2,14})[》」]/g;
const mentioned = new Set();
for (const m of web.matchAll(QUOTED)) mentioned.add(m[1]);
/**
 * 这些是**动作/页面/工具名**，不是权限名，不该拿去对权限表。
 * 列出来是为了"改说明书时想起来更新这份豁免"，而不是为了放过错误。
 */
const EXEMPT = new Set([
  "工具 → HTTP", "工具 → MCP", "我的 → 系统", "做不到", "看这里", "直接允许", "每次要问",
  "你帮我切一下", "做不到", "这个还没做", "会做", "不会", "我以为自己不会", "我不会",
  "不相信", "明白", "以为",
]);
const suspicious = [...mentioned].filter((w) => !permTitles.has(w) && !EXEMPT.has(w));
check(
  "引号里的名字要么是真实权限名，要么在豁免表里",
  suspicious.length === 0,
  suspicious.length ? `可疑：${suspicious.join(" / ")}` : "",
);
check("权限表读到了（不然这项等于没测）", permTitles.size > 50, `权限 ${permTitles.size} 项`);

/* ───────── 四、② 页面路径对账 ───────── */

console.log("\n【二】说明书里的页面路径，真实路由里真的有");
const paths = new Set();
for (const m of web.matchAll(/(?<![\w:/])\/[a-z][a-z0-9/-]*/g)) paths.add(m[0].replace(/\/$/, ""));
const badPaths = [...paths].filter((p) => !routes.has(p));
check(
  "每个 /xxx 都在真实路由里",
  badPaths.length === 0,
  badPaths.length ? `查无此路：${badPaths.join(" / ")}` : `查了 ${paths.size} 个路径`,
);

/* ───────── 五、③ 过期说法 ───────── */

console.log("\n【三】不许再出现「会过期」的断言");
const STALE = [
  /配置能存[，,]?\s*但还?没接上/,
  /还没接上/,
  /目前还没做的/,
  /还没做[^。]{0,6}$/m,
  /网页搜索 \/ 抓取网页内容（权限表里标着/,
];
for (const re of STALE) {
  check(`说明书里没有这种过期句子：${re.source.slice(0, 22)}`, !re.test(web), "");
}

/* ───────── 六、④ 分平台 ───────── */

console.log("\n【四】手机版和网页版说的能力边界不一样");
check("两端文本不同（说明真的按平台生成了）", web !== app);
check(
  "手机版明说「网页搜索/抓取正文」做不到",
  /网页搜索 \/ 抓取网页正文[^\n]*做不到/.test(app) || /网页搜索[^\n]*手机版做不到/.test(app),
  app.split("\n").find((l) => l.includes("网页搜索"))?.slice(0, 90) ?? "没找到那句",
);
check(
  "网页版说的是「要靠中转」，不是「做不到」",
  /网页搜索 \/ 抓取网页正文[^\n]*中转/.test(web),
  web.split("\n").find((l) => l.includes("网页搜索"))?.slice(0, 90) ?? "没找到那句",
);
check(
  "手机版**没有**承诺中转/服务端能力（APK 里没有服务端）",
  !/中转/.test(app) || !/中转[^\n]*能/.test(app),
  "",
);

/* ───────── 七、⑤ 权限那节的瘦身没把「允许 / 拒绝」丢掉 ───────── */

console.log("\n【五】权限那一节：允许/拒绝照旧全列，「每次要问」只报个数");
const page2 = await browser.newPage();
await page2.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page2.waitForTimeout(800);
const withPerms = await page2.evaluate(async () => {
  const { buildManual } = await import("/src/lib/manual.ts");
  const { PERMISSIONS } = await import("/src/lib/permissions.ts");
  const permissions = {};
  // 造三个"允许"、两个"拒绝"，其余留空（= 每次要问）
  permissions.navigate = "allow";
  permissions.diary = "allow";
  permissions.memory = "allow";
  permissions.delete_chat = "deny";
  permissions.reset_all = "deny";
  return buildManual({
    permissions,
    titles: PERMISSIONS.map((p) => ({ id: p.id, title: p.title })),
    displayName: "yan",
    aiName: "星芒",
  });
});
await page2.close();
const permBlock = withPerms.slice(withPerms.indexOf("【你现在的权限"));
check("「允许」的三项都在", ["切换页面", "写日记", "长期记忆"].every((t) => permBlock.includes(t)));
check("「拒绝」的两项都在", ["删除对话", "重置设置 / 清空数据"].every((t) => permBlock.includes(t)));
check("「每次要问」那串变成了只报个数", /其余 \d+ 项没设/.test(permBlock), permBlock.split("\n")[2]?.slice(0, 80) ?? "");
check(
  "**没有**把「每次要问」的权限名一个个列出来（瘦身真的生效）",
  !permBlock.includes("网页搜索 / 抓取、调用你的"),
  "",
);
check("仍然强调「开了就要主动用」", permBlock.includes("主动用起来"));

/* ───────── 八、整体 ───────── */

console.log("\n【六】整体");
check("说明书里还有【硬要求】那十条（用户强调过，别动）", web.includes("【硬要求 · 不可协商"));
check("说明书里还有页面地图", web.includes("【栖岛里有什么（页面地图）】"));
check("引子提到设备本地（隐私说法没丢）", web.includes("只存在他那台设备上"));

console.log("-".repeat(64));
console.log(`说明书写真验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);

await browser.close();
process.exit(bad === 0 ? 0 : 1);
