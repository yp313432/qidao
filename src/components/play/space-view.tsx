import { Link } from "@tanstack/react-router";
import { BookHeart, ChevronRight, Mail, NotebookPen } from "lucide-react";
import { SceneBackdrop } from "@/components/background-layer";
import { PlayHeader } from "@/components/play-header";
import { useApp } from "@/lib/store";

/**
 * 动态空间 —— 现在是**目录**，不是三个页签。
 *
 * ── 为什么改（2026-10，用户定的）──────────────────────────────────
 * 用户："动态/日记/信 做成插件二级页，点「动态」进朋友圈。"
 * 所以原来那一排页签拆成了三张**整页铺满的二级页**：
 *
 *   动态  → /play/space/moments  朋友圈（发一条、点赞、评论）
 *   日记  → /play/space/diary    便签墙（里面跟原来一模一样）
 *   信    → /play/space/letters  拆信（里面跟原来一模一样）
 *
 * 层级关系写在 `lib/nav-tree.ts` 一处（三页的上一级都是这一页），
 * 所以页内返回钮和安卓系统返回键都自动回到这里 —— 不用手写返回目标。
 *
 * 样式照 §3.1「入口卡」那套（图标 + 标题 + 一行小字 + 箭头），
 * 跟插件目录 / 小日子是同一份写法，不新造第五套。
 */
export function SpaceView() {
  const settings = useApp((s) => s.settings);
  const moments = useApp((s) => s.moments);
  const diary = useApp((s) => s.diary);
  const letters = useApp((s) => s.letters);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SceneBackdrop image={settings.diaryImage} />
      <PlayHeader title="动态空间" />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <p className="text-center text-[10px] tracking-[0.28em] text-subtle uppercase">
          how are you feeling, right now
        </p>
        <p className="mt-2 px-2 text-center text-[12px] leading-5 text-muted">
          写下来的都留在这里。
        </p>

        <ul className="mt-4 space-y-2.5">
          <Entry
            to="/play/space/moments"
            title="动态"
            hint={moments.length > 0 ? `朋友圈 · ${moments.length} 条` : "朋友圈：发一条、点赞、评论"}
            icon={<BookHeart className="size-[1.15rem] text-accent" strokeWidth={1.7} aria-hidden="true" />}
          />
          <Entry
            to="/play/space/diary"
            title="日记"
            hint={diary.length > 0 ? `共 ${diary.length} 篇` : "一天至少给自己留一篇"}
            icon={<NotebookPen className="size-[1.15rem] text-accent" strokeWidth={1.7} aria-hidden="true" />}
          />
          <Entry
            to="/play/space/letters"
            title="信"
            hint={letters.length > 0 ? `共 ${letters.length} 封` : "他写给你的信"}
            icon={<Mail className="size-[1.15rem] text-accent" strokeWidth={1.7} aria-hidden="true" />}
          />
        </ul>

        <p className="mt-10 text-center text-[10px] tracking-[0.28em] text-subtle uppercase">
          one thing at a time
        </p>
      </div>
    </div>
  );
}

/** 一张入口卡 —— 跟插件目录 / 玩乐首页同一个写法（§3.1） */
function Entry({
  to,
  title,
  hint,
  icon,
}: {
  to: string;
  title: string;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <li>
      <Link
        to={to as never}
        className="flex items-center gap-3 rounded-3xl border border-line bg-elevated px-4 py-3.5"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-line bg-chip">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-[15px]">{title}</span>
          <span className="mt-1 block text-[11px] leading-4 text-subtle">{hint}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
      </Link>
    </li>
  );
}
