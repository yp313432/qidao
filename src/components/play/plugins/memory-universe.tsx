"use client";

import { useMemo } from "react";
import { MemoryUniverse } from "@/plugins/memory-universe/index";
import { toUniverse } from "@/plugins/memory-universe/adapter/qidao-memory";
import { useApp } from "@/lib/store";

/**
 * **记忆宇宙**（原生型插件）—— 把 `src/plugins/memory-universe/` 那个星图直接渲染进来。
 *
 * 用户拍板的两件事：
 *   · **走 B**（原生，不是 iframe）：所以它能**直接读栖岛本地的记忆**，不用喂数据
 *   · **UI 和设计一个像素都不动**：插件目录里的组件 / 引擎 / CSS
 *     跟 Grok 产出的原版**逐字节一致**（`verify-plugin-untouched.mjs` 会盯这件事）。
 *     这一页只负责"外壳"：整页铺满 + 把真数据算好传进去。
 *
 * 数据怎么来的：`adapter/qidao-memory.ts` 的 `toUniverse()` ——
 * 星的浓淡 = strength+confidence、连线 = links+共同标签、
 * 记忆形成 = createdAt / recallCount / lastRecalledAt / lastConfirmedAt。
 * **拿不到的字段不编**（星图那边对缺字段有兜底）。
 */
export function MemoryUniversePluginView() {
  const memories = useApp((s) => s.memories);
  /** 占位数据：库里一条记忆都没有时，星图总得有点东西看（插件自带的那份示例） */
  const data = useMemo(() => toUniverse(memories ?? []), [memories]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/*
        星图本体 —— 用它的 className 加一层"撑满"（`.memory-universe` 自己已经是
        absolute 铺满 + min-height:100dvh，所以这里只是保证父容器有高度）。
      */}
      <MemoryUniverse
        memories={data.memories}
        relationships={data.relationships}
        className="min-h-0 flex-1"
      />

      {/*
        ⚠️ 这里**不再**叠悬浮返回钮了（用户 2026-11：「把返回键也放到左上角统一一下」）。
        以前那个在右下角 —— 因为左上角被题字占着，没地方放。
        现在题字挪到画面下方去了，左上角空出来，返回键就长进了插件自己的页头
        （`UniverseChrome` 的 `.mu-chrome-top` 第一个子元素）：它天然吃那 24px 边距和
        安全区，跟情绪页、插件外壳的按钮是同一套尺寸与底色。
        留在这里会变成第二个按钮，既重复又挡内容。
      */}
    </div>
  );
}
