import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 容器卡片 —— `.k-card`。
 *
 * 和 `.k-row` 的区别：卡片装内容、不响应手指；行是可点的，带按下位移。
 * 别拿卡片当按钮用 —— 那样按下没反馈，用户会以为没点上。
 */
export function KCard({
  children,
  open,
  className,
}: {
  children: ReactNode;
  /** 可展开卡片：`true` 时里面的 `.k-chev` 折角会翻过来 */
  open?: boolean;
  className?: string;
}) {
  return (
    <div data-open={open ? "true" : undefined} className={cn("k-card", className)}>
      {children}
    </div>
  );
}
