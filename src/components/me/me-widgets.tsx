import { useState, type ReactNode } from "react";
import { ChevronDown, ImagePlus, X } from "lucide-react";
import { readImageFile } from "@/lib/image-file";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { FileButton } from "@/components/shared/file-button";

/**
 * 页面小部件：Section / Group / Sub / Fold / Row / SliderRow / ImageRow / ProbeLine。
 * 只吃 props，不认识任何业务状态 —— 所以谁都能用。
 */

/* ───────────────────────────── 小部件 ───────────────────────────── */
/** 一张背景图槽位：缩略图 + 名字 + 说明 + 更换/移除。 */
export function ImageRow({
  label,
  hint,
  value,
  onPick,
  onClear,
}: {
  label: string;
  hint: string;
  value: string;
  onPick: (url: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-chip px-3 py-2.5">
      <FileButton
        ariaLabel={value ? `更换${label}` : `上传${label}`}
        accept="image/*"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onPick={(files) => {
          const file = files[0];
          if (file) readImageFile(file, onPick);
        }}
      >
        <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-elevated">
          {value ? (
            <img src={value} alt="" className="size-full object-cover" />
          ) : (
            <ImagePlus className="size-4 text-muted" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium">{label}</span>
          <span className="block truncate text-[11px] text-muted">
            {value ? "已设置 · 点一下换" : `${hint} · 点一下上传`}
          </span>
        </span>
      </FileButton>
      {value && (
        <button
          type="button"
          aria-label={`移除${label}`}
          onClick={onClear}
          data-opt=""
          className="flex size-8 shrink-0 items-center justify-center rounded-full"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** 探测结果里的一行：通过 / 不通过 */
export function ProbeLine({ label, pass }: { label: string; pass: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-[13px]">{label}</span>
      <span className={cn("shrink-0 text-[12px] font-medium", pass ? "text-ok" : "text-warn")}>
        {pass ? "通过" : "不通过"}
      </span>
    </div>
  );
}

export function Section({
  title,
  children,
  hidden,
}: {
  title: string;
  children: ReactNode;
  /** 暂时收起这一块（内容已经归到别处了，但代码先留着） */
  hidden?: boolean;
}) {
  // 收起的块直接不渲染（代码留着，随时能放回来）
  if (hidden) return null;
  return (
    <section className="mt-6 px-4">
      <h2 className="mb-2 px-1 text-[12px] tracking-wide text-muted">{title}</h2>
      <div className="rounded-3xl border border-line bg-surface p-3">{children}</div>
    </section>
  );
}

/**
 * 折叠入口：一行标题 + 当前值，点开才展开内容。
 *
 * 用户定的版式（m14333）：我的空间就是"几行字"，点哪行展哪行；
 * 不再一页全是常驻卡片 —— 那样每加一项就更长一截。
 */

/**
 * 系统页的折叠组：平时收起，点标题展开。
 * （用户 2026-11：系统页先做二级区，平时也是收起来的，点击再展开）
 */
export function Group({
  title,
  value,
  order,
  children,
}: {
  title: string;
  value: string;
  order?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="me-group" style={order ? { order } : undefined}>
      <button
        type="button"
        className="me-group-h"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="me-group-t">{title}</span>
        <span className="me-group-v">{value}</span>
        <ChevronDown className={cn("me-group-ic", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && <div className="me-group-body bubble-in">{children}</div>}
    </section>
  );
}

/** 折叠组里的二级小标题 */
export function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="me-sub">
      <h3 className="me-sub-t">{title}</h3>
      <div className="me-sub-body">{children}</div>
    </div>
  );
}

export function Fold({
  title,
  value,
  open,
  onToggle,
  children,
}: {
  title: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mt-3 rounded-3xl border border-line bg-surface">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] text-fg">{title}</span>
          <span className="mt-0.5 block truncate text-[12px] text-muted">{value}</span>
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-subtle transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div className="bubble-in border-t border-line/60 px-4 pb-4 pt-3">{children}</div>}
    </div>
  );
}

export function Row({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-2.5">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[12px] text-muted">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} label={label} />
    </div>
  );
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("mt-3 px-1", disabled && "opacity-45")}>
      <div className="flex items-center justify-between text-[12px] text-muted">
        <span>{label}</span>
        <span>
          {Math.round(value * 100) / 100}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full"
        style={{ accentColor: "var(--aster-accent)" }}
      />
    </div>
  );
}

/** ⚠️ 「把相册里选的图读成 dataURL」已经搬去 `@/lib/image-file` 了（全 App 一处实现） */
