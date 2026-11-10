import { useEffect, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { requestDrawer } from "@/lib/drawer-request";
import { registerPageHeader } from "@/lib/header-registry";
import { materialOf } from "@/lib/material";
import { backLabelOf, parentOf } from "@/lib/nav-tree";
import { useApp } from "@/lib/store";

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
 *
 * ── 液态下的箭头（用户 m03354 / m03470）─────────────────────────
 * 跟 `PageHeader` 一样：这里自己画那颗裸箭头，不再指望 app-shell 在页面外面
 * 绝对定位补一颗 —— 那种做法标题一滚走就跟箭头叠在一起，而且各页对不齐。
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
  const liquid = useApp((s) => materialOf(s.settings) === "liquid");
  const target = backTo ?? parentOf(pathname, liquid) ?? (liquid ? "/" : "/play");
  const label = backLabel ?? backLabelOf(pathname, liquid);

  // 告诉 app-shell：这一页自己有页头，别再补兜底箭头
  useEffect(() => registerPageHeader(), []);

  return (
    <header className={liquid ? "lq-head px-4" : "inset-top-60 flex items-center gap-1 px-2 pb-1"}>
      <div className={liquid ? "flex items-center gap-3" : "contents"}>
        <Link
          to={target as never}
          aria-label={label}
          className={
            liquid ? "lq-back lq-back--inline" : "flex size-11 items-center justify-center"
          }
          onClick={() => {
            // 用户 m03470：退回对话页时把侧边栏一起拉开
            if (liquid && target === "/") requestDrawer();
          }}
        >
          <ChevronLeft className={liquid ? undefined : "size-6"} strokeWidth={liquid ? 1.5 : 1.6} />
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-serif text-lg font-medium">{title}</h1>
        {extra}
      </div>
    </header>
  );
}
