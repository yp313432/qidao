import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";

/**
 * 工具区编辑器的**共用外壳 + 共用表单零件**。
 *
 * ── 为什么要有这个文件 ──────────────────────────────────────────
 *
 * 用户对着截图提的（原话）：
 *   "直接改成和思考链弹出一样的形式，单独的一个页面，没有导航栏，
 *    这三个是同类的，明明可以用一套写法"
 *
 * 「这三个」= 工具页的三个标签：HTTP / MCP / 文档。
 * 之前是**三套写法**：
 *   · HTTP 和 MCP 各写一个底部弹层（两份代码 95% 一样），而且是
 *     `z-40` —— 比底部导航的 `z-60` 低，导航直接压住最后一栏输入框
 *     （用户实测：MCP 的「请求头」被导航挡住看不见）
 *   · 文档更离谱，用 `window.prompt` 弹两次原生输入框
 *
 * 现在统一成：**一个独立页面（不是弹层）+ 一套字段零件**。
 * 独立页面天然没有底部导航（`nav-tree.ts` 的 `hidesNav` 一处定义），
 * 所以"被导航挡住"这个问题从根上没有了，也不用去比 z 值。
 *
 * ── 规矩 ────────────────────────────────────────────────────
 *
 * 以后新增任何"填一个东西然后保存"的页面，都用这里的 `EditorPage` +
 * `TextInput` / `TextArea` / `Segmented`，**不要再自己写 label + input**。
 * 要改字段的长相（圆角、字号、间距）只改这一个文件。
 */

/** 编辑器页面外壳：顶部（返回 + 标题 + 保存）、可滚的字段区。 */
export function EditorPage({
  title,
  description,
  onSave,
  canSave,
  saveHint,
  children,
}: {
  title: string;
  description?: string;
  onSave: () => void;
  canSave: boolean;
  /** 保存按钮为什么是灰的（缺哪个字段），说清楚，别让用户猜 */
  saveHint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={title}
        description={description}
        right={
          /*
            保存放**标题栏**，不放页面最底下。
            这条是从上一轮踩出来的：手机上键盘一弹起，页面被压矮，
            最底下的按钮就跑到屏幕外，用户以为"根本没有保存按钮"
            （用户原话："新建 http 工具和 mcp 没有保存按钮，怎么用？"）。
          */
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className="mr-1 shrink-0 rounded-full bg-ink px-4 py-1.5 text-[13px] font-medium text-ink-fg disabled:opacity-40"
          >
            保存
          </button>
        }
      />
      {!canSave && saveHint && <p className="px-5 pb-1 text-[11px] text-subtle">{saveHint}</p>}

      {/*
        字段区：内部滚动，底部留安全区。
        这一页不显示底部导航（hidesNav 管着），所以**不需要** pb-above-nav ——
        留了反而多出一截空白。
      */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {children}
      </div>
    </div>
  );
}

/** 单行输入。`mono` = 地址、命令这类要看清字符的，用等宽字体。 */
export function TextInput({
  label,
  value,
  onChange,
  placeholder,
  mono,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <label className="mt-3 block first:mt-0">
      <span className="text-[12px] text-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "mt-1 w-full rounded-2xl border border-line bg-chip px-4 py-2.5 outline-none placeholder:text-subtle",
          mono ? "font-mono text-[13px]" : "text-[15px]",
        )}
      />
      {hint && <span className="mt-1 block text-[11px] leading-4 text-subtle">{hint}</span>}
    </label>
  );
}

/** 多行输入（请求头、请求体、文档正文）。 */
export function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  hint?: string;
}) {
  return (
    <label className="mt-3 block first:mt-0">
      <span className="text-[12px] text-muted">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="mt-1 w-full resize-none rounded-2xl border border-line bg-chip px-4 py-3 font-mono text-[12px] leading-5 outline-none placeholder:text-subtle"
      />
      {hint && <span className="mt-1 block text-[11px] leading-4 text-subtle">{hint}</span>}
    </label>
  );
}

/**
 * 几个选项里挑一个（传输方式、请求方法）。
 *
 * 列数用内联样式算 —— **不要写 `grid-cols-${n}`**，
 * Tailwind 是构建时静态扫类名的，拼出来的类名不会生成样式。
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  hint?: string;
}) {
  return (
    <div className="mt-3">
      <span className="text-[12px] text-muted">{label}</span>
      <div
        className="mt-1 grid gap-2"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={value === o.id}
            onClick={() => onChange(o.id)}
            className={cn(
              "rounded-2xl border px-3 py-2.5 text-[13px] font-medium",
              value === o.id ? "border-fg" : "border-line",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1 text-[11px] leading-4 text-muted">{hint}</p>}
    </div>
  );
}
