import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 空态 —— `.k-empty`。
 *
 * 空列表不要只留一片白：给一句"为什么空"和下一步动作，
 * 否则用户会以为加载失败。
 */
export function KEmpty({
  title,
  hint,
  action,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  /** 下一步动作（通常是 KButton） */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("k-empty", className)}>
      <span>{title}</span>
      {hint !== undefined && <span>{hint}</span>}
      {action}
    </div>
  );
}
