import { useState } from "react";
import { Mail, MailOpen, Send, Sparkles } from "lucide-react";
import { SceneBackdrop } from "@/components/background-layer";
import { PlayHeader } from "@/components/play-header";
import { DiaryWall } from "@/components/play/diary-view";
import { LetterViewer } from "@/components/play/letter-envelope";
import { useApp } from "@/lib/store";
import type { Letter, MoodId } from "@/lib/types";
import { cn, formatClock, formatDay } from "@/lib/utils";

const MOODS: { id: MoodId; label: string }[] = [
  { id: "calm", label: "平静" },
  { id: "joy", label: "开心" },
  { id: "spark", label: "心动" },
  { id: "focus", label: "专注" },
  { id: "miss", label: "想你" },
  { id: "low", label: "低落" },
];

const TONE: Record<MoodId, string> = {
  calm: "bg-sky-400",
  joy: "bg-amber-400",
  spark: "bg-fuchsia-400",
  focus: "bg-emerald-400",
  miss: "bg-rose-400",
  low: "bg-slate-400",
};

const EN_TOP: Record<string, string> = {
  moments: "how are you feeling, right now",
  diary: "some days are only for keeping",
  letters: "letters take longer — that is why they work",
};

const EN_BOTTOM: Record<string, string> = {
  moments: "feelings arrive before words do",
  diary: "put it down before it fades",
  letters: "keep it somewhere warm",
};

type Tab = "moments" | "diary" | "letters";

/**
 * 动态空间：三层。
 *
 *   动态 —— 即时心情（他发的 / 我发的）
 *   日记 —— 一天至少一篇，可写多篇；便签墙 + 展开动画
 *   信   —— 他写给我的信；拆信动画在哪都是同一套
 *
 * 上下各一句英文，纯装饰。
 */
