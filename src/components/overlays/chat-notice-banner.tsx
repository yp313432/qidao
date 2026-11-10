import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  clearChatNotice,
  subscribeChatNotice,
  type ChatNotice,
} from "@/lib/inapp-notice";
import { useApp } from "@/lib/store";
import { materialOf } from "@/lib/material";
import { resolveAiName } from "@/lib/branding";

/**
 * 顶部横幅：「他在别的页面给你发了一条」。
 *
 * 用户 2026-11-01："app 内发消息会弹一个横幅……要自然有动效那种"。
 *
 * 动效设计（都是 transform/opacity，不触发重排）：
 *   · 进来：从上方 -110% 落到 0，320ms `cubic-bezier(.22,1.15,.36,1)`（带一点回弹）
 *   · 停留：正文越长停得越久（3.6s ~ 6s）
 *   · 出去：往上滑回 -110% 并淡出，240ms ease-in
 *   · 点它：立刻收起并跳到聊天页
 */
export function ChatNoticeBanner() {
  const [notice, setNotice] = useState<ChatNotice | null>(null);
  /** "正在退场" —— 先播退场动画，动画结束再真正卸载 */
  const [leaving, setLeaving] = useState(false);
  const timers = useRef<number[]>([]);
  const navigate = useNavigate();
  const aiName = useApp((s) => resolveAiName(s.settings.aiName));
  /** 液态横幅：白膜 + 磨砂（第 12 条） */
  const liquid = useApp((s) => materialOf(s.settings) === "liquid");

  useEffect(() => subscribeChatNotice((n) => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    if (!n) {
      setLeaving(true);
      timers.current.push(window.setTimeout(() => {
        setNotice(null);
        setLeaving(false);
      }, 240));
      return;
    }
    setNotice(n);
    setLeaving(false);
    const stay = Math.min(6000, Math.max(3600, 2400 + n.body.length * 90));
    timers.current.push(window.setTimeout(() => {
      setLeaving(true);
      timers.current.push(window.setTimeout(() => {
        setNotice(null);
        setLeaving(false);
      }, 240));
    }, stay));
  }), []);

  useEffect(() => () => {
    for (const t of timers.current) window.clearTimeout(t);
  }, []);

  if (!notice) return null;

  const goChat = () => {
    clearChatNotice();
    void navigate({ to: "/" });
  };

  return (
    <div
      className="pointer-events-none fixed inset-x-3 z-[130]"
      style={{ top: "calc(var(--q-inset-top, env(safe-area-inset-top, 0px)) + 10px)" }}
    >
      <div
        role="status"
        className={[
          "pointer-events-auto flex w-full items-center gap-3 rounded-[20px] px-3 py-2.5 text-left",
          "border border-white/50 bg-surface/88 shadow-[0_10px_30px_rgba(0,0,0,0.22)]",
          "backdrop-blur-xl will-change-transform",
          liquid && "lq-dialog lq-dialog--bar",
          leaving
            ? "transition-all duration-[240ms] ease-in"
            : "transition-all duration-[320ms]",
        ].join(" ")}
        style={{
          transform: leaving ? "translateY(-115%) scale(.98)" : "translateY(0) scale(1)",
          opacity: leaving ? 0 : 1,
          transitionTimingFunction: leaving
            ? "ease-in"
            : "cubic-bezier(.22,1.15,.36,1)",
        }}
      >
        <button
          type="button"
          onClick={goChat}
          className="flex min-w-0 flex-1 items-center gap-3"
          aria-label="去聊天页看看"
        >
          {/* 头像：没有就显示名字首字 */}
          <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-chip text-[13px] font-medium text-ink ring-1 ring-black/5">
            {notice.avatar ? (
              <img src={notice.avatar} alt="" className="size-full object-cover" />
            ) : (
              (notice.name || aiName || "他").slice(0, 1)
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="truncate text-[12.5px] font-medium text-ink">
                {notice.name || aiName}
              </span>
              <span className="shrink-0 text-[11px] text-subtle">刚刚</span>
            </span>
            <span className="mt-0.5 block truncate text-[12.5px] leading-5 text-ink/75">
              {notice.body}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => clearChatNotice()}
          aria-label="收起"
          className="-mr-1 grid size-7 shrink-0 place-items-center rounded-full text-subtle active:bg-black/5"
        >
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
