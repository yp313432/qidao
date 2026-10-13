import { useState } from "react";
import { Heart, Send, Sparkles } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { SceneBackdrop } from "@/components/background-layer";
import { PlayHeader } from "@/components/play-header";
import { resolveAiName } from "@/lib/branding";
import { useApp } from "@/lib/store";
import type { Moment } from "@/lib/types";
import { cn, formatClock, formatDay } from "@/lib/utils";

/**
 * 朋友圈 —— 「玩乐 → 动态空间 → 动态」那一页。
 *
 * ── 2026-10 从"动态流"改成仿微信朋友圈（用户定的）─────────────────
 * 用户原话："动态空间咱们改一下吧，改成仿微信朋友圈的那种。就是他发一条，
 * 我可以在下面回复点赞，然后我也可以发，然后他也可以看到回复那种。"
 *
 * 所以这一页每张卡从"一条平铺的心情"变成：
 *   · 头像 + 名字 + 时间 + 正文
 *   · **点赞行**（♡ + 谁点了）与**评论列表**（多轮，`名字：内容`）
 *   · **底部一行输入**（我在这条下面回）
 * 上面一个「写点什么…」的发表入口 —— 我发的、他发的**都在同一条列表里**。
 *
 * ── 一并撤掉的两样（用户定的"删心情标签"）─────────────────────────
 *   · 那排心情胶囊（开心 / 平静…）**整排删掉**，新动态不再带心情；
 *   · 卡片上原来那个彩色小圆点 + 心情名也不再显示。
 * 旧存档里那份 `moment.mood` **数据不删**（切回老存储还要原样拼回去），
 * 只是从界面上消失 —— 这就是"旧数据不删、不显示、不新增"。
 *
 * ── 两条纪律（都是踩过的坑）──────────────────────────────────────
 *   · 旧动态**没有** `likes` / `comments` 这两个键 → 一律 `?? []` 兜底，
 *     不许直接 `.length`（8 号 bug 的根因就是"键不存在"被当成数据）。
 *   · 空集合写回去时**显式写 `[]`**（见 store 的 toggleMomentLike）。
 */
export function MomentsWall() {
  const settings = useApp((s) => s.settings);
  const moments = useApp((s) => s.moments);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SceneBackdrop image={settings.diaryImage} />
      <PlayHeader title="朋友圈" />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <Composer />

        {moments.length === 0 ? (
          <div className="mt-3 rounded-3xl border border-dashed border-line px-6 py-10 text-center">
            <Sparkles className="mx-auto size-6 text-muted" strokeWidth={1.5} />
            <p className="mt-3 text-[13px] text-muted">还没有动态。上面写一条试试。</p>
          </div>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {moments.map((m) => (
              <li key={m.id}>
                <MomentCard moment={m} />
              </li>
            ))}
          </ul>
        )}

        <p className="mt-10 text-center text-[10px] tracking-[0.28em] text-subtle uppercase">
          feelings arrive before words do
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 发表 */

/**
 * 我发一条。
 *
 * 微信那种"发表入口"：平时只是一行（头像 + 一句灰字），点一下才展开输入框 ——
 * 空着一大片输入框挂在最上面，反而把动态挤下去了。
 */
function Composer() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  function publish() {
    const t = text.trim();
    if (!t) return;
    useApp.getState().addMoment(t, "me");
    setText("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-3xl border border-line bg-surface px-4 py-3 text-left"
      >
        <Avatar role="user" size={32} />
        <span className="min-w-0 flex-1 truncate text-[13px] text-subtle">写点什么…</span>
        <span className="shrink-0 rounded-full bg-chip px-3 py-1.5 text-[12px] font-medium text-accent">
          发表
        </span>
      </button>
    );
  }

  return (
    <div className="rounded-3xl border border-line bg-surface px-4 py-3">
      <textarea
        autoFocus
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="写一条动态"
        placeholder="此刻想到什么…"
        className="w-full resize-none bg-transparent text-[13px] leading-6 outline-none placeholder:text-subtle"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setText("");
          }}
          className="rounded-full bg-chip px-3.5 py-2 text-[12px] text-muted"
        >
          取消
        </button>
        <button
          type="button"
          onClick={publish}
          disabled={!text.trim()}
          className="flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-[12px] font-medium text-ink-fg disabled:opacity-45"
        >
          <Send className="size-3.5" />
          发表
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 一张卡 */

