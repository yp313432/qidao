import { useEffect } from "react";
import { X } from "lucide-react";

/**
 * 思考链 —— Claude 那种**从底部弹出来的一层**。
 *
 * 用户的原话："改成 Claude 那种思考链，点开是从下面弹出来的那种，单独一层"。
 * 好处：思考链不再占正文的地方（它字数多，放在气泡旁边怎么摆都别扭），
 * 点一下弹出来看，关掉就回到对话 ✅
 *
 * 用的是 fixed 覆盖层 + 底部圆角面板（没引第三方抽屉库，省依赖）✅
 */
export function ThinkingSheet({
  open,
  text,
  durationMs,
  live,
  onClose,
}: {
  open: boolean;
  text: string;
  durationMs?: number;
  /** 还在生成中（实时长出来的那种） */
  live?: boolean;
  onClose: () => void;
}) {
  // Esc 关闭（桌面端顺手）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const secs = durationMs ? Math.max(1, Math.round(durationMs / 1000)) : 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      {/* 点背景关掉 */}
      <button
        type="button"
        aria-label="关闭思考链"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/35"
      />
      <div className="relative flex max-h-[78vh] flex-col rounded-t-3xl border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        {/* 顶部小横条：一眼看出"这是能往下收的一层" */}
        <div className="flex justify-center pt-2.5">
          <span className="h-1 w-10 rounded-full bg-line" />
        </div>
        <div className="flex items-center justify-between px-4 pt-2 pb-2">
          <span className="text-[12px] text-muted">
            {live ? "正在思考…" : secs ? `思考过程 · 用时 ${secs} 秒` : "思考过程"}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex size-8 items-center justify-center rounded-full bg-chip text-muted"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
          <p className="whitespace-pre-wrap text-[0.95em] leading-[1.85] text-muted">
            {text || "（没有思考内容）"}
            {live && <span className="ml-0.5 animate-pulse">▍</span>}
          </p>
        </div>
      </div>
    </div>
  );
}
