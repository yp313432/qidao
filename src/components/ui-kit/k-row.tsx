import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 列表行 —— `.k-row`，整个 app 的主力组件（原来的 `.tool-card` 就是它）。
 *
 * 一行 = 序号 + 标题 + 副信息 + 右侧尾巴（开关/标签/箭头）。
 *
 * 传了 `onClick` 就渲染成 `<button>`（可点、有按下位移、能聚焦）；
 * 不传就渲染成 `<div>` —— 别给不可点的地方加 onClick，
 * 手机的点击热区和滚动会在那 300ms 里打架。
 *
 * `off` 只是把字压灰（`data-off`），不改配色：改了配色就得为四套纸色各写一遍。
 */
export function KRow({
  index,
  title,
  meta,
  trailing,
  onClick,
  off,
  className,
}: {
  /** 左侧序号（等宽字，两位内最好）。不传就不占位。 */
  index?: ReactNode;
  title: ReactNode;
  /** 标题下那行小字：时间、次数、状态 */
  meta?: ReactNode;
  /** 右侧尾巴：开关、标签、箭头 */
  trailing?: ReactNode;
  onClick?: () => void;
  /** 停用/关闭态：只压信息 */
  off?: boolean;
  className?: string;
}) {
  const body = (
    <>
      {index !== undefined && <span className="k-row__idx">{index}</span>}
      <span className="k-row__body">
        <span className="k-row__title">{title}</span>
        {meta !== undefined && <span className="k-row__meta">{meta}</span>}
      </span>
      {trailing}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-off={off ? "true" : undefined}
        className={cn("k-row", className)}
      >
        {body}
      </button>
    );
  }

  return (
    <div data-off={off ? "true" : undefined} className={cn("k-row", className)}>
      {body}
    </div>
  );
}
