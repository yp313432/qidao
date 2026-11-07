import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * 输入框 —— `.k-input`。
 *
 * 高度取 `var(--k-tap)`（44px）保证触控够大，字号取 `var(--k-t-3)`（15px）
 * —— 手机上再小就要双击放大。边框粗细/圆角/底色全由模式变量给：
 * 纯色是 2px 墨框方角，磨砂是 1px 细线大圆角。
 */
export function KInput({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cn("k-input", className)} {...rest} />;
}
