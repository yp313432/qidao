import { useState, type ComponentProps, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { KCard } from "./k-card";

/**
 * 可展开卡片 —— `.k-card` + `.k-card__head/__toggle/__body` + `.k-chev`。
 *
 * 设置页那种「一行标题 + 副信息 + 点开才展开」的卡片，全都长这样；
 * 工具页的三种列表也是同一副骨架。收进标准件的原因很实在：
 * 手写一遍要 20 行，六个卡片就是 120 行 —— 而且每写一遍都能多出一个小差异。
 *
 * `trailing` 放"不在热区里的东西"（比如开关）：它挂在标题按钮**外面**，
 * 点开关不会连带展开 —— 工具页那排"启用"开关就是踩过这个坑之后这么放进的。
 *
 * 受控 / 非受控两种用法都行：
 *   · 传了 `open` + `onToggle` → 受控（外观页那六张卡要一次只开一张，必须受控）
 *   · 谁都不传，或只传 `defaultOpen` → 自己管开合（`/profile` 这种单卡页面就省掉一个 useState）
 */
export function KFold({
  title,
  meta,
  open,
  onToggle,
  defaultOpen,
  trailing,
  children,
  ...rest
}: Omit<ComponentProps<"div">, "title"> & {
  title: ReactNode;
  /** 标题下那行小字：当前选中的值、条数、状态 */
  meta?: ReactNode;
  open?: boolean;
  onToggle?: () => void;
  /** 非受控时的初始展开状态 */
  defaultOpen?: boolean;
  /** 右侧尾巴：开关、标签（不参与展开热区） */
  trailing?: ReactNode;
  /** 只有展开时才渲染 —— 收起的卡片不进 DOM，省一层布局 */
  children?: ReactNode;
}) {
  const [selfOpen, setSelfOpen] = useState(defaultOpen ?? false);
  const isOpen = open ?? selfOpen;
  return (
    <KCard open={isOpen} {...rest}>
      <div className="k-card__head">
        <button
          type="button"
          className="k-card__toggle"
          aria-expanded={isOpen}
          onClick={() => (onToggle ? onToggle() : setSelfOpen((v) => !v))}
        >
          <span className="k-row__body">
            <span className="k-row__title">{title}</span>
            {meta !== undefined && <span className="k-row__meta">{meta}</span>}
          </span>
          <ChevronDown className="k-chev" aria-hidden="true" />
        </button>
        {trailing}
      </div>
      {isOpen && children !== undefined && <div className="k-card__body">{children}</div>}
    </KCard>
  );
}
