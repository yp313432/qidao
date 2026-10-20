"use client";

import { useState } from "react";
import { ChevronRight, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { summarizeNow } from "@/lib/summarizer";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * 「更早的对话（摘要）」—— 对话顶部**一条线**，点开就是摘要。
 *
 * 用户的原话：
 *   "摘要我也要能看见和编辑，就是屏幕总结完出现一条线，展开就是摘要"
 *
 * 为什么必须让他看见、能改（不只是"技术上存了"）：
 *   · 摘要是**模型写的**，它可能漏掉或写偏 —— 而它接下来会**替代原文**进上下文
 *   · 写偏的摘要比"忘掉"更糟：忘掉只是记不起来，记错是**拿错的当真的用**
 *   · 所以给他三个按钮：**改**（直接编辑）、**重摘**（拿现在的对话再压一遍）、**删**（退回不摘）
 */
export function SummaryLine({ conversationId }: { conversationId: string }) {
  const summary = useApp((s) =>
    s.conversations.find((c) => c.id === conversationId)?.summary,
  );
  /*
    用户 m07934 第 4 条：「摘要之后的前文翻不了了……摘要只是把前文消息塞进 ai 里了，
    我这里还是要能正常看到所有聊天记录的」。

    实现上，摘要**从来不会删本地消息**（`messages` 全量留着，只在发给模型时
    `droppedBySummary()` 把它们换成摘要）。所以这里把"被吸收的那些原文"直接摊出来：
    既能让他翻、也能当自检 —— 如果"本地共 X 条"明显小于他印象里的条数，那就是真的
    丢过数据，要另查。
  */
  const conv = useApp((s) => s.conversations.find((c) => c.id === conversationId));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [showOld, setShowOld] = useState(false);
  const [oldLimit, setOldLimit] = useState(40);
  const [expandId, setExpandId] = useState<string | null>(null);

  if (!summary?.text) return null;

  const localCount = conv?.messages.length ?? 0;
  const absorbed = Math.max(0, summary.upToIndex ?? 0);
  const oldMsgs = (conv?.messages ?? []).slice(0, absorbed);
  const shownOld = oldMsgs.slice(Math.max(0, oldMsgs.length - oldLimit));

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
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-1 mb-2">
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
          更早的对话（摘要 · 吸收了 {summary.covered} 条）
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
                rows={6}
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
              <p className="text-[12px] leading-5 whitespace-pre-wrap">{summary.text}</p>
              <p className="mt-2 text-[11px] leading-4 text-subtle">
                这段原文已经不再发给他了，换成了上面的摘要（约省 {saved} token）。
                觉得写得不对就改，或者重摘一次。
              </p>
              <p className="mt-1 text-[11px] leading-4 text-subtle">
                本地共 {localCount} 条 · 摘要覆盖前 {absorbed} 条（原文都还在，下面能翻）
              </p>

              {/* 被吸收的原文 —— 只影响"发给他的上下文"，不影响你翻看历史 */}
              <button
                type="button"
                onClick={() => setShowOld((v) => !v)}
                className="mt-2 flex items-center gap-1 rounded-full bg-elevated px-3 py-2 text-[12px]"
              >
                <ChevronRight
                  className={cn("size-3.5 transition-transform", showOld && "rotate-90")}
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
                {showOld ? "收起原文" : `查看被吸收的 ${absorbed} 条原文`}
              </button>
              {showOld && (
                <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-line bg-elevated px-2.5 py-2">
                  {shownOld.length === 0 ? (
                    <p className="py-2 text-[11px] leading-4 text-subtle">
                      摘要覆盖的范围内本地没有消息（可能是摘要生成后又清过记录）。
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {shownOld.map((m) => {
                        const long = (m.content ?? "").length > 240;
                        const body =
                          long && expandId !== m.id
                            ? `${(m.content ?? "").slice(0, 240)}…`
                            : m.content;
                        return (
                          <li key={m.id} className="text-[11px] leading-4">
                            <span className="mr-1.5 text-subtle">
                              {new Date(m.createdAt).toLocaleString("zh-CN", {
                                month: "numeric",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            <span className="mr-1 text-subtle">
                              {m.role === "user" ? "你" : "他"}
                            </span>
                            <span className="whitespace-pre-wrap break-words text-muted">
                              {body || "（空）"}
                            </span>
                            {long && (
                              <button
                                type="button"
                                onClick={() => setExpandId(expandId === m.id ? null : m.id)}
                                className="ml-1 text-subtle underline decoration-dotted"
                              >
                                {expandId === m.id ? "收起" : "展开"}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {oldMsgs.length > shownOld.length && (
                    <button
                      type="button"
                      onClick={() => setOldLimit((n) => n + 40)}
                      className="mt-2 w-full rounded-full bg-chip px-3 py-2 text-[11px] text-muted"
                    >
                      再往前看 40 条
                    </button>
                  )}
                </div>
              )}
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
