import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 选择块 —— `.k-opt`。
 *
 * 和 `KButton` 的区别：按钮是"做一个动作"，选择块是"我现在是哪一档"。
 * 所以它有 `active`（选中态：淡墨底 + 实线边 + 墨字），按钮没有。
 *
 * 为什么收成一个：材质、纸的颜色、正文字体、正文字号、文字颜色、星球颜色、
 * 配色预设 —— 这七样原来各写各的（圆角方块 / 粉底胶囊 / 描边胶囊），
 * 一页里能出现三种长相。收进来之后，"选一项"在全 App 只有一个样子。
 *
 * 两行的用 `tall`（字体那种"名字 + 一句说明"）；带色点的传 `dot`。
 */
export function KOpt({
  active,
  dot,
  sub,
  tall,
  className,
  type = "button",
  children,
  ...rest
}: ComponentProps<"button"> & {
  /** 选中态 */
  active?: boolean;
  /** 左侧小色点：传任何 CSS 颜色（`linear-gradient(...)` 也行） */
  dot?: string;
  /** 第二行小字（字体的说明、字号的 px） */
  sub?: ReactNode;
  /** 两行款：靠左排 */
  tall?: boolean;
}) {
  return (
    <button
      type={type}
      // 只写「选中」这一种状态：没选中就是 `.k-opt` 的默认样子
      data-active={active ? "true" : undefined}
      className={cn("k-opt", tall && "k-opt--tall", className)}
      {...rest}
    >
      {dot !== undefined && (
        <span className="k-opt__dot" style={{ background: dot }} aria-hidden="true" />
      )}
      <span>{children}</span>
      {sub !== undefined && <span className="k-opt__sub">{sub}</span>}
    </button>
  );
}

/**
 * 选择块的排列框 —— `.k-opts`。
 *
 * `cols` 给数字就是等分网格，给 `"wrap"` 就是按内容宽度自动换行
 * （星球色、文字颜色这种长短不一的用它）。
 */
export function KOpts({
  cols = 2,
  className,
  children,
}: {
  cols?: 2 | 3 | 4 | "wrap";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div data-cols={cols} className={cn("k-opts", className)}>
      {children}
    </div>
  );
}
