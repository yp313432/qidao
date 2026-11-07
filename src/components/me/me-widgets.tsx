import { useState, type ReactNode } from "react";
import { ChevronDown, ImagePlus, X } from "lucide-react";
import { readImageFile } from "@/lib/image-file";
import { cn } from "@/lib/utils";
import { FileButton } from "@/components/shared/file-button";
import { KCard, KSwitch } from "@/components/ui-kit";

/**
 * 页面小部件：Section / Group / Sub / Fold / Row / SliderRow / ImageRow / ProbeLine。
 * 只吃 props，不认识任何业务状态 —— 所以谁都能用。
 *
 * 2026-11 这一轮把它们全换成标准件（`.k-*`）：
 * 用户看着「我的」里剩下的页面说「里面的卡片还是之前那个圆形卡片」——
 * 病根就在这几个小部件上：全站剩下的旧卡片都是它们画出来的（`rounded-3xl bg-surface`）。
 * 换成 `.k-card` / `.k-row` / `.k-sect` / `.k-switch` 之后，用到它们的页面一次全部对齐纸世界皮肤，
 * 不用一页一页改 —— 形状改 kit，页面只管怎么摆。
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
    <div className="k-hstack">
      <FileButton
        ariaLabel={value ? `更换${label}` : `上传${label}`}
        accept="image/*"
        className="k-hstack k-grow"
        onPick={(files) => {
          const file = files[0];
          if (file) readImageFile(file, onPick);
        }}
      >
        <span className="k-thumb">{value ? <img src={value} alt="" /> : <ImagePlus />}</span>
        <span className="k-row__body">
          <span className="k-row__title">{label}</span>
          <span className="k-row__meta">
            {value ? "已设置 · 点一下换" : `${hint} · 点一下上传`}
          </span>
        </span>
      </FileButton>
      {value && (
        <button
          type="button"
          aria-label={`移除${label}`}
          onClick={onClear}
          className="k-btn k-btn--icon"
        >
          <X />
        </button>
      )}
    </div>
  );
}

/** 探测结果里的一行：通过 / 不通过 */
export function ProbeLine({ label, pass }: { label: string; pass: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="k-row__meta">{label}</span>
      <span className="k-stat" data-tone={pass ? "ok" : "warn"}>
        {pass ? "通过" : "不通过"}
      </span>
    </div>
  );
}

/**
 * 一整块设置：分类标题 + 一张纸卡。
 *
 * 标题放进卡片里（`.k-sect` 那一行小字），不再像原来那样标题浮在卡片外面、
 * 卡片本身又没有边界 —— 纯色下那正是"整页没有条理"的由来。
 */
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
    <section className="k-card">
      <div className="k-sect">
        <h2 className="k-sect__title">{title}</h2>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

/**
 * 系统页的折叠组：平时收起，点标题展开。
 *
 * 旧 tab `/system` 还在用它把五块还原成可折叠壳（新页面已经把正文铺开了）。
 * 换成 kit 的 `.k-card` + `.k-card__head/__toggle` + `.k-chev`，与工具页、外观页同一副骨架。
 */
export function Group({
  title,
  value,
  order,
  children,
  /** 只渲染里面的内容，不要外壳（新页面「铺开」时用） */
  bare,
}: {
  title: string;
  value: string;
  order?: number;
  children: ReactNode;
  bare?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (bare) return <div className="flex flex-col gap-3">{children}</div>;
  return (
    <section className="k-card" style={order ? { order } : undefined} data-open={open}>
      <div className="k-card__head">
        <button
          type="button"
          className="k-card__toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="k-row__body">
            <span className="k-row__title">{title}</span>
            <span className="k-row__meta">{value}</span>
          </span>
          <ChevronDown className="k-chev" aria-hidden="true" />
        </button>
      </div>
      {open && <div className="k-card__body">{children}</div>}
    </section>
  );
}

/**
 * 折叠组里的二级分类。
 *
 * 它自己就是一张纸卡 —— 新页面把这一层铺开后，"思考链 / 说话方式 / 表情包"
 * 是并列的三张卡，而不是挤在一个「聊天」卡里面。
 * 真的嵌在别的卡片里时（旧 `/system` 页），kit.css 的 `.k-card .k-sub` 会把它降级成纯标题+内容，
 * 免得卡里套卡。
 */
export function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="k-card k-sub">
      <div className="k-sect">
        <h3 className="k-sect__title">{title}</h3>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

/**
 * 折叠入口：一行标题 + 当前值，点开才展开内容。
 *
 * 用户定的版式（m14333）：我的空间就是"几行字"，点哪行展哪行 ——
 * 现在外观页用的是 `KFold`，这个留给还用 `<Fold>` 的页面。
 */
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
    <KCard open={open}>
      <div className="k-card__head">
        <button type="button" onClick={onToggle} aria-expanded={open} className="k-card__toggle">
          <span className="k-row__body">
            <span className="k-row__title">{title}</span>
            <span className="k-row__meta">{value}</span>
          </span>
          <ChevronDown className="k-chev" aria-hidden="true" />
        </button>
      </div>
      {open && <div className="k-card__body">{children}</div>}
    </KCard>
  );
}

/** 一行开关：左标题 + 说明，右开关 */
export function Row({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  /** 一句补充说明。留空就不渲染 —— 上市标准里"看一眼就懂"的行不该再挂解释。 */
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="k-row__body">
        <p className="k-row__title">{label}</p>
        {hint ? <p className="k-row__meta">{hint}</p> : null}
      </div>
      <KSwitch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

/** 一条滑杆：左标题 + 右当前值，下面滑杆 */
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
    <label className={cn("k-field", disabled && "opacity-45")} data-off={disabled}>
      <span className="k-field__head">
        <span>{label}</span>
        <span className="k-field__val">
          {Math.round(value * 100) / 100}
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
        onChange={(e) => onChange(Number(e.target.value))}
        className="k-range"
      />
    </label>
  );
}

/** ⚠️ 「把相册里选的图读成 dataURL」已经搬去 `@/lib/image-file` 了（全 App 一处实现） */
