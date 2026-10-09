"use client";

import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { EmotionApp } from "@/plugins/emotion-lifeform/components/app/EmotionApp";
import { toEmotionEvents } from "@/plugins/emotion-lifeform/lib/emotion/qidao-scenes";
import { useApp } from "@/lib/store";
/* 插件自带的那套主题令牌（收在 `.emotion-lifeform` 作用域里，见文件头注释） */
import "@/plugins/emotion-lifeform/emotion-lifeform.css";

/**
 * **星屿**（原生型插件）—— 把 `src/plugins/emotion-lifeform/` 里的
 * `EmotionApp` 整屏渲染进来（原本是独立工程，2026-10 搬进栖岛）。
 *
 * 搬运的纪律跟记忆宇宙那次一样：
 *   · 插件内部的组件 / 画布 / CSS **一个字节都没改**，唯一的例外是
 *     `lib/store.ts` 里"减弱动态听谁的"那一处判断
 *     （规则：`qidao-docs/规则-插件的动效要听宿主的.md`）
 *   · 这一页只负责"外壳"：给它一块能滚的地方 + 一个返回钮
 *
 * ── 两处跟记忆宇宙不一样的地方，都是**宿主结构**逼出来的，不是设计 ──
 *
 *   ① **要有一层滚动容器**。记忆宇宙的画布是 `absolute inset-0`（自己不滚），
 *      而星屿原来整页应用是**文档在滚**（画布 320px + 下面很长的面板）。
 *      栖岛的 AppShell 是 `h-dvh overflow-hidden`（它自己的注释说过为什么），
 *      所以这里必须补一个 `overflow-y-auto` 的框，否则下面几屏会被直接裁掉。
 *
 *   ② **`.emotion-lifeform` 上有 `contain: paint`**（见 emotion-lifeform.css）。
 *      它自带的底部五项导航是 `fixed` —— 独立跑的时候那是"屏幕底部"；
 *      住进栖岛 `max-w-lg` 的手机宽栏目后，得让它以**这一屏**为准，
 *      否则在宽屏上那条导航会横穿整个窗口。`contain: paint` 正好把这个壳
 *      变成 `fixed` 的包含块 = 还原它原来的位置。
 *
 * 返回钮的位置：插件自己那条底部导航占掉 `safe-area + 3.5rem`（min-h-14），
 * 所以按钮放在它**上面**（`+4.5rem`）靠右，一个字都不挡；
 * `z-20` 跟记忆宇宙那一页同一个值（插件内部浮层是 z-2~5）。
 */
export function EmotionLifeformPluginView() {
  const navigate = useNavigate();
  /**
   * **真数据是这里喂进去的**（跟记忆宇宙那一页同一个套路）：
   * 宿主 store 里 `emotionEvents`（AI 用 `emotion.report` 上报的，见 `lib/actions.ts`）
   * → `qidao-scenes.ts` 映射成插件要的 `EmotionEvent`（0~1 → 0~100 之类的换算在那一层）
   * → 交给 `EmotionApp` 的 `realScenes`。
   *
   * 一条都没有时传空数组：插件那边会**回落它自带的 10 个模拟场景**，不会白屏。
   * `emotionEvents` 加了 `?? []` 是防老存档（那个字段是后加的）。
   */
  const emotionEvents = useApp((s) => s.emotionEvents);
  const realScenes = useMemo(() => toEmotionEvents(emotionEvents ?? []), [emotionEvents]);

  return (
    <div className="emotion-lifeform flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 插件本体（未改动）。外面这层只负责给它一个能滚的高度 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EmotionApp realScenes={realScenes} />
      </div>

      {/* 本页唯一加在插件外面的东西：返回钮 */}
      <button
        type="button"
        aria-label="返回插件"
        onClick={() => {
          if (window.history.length > 1) window.history.back();
          else void navigate({ to: "/play/plugins" });
        }}
        className="absolute right-3 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-20 flex size-8 items-center justify-center rounded-full bg-white/10 text-[#e6e1d6] backdrop-blur-sm active:bg-white/20"
      >
        <ChevronLeft className="size-4" strokeWidth={2} />
      </button>
    </div>
  );
}
