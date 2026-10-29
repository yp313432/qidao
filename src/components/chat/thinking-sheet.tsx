import { useEffect, useRef, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { callSentence } from "@/lib/call-sentence";
import { resolveAiName } from "@/lib/branding";
import { useApp } from "@/lib/store";
import type { ChatStep } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 思考链 —— 从底部弹出来的一层（Claude 那种）。
 *
 * 用户的原话："改成 Claude 那种思考链，点开是从下面弹出来的那种，单独一层"。
 * 好处：思考链不再占正文的地方（它字数多，放在气泡旁边怎么摆都别扭），
 * 点一下弹出来看，关掉就回到对话 ✅
 *
 * ── 形态（用户 m12599 定的）──────────────────────────────────
 *
 * 不是"思考区 + 动作区"两块，而是**一条线**：想 → 做 → 想 → 做。
 * 每行只留一句概括，右边一个尖角，**点那行就地展开**（思考给全文、动作补细节）。
 * 数据来自 `ChatMessage.steps`（流式时按发生顺序切下来的）；
 * 老消息没有这格 → 退回"整段思考"那段纯文本，跟以前一样。
 *
 * ── 实测修过的两个毛病（别改回去）──────────────────────────────
 *
 * ① 「一滑就消失」
 *    原来遮罩上那个关闭按钮绑的是 onClick。手指在遮罩上滑动、一松手，
 *    浏览器**照样会发一个 click** → 被当成"点了背景"，弹层就关了。
 *    实测：快速上滑后弹层消失，而消息区 scrollTop 一点没动（滑动全被遮罩吃掉）。
 *    → 现在关闭按钮**不响应 click**，只认"按下的点和抬起的点几乎在同一个地方"
 *      （位移 < 10px 才算点击）。滑动再怎么滑都不会误关。
 *
 * ② 「背后带着不同色块」
 *    原来遮罩是 `bg-black/35` —— 硬编码死黑，全 App 只有这一处这么写。
 *    别的遮罩（action-gate / memory-detail / mcp-servers / http-tools /
 *    gobang / chat-view / player-view）统一用 `bg-fg/xx` 这个**跟着主题走**
 *    的语义色。死黑不给内容打码，底下的气泡、头像、背景图直接透上来 = 色块感。
 *    → 现在统一成 `bg-fg/25`，跟全 App 一致。
 *
 * 顺带：加了「抓着顶部横条往下拖」关闭 —— 原来只能点背景，太隐蔽。
 */
export function ThinkingSheet({
  open,
  text,
  steps,
  durationMs,
  live,
  onClose,
}: {
  open: boolean;
  text: string;
  /** 过程线（想 → 做 → 想）。没有就用 `text` 显示整段思考（老消息） */
  steps?: ChatStep[];
  durationMs?: number;
  /** 还在生成中（实时长出来的那种） */
  live?: boolean;
  onClose: () => void;
}) {
  /** 往下拖了多少（0 = 原位）。跟手，松手看够不够远。 */
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);

  // Esc 关闭（桌面端顺手）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 每次重新打开都从原位开始
  useEffect(() => {
    if (open) setDragY(0);
  }, [open]);

  if (!open) return null;

  const secs = durationMs ? Math.max(1, Math.round(durationMs / 1000)) : 0;
  const callCount = (steps ?? []).filter((s) => s.kind === "call").length;

  /** 抓手拖动中 */
  function onHandleDown(e: React.PointerEvent) {
    startY.current = e.clientY;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onHandleMove(e: React.PointerEvent) {
    if (!dragging) return;
    // 只允许往下拖（往上拖不动，回弹到 0）
    setDragY(Math.max(0, e.clientY - startY.current));
  }
  function onHandleUp(e: React.PointerEvent) {
    if (!dragging) return;
    setDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    // 拖过 88px（或面板的三分之一）就收起来，否则弹回原位
    const far = dragY > 88 || dragY > e.currentTarget.getBoundingClientRect().height / 3;
    if (far) onClose();
    else setDragY(0);
  }

  return (
    /*
      z 值必须是 70，**要压过底部导航栏**（导航是 z-[60]）。
      用户反馈："点开一思考时，思考链界面从底部弹出，但是没有底部导航栏，
      你看图片上是不是带着导航栏，这样很突兀，还会遮挡" ——
      原来这里是 z-50 < 60，所以导航浮在弹层**上面**：
      既突兀（弹层背后露一条导航），又遮挡（它盖住了弹层底部的文字）。
      抬到 70 之后，弹层是一整层盖住全屏，导航被压在底下看不见。
    */
    <div className="fixed inset-0 z-70 flex flex-col justify-end" role="dialog" aria-modal="true">
      {/*
        点背景关掉。用 pointerdown/pointerup 自己判断位移，**不用 onClick** ——
        否则在遮罩上滑动、一松手会被当成点击（① 那个 bug 就是这么来的）。
      */}
      <button
        type="button"
        aria-label="关闭思考链"
        className="absolute inset-0 cursor-default bg-fg/25"
        onPointerDown={(e) => {
          startY.current = e.clientY;
        }}
        onPointerUp={(e) => {
          if (Math.abs(e.clientY - startY.current) > 10) return; // 是滑动，不是点击
          onClose();
        }}
      />
      <div
        className="relative flex max-h-[78vh] flex-col rounded-t-3xl border-t border-line bg-[rgba(252,248,242,0.99)] pb-[env(safe-area-inset-bottom)]"
        style={{
          transform: `translateY(${dragY}px)`,
          transition: dragging ? "none" : "transform 0.26s cubic-bezier(0.22, 0.8, 0.25, 1)",
        }}
      >
        {/* 顶部横条：一眼看出「这是能往下收的一层」，抓着还能真往下拖 */}
        <div
          className="flex cursor-grab touch-none justify-center pt-2.5 pb-1 active:cursor-grabbing"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          role="button"
          aria-label="下滑关闭"
        >
          <span className="h-1 w-10 rounded-full bg-line" />
        </div>
        <div className="flex items-center justify-between px-4 pt-1.5 pb-2">
          <span className="text-[12px] text-muted">
            {live
              ? "正在思考…"
              : [
                  secs ? `想了 ${secs} 秒` : "想了想",
                  callCount > 0 ? `动了 ${callCount} 次手` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex size-8 items-center justify-center rounded-full bg-chip-flat text-muted"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(var(--aster-nav-h)+1.5rem)]">
          {steps && steps.length > 0 ? (
            <StepList steps={steps} live={live} />
          ) : (
            <p className="whitespace-pre-wrap text-[0.95em] leading-[1.85] text-muted">
              {text || "（没有思考内容）"}
              {live && <span className="ml-0.5 animate-pulse">▍</span>}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 过程线本体：左列一条竖线领着，每行一句概括 + 右边尖角，点哪行展哪行。
 *
 * 只在这里出现一次 —— 对话流里**不再**放过程（用户 m12579："不能放在对话里，
 * 会显得很长，放在思考链里"），那边只有一行入口。
 */
function StepList({ steps, live }: { steps: ChatStep[]; live?: boolean }) {
  const aiName = resolveAiName(useApp((st) => st.settings.aiName));
  const [open, setOpen] = useState<number[]>([]);
  const isOpen = (i: number) => open.includes(i);
  const toggle = (i: number) =>
    setOpen((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));

  return (
    <div className="flex flex-col">
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        if (step.kind === "think") {
          const expanded = isOpen(i);
          return (
            <div key={`t${i}`} className="flex gap-2.5">
              <Rail last={last}>
                <span className="mt-[3px] size-[15px] rounded-full bg-surface">
                  <span className="mx-auto mt-[5px] block size-[5px] rounded-full bg-muted" />
                </span>
              </Rail>
              <button
                type="button"
                onClick={() => toggle(i)}
                aria-expanded={expanded}
                className="min-w-0 flex-1 pb-3.5 pt-0.5 text-left"
              >
                <span className="flex items-start gap-2">
                  <span
                    className={cn(
                      "flex-1 whitespace-pre-wrap text-[12px] leading-[1.75] text-muted",
                      !expanded && "line-clamp-2",
                    )}
                  >
                    {step.text}
                  </span>
                  <ChevronRight
                    className={cn(
                      "mt-1 size-3 shrink-0 text-subtle transition-transform",
                      expanded && "rotate-90",
                    )}
                    strokeWidth={1.6}
                    aria-hidden="true"
                  />
                </span>
              </button>
            </div>
          );
        }
        const s = callSentence(step.call, aiName);
        const expanded = isOpen(i);
        return (
          <div key={`c${i}`} className="flex gap-2.5">
            <Rail last={last} bad={!step.call.ok}>
              <span
                className={cn(
                  "mt-[3px] flex size-[15px] items-center justify-center rounded-full border bg-surface",
                  step.call.ok ? "border-line" : "border-warn/50",
                )}
              >
                {step.call.ok ? (
                  <svg
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="size-2.5 text-muted"
                    aria-hidden="true"
                  >
                    <path d="M2.8 2.6 5.1 5 2.8 7.4" />
                    <path d="M5.6 7.6h2" />
                  </svg>
                ) : (
                  <span className="text-[8px] font-bold leading-none text-warn">!</span>
                )}
              </span>
            </Rail>
            <button
              type="button"
              onClick={() => toggle(i)}
              aria-expanded={expanded}
              className="min-w-0 flex-1 pb-3.5 pt-0.5 text-left"
            >
              <span className="flex items-start gap-2">
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-[12px] leading-[1.6] [overflow-wrap:anywhere]",
                      step.call.ok ? "text-fg" : "text-warn",
                    )}
                  >
                    {s.line}
                  </span>
                  {(expanded || s.detail) && s.detail && (
                    <span className="mt-0.5 block text-[11px] leading-[1.55] text-subtle [overflow-wrap:anywhere]">
                      {s.detail}
                    </span>
                  )}
                  {expanded && s.why && (
                    <span className="mt-0.5 block text-[11px] leading-[1.55] text-warn/80 [overflow-wrap:anywhere]">
                      {s.why}
                    </span>
                  )}
                  {expanded && s.raw && (
                    <span className="mt-0.5 block font-mono text-[10px] leading-[1.5] text-subtle">
                      {s.raw}
                    </span>
                  )}
                </span>
                <ChevronRight
                  className={cn(
                    "mt-1 size-3 shrink-0 text-subtle transition-transform",
                    expanded && "rotate-90",
                  )}
                  strokeWidth={1.6}
                  aria-hidden="true"
                />
              </span>
            </button>
          </div>
        );
      })}
      {live && (
        <div className="flex gap-2.5">
          <Rail last>
            <span className="mt-[3px] size-[15px] rounded-full bg-surface">
              <span className="mx-auto mt-[5px] block size-[5px] animate-pulse rounded-full bg-accent" />
            </span>
          </Rail>
          <span className="pb-2 pt-0.5 text-[12px] text-subtle">还在想…</span>
        </div>
      )}
    </div>
  );
}

/** 左列：一条竖线 + 行的节点。首尾把线裁掉半格，看着是"从第一个点到最后一个点"。 */
function Rail({
  children,
  last,
  bad,
}: {
  children: React.ReactNode;
  last?: boolean;
  bad?: boolean;
}) {
  return (
    <div className="relative flex w-[15px] shrink-0 flex-col items-center">
      <span
        className={cn(
          "absolute top-0 w-px",
          last ? "h-[10px]" : "bottom-0",
          bad ? "bg-warn/25" : "bg-line",
        )}
      />
      <span className="relative z-[1]">{children}</span>
    </div>
  );
}
