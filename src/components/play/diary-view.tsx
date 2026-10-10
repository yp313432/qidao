import { useState } from "react";
import { useApp } from "@/lib/store";
import { MOOD_TERMS, moodDisplay } from "@/lib/emotion-lexicon";
import type { DiaryEntry } from "@/lib/types";
import { cn, formatClock, formatDay } from "@/lib/utils";

/**
 * 日记的心情也**跟星屿共用同一张新词表**（`lib/emotion-lexicon.ts`）。
 *
 * 旧的 11 维花瓣词表退休后（用户："就是那 11 个就不用了"），这里取的是新词表
 * **每组一个代表词**（13 个）—— 217 个词铺成按钮不是"换词表"，是重做界面，
 * 而用户明说不要新做界面。AI 上报侧不受影响（那是完整的 13 组 / 217 词）。
 */
const MOODS: { id: DiaryEntry["mood"]; label: string }[] = MOOD_TERMS.map((term) => ({
  id: term,
  label: term,
}));

/**
 * 每种心情一种纸色 —— 直接拿词表里的颜色调透明度，
 * 不再每种心情各写一套 Tailwind 渐变（改词表时不会漏）。
 */
function paperTint(id: string): string {
  const c = moodDisplay(id).color;
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(c);
  if (!m) return "transparent";
  return `linear-gradient(to bottom right, rgba(${m[1]},${m[2]},${m[3]},0.3), rgba(${m[1]},${m[2]},${m[3]},0.06))`;
}

const TILT = ["-rotate-[1.2deg]", "rotate-[0.9deg]", "-rotate-[0.4deg]", "rotate-[1.4deg]"];

function clip(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * 日记：便签墙。
 *
 * **不限制一天一篇** —— 想写随时写，一条一个时间戳；上面显示连续天数，
 * 提醒「至少一天一篇」。纸上带日期和心情，点一张慢慢展开看全文。
 */
export function DiaryWall() {
  const diary = useApp((s) => s.diary);
  const streak = useApp((s) => s.diaryStreak());
  const today = useApp((s) => s.todayDiary());
  // 默认心情取新词表里的「平静」（B 组的代表词）—— 不再是旧 id "reflect"
  const [mood, setMood] = useState<DiaryEntry["mood"]>(MOOD_TERMS[1] ?? "平静");
  const [body, setBody] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);

  function publish() {
    const t = body.trim();
    if (!t) return;
    useApp.getState().addDiary(mood, t);
    setBody("");
    setWriting(false);
  }

  return (
    <div className="space-y-3">
      {/* 连续天数：今天写了从今天算，没写就从昨天往回算 —— 所以今天没写也不立刻断 */}
      <div className="flex items-center justify-between rounded-3xl border border-line bg-surface px-4 py-3">
        <div>
          <p className="text-[13px] font-medium">
            {today ? "今天写过了" : "今天还没写"}
            {streak > 1 ? ` · 连续 ${streak} 天` : ""}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            想写随时写，一天可以写好几篇；至少给自己留一篇。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setWriting((v) => !v)}
          className="shrink-0 rounded-full bg-chip px-3.5 py-2 text-[12px] font-medium text-accent"
        >
          {writing ? "收起" : "写一张"}
        </button>
      </div>

      {/* 写一张：展开时才占地方 */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-500 ease-out",
          writing ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="aster-card relative overflow-hidden rounded-[1.5rem] border border-line p-4">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-100/40 via-transparent to-rose-100/20" />
            <div className="relative">
              <div className="flex flex-wrap gap-1.5">
                {MOODS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMood(m.id)}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-[12px] font-medium",
                      mood === m.id ? "bg-ink text-ink-fg" : "bg-chip",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                placeholder="写给今天的纸页…"
                className="mt-3 w-full resize-none bg-transparent text-[15px] leading-6 outline-none placeholder:text-subtle"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={publish}
                  className="rounded-full bg-ink px-4 py-2 text-sm text-ink-fg"
                >
                  贴上去
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {diary.length === 0 && !writing && (
        <p className="py-10 text-center text-sm text-muted">
          还没有写过。点右上角「写一张」贴第一张纸。
        </p>
      )}

      {/* 便签墙：两列瀑布流，每张略微歪一点 */}
      <div className="columns-2 gap-3">
        {diary.map((d, i) => {
          const open = openId === d.id;
          const moodLabel = moodDisplay(d.mood).label;
          return (
            <button
              key={d.id}
              type="button"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : d.id)}
              className={cn(
                "aster-card relative mb-3 block w-full break-inside-avoid overflow-hidden rounded-[1.25rem] border border-line px-3.5 py-3 text-left transition-transform duration-300",
                TILT[i % TILT.length],
                open && "rotate-0 scale-[1.02]",
              )}
            >
              <span
                className="pointer-events-none absolute inset-0"
                style={{ backgroundImage: paperTint(d.mood) }}
              />
              <span
                className="pointer-events-none absolute top-0 right-0 size-5 bg-fg/8"
                style={{ clipPath: "polygon(100% 0, 0 0, 100% 100%)" }}
              />
              <span className="relative block">
                <span className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-accent" />
                  <span className="text-[11px] text-muted">{moodLabel}</span>
                </span>
                <span className="mt-1.5 block text-[13px] leading-5">
                  {open ? d.body : clip(d.body, d.body.length > 60 ? 46 : 60)}
                </span>

                <span
                  className={cn(
                    "grid transition-[grid-template-rows] duration-500 ease-out",
                    open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                  )}
                >
                  <span className="overflow-hidden">
                    <span className="mt-2 block border-t border-line pt-2 text-[11px] text-subtle">
                      {formatDay(d.createdAt)} {formatClock(d.createdAt)}
                    </span>
                  </span>
                </span>

                {!open && (
                  <span className="mt-1.5 block text-[10px] text-subtle">
                    {formatDay(d.createdAt)} · 点开看全文
                  </span>
                )}

                {open && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      useApp.getState().deleteDiary(d.id);
                      setOpenId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        useApp.getState().deleteDiary(d.id);
                        setOpenId(null);
                      }
                    }}
                    className="mt-2 inline-block rounded-full bg-chip px-2.5 py-1 text-[11px] text-muted"
                  >
                    删除这张
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
