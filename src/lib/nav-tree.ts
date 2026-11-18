/**
 * 唯一的页面层级表 —— 「这一页的上一级是谁」**只在这里定义一次**。
 *
 * ── 为什么要有这个文件 ──────────────────────────────────────────
 *
 * 用户的抱怨（原话）：
 *   "返回只能返回上一级，不能直接返回首页……不能只说我改哪儿你就改哪，
 *    所有的返回都要是返回上一级"
 *
 * 之前的做法：**每个页面自己手写返回目标**（`<PageHeader to="/me" />`）。
 * 后果：页面被挪到更深一层时，返回钮不会跟着变 —— 于是
 * `/memory`（在「模型与用量」里面）一直退回一级首页「我的」。
 *
 * ── 2026-11-18：两种主题合表（用户 m00516）────────────────────
 *
 * 原话："这两个模式的层级逻辑是一样的。" —— 之前这个文件里有**两张表**：
 * 液态一张（`LQ_CHILD` / `LQ_ME_CHILD`），纯色一张（`TERTIARY_PARENT`），
 * 于是同一个页面在两个主题下返回目标不一样（`/tools` 在纯色下"没有上一级"、
 * 在液态下回对话页），这是"换主题行为就变"的根源。现在只有一张。
 *
 *   一级  `/`                     对话页（侧边栏、抽屉、设置屏都挂在它身上）
 *   二级  `/tools` `/play/space` `/play/tools` `/play/listen` `/play/learn`
 *         `/play/garden` `/play/plugins` `/play/games` `/pet` `/me`
 *         —— 从侧边栏 / 抽屉 / 头像推进来的列表页，上一级都是对话页
 *   三级  列表里再点进去的页（编辑器、三间房、房间、播放页、具体插件、
 *         「我的」五个板块与设置八项）
 *   四级  `/permissions` `/worldbook` `/memories`（← `/core`）、
 *         `/memory`（← `/usage`）、`/alarms` `/tasks`（← `/system`）、
 *         `/env`（← `/about`）、`/play/garden/cesta`（← 池塘）、
 *         `/play/garden/tarot`（← 棋桌）
 *
 * 规矩（用户 m09110）：**返回永远只退一级**，不许从三级一步跳回一级；
 * 用户 m00516 又确认了一遍："返回是按真实父级回退，不是全部回到聊天页，咱们就一级一级的退。"
 */

/** 去掉查询串与末尾斜杠：`/memory/?a=1` → `/memory` */
function normalize(path: string): string {
  return path.split("?")[0]!.replace(/\/+$/, "") || "/";
}

/**
 * 三级、四级页 → 它的**上一级**（显式写死的那部分）。
 *
 * 二级页也列在这里（上一级都是 `/`）—— 不是必须有，是为了让这张表能一眼读全：
 * 想看"从侧边栏能进哪些地方"，看 `SECOND_LEVEL` 那一段就够了。
 */
export const PARENT_OF: Record<string, string> = {
  // ── 二级：从侧边栏 / 抽屉 / 头像推进来的列表页，返回对话页 ──────────
  "/tools": "/",
  "/play/space": "/",
  "/play/tools": "/",
  "/play/listen": "/",
  "/play/learn": "/",
  "/play/garden": "/",
  "/play/plugins": "/",
  "/play/games": "/",
  "/pet": "/",
  // 语音对话页：从对话页顶栏那颗麦克风进去的（v22 仍是），所以上一级是对话页
  "/voice": "/",
  "/me": "/",

  // ── 三级：工具区的三个编辑器 ────────────────────────────────
  "/tools/mcp": "/tools",
  "/tools/http": "/tools",
  "/tools/docs": "/tools",

  // ── 三级：动态空间目录底下的三间房 ──────────────────────────
  "/play/space/moments": "/play/space",
  "/play/space/diary": "/play/space",
  "/play/space/letters": "/play/space",

  /*
    三级：小日子（`/play/tools`）底下的房间。
    入口在 `tools-view.tsx`，但父级是「小日子」—— 从哪儿进去就回哪儿。
  */
  "/play/days": "/play/tools",
  "/play/todo": "/play/tools",
  "/play/tools/alarms": "/play/tools",
  "/play/tools/tasks": "/play/tools",

  // ── 三级：音乐列表底下的播放页与「加歌」 ────────────────────
  "/play/player": "/play/listen",
  "/play/add": "/play/listen",

  // ── 三级：小游戏 ────────────────────────────────────────
  "/play/games/gobang": "/play/games",
  "/play/games/truth": "/play/games",

  /*
    三级：花园里的房间。
    池塘里的「竹篮」是 花园 → 池塘 → 竹篮，所以竹篮的上一级是池塘；
    棋桌的「塔罗」是 花园 → 棋桌 → 塔罗，所以塔罗的上一级是棋桌。
  */
  "/play/garden/qi": "/play/garden",
  "/play/garden/stagno": "/play/garden",
  "/play/garden/cesta": "/play/garden/stagno",
  "/play/garden/vestigia": "/play/garden",
  "/play/garden/fiori": "/play/garden",
  "/play/garden/tavolo": "/play/garden",
  "/play/garden/tarot": "/play/garden/tavolo",

  /*
    三级：「我的」这一屏**里面**的东西（用户 m00624 真机：
      "你的返回层级没做吧，我一点返回直接全回到对话页了，而不是上一级"）。
    五个板块 + 设置八项，上一级都是 `/me`。
  */
  "/core": "/me",
  "/space": "/me",
  "/usage": "/me",
  "/data": "/me",
  "/system": "/me",
  "/profile": "/me",
  "/chat-settings": "/me",
  "/notify": "/me",
  "/voice-settings": "/me",
  "/privacy": "/me",
  "/about": "/me",

  // ── 四级：板块 / 设置项再往里一层 ──────────────────────────
  "/permissions": "/core",
  "/worldbook": "/core",
  "/memories": "/core",
  "/memory": "/usage",
  "/alarms": "/system",
  "/tasks": "/system",
  // 「开发与纠错」这一组搬进了 /about（原来指向 /system，退出时会先落回已下线的「系统」页 —— 用户 m04469 第 4 条）
  "/env": "/about",
};

