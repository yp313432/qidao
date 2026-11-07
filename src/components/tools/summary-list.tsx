import { useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { ToolCard } from "@/components/tools/tool-card";
import { KButton, KChip, KEmpty } from "@/components/ui-kit";
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
 * 2026-11 布局改版（用户："每个都好大一块……没有交互逻辑"）：
 * 一行一条（标题 + 字数/日期 + 折角），点开才显示全文与操作；说明收进底部折叠。
 *
 * ⚠️ 摘要**不是**只存在这儿：它同时以「【更早的对话（摘要，原文已不再带上）】」
 * 的形式挂在请求历史的**最前面**（`use-chat.ts`），那才是它给 AI 看的用途；
 * 对话顶部那条「更早的对话（摘要）」也一直在（能看能改）。
 *
 * 2026-11-07 阶段3 迁移：外框换成 kit 的 `ToolCard`。
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
    <div className="k-list">
      <div className="k-sect">
        <p className="k-sect__title">摘要 · {withSummary.length} 条</p>
        <span className="k-stat">{keepRecent ? `最近 ${keepRecent} 条不摘` : ""}</span>
      </div>

      {msg && (
        <p className="k-stat" data-tone="ok">
          {msg}
        </p>
      )}

      {withSummary.length === 0 && (
        <KEmpty
          title="还没有任何摘要"
          hint={activeId ? "可以点下面那个按钮，为当前对话摘一份。" : undefined}
        />
      )}

      <div className="k-list">
        {withSummary.map((c, i) => {
          const s = c.summary!;
          const saved = Math.max(0, s.sourceTokens - s.tokens);
          const open = openId === c.id;
          return (
            <ToolCard
              key={c.id}
              title={c.title || "（没标题的对话）"}
              open={open}
              onToggle={() => setOpenId(open ? null : c.id)}
              meta={
                <>
                  <KChip>摘要</KChip>
                  <span className="k-stat" data-tone="ok">
                    约 {s.text.length} 字 · 吸收 {s.covered} 条
                    {saved > 0 ? ` · 省 ${saved} tokens` : ""}
                  </span>
                  <span className="k-stat">{formatDay(s.updatedAt)}</span>
                  <span className="k-stat">No.{String(i + 1).padStart(2, "0")}</span>
                </>
              }
            >
              {editingId === c.id ? (
                <>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="k-long k-long--input"
                    aria-label="编辑摘要"
                  />
                  <div className="k-acts">
                    <KButton
                      variant="primary"
                      onClick={() => {
                        useApp.getState().patchSummary(c.id, { text: draft });
                        setEditingId(null);
                        setMsg("改好了 —— 下一轮就按这一版发给他。");
                      }}
                    >
                      存
                    </KButton>
                    <KButton onClick={() => setEditingId(null)}>取消</KButton>
                  </div>
                </>
              ) : (
                <>
                  <p className="k-long">{s.text}</p>
                  <div className="k-acts">
                    <KButton
                      onClick={() => {
                        setDraft(s.text);
                        setEditingId(c.id);
                      }}
                    >
                      改
                    </KButton>
                    <KButton disabled={busyId === c.id} onClick={() => void summarize(c.id)}>
                      <RefreshCw aria-hidden="true" />
                      {busyId === c.id ? "重摘中…" : "重摘"}
                    </KButton>
                    <KButton
                      onClick={() => {
                        useApp.getState().clearSummary(c.id);
                        setMsg("删掉了 —— 原文会重新进上下文（这块就不省 token 了）。");
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                      删掉摘要
                    </KButton>
                  </div>
                </>
              )}
            </ToolCard>
          );
        })}
      </div>

      {activeId && (
        <KButton
          variant="dashed"
          block
          disabled={busyId === activeId}
          onClick={() => void summarize(activeId)}
        >
          {busyId === activeId ? "总结中…" : "为当前这段对话现在就摘一次"}
        </KButton>
      )}

      <details className="k-note">
        <summary>说明 · 摘要在做什么</summary>
        <div className="k-note__body">
          <p>
            摘要 = 更早那些对话的压缩版：原文不再发给 AI，摘要代替它挂在历史最前面。长对话（约每
            15~20 轮）会自动做一次；平时也可以在这儿手动摘。
          </p>
          <p>对话顶部那条「更早的对话（摘要）」跟这里是同一份，能看也能改。</p>
        </div>
      </details>
    </div>
  );
}
