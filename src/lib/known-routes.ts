/**
 * **这个 App 里到底有哪些页面** —— 给 `navigate` 动作做一次校验。
 *
 * 起因（用户 m03612 第 4 条："ai 开新局还是空白"）：模型的 `navigate` 路径
 * 一路直通 `ctx.navigate(path)`，写错一个字就是 TanStack Router 的
 * "Not Found" 整页 —— 花园那批改完后，旧动作还在往 `/play/gobang`、
 * `/play/truth` 跳（真页面是 `/play/games/gobang`、`/play/games/truth`），
 * 用户看到的就是一页空白。
 *
 * 所以这里放一份**允许清单**：不认识的路径不跳，改成回一句人话。
 *
 * ⚠️ 加/改路由时同步这里，然后跑 `node verify-nav-paths.mjs`
 * （脚本会拿 `src/routeTree.gen.ts` 里的 `fileRoutesByFullPath` 对账，
 * 少写、多写都会报出来）。
 */

/** 精确路径（`/` 开头、不带结尾斜杠） */
const EXACT = [
  "/",
  "/core",
  "/data",
  "/env",
  "/me",
  "/memories",
  "/memory",
  "/permissions",
  "/play",
  "/play/add",
  "/play/days",
  "/play/games",
  "/play/games/gobang",
  "/play/games/truth",
  "/play/garden",
  "/play/garden/cesta",
  "/play/garden/qi",
  "/play/garden/stagno",
  "/play/garden/tavolo",
  "/play/garden/tarot",
  "/play/garden/vestigia",
  "/play/garden/fiori",
  "/play/learn",
  "/play/listen",
  "/play/player",
  "/play/plugins",
  "/play/shigan",
  "/play/space",
  "/play/space/diary",
  "/play/space/letters",
  "/play/space/moments",
  "/play/todo",
  "/play/tools",
  "/play/tools/alarms",
  "/play/tools/tasks",
  "/space",
  "/system",
  "/tools",
  "/tools/docs",
  "/tools/http",
  "/tools/mcp",
  "/usage",
  "/voice",
  "/worldbook",
] as const;

/** 前缀路径（后面可以再接一段：插件 id 之类） */
const PREFIXES = ["/play/plugins/"] as const;

const EXACT_SET = new Set<string>(EXACT);

/** `/play/listen/?x=1#y` → `/play/listen`（只留路径本身） */
export function normalizePath(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const noHash = s.split("#")[0]!;
  const noQuery = noHash.split("?")[0]!;
  const withSlash = noQuery.startsWith("/") ? noQuery : `/${noQuery}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : "/";
}

/** 这个路径是不是真的存在 */
export function isKnownPath(raw: string): boolean {
  const p = normalizePath(raw);
  if (!p) return false;
  if (EXACT_SET.has(p)) return true;
  return PREFIXES.some((pre) => p.startsWith(pre) && p.length > pre.length);
}

/** 给模型的"能去哪些地方"，报错时回它一句人话用 */
export function knownPathExamples(): string {
  return "/play/garden/qi、/play/garden/stagno、/play/space/moments、/play/tools、/me";
}

/** 验收脚本用：把清单吐出来对账 */
export function knownPathList(): { exact: string[]; prefixes: string[] } {
  return { exact: [...EXACT], prefixes: [...PREFIXES] };
}
