import { cn } from "@/lib/utils";

export function Switch({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200",
        /**
         * ⚠️ 原来"开"是 `bg-ink`（深色底）、"关"是 `bg-chip`（浅色底）——
         * 在深色主题下这两个**一眼看不出来**（用户 2026-11："心情让他开口那个
         * 也是选了哪档，看不出来"）。
         * 现在"开"用**主题色**（accent），跟"关"的灰底拉出明显差别。
         */
        checked ? "bg-accent" : "bg-line",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 size-6 rounded-full bg-elevated shadow-sm transition-transform duration-200",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}
