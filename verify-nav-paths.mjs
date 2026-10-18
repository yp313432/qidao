/**
 * 验收：`navigate` 的允许清单（`src/lib/known-routes.ts`）跟真实路由对不对得上。
 *
 * 为什么要有这个脚本（用户 m03612 第 4 条："ai 开新局还是空白"）：
 * 模型写的 `navigate` 路径以前直通页面 —— 旧动作跳 `/play/gobang`、
 * `/play/truth`，这两个路由**根本不存在**，点下去就是一页 "Not Found"。
 * 现在 `actions.ts` 会先过 `isKnownPath()`，所以这份清单必须**跟路由一致**：
 *   · 路由有、清单漏了 → 该能去的地方去不了（比空白页还气人）
 *   · 清单有、路由没有 → 校验形同虚设
 *
 * 用法：`node verify-nav-paths.mjs`（改路由、改清单之后都跑一遍）
 */
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const PASS = [];
const FAIL = [];
const check = (name, ok, detail = "") => (ok ? PASS : FAIL).push({ name, detail });

/* ── ① 从 `routeTree.gen.ts` 里抠出真实路径（这个文件是 TanStack 生成的） ── */
const tree = read("./src/routeTree.gen.ts");
const block = tree.slice(
  tree.indexOf("export interface FileRoutesByFullPath {"),
  tree.indexOf("export interface FileRoutesByTo"),
);
const routes = [...block.matchAll(/'([^']+)':/g)]
  .map((m) => m[1])
  // 服务端接口 / OAuth 回调不是"页面"，`navigate` 不该往那儿跳
  .filter((p) => !p.startsWith("/api/") && !p.startsWith("/oauth/"))
  // `/play/` 这种就是 `/play`
  .map((p) => (p.length > 1 ? p.replace(/\/+$/, "") : "/"));
const routeSet = new Set(routes);

/* ── ② 从清单里抠出 EXACT / PREFIXES ── */
const src = read("./src/lib/known-routes.ts");
const slice = (start, end) => {
  const i = src.indexOf(start);
  const j = src.indexOf(end, i);
  return src.slice(i, j);
};
const exactBlock = slice("const EXACT = [", "] as const;");
const prefixBlock = slice("const PREFIXES = [", "] as const;");
const exact = [...exactBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const prefixes = [...prefixBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

/* ── ③ 路由里除了 `$slug` 这种动态段，其余都得在清单里 ── */
const dynamic = routes.filter((p) => p.includes("$"));
const staticRoutes = routes.filter((p) => !p.includes("$"));
const missing = staticRoutes.filter(
  (p) => !exact.includes(p) && !prefixes.some((pre) => p.startsWith(pre)),
);
check(
  "① 每个真页面都在允许清单里（漏了 = 该能去的地方去不了）",
  missing.length === 0,
  missing.join("、") || `${staticRoutes.length} 个页面全覆盖`,
);

const ghosts = exact.filter((p) => !routeSet.has(p));
check("② 清单里没有不存在的页面（有 = 校验形同虚设）", ghosts.length === 0, ghosts.join("、") || "零幽灵页面");

const dynMissing = dynamic.filter((p) => !prefixes.some((pre) => p.startsWith(pre)));
check(
  "③ 动态路由都有对应的前缀放行（`/play/plugins/$slug` 这类）",
  dynMissing.length === 0,
  dynMissing.join("、") || dynamic.join("、") || "没有动态页面",
);

/* ── ④ 用户真正踩过的那两条老路径，必须**不**被放行 ── */
const norm = (p) => (p.length > 1 ? p.replace(/\/+$/, "") : "/");
const isKnown = (p) => {
  const n = norm(p.split("?")[0].split("#")[0]);
  return exact.includes(n) || prefixes.some((pre) => n.startsWith(pre) && n.length > pre.length);
};
check(
  "④ 踩过的空白页路径仍被拦住（/play/gobang、/play/truth）",
  !isKnown("/play/gobang") && !isKnown("/play/truth"),
  `/play/gobang=${isKnown("/play/gobang")} /play/truth=${isKnown("/play/truth")}`,
);
check(
  "⑤ 改对之后的路径放行（/play/garden/qi、/play/games/truth、/play/garden/stagno）",
  ["/play/garden/qi", "/play/games/truth", "/play/garden/stagno", "/play/"].every(isKnown),
  "含结尾斜杠也要认",
);

for (const p of PASS) console.log(`✅ ${p.name}${p.detail ? ` —— ${p.detail}` : ""}`);
for (const f of FAIL) console.log(`❌ ${f.name}${f.detail ? ` —— ${f.detail}` : ""}`);
console.log(`\n${PASS.length} 通过 / ${FAIL.length} 失败`);
process.exit(FAIL.length ? 1 : 0);
