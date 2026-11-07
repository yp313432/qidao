import { cn } from "@/lib/utils";

/**
 * 开关 —— `.k-switch` 的 React 封装。
 *
 * 为什么不用旧的 `src/components/ui/switch.tsx`：
 * 旧版是 Tailwind 原子类拼出来的（`h-7 w-12` + 位移 `translate-x-5` = 固定 20px），
 * 纯色模式把轨道换成 40×22 之后位移距离就对不上了，白点会飞出轨道右沿
 * （2026-11 那次「开关点点到外面去了」就是这么来的）。
 *
 * 这里的位移距离由 kit.css 用 `calc(var(--k-track-w) - var(--k-knob) - …)` 算，
 * 三套材质各自只换变量：纯色 40/22/14（方角墨框）、磨砂 40/22/16、液态同尺寸但更慢。
 * 开关的"开"态语义也由变量决定，纯色是墨底纸点，磨砂是主题色底。
 */
export function KSwitch({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** 无障碍名（读屏会念）。必填 —— 不传就没法知道这个开关管什么。 */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("k-switch", className)}
    >
      <span className="k-switch__knob" />
    </button>
  );
}
