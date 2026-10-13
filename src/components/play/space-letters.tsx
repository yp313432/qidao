import { useState } from "react";
import { Mail, MailOpen } from "lucide-react";
import { SceneBackdrop } from "@/components/background-layer";
import { PlayHeader } from "@/components/play-header";
import { LetterViewer } from "@/components/play/letter-envelope";
import { useApp } from "@/lib/store";
import type { Letter } from "@/lib/types";
import { formatClock, formatDay } from "@/lib/utils";

/**
 * 信 —— 「玩乐 → 动态空间 → 信」那一页。
 *
 * ── 为什么从"页签"搬成一整页（2026-10，用户定的）──────────────────
 * 跟日记同一条理由：动态/日记/信 各成一页，动态空间只当目录。
 * ⚠️ 信**里面的样子没动**：列表、没拆标记、拆信动画（`LetterViewer`）都照旧，
 * 这里只加了"一整页"的外框。
 */
export function LettersPage() {
  const settings = useApp((s) => s.settings);
  const [openLetter, setOpenLetter] = useState<Letter | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SceneBackdrop image={settings.diaryImage} />
      <PlayHeader title="信" />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <LettersSection onOpen={setOpenLetter} />

        <p className="mt-10 text-center text-[10px] tracking-[0.28em] text-subtle uppercase">
          keep it somewhere warm
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

/* ------------------------------------------------------------------ 信列表 */

function LettersSection({ onOpen }: { onOpen: (l: Letter) => void }) {
  const letters = useApp((s) => s.letters);
  const [demo, setDemo] = useState(false);

  return (
    <div className="space-y-3">
      {letters.length === 0 && !demo && (
        <div className="rounded-3xl border border-line bg-surface px-5 py-10 text-center">
          <Mail className="mx-auto size-7 text-muted" strokeWidth={1.5} />
          <p className="mt-4 text-[13px] font-medium">他还没写过信</p>
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
            下面是<span className="text-fg">演示</span>用的信 ——
            内容是我写的占位文字，不是他写的，看完可以在旁边删掉。
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
                      <span className="truncate text-[13px] font-medium">{l.title}</span>
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
