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
 *     /tools   ├ /tools/http /tools/mcp /tools/docs（三个编辑器页）
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

/**
 * 工具区的编辑器页 —— 它们的上一级是「工具」（`/tools` 那个 tab 首页）。
 *
 * 为什么单独列出来：`/tools/http` 这种路径走不到下面任何一条兜底规则
 * （不是三级页表里的、不是顶级 tab、也不以 `/play/` 开头），会被兜底成
 * `/me` —— 从「工具」进去、返回却跳到「我的」，就是用户最烦的那种错。
 */
const TOOLS_SUBPAGE_PREFIX = "/tools/";

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

  // 4) 工具区的编辑器 → 回工具首页
  if (p.startsWith(TOOLS_SUBPAGE_PREFIX)) return "/tools";

  // 5) 其余都是「我的」的板块 → 回我的
  return "/me";
}

/**
 * **系统返回键（安卓的返回键 / 侧边滑动手势）该去哪儿。**
 *
 * 为什么要单独一个函数：`PageHeader` 里那个返回钮一直是对的（按层级回上一级），
 * 但**系统返回键走的是浏览器历史** —— 用户真机实测：
 *   "我点了语音通话，又切换到其他页面点开它的下级，最后一步步返回我所有点过的页面，
 *    即使他们之间并没有层级关系，就跟网页版一样"。
 * 那是网页的行为。**App 的返回永远是"当前页的上一级"**，跟你怎么点过来的无关。
 *
 * 所以两个入口（页内返回钮 / 系统返回）共用这一份层级表：
 *   · 有上一级 → 回上一级
 *   · 非首页的 tab → 回对话首页
 *   · 对话首页 `/` → `"exit"`（只有站在首页，返回才是退出 App）
 *
 * 网页版**不用**它（浏览器里"历史返回"才是对的），只有原生壳会调。
 */
export function systemBackTarget(path: string): string | "exit" {
  const p = path.split("?")[0]!.replace(/\/+$/, "") || "/";

  /*
    顶级页分两种，这是**真 App 的规矩**（用户 2026-10 明确要求）：
      · `/`（对话首页）→ **退出 App**（"对话页面我侧滑屏幕才会退出 app"）
      · 其它三个 tab（工具/玩乐/我的）→ **先回对话首页**，不退出
        （安卓 App 一贯做法：在非首页 tab 按返回，回到起始 tab）
    只有真的站在首页了，返回才是"退出"。
  */
  if (p === "/") return "exit";
  if ((ROOT_PATHS as readonly string[]).includes(p)) return "/";

  return parentOf(p) ?? "exit";
}

/**
 * 哪些页面**不显示底部导航**（整屏页面）。
 *
 *   · 玩乐的子页 —— 自己带返回，界面要沉浸
 *   · 工具区的编辑器（/tools/http 这些）—— 表单要整屏，
 *     底部导航会压住最后一行（用户实测：MCP 的「请求头」输入框被导航挡住）
 *
 * 规则只在这里定义一处：以后再加整屏页面，往 `FULL_BLEED_PREFIXES`
 * 补一行就行，`app-shell` 不用改。
 */
export const FULL_BLEED_PREFIXES = ["/play/", "/tools/"] as const;

/** 这个页面该不该隐藏底部导航。 */
export function hidesNav(path: string): boolean {
  const p = path.split("?")[0]!.replace(/\/+$/, "") || "/";
  return FULL_BLEED_PREFIXES.some((prefix) => p.startsWith(prefix));
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
    "/tools": "返回工具",
  };
  return names[parent] ?? "返回上一级";
}