export function SpaceView() {
  const settings = useApp((s) => s.settings);
  const [tab, setTab] = useState<Tab>("moments");
  const [openLetter, setOpenLetter] = useState<Letter | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SceneBackdrop image={settings.diaryImage} />
      <PlayHeader title="动态空间" />

      <div className="px-4">
        <p className="text-center text-[10px] tracking-[0.28em] text-subtle uppercase">
          {EN_TOP[tab]}
        </p>
        <div className="mt-3 grid grid-cols-3 gap-1 rounded-full bg-chip p-1">
          {(
            [
              ["moments", "动态"],
              ["diary", "日记"],
              ["letters", "信"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "rounded-full py-2 text-[12px] font-medium",
                tab === id ? "bg-elevated text-fg shadow-sm" : "text-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-above-nav">
        {tab === "moments" && <MomentsSection />}
        {tab === "diary" && <DiaryWall />}
        {tab === "letters" && <LettersSection onOpen={setOpenLetter} />}

        <p className="mt-10 text-center text-[10px] tracking-[0.28em] text-subtle uppercase">
          {EN_BOTTOM[tab]}
        </p>
      </div>

      {openLetter && (
        <LetterViewer
          letter={openLetter}
          onClose={() => {
            useApp.getState().markLetterSeen(openLetter.id);
            setOpenLetter(null);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ 动态 */

function MomentsSection() {
  const moments = useApp((s) => s.moments);
  const [mood, setMood] = useState<MoodId>("calm");
  const [text, setText] = useState("");

  function post() {
    const t = text.trim();
    if (!t) return;
    useApp.getState().addMoment(mood, t, "me");
    setText("");
  }

  return (
    <div className="space-y-3">
      <div className="rounded-3xl border border-line bg-surface px-4 py-4">
        <p className="text-[13px] font-medium">此刻的心情</p>
        <p className="mt-0.5 text-[11px] leading-4 text-muted">
          随手记一下。他自己也会发 —— 那要等他接上 AI（权限里也得允许「发布动态」）。
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {MOODS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMood(m.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium",
                mood === m.id ? "bg-ink text-ink-fg" : "bg-chip",
              )}
            >
              <span className={cn("size-1.5 rounded-full", TONE[m.id])} />
              {m.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") post();
            }}
            aria-label="此刻的心情"
            placeholder="此刻想到什么…"
            className="min-w-0 flex-1 rounded-2xl bg-chip px-3.5 py-2.5 text-[13px] outline-none placeholder:text-subtle"
          />
          <button
            type="button"
            aria-label="发一条动态"
            onClick={post}
            className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-ink text-ink-fg"
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>

      {moments.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line px-6 py-10 text-center">
          <Sparkles className="mx-auto size-6 text-muted" strokeWidth={1.5} />
          <p className="mt-3 text-[13px] text-muted">还没有动态。上面记一条试试。</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {moments.map((m) => {
            const label = MOODS.find((x) => x.id === m.mood)?.label ?? "";
            return (
              <li key={m.id}>
                <div className="group flex items-start gap-3 rounded-3xl border border-line bg-surface px-4 py-3">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", TONE[m.mood])} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-6">{m.text}</p>
                    <p className="mt-1 text-[11px] text-subtle">
                      {m.by === "ai" ? "他" : "我"} · {label} · {formatDay(m.at)}{" "}
                      {formatClock(m.at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="删掉这条动态"
                    onClick={() => useApp.getState().deleteMoment(m.id)}
                    className="shrink-0 text-[11px] text-subtle"
                  >
                    删
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ 信 */

function LettersSection({ onOpen }: { onOpen: (l: Letter) => void }) {
  const letters = useApp((s) => s.letters);
  const [demo, setDemo] = useState(false);

  return (
    <div className="space-y-3">
      {letters.length === 0 && !demo && (
        <div className="rounded-3xl border border-line bg-surface px-5 py-10 text-center">
          <Mail className="mx-auto size-7 text-muted" strokeWidth={1.5} />
          <p className="mt-4 text-[14px] font-medium">他还没写过信</p>
          <p className="mt-2 text-[12px] leading-5 text-muted">
            信是他写给你的 —— 接上 AI 之后他可以自己写。
            <br />
            想先看看拆信是什么样子？
          </p>
          <button
            type="button"
            onClick={() => setDemo(true)}
            className="mt-4 rounded-full bg-chip px-4 py-2.5 text-[12px] font-medium"
          >
            看一遍拆信动画
          </button>
        </div>
      )}

      {demo && (
        <div className="rounded-3xl border border-dashed border-line px-4 py-4">
          <p className="text-[11px] leading-4 text-subtle">
            下面是**演示**用的信 —— 内容是我写的占位文字，不是他写的，看完可以在旁边删掉。
          </p>
          <button
            type="button"
            onClick={() => {
              const id = useApp
                .getState()
                .writeLetter(
                  "演示：一封占位信",
                  "这封信是演示用的，内容由我（App）写的占位文字，不是他写的。\n\n拆信的动画就是你现在看到的这一套：信封浮着、盖子翻过去、蜡封裂开、信纸升起来、正文一句一句浮出来。\n\n他在真的写信时，走的是同一套动画。",
                );
              const l = useApp.getState().letters.find((x) => x.id === id);
              if (l) onOpen(l);
              setDemo(false);
            }}
            className="mt-3 w-full rounded-2xl bg-chip py-3 text-[13px] font-medium"
          >
            放一封演示信进来并拆开
          </button>
        </div>
      )}

      {letters.length > 0 && (
        <ul className="space-y-2">
          {letters.map((l) => (
            <li key={l.id}>
              <div className="flex items-center gap-1 overflow-hidden rounded-3xl border border-line bg-surface pr-1">
                <button
                  type="button"
                  onClick={() => {
                    onOpen(l);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-chip text-accent">
                    {l.seen ? <MailOpen className="size-4" /> : <Mail className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-medium">{l.title}</span>
                      {!l.seen && (
                        <span className="shrink-0 rounded-full bg-accent/20 px-2 py-0.5 text-[10px] text-accent">
                          没拆过
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted">
                      {formatDay(l.at)} {formatClock(l.at)} · 点开拆信
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="删掉这封信"
                  onClick={() => useApp.getState().deleteLetter(l.id)}
                  className="shrink-0 px-2 text-[11px] text-subtle"
                >
                  删
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
