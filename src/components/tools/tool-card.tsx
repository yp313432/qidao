import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { KCard } from "@/components/ui-kit";

/**
 * 工具页三种列表（HTTP / MCP / 摘要）共用的「一行 + 展开区」卡片。
 *
 * 为什么抽出来：这三处的旧结构是同一套 `.tool-card` + `.tool-hit` + `.tool-r1/r2`
 * 手写标签，同一个外框在三份文件里各写一遍（连 `data-method` 和折角都抄），
 * 一旦想改"展开区长什么样"就得改三处。收成一个组件之后：
 *   · 结构只在这一处；
 *   · 观感全部来自 `.k-card` / `.k-card__body` 这些 kit 类 —— 三套材质
 *     （纯色/磨砂/液态）各自靠变量变样子，组件里一个颜色都不写。
 *
 * 交互约定：整行都是热区（`.k-card__toggle` 撑满、最小 44px），
 * 右上角的开关（`trailing`）**不在**热区里 —— 否则点开关会连带展开。
 */
export function ToolCard({
  title,
  meta,
  trailing,
  open,
  onToggle,
  off,
  children,
}: {
  /** 第一行大字：工具名 / 服务器名 / 对话标题 */
  title: ReactNode;
  /** 第二行小字：方法、主机、状态、编号 */
  meta?: ReactNode;
  /** 右侧尾巴（开关）。不参与展开点击。 */
  trailing?: ReactNode;
  open: boolean;
  onToggle: () => void;
  /** 停用态：只把字压灰，不换配色 */
  off?: boolean;
  /** 展开后显示的内容 */
  children?: ReactNode;
}) {
  return (
    <KCard open={open}>
      <div className="k-card__head">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          data-off={off ? "true" : undefined}
          className="k-card__toggle"
        >
          <span className="k-row__body">
            <span className="k-row__title">{title}</span>
            {meta !== undefined && <span className="k-row__meta">{meta}</span>}
          </span>
          <ChevronDown className="k-chev" aria-hidden="true" />
        </button>
        {trailing}
      </div>
      {open && children !== undefined && <div className="k-card__body">{children}</div>}
    </KCard>
  );
}
