import { useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { summarizeNow } from "@/lib/summarizer";
import { useApp } from "@/lib/store";
import { formatDay } from "@/lib/utils";

/**
 * **对话摘要**（工具 → 摘要）。
 *
 * 用户 2026-11 的原话：
 *   "这个摘要总结完在哪，没看到啊" → 然后："你把摘要后的直接写到工具区的那个文档里面，
 *    就把那个文档改做摘要总结吧。因为那个文档我看一直没用上……但是聊天页面也要里保留，
 *    因为他不是要当做 AI 能知道的上下文吗？"
 *
 * ── 所以这里解决三件事 ──────────────────────────────────────
 *   1. **摘要有个家了**：每条对话的摘要都列在这儿（标题 + 约多少字 + 省了多少 token）
 *   2. **能自己动手**：点开看全文、能改、能重摘、能删
 *   3. **点完必须有回话**：`summarizeNow()` 在"没得可摘"时会返回 null ——
 *      原来界面上**一个字都不说**（用户就是这么被坑的），这里如实说清原因
 *
 * ⚠️ 摘要**不是**只存在这儿：它同时以「【更早的对话（摘要，原文已不再带上）】」
 * 的形式挂在请求历史的**最前面**（`use-chat.ts`），那才是它给 AI 看的用途；
 * 对话顶部那条「更早的对话（摘要）」也一直在（能看能改）。
 */
export function SummaryList() {
  const conversations = useApp((s) => s.conversations);
  const activeId = useApp((s) => s.activeId);
  const keepRecent = useApp((s) => s.settings.keepRecent);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const withSummary = conversations.filter((c) => c.summary?.text);

  /**
   * 「现在就摘一次」——**不管成没成都要有一句话**。
   * `summarizeNow` 返回 null 的两种情况：这段对话还不够长（没有"最近 N 条之外"的更早消息）、
   * 或者那条线上本来就没内容。原来这两种都静默，用户只会觉得按钮坏了。
   */
  async function summarize(conversationId: string) {
    setBusyId(conversationId);
    setMsg("");
    try {
      const text = await summarizeNow(conversationId);
      const conv = useApp.getState().conversations.find((c) => c.id === conversationId);
      if (!text) {
        setMsg(
          `没得可摘 —— 摘要压的是「最近 ${keepRecent ?? 16} 条之外」的更早消息；` +
            `这段对话还不够长（或者那一截已经摘过了）。等聊长了它会自己摘。`,
        );
        return;
      }
      setMsg(`摘好了（约 ${text.length} 字）—— 就在下面这一条里，点开能看能改。`);
      setOpenId(conversationId);
      void conv;
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-4 text-subtle">
        摘要 = 更早那些对话的压缩版：**原文不再发给 AI，摘要代替它挂在历史最前面**。
        长对话（约每 15~20 轮）会自动做一次；平时也可以在这儿手动摘。
      </p>

      {msg && (
        <p className="rounded-2xl bg-chip px-3.5 py-2.5 text-[12px] leading-5 text-ok">{msg}</p>
      )}

      {withSummary.length === 0 && (
        <p className="py-6 text-center text-[12px] text-muted">
          还没有任何摘要。
          {activeId ? "（可以点下面那个按钮，为当前对话摘一份）" : ""}
        </p>
      )}

      {withSummary.map((c) => {
        const s = c.summary!;
        const saved = Math.max(0, s.sourceTokens - s.tokens);
        const open = openId === c.id;
        return (
          <article key={c.id} className="rounded-2xl border border-line bg-surface px-4 py-3">
            <button
              type="button"
              className="w-full text-left"
              onClick={() => setOpenId(open ? null : c.id)}
            >
              <p className="font-medium">{c.title || "（没标题的对话）"}</p>
              <p className="text-[12px] text-muted">
                约 {s.text.length} 字 · {s.tokens} tokens · 吸收 {s.covered} 条
                {saved > 0 ? ` · 省了约 ${saved} tokens` : ""} · {formatDay(s.updatedAt)}
              </p>
            </button>

            {open && (
              <div className="mt-2.5">
                {editingId === c.id ? (
                  <>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={6}
                      className="w-full rounded-2xl bg-elevated px-3 py-2 text-[13px] leading-6"
                      aria-label="编辑摘要"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          useApp.getState().patchSummary(c.id, { text: draft });
                          setEditingId(null);
                          setMsg("改好了 —— 下一轮就按这一版发给他。");
                        }}
                        className="rounded-full bg-ink px-3.5 py-2 text-[12px] text-ink-fg"
                      >
                        存
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-full bg-chip px-3.5 py-2 text-[12px] text-muted"
                      >
                        取消
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-elevated px-3 py-2 text-[13px] leading-6 text-muted">
                      {s.text}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDraft(s.text);
                          setEditingId(c.id);
                        }}
                        className="rounded-full bg-chip px-3.5 py-2 text-[12px]"
                      >
                        改
                      </button>
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => void summarize(c.id)}
                        className="flex items-center gap-1.5 rounded-full bg-chip px-3.5 py-2 text-[12px] disabled:opacity-40"
                      >
                        <RefreshCw className="size-3" strokeWidth={2} aria-hidden="true" />
                        {busyId === c.id ? "重摘中…" : "重摘"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          useApp.getState().clearSummary(c.id);
                          setMsg("删掉了 —— 原文会重新进上下文（这块就不省 token 了）。");
                        }}
                        className="flex items-center gap-1.5 rounded-full bg-chip px-3.5 py-2 text-[12px] text-muted"
                      >
                        <Trash2 className="size-3" strokeWidth={2} aria-hidden="true" />
                        删掉摘要
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </article>
        );
      })}

      {activeId && (
        <button
          type="button"
          disabled={busyId === activeId}
          onClick={() => void summarize(activeId)}
          className="w-full rounded-2xl border border-dashed border-line py-3 text-[12px] text-muted disabled:opacity-40"
        >
          {busyId === activeId ? "总结中…" : "为当前这段对话现在就摘一次"}
        </button>
      )}
    </div>
  );
}
