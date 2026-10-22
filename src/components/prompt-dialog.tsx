/**
 * App 内的"编辑一段文字"弹层 —— 替代 `window.prompt()`。
 *
 * 为什么必须换掉（用户 m11475 截图：世界书"改这条"弹出一个安卓原生白卡片，
 * 而且**原来那段文字没带进来**，只能整段重新打）：
 *
 *   · 安卓 WebView 里的 `prompt/alert/confirm` 是系统原生对话框，
 *     白底、方块、跟 App 的玻璃质感完全不搭；
 *   · 更糟的是 `prompt()` 的第二个参数（默认值）在部分机型/主题下**不显示**，
 *     于是"只加一句话"变成"整段重写"。
 *
 * 规则：**App 里不许再出现 alert / confirm / prompt**（见 AGENTS.md）。
 * 提示用 `pushToast`，二选一用两段式按钮，要打字就用这个。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type PromptDialogProps = {
  open: boolean;
  title: string;
  /** 标题下面那行小字（说明留空会怎样之类） */
  hint?: string;
  /** 打开时预填的内容（**必须传**，这正是原生 prompt 丢的东西） */
  defaultValue?: string;
  multiline?: boolean;
  placeholder?: string;
  confirmText?: string;
  onCancel: () => void;
  /** 空字符串 = 用户清空了（调用方自己决定是"删掉"还是"忽略"） */
  onConfirm: (value: string) => void;
};

export function PromptDialog({
  open,
  title,
  hint,
  defaultValue = "",
  multiline = false,
  placeholder,
  confirmText = "确定",
  onCancel,
  onConfirm,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const box = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  // 每次打开都重新填一遍原文（这是"不重新打"的关键）
  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      const t = window.setTimeout(() => {
        const el = box.current;
        if (!el) return;
        el.focus();
        // 光标放末尾，直接接着写
        try {
          el.setSelectionRange(el.value.length, el.value.length);
        } catch {
          /* 有些 input 类型不支持，忽略 */
        }
      }, 60);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open, defaultValue]);

  if (!open) return null;

  const confirm = () => {
    onConfirm(value);
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center px-5">
      <button
        type="button"
        aria-label="关闭"
        onClick={onCancel}
        className="absolute inset-0 bg-black/45"
      />
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-line bg-[rgba(252,248,242,0.99)] shadow-[0_20px_60px_rgba(30,20,12,.35)]">
        <div className="px-4 pt-4">
          <p className="text-[14px] font-semibold text-fg">{title}</p>
          {hint ? <p className="mt-1 text-[11.5px] leading-4 text-muted">{hint}</p> : null}
        </div>
        <div className="px-4 pb-1 pt-3">
          {multiline ? (
            <textarea
              ref={box as React.RefObject<HTMLTextAreaElement>}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              rows={6}
              className="w-full resize-y rounded-2xl border border-line bg-surface px-3 py-2.5 text-[13px] leading-[1.7] text-fg outline-none placeholder:text-subtle"
            />
          ) : (
            <input
              ref={box as React.RefObject<HTMLInputElement>}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirm();
                if (e.key === "Escape") onCancel();
              }}
              className="w-full rounded-2xl border border-line bg-surface px-3 py-2.5 text-[13px] text-fg outline-none placeholder:text-subtle"
            />
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 pb-4 pt-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full bg-chip px-4 py-2 text-[13px] text-muted"
          >
            取消
          </button>
          <button
            type="button"
            onClick={confirm}
            className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-ink-fg"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
