import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

/**
 * 二级页统一的顶部：左上角返回 + 标题 +（可选）右边一个动作。
 *
 * ── 为什么必须有这个文件 ──────────────────────────────────────
 * 用户的原话："重要的是我现在要统一一下这个 APP 的整体风格和框架，
 * 不要每一个页面一个风格那种，很乱。"
 *
 * 之前"返回 + 标题"这一个零件，全 App 有 **5 套写法**：
 *   A. alarms / env / inner / memory / permissions / tasks / worldbook /
 *      memory-library —— size-11 按钮 + 图标 size-6 + strokeWidth 1.6
 *   B. 「我的」拆出来的 /space /usage /data /system —— size-9 + size-4
 *   C. /core（AI 概览）—— size-9 + size-4，而且是**反着旋转**的 ChevronRight
 *   D. play-header.tsx —— size-6
 *   E. voice-view.tsx —— size-6，连 aria-label 都不一样
 *
 * 同一个"返回"按钮五种尺寸，就是"很乱"的根源。现在全部走这里，
 * 以后新增二级页照抄 `PageHeader`，不会再长出第六套。
 *
 * 规格固定为（A 组那套，因为用它的页面最多、改动面最小）：
 *   · 容器  flex items-center gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1
 *   · 返回  size-11 的圆形按钮，图标 size-6 / strokeWidth 1.6
 *   · 标题  font-serif text-lg font-medium
 *   · 右边  任意节点（动作按钮 / 一行状态），会自己撑开剩余宽度
 */
export function PageHeader({
  title,
  to = "/me",
  backLabel = "返回",
  right,
  description,
}: {
  title: string;
  /** 返回去哪儿。默认回「我的」。 */
  to?: string;
  backLabel?: string;
  /** 标题右边的东西：动作按钮、计数、状态文字…… 不传就只有标题 */
  right?: ReactNode;
  /** 标题下面那行小字。标题跟着页面滚，所以这里也不吸顶。 */
  description?: string;
}) {
  return (
    <header className="px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1">
      <div className="flex items-center gap-1">
        <Link
          to={to as never}
          aria-label={backLabel}
          className="flex size-11 shrink-0 items-center justify-center"
        >
          <ChevronLeft className="size-6" strokeWidth={1.6} />
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-serif text-lg font-medium">{title}</h1>
        {right}
      </div>
      {description && (
        <p className="px-3 pb-1 text-[11px] leading-4 text-subtle">{description}</p>
      )}
    </header>
  );
}
