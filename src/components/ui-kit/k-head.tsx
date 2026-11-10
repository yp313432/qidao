import { useEffect, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { requestDrawer } from "@/lib/drawer-request";
import { registerPageHeader } from "@/lib/header-registry";
import { materialOf } from "@/lib/material";
import { backLabelOf, parentOf } from "@/lib/nav-tree";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * 页面/分区标题 —— `.k-head`。
 *
 * 标题左、附注右（附注是等宽大写字，纯色模式下的"工程图纸"味就靠它）。
 * 字号取 `var(--k-t-6)`（25px）而不是 24px：三套模式共用同一把尺子，
 * 改字号只改 tokens。
 *
 * ── 液态下的返回键（用户 m03679 第 4 条）────────────────────────────
 * 用户原话："工具插件点进去，返回键跟工具没有对齐。"
 * 原因：全 App 的二级页都走 `PageHeader`（箭头跟标题同在一个 `<header>` 里、
 * 一起滚），但「工具」页（`components/views/tools-view.tsx`）用的是这块老的
 * `KHead` —— 它没有箭头，箭头全靠 app-shell 那颗绝对定位的兜底 `.lq-back`，
 * 于是位置是"钉"出来的、对不齐，下滑也不跟着走。
 * 现在 KHead 自己也长一颗行内箭头（只在液态），几何跟 `PageHeader` 完全一样：
 * 箭头 26 / 与标题间距 12 / 带高 64 + 安全区 / 标题 23px（见 glass.css 的
 * `.lq-head-row`）。这样「工具」页不用换组件就能跟其它页站在同一条线上。
 */
export function KHead({
  title,
  kicker,
  meta,
  action,
  className,
}: {
  title: ReactNode;
  /** 标题上方那行小字（「功能区」「对话」这种分区名） */
  kicker?: ReactNode;
  /** 右侧小字：数量、日期、"共 12 项" */
  meta?: ReactNode;
  /** 右侧动作（比如一个「添加」按钮），优先于 meta */
  action?: ReactNode;
  className?: string;
}) {
  const liquid = useApp((s) => materialOf(s.settings) === "liquid");
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const target = parentOf(pathname, liquid) ?? (liquid ? "/" : "/me");
  const label = backLabelOf(pathname, liquid);

  // 有页头就不让 app-shell 再补那颗兜底箭头（否则一页两颗）
  useEffect(() => (liquid ? registerPageHeader() : undefined), [liquid]);

  return (
    <div className={cn("k-head", liquid && "lq-head-row", className)}>
      {liquid && (
        <Link
          to={target as never}
          aria-label={label}
          className="lq-back lq-back--inline"
          onClick={() => {
            if (target === "/") requestDrawer();
          }}
        >
          <ChevronLeft strokeWidth={1.5} />
        </Link>
      )}
      <div className="k-head__main">
        {kicker !== undefined && <span className="k-head__kicker">{kicker}</span>}
        <h2 className="k-head__title">{title}</h2>
      </div>
      {action ?? (meta !== undefined ? <span className="k-head__meta">{meta}</span> : null)}
    </div>
  );
}
