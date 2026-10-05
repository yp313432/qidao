/**
 * 「我的」那五个板块的**父级表**。
 *
 * ── 为什么要有这个文件 ──────────────────────────────────────────
 *
 * 用户的抱怨（原话）：
 *   "返回只能返回上一级，不能直接返回首页……不能只说我改哪儿你就改哪，
 *    所有的返回都要是返回上一级"
 *
 * 之前的做法：**每个页面自己手写返回目标**（`<PageHeader to="/me" />`）。
 * 后果：页面被挪到更深一层时，返回钮不会跟着变 —— 于是
 * `/memory`（在「模型与用量」里面）一直退回一级首页「我的」，
 * 而不是退回上一级「模型与用量」。
 *
 * 这就是"同样都是组件，这个组件一套代码写法，换一个组件又是另一套"的典型：
 * **返回逻辑散在 20 个文件里，没有任何一处能回答"这个页面的上一级是谁"**。
 *
 * 现在改法：层级关系**只在这一个文件里定义**，所有返回钮从它读。
 * 于是"不写"就等于"正确"，不会再有人手写错目标。
 * 再配一个 `verify-hierarchy.mjs` 遍历所有页面自动对账。
 *
 * ── 结构 ────────────────────────────────────────────────────
 *   /me（一级）
 *     ├ /core     → AI 概览
 *     ├ /space    → 我的空间
 *     ├ /usage    → 模型与用量
 *     ├ /data     → 数据
 *     └ /system   → 系统
 *
 *   三级页（挂在某个二级下面）
 *     /core    ├ /permissions /worldbook /inner /memories
 *     /usage   ├ /memory
 *     /system  ├ /alarms /tasks /env
 *     /play/tools ├ /play/gobang /play/days /play/todo
 *     /play/listen ├ /play/add
 */

/** 「我的」的五个二级板块（它们的上一级都是一级首页 /me） */
export const ME_SECTIONS = ["/core", "/space", "/usage", "/data", "/system"] as const;

/**
 * 三级页 → 它的**上一级**。
 *
 * 只列三级页。二级页（ME_SECTIONS 和 /play/* 那些房间）不用列 ——
 * 它们的上一级是根（/me 或 /play），由 `parentOf` 兜底推出来。
 */
export const TERTIARY_PARENT: Record<string, string> = {
  // 「AI 概览」下面四项
  "/permissions": "/core",
  "/worldbook": "/core",
  "/inner": "/core",
  "/memories": "/core",

  // 「模型与用量」下面一项
  "/memory": "/usage",

  // 「系统」下面一项
  "/env": "/system",

  /*
    玩乐区 —— 两级子分区：
      /play/tools  小日子  →  days / todo / alarms / tasks
      /play/games  小游戏  →  gobang / truth
    以后往小游戏里加新游戏，**只要在这里补一行**，
    返回钮和 verify-hierarchy 就都跟着对了。
  */
  "/play/days": "/play/tools",
  "/play/todo": "/play/tools",
  "/play/tools/alarms": "/play/tools",
  "/play/tools/tasks": "/play/tools",
  "/play/games/gobang": "/play/games",
  "/play/games/truth": "/play/games",

  // 音乐列表下面一项
  "/play/add": "/play/listen",
};

/** 顶级 tab（它们没有返回钮 —— 它们就是"首页"） */
export const ROOT_PATHS = ["/", "/tools", "/play", "/me"] as const;

/**
 * 这个页面的**上一级**在哪。
 *
 * 规则（按优先级）：
 *   1. 三级页 → 查 TERTIARY_PARENT
 *   2. 玩乐区二级页（/play/xxx）→ /play
 *   3. 其余二级页 → /me（「我的」里的板块）
 *
 * 返回 null 表示"这是首页，不该有返回钮"。
 */
export function parentOf(path: string): string | null {
  // 去掉查询串/末尾斜杠，别让 "/memory/" 这种写法漏掉
  const p = path.split("?")[0]!.replace(/\/+$/, "") || "/";

  // 1) 三级页
  const explicit = TERTIARY_PARENT[p];
  if (explicit) return explicit;

  // 2) 顶级 tab：没有上一级
  if ((ROOT_PATHS as readonly string[]).includes(p)) return null;

  // 3) 玩乐区的房间 → 回玩乐首页
  if (p.startsWith("/play/")) return "/play";

  // 4) 其余都是「我的」的板块 → 回我的
  return "/me";
}

/**
 * 这个页面该不该显示返回钮。
 * 顶级 tab 不显示（用户从底部导航直接到它们，没有"上一级"）。
 */
export function hasBackButton(path: string): boolean {
  return parentOf(path) !== null;
}

/** 给返回钮一个说人话的标签（无障碍 + 长按提示用） */
export function backLabelOf(path: string): string {
  const parent = parentOf(path);
  if (!parent) return "返回";
  const names: Record<string, string> = {
    "/me": "返回我的",
    "/play": "返回玩乐",
    "/core": "返回 AI 概览",
    "/space": "返回我的空间",
    "/usage": "返回模型与用量",
    "/data": "返回数据",
    "/system": "返回系统",
    "/play/tools": "返回小日子",
    "/play/games": "返回小游戏",
    "/play/listen": "返回音乐",
  };
  return names[parent] ?? "返回上一级";
}
