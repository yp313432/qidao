import { MessageCircle, Puzzle, Sparkles, UserRound } from "lucide-react";

/**
 * 主导航的四个入口 —— **全 App 唯一一份定义**。
 *
 * 用户的要求："上面留对话列表，下面显示导航栏"。
 *
 * ── 这里为什么带归属表 ────────────────────────────────────────
 * 高亮**不是**拿路径前缀比。二级页都是**平级路径**
 * （`/core` `/space` `/permissions` …，不带 `/me`），前缀法会让它们
 * 点进去之后**四个 tab 一个都不亮**，看起来像掉出了 App。
 * 示例图里这些页面的「我的」是保持亮着的。
 *
 * 所以二级页要在 `TAB_OWNED_PATHS` 里登记归属。新增二级页时**记得补一行**。
 */
export const MAIN_TABS = [
  { to: "/", label: "对话", icon: MessageCircle },
  { to: "/tools", label: "工具", icon: Puzzle },
  { to: "/play", label: "玩乐", icon: Sparkles },
  { to: "/me", label: "我的", icon: UserRound },
] as const;

/** 二级页 → 它父级 tab。 */
export const TAB_OWNED_PATHS: Record<string, string[]> = {
  "/me": [
    "/core",
    "/space",
    "/usage",
    "/data",
    "/system",
    "/permissions",
    "/worldbook",
    "/inner",
    "/memories",
    "/memory",
    "/env",
    /*
      ⚠️ /alarms 和 /tasks 从这份表里**拿掉了** ——
      它们已经挪到「玩乐 → 小日子」下面，路径变成
      /play/tools/alarms 和 /play/tools/tasks，
      前缀比对（/play/...）自然就归到「玩乐」了，不需要在这里登记。
      留在这里反而会让高亮走错 tab。
    */
  ],
};

/**
 * 这个路径属于哪个 tab（找不到返回 null）。
 *
 * 对话页的抽屉底部原来自己写了一套前缀比较 —— 于是抽屉里的高亮和漂浮导航
 * 会不一样。现在两边都走这里，永远一致。
 */
export function tabOwning(pathname: string): string | null {
  for (const tab of MAIN_TABS) {
    if (tab.to === "/" ? pathname === "/" : pathname === tab.to || pathname.startsWith(`${tab.to}/`)) {
      return tab.to;
    }
  }
  for (const [tabTo, owned] of Object.entries(TAB_OWNED_PATHS)) {
    for (const p of owned) {
      if (pathname === p || pathname.startsWith(`${p}/`)) return tabTo;
    }
  }
  return null;
}
