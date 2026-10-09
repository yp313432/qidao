/**
 * 「插件」—— 玩乐区里的一个区，**一个目录装所有插件**。
 *
 * 用户的原话（这轮的需求）：
 *   "换到玩乐区不是有时感吗，他和时感组成一个插件类别，然后点开是这两个插件，
 *    以后我如果有新加的插件也放里面……有一个单独的插件区……点进去写上地址和名字，
 *    就能插进去了，可以做成这种吗"
 *
 * ── 两种插件（一套目录）──────────────────────────────────────────
 *
 *   · `iframe` —— **填名字 + 地址**就能插（跟时感一模一样：整页铺满、返回钮、无底部导航）。
 *     这类插件**不碰栖岛代码**，用户自己就能加。
 *   · `native` —— 真代码搬进仓库（记忆宇宙就是这种），能读栖岛本地数据、
 *     手势和返回跟栖岛一套。
 *
 * ── 一个必须说清的边界（别让用户以为"随便粘个网址就行"）──────────
 *
 * 一个网页**能不能嵌进来，取决于对方有没有禁止被嵌**
 * （`X-Frame-Options` / CSP `frame-ancestors`）。而浏览器**不允许跨域读响应头**，
 * 所以"填地址的时候"根本查不出来能不能嵌。
 *
 * 所以规矩是：**先试着嵌，嵌不上就明说 + 给一个"用浏览器打开"的按钮**，
 * 绝不丢给用户一个白屏让他猜（见 `plugin-frame` 组件）。
 *
 * 自己做的网页**基本都能嵌**（两条路：打进栖岛的文件里 = 绝对能嵌；放自己服务器 = 加一句响应头）。
 */

export type PluginKind = "iframe" | "native";

/** 一个插件在目录里的样子 */
export type PluginEntry = {
  id: string;
  name: string;
  /** 一行小字（卡片上显示的说明） */
  hint: string;
  kind: PluginKind;
  /** iframe 型：要打开的地址；留空 = 用打进包里的本地副本（时感就是这样） */
  url?: string;
  /** 目录里的路由（`/play/plugins/xxx`） */
  slug: string;
  /** 用户自己加的（能改、能删）；内置的不能删 */
  custom?: boolean;
  /** 关掉的插件在列表里灰掉、点不进去 */
  enabled?: boolean;
};

import type { CustomPlugin } from "@/lib/types";

export type { CustomPlugin };

/* ─────────────────── 内置插件（写在代码里的三个） ─────────────────── */

export const BUILTIN_PLUGINS: PluginEntry[] = [
  {
    id: "plugin_shigan",
    name: "时感",
    hint: "整页铺满的那个网页",
    kind: "iframe",
    /**
     * 地址留空的语义 = "用打进包里的那份副本"（`public/shigan/index.html`）。
     * 用户想指到别处（比如局域网另一台机器）就在插件编辑器里填 ——
     * 原来那个设置项在「我的 → 我的空间 → 时感地址」，现在**归到这里**了
     * （插件的事在插件里管，设置页不再重复一份）。
     */
    url: "",
    slug: "shigan",
  },
  {
    id: "plugin_memory",
    name: "记忆宇宙",
    hint: "你的记忆连成一片星空",
    kind: "native",
    slug: "memory",
  },
  {
    /**
     * 星屿（2026-10 从独立工程搬进来，原生型）。
     * 源码在 `src/plugins/emotion-lifeform/`，外壳页是
     * `src/components/play/plugins/emotion-lifeform.tsx`，路由
     * `src/routes/_app/play/plugins/emotion.tsx`。
     * 层级 / 整屏规则由 `nav-tree.ts` 的**前缀表**覆盖，这里不用再写路径。
     */
    id: "plugin_emotion",
    name: "星屿",
    hint: "把对话里的情绪画成一个活的灵体",
    kind: "native",
    slug: "emotion",
  },
];

/** 自建插件 → 目录条目 */
export function customToEntry(p: CustomPlugin): PluginEntry {
  return {
    id: p.id,
    name: p.name,
    hint: p.hint || "自己加的插件",
    kind: "iframe",
    url: p.url,
    slug: `c_${p.id}`,
    custom: true,
    enabled: p.enabled,
  };
}

/** 目录 = 内置 + 自建（自建的排在后面） */
export function catalogOf(customs: CustomPlugin[] | undefined): PluginEntry[] {
  return [...BUILTIN_PLUGINS, ...(customs ?? []).map(customToEntry)];
}

/** 按 slug 找一个插件（找不到返回 null） */
export function pluginBySlug(customs: CustomPlugin[] | undefined, slug: string): PluginEntry | null {
  return catalogOf(customs).find((p) => p.slug === slug) ?? null;
}

/** 一个插件该打哪个地址（iframe 型）—— 留空就用本地副本 */
export function iframeSrcOf(plugin: PluginEntry, localFallback: string): string {
  const raw = (plugin.url ?? "").trim() || localFallback;
  // .html 结尾的本地路径别补斜杠（会变成 xxx/index.html/ 打不开）
  return /\.html?$/i.test(raw) ? raw : raw.replace(/\/?$/, "/");
}