/**
 * 设置那一屏的**八项**点进去的页。
 * 它们的上一级是「我的」整屏，但用户是在设置里点进去的，所以标签念作「返回设置」。
 */
const SETTINGS_CHILDREN = [
  "/profile",
  "/space",
  "/chat-settings",
  "/notify",
  "/voice-settings",
  "/privacy",
  "/about",
] as const;

/**
 * 成组的前缀规则 —— 省得为每个成员写一行。
 *
 * 只放"这一族都会长出新成员"的：加一个新插件 / 新编辑器 / 新房间，
 * 不用回来改这个文件。
 */
const PREFIX_PARENT: ReadonlyArray<readonly [string, string]> = [
  ["/play/plugins/", "/play/plugins"],
  ["/play/games/", "/play/games"],
  ["/play/tools/", "/play/tools"],
  ["/play/garden/", "/play/garden"],
  ["/tools/", "/tools"],
];

/** 顶级 tab（它们没有返回钮 —— 它们就是"首页"）。`/play` 已随玩乐区删掉（2026-11-18） */
export const ROOT_PATHS = ["/", "/tools", "/me"] as const;

/**
 * 这个页面的**上一级**在哪。返回 null 表示"这是首页，不该有返回钮"。
 *
 * 查找顺序：显式表 → 前缀族 → 兜底对话页。
 * 兜底是 `/` 而不是 `/me`：一级只有对话页，任何没登记的页退到首页最不吓人。
 */
export function parentOf(path: string): string | null {
  const p = normalize(path);
  if (p === "/") return null;

  const explicit = PARENT_OF[p];
  if (explicit) return explicit;

  for (const [prefix, parent] of PREFIX_PARENT) {
    if (p.startsWith(prefix)) return parent;
  }

  return "/";
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
  const p = normalize(path);

  /*
    顶级页分两种，这是**真 App 的规矩**（用户 2026-10 明确要求）：
      · `/`（对话首页）→ **退出 App**（"对话页面我侧滑屏幕才会退出 app"）
      · 其它 tab（工具/我的）→ **先回对话首页**，不退出
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
 *
 * 2026-10 加了两条：
 *   · `/play/plugins/` —— **具体某个插件**是整页铺满的（跟时感一样），
 *     但 **`/play/plugins` 这个目录本身不隐藏导航**（它还在 App 框架里，是个列表）。
 *     所以前缀比目录多一个斜杠，正好把两者分开。
 *   · `/play/plugins/edit` —— 插件的编辑器，跟工具区那几个编辑器一样要整屏。
 */
export const FULL_BLEED_PREFIXES = ["/play/", "/tools/", "/play/plugins/"] as const;

/**
 * 例外：**这些整段前缀下的某个路径，其实是"列表页"，要保留底部导航**。
 *
 * 起因是实测抓到的：`/play/plugins/` 这个前缀把**目录页自己**
 * （`/play/plugins`，注意最后没有斜杠）也算进去了 ——
 * 而"插件目录"是个列表页，用户还要靠底部导航去别的地方，隐藏它等于把人关在里面。
 * 真正该整屏的是**具体某个插件**（`/play/plugins/xxx`）。
 */
const KEEPS_NAV = ["/play/plugins"] as const;

/** 这个页面该不该隐藏底部导航。 */
export function hidesNav(path: string): boolean {
  const p = normalize(path);
  if ((KEEPS_NAV as readonly string[]).includes(p)) return false;
  return p === "/pet" || FULL_BLEED_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/**
 * 这个页面该不该显示返回钮。
 * 顶级 tab 不显示（它们是"首页"，没有上一级）。
 */
export function hasBackButton(path: string): boolean {
  return parentOf(path) !== null;
}

/** 给返回钮一个说人话的标签（无障碍 + 长按提示用） */
export function backLabelOf(path: string): string {
  const p = normalize(path);
  const parent = parentOf(p);
  if (!parent) return "返回";
  // 设置里点进去的页，退回的是「我的 / 设置」那一屏，说成「返回设置」才不误导
  if ((SETTINGS_CHILDREN as readonly string[]).includes(p)) return "返回设置";
  const names: Record<string, string> = {
    "/": "返回对话",
    "/me": "返回我的",
    "/core": "返回 AI 概览",
    "/space": "返回外观",
    "/usage": "返回模型与用量",
    "/data": "返回数据",
    "/system": "返回系统",
    "/about": "返回关于与高级",
    "/notify": "返回主动与通知",
    "/voice-settings": "返回语音",
    "/privacy": "返回隐私与数据",
    "/chat-settings": "返回对话设置",
    "/profile": "返回账号与资料",
    "/play/tools": "返回小日子",
    "/play/games": "返回小游戏",
    "/play/garden": "返回花园",
    "/play/garden/stagno": "返回池塘",
    "/play/listen": "返回音乐",
    "/play/space": "返回动态空间",
    "/play/plugins": "返回插件",
    "/play/learn": "返回学习",
    "/tools": "返回工具",
  };
  return names[parent] ?? "返回上一级";
}
