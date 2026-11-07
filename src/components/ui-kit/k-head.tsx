import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 页面/分区标题 —— `.k-head`。
 *
 * 标题左、附注右（附注是等宽大写字，纯色模式下的"工程图纸"味就靠它）。
 * 字号取 `var(--k-t-6)`（25px）而不是 24px：三套模式共用同一把尺子，
 * 改字号只改 tokens。
 */
export function KHead({
  title,
  meta,
  action,
  className,
}: {
  title: ReactNode;
  /** 右侧小字：数量、日期、"共 12 项" */
  meta?: ReactNode;
  /** 右侧动作（比如一个「添加」按钮），优先于 meta */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("k-head", className)}>
      <h2 className="k-head__title">{title}</h2>
      {action ?? (meta !== undefined ? <span className="k-head__meta">{meta}</span> : null)}
    </div>
  );
}
