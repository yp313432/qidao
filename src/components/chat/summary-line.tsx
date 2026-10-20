"use client";

import { useState } from "react";
import { ChevronRight, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { summarizeNow } from "@/lib/summarizer";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * 「更早的对话（摘要）」—— 消息流里**一条线**，点开就是摘要。
 *
 * 用户的原话（m07934 / m09634）：
 *   "摘要我也要能看见和编辑，就是屏幕总结完出现一条线，展开就是摘要"
 *   "上下文正常保留，该摘要的地方划一道线显示摘要，点击这条线展开摘要内容，
 *    而不是以摘要为界限把原文塞到摘要那里……在它上面的消息我都翻不到了"
 *
 * 所以这个组件**只负责那道线 + 摘要卡**，不负责藏原文：
 * 原文一条不藏（`chat-view` 把全部消息照常渲染），线由 `chat-view` 插在
 * "摘要覆盖的最后一条之后"（`i === summary.upToIndex`），跟着数据走。
 *
 * 为什么必须让他看见、能改（不只是"技术上存了"）：
 *   · 摘要是**模型写的**，它可能漏掉或写偏 —— 而它接下来会**替代原文**进上下文
 *   · 写偏的摘要比"忘掉"更糟：忘掉只是记不起来，记错是**拿错的当真的用**
 *   · 所以给他三个按钮：**改**（直接编辑）、**重摘**（拿现在的对话再压一遍）、**删**（退回不摘）
 */
export function SummaryLine({ conversationId }: { conversationId: string }) {
  const conv = useApp((s) => s.conversations.find((c) => c.id === conversationId));
  const summary = conv?.summary;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  if (!summary?.text) return null;

  const absorbed = Math.max(0, summary.upToIndex ?? 0);
  const saved = Math.max(0, summary.sourceTokens - summary.tokens);

  function startEdit() {
    setDraft(summary!.text);
    setEditing(true);
    setOpen(true);
  }

  async function regenerate() {
    setBusy(true);
    try {
      await summarizeNow(conversationId);
    } catch {
      /* 摘要失败不能变成界面报错（纪律：它只是后台的一件小事） */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-1">
      {/* 那条"线"本身 —— 点它展开 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-1 py-1 text-[11px] text-subtle"
      >
        <span className="h-px flex-1 bg-line" />
        <span className="flex shrink-0 items-center gap-1">
          <ChevronRight
            className={cn("size-3 transition-transform", open && "rotate-90")}
            strokeWidth={1.8}
            aria-hidden="true"
          />
          更早的对话 · 摘要 {summary.covered} 条
        </span>
        <span className="h-px flex-1 bg-line" />
      </button>

      {open && (
        <div className="mt-1 rounded-2xl border border-line bg-chip px-3.5 py-3">
          {editing ? (
            <>
              <textarea
                aria-label="编辑摘要"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={7}
                className="w-full resize-y rounded-xl border border-line bg-elevated px-3 py-2 text-[12px] leading-5 outline-none"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    useApp.getState().patchSummary(conversationId, { text: draft.trim() });
                    setEditing(false);
                  }}
                  className="rounded-full bg-ink px-3.5 py-2 text-[12px] font-medium text-ink-fg"
                >
                  保存
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-full bg-elevated px-3.5 py-2 text-[12px]"
                >
                  取消
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[11px] font-medium tracking-wide text-subtle">
                摘要 · 覆盖前 {absorbed} 条
              </p>
              <p className="mt-1.5 text-[12px] leading-6 whitespace-pre-wrap">{summary.text}</p>
              <p className="mt-2 text-[11px] leading-4 text-subtle">
                这段原文不再发给他，换成上面的摘要（省了约 {saved} token）。
                觉得写得不对就改，或者重摘一次。
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={startEdit}
                  className="flex items-center gap-1 rounded-full bg-elevated px-3 py-2 text-[12px]"
                >
                  <Pencil className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
                  改一下
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void regenerate()}
                  className="flex items-center gap-1 rounded-full bg-elevated px-3 py-2 text-[12px] disabled:opacity-40"
                >
                  <RefreshCw
                    className={cn("size-3.5", busy && "animate-spin")}
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                  {busy ? "重摘中…" : "重新总结"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useApp.getState().clearSummary(conversationId);
                    setOpen(false);
                  }}
                  className="flex items-center gap-1 rounded-full bg-elevated px-3 py-2 text-[12px] text-muted"
                >
                  <Trash2 className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
                  删掉
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
