import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * 按钮 —— `.k-btn`（含 `--primary` / `--dashed` / `--block` 三个变体）。
 *
 * 三档的差别只在变量里：纯色模式是 2px 墨框 + 4px 硬位移阴影，按下位移 3px；
 * 磨砂/液态是圆角胶囊 + 柔和阴影。所以这里不写任何颜色，只拼类名。
 *
 * `variant="dashed"` 专给"添加类"动作用（原来是「添加接口」那种虚线按钮）。
 */
export function KButton({
  variant = "default",
  block,
  className,
  type = "button",
  ...rest
}: ComponentProps<"button"> & {
  variant?: "default" | "primary" | "dashed" | "icon";
  /** 撑满一行 */
  block?: boolean;
}) {
  return (
    <button
      type={type}
      className={cn(
        "k-btn",
        variant === "primary" && "k-btn--primary",
        variant === "dashed" && "k-btn--dashed",
        variant === "icon" && "k-btn--icon",
        block && "k-btn--block",
        className,
      )}
      {...rest}
    />
  );
}
