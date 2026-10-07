"use client";

import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { MemoryUniverse } from "@/plugins/memory-universe";
import { toUniverse } from "@/plugins/memory-universe/adapter/qidao-memory";
import { useApp } from "@/lib/store";

/**
 * **记忆宇宙**（原生型插件）—— 把 `src/plugins/memory-universe/` 那个星图直接渲染进来。
 *
 * 用户拍板的两件事：
 *   · **走 B**（原生，不是 iframe）：所以它能**直接读栖岛本地的记忆**，不用喂数据
 *   · **UI 和设计一个像素都不动**：插件目录里的组件 / 引擎 / CSS
 *     跟 Grok 产出的原版**逐字节一致**（`verify-plugin-untouched.mjs` 会盯这件事）。
 *     这一页只负责"外壳"：整页铺满 + 一个返回钮 + 把真数据算好传进去。
 *
 * 数据怎么来的：`adapter/qidao-memory.ts` 的 `toUniverse()` ——
 * 星的浓淡 = strength+confidence、连线 = links+共同标签、
 * 记忆形成 = createdAt / recallCount / lastRecalledAt / lastConfirmedAt。
 * **拿不到的字段不编**（星图那边对缺字段有兜底）。
 */
export function MemoryUniversePluginView() {
  const navigate = useNavigate();
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
        返回钮。**这是本页唯一加在插件外面的东西**（插件内部一个像素没动）：
        整页铺满时用户无路可退 —— 真机实测过"没做返回键，按系统返回直接退出 App"。

        ⚠️ 位置是**量出来**的，别随手改（前两版都压住了插件自己的字）：
        · 插件顶部 `padding: max(20px, 安全区) 24px 0`，品牌小字占 20~35px、
          标题「记忆宇宙」占约 30~62px —— 左上角那一块**没有空位**
          （放 8px 压小字、放 44px 压标题，20~62px 全被占）。
        · 插件底部只有那两行诗句（约最后 60px），**上面一大片是空的**。
        所以按钮放**右下角**、诗句上方一点：一个字都不挡（用户拍板的选择）。

        ⚠️ z-index 要 ≥ 20：插件内部浮层是 z-index 2~5、详情面板更高，
        低于它们的话按钮会被压在下面点不到。
      */}
      <button
        type="button"
        aria-label="返回插件"
        onClick={() => {
          if (window.history.length > 1) window.history.back();
          else void navigate({ to: "/play/plugins" });
        }}
        className="absolute right-3 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-20 flex size-8 items-center justify-center rounded-full bg-white/10 text-[#e6e1d6] backdrop-blur-sm active:bg-white/20"
      >
        <ChevronLeft className="size-4" strokeWidth={2} />
      </button>
    </div>
  );
}
