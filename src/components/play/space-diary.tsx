import { SceneBackdrop } from "@/components/background-layer";
import { PlayHeader } from "@/components/play-header";
import { DiaryWall } from "@/components/play/diary-view";
import { useApp } from "@/lib/store";

/**
 * 日记 —— 「玩乐 → 动态空间 → 日记」那一页。
 *
 * ── 为什么从"页签"搬成一整页（2026-10，用户定的）──────────────────
 * 用户要的是"动态/日记/信 做成插件二级页"：三样各有各的一整页（整页铺满、
 * 左上角返回、没有底部导航），动态空间本身只当一个**目录**。
 *
 * ⚠️ 日记**里面的样子一点没动** —— 便签墙、展开动画、心情选择器都还是原来那套
 * （用户没让改日记）。这里只负责"给它一整页"：背景图 + 顶部 + 滚动区。
 */
export function DiaryPage() {
  const settings = useApp((s) => s.settings);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SceneBackdrop image={settings.diaryImage} />
      <PlayHeader title="日记" />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <DiaryWall />

        <p className="mt-10 text-center text-[10px] tracking-[0.28em] text-subtle uppercase">
          put it down before it fades
        </p>
      </div>
    </div>
  );
}
