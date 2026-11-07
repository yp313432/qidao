import { cn } from "@/lib/utils";

/**
 * 滑杆行 —— `.k-field` + `.k-range`。
 *
 * 一行 = 左边名字、右边当前值、下面一根滑杆（热区撑到 44px，手指按得住）。
 *
 * 为什么不用 `SliderRow` 那一版：它把"标签 / 值 / 轨道"写成三段 Tailwind
 * （`text-[12px]`、`accent-accent`、`mt-2`），纯色模式下没法统一口径。
 * 这里所有数值走 `var(--k-*)`，跟其它标准件同一套尺子。
 *
 * `disabled` 只把整行压淡（`data-off`），不改配色 —— 改配色就得为四套纸色各写一遍。
 */
export function KSlider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  disabled,
  onChange,
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** 值后面跟的单位：`px` / `%` / 空 */
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
  className?: string;
}) {
  /** 0.05 这种步长会算出 0.30000000000000004，四舍五入到两位再显示 */
  const shown = Math.round(value * 100) / 100;
  return (
    <label data-off={disabled ? "true" : undefined} className={cn("k-field", className)}>
      <span className="k-field__head">
        <span>{label}</span>
        <span className="k-field__val">
          {shown}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="k-range"
      />
    </label>
  );
}
