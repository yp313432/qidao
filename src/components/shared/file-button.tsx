import { cn } from "@/lib/utils";

/**
 * 「选文件」按钮 —— 移动端最可靠的写法。
 *
 * 之前踩过的坑：
 *  1. `<label>` 包 `<input className="hidden">` → 部分手机浏览器/WebView
 *     不肯为 `display:none` 的 file input 打开选择器，点了完全没动静。
 *  2. 真按钮 + 程序化 `.click()` → 在少数内核里不算「用户手势」，同样没反应。
 *
 * 现在改成：把**真正的 `<input type="file">` 铺在按钮上层**，透明但可点。
 * 用户手指直接点在 input 自己身上，等于原生点击，所有浏览器都吃这一套。
 */
export function FileButton({
  children,
  onPick,
  accept,
  multiple,
  className,
  ariaLabel,
  disabled,
}: {
  children: React.ReactNode;
  onPick: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <span className={cn("relative inline-flex", className)}>
      {children}
      <input
        type="file"
        aria-label={ariaLabel}
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="absolute inset-0 m-0 h-full w-full cursor-pointer p-0 opacity-0 disabled:cursor-not-allowed"
        onChange={(e) => {
          // 先同步取出数组，再清空，避免 FileList 被回收
          const files = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = "";
          if (files.length) onPick(files);
        }}
      />
    </span>
  );
}