function MomentCard({ moment }: { moment: Moment }) {
  const settings = useApp((s) => s.settings);
  const aiName = resolveAiName(settings.aiName);
  const myName = settings.displayName || "我";
  const [text, setText] = useState("");

  const likes = moment.likes ?? [];
  const comments = moment.comments ?? [];
  const mine = moment.by === "me";
  const likedByMe = likes.some((l) => l.by === "me");
  /** 名字只有一处口径：他 = AI 名字，我 = 用户填的显示名（没填就"我"） */
  const nameOf = (by: "ai" | "me") => (by === "ai" ? aiName : myName);

  function comment() {
    const t = text.trim();
    if (!t) return;
    useApp.getState().addMomentComment(moment.id, "me", t);
    setText("");
  }

  return (
    <article className="rounded-3xl border border-line bg-surface px-4 py-3.5">
      <div className="flex items-start gap-3">
        <Avatar role={mine ? "user" : "ai"} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 truncate text-[13px] font-medium">{nameOf(moment.by)}</span>
            <span className="shrink-0 text-[11px] text-subtle">
              {formatDay(moment.at)} {formatClock(moment.at)}
            </span>
          </div>

          <p className="mt-1 text-[13px] leading-6 break-words whitespace-pre-wrap">{moment.text}</p>

          {/* 点赞行 + 评论列表（微信那样合成一块浅底） */}
          {(likes.length > 0 || comments.length > 0) && (
            <div className="mt-2.5 space-y-1.5 rounded-2xl bg-chip px-3 py-2">
              {likes.length > 0 && (
                <p className="flex items-start gap-1.5 text-[12px] leading-5">
                  <Heart
                    className="mt-0.5 size-3.5 shrink-0 text-accent"
                    fill="currentColor"
                    strokeWidth={0}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 break-words">
                    {likes.map((l) => nameOf(l.by)).join("、")}
                  </span>
                </p>
              )}
              {comments.map((c) => (
                <p key={c.id} className="text-[12px] leading-5 break-words">
                  <span className="text-accent">{nameOf(c.by)}</span>
                  <span className="text-subtle">：</span>
                  <span>{c.text}</span>
                </p>
              ))}
            </div>
          )}

          {/* 底部一行：写评论 + 点赞 */}
          <div className="mt-2 flex items-center gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") comment();
              }}
              aria-label="写评论"
              placeholder="写评论…"
              className="min-w-0 flex-1 rounded-2xl bg-chip px-3 py-2 text-[12px] outline-none placeholder:text-subtle"
            />
            {text.trim() !== "" && (
              <button
                type="button"
                onClick={comment}
                aria-label="发表评论"
                className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-ink text-ink-fg"
              >
                <Send className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => useApp.getState().toggleMomentLike(moment.id, "me")}
              aria-label={likedByMe ? "取消赞" : "点赞"}
              aria-pressed={likedByMe}
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-2xl",
                likedByMe ? "bg-accent/15 text-accent" : "bg-chip text-muted",
              )}
            >
              <Heart
                className="size-4"
                strokeWidth={1.7}
                fill={likedByMe ? "currentColor" : "none"}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>

        <button
          type="button"
          aria-label="删掉这条动态"
          onClick={() => useApp.getState().deleteMoment(moment.id)}
          className="shrink-0 text-[11px] text-subtle"
        >
          删
        </button>
      </div>
    </article>
  );
}
