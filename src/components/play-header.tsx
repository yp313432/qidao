import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { backLabelOf, parentOf } from "@/lib/nav-tree";

/**
 * 玩乐区各页统一的顶部：返回 + 标题 +（可选）右边一个动作。
 *
 * 跟 `PageHeader` 是**同一个规格**（size-11 按钮 / size-6 图标 / strokeWidth 1.6 /
 * font-serif text-lg），只是默认字体职责不同（玩乐区顶上没有 safe-area 之外的区别）。
 *
 * ── 返回目标同样从层级表读 ─────────────────────────────────────
 * 用户："所有的返回都要是返回上一级"。
 * 所以这里**不再写死 `backTo = "/play"`** ——
 * 那个默认值正是 `/play/gobang` 退回玩乐首页（而不是小日子）的原因。
 * 现在不传 backTo 就自动按 nav-tree 算：/play/gobang → /play/tools。
 */
export function PlayHeader({
  title,
  extra,
  backTo,
  backLabel,
}: {
  title: string;
  extra?: ReactNode;
  /** 不传（推荐）= 自动回上一级；只有确实要跳别处才显式传 */
  backTo?: string;
  backLabel?: string;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const target = backTo ?? parentOf(pathname) ?? "/play";
  const label = backLabel ?? backLabelOf(pathname);

  return (
    <header className="flex items-center gap-1 px-2 pt-[max(0.6rem,env(safe-area-inset-top))] pb-1">
      <Link to={target} aria-label={label} className="flex size-11 items-center justify-center">
        <ChevronLeft className="size-6" strokeWidth={1.6} />
      </Link>
      <h1 className="flex-1 font-serif text-lg font-medium">{title}</h1>
      {extra}
    </header>
  );
}
