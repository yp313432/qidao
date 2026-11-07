import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 标签 —— `.k-chip`。
 *
 * `tone="outline"` 是描边款（用 `inset box-shadow` 画，不占布局尺寸，
 * 所以实心款和描边款并排时高度一致，不会错位）。
 */
export function KChip({
  tone = "solid",
  children,
  className,
}: {
  tone?: "solid" | "outline";
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn("k-chip", className)}
      data-tone={tone === "outline" ? "outline" : undefined}
    >
      {children}
    </span>
  );
}
