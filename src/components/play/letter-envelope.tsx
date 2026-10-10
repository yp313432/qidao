import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Letter } from "@/lib/types";
import { cn, formatClock, formatDay } from "@/lib/utils";

/**
 * 拆信。
 *
 * 三段式，故意的慢：
 *   1. 信封躺着 + 蜡封，轻轻浮着
 *   2. 盖子绕上边翻过去，蜡封裂开
 *   3. 信纸从信封里升起来，铺满，正文逐段淡入
 *
 * 从「信」列表点开也走同一套动画 —— 不是只有新信才有仪式感。
 */
export function LetterViewer({
  letter,
  onClose,
  auto = false,
}: {
  letter: Letter;
  onClose: () => void;
  /** true = 一进来就自动拆（前端跳出来的那封） */
  auto?: boolean;
}) {
  const [phase, setPhase] = useState<"envelope" | "opening" | "open">(
    auto ? "envelope" : "envelope",
  );

  // 跳出来的那封自动拆；手动点开的等你自己按
  useEffect(() => {
    if (!auto) return;
    const t1 = window.setTimeout(() => setPhase("opening"), 900);
    const t2 = window.setTimeout(() => setPhase("open"), 2400);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [auto]);

  function open() {
    if (phase !== "envelope") return;
    setPhase("opening");
    window.setTimeout(() => setPhase("open"), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg/92 backdrop-blur-xl">
      {phase !== "open" && (
        <div className="flex flex-1 flex-col items-center justify-center px-8" onClick={open}>
          <p className="mb-8 text-center text-[10px] tracking-[0.35em] text-subtle uppercase">
            a letter for you
          </p>

          <div className="env-stage" role="button" aria-label="拆开这封信">
            <div className={cn("env-body", phase === "opening" && "is-open")}>
              {/* 信纸 */}
              <div className={cn("env-letter", phase === "opening" && "is-out")}>
                <span className="block h-2 w-3/5 rounded bg-fg/10" />
                <span className="mt-2 block h-2 w-4/5 rounded bg-fg/10" />
                <span className="mt-2 block h-2 w-2/3 rounded bg-fg/10" />
              </div>
              {/* 信封本体 */}
              <div className="env-pocket" />
              {/* 盖子 */}
              <div className={cn("env-flap", phase === "opening" && "is-flipped")} />
              {/* 蜡封 */}
              <div className={cn("env-seal", phase === "opening" && "is-broken")}>
                <span className="font-serif text-[13px] text-white/90">✦</span>
              </div>
            </div>
          </div>

          <p className="mt-10 text-center font-serif text-[15px] text-muted">
            {phase === "envelope" ? "点一下拆开" : "正在展开…"}
          </p>
        </div>
      )}

      {/* 展开的信 */}
      {phase === "open" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="flex items-center gap-1 px-2 inset-top-75 pb-1">
            <span className="size-9" />
            <p className="flex-1 text-center text-[10px] tracking-[0.3em] text-subtle uppercase">
              from her
            </p>
            <button
              type="button"
              aria-label="收起来"
              onClick={onClose}
              className="flex size-9 items-center justify-center rounded-full bg-chip text-muted"
            >
              <X className="size-4" />
            </button>
          </header>

          <div className="aster-letter-scroll min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-above-nav">
            <h2 className="font-serif text-2xl leading-9 font-medium">{letter.title}</h2>
            <p className="mt-2 text-[11px] tracking-wide text-subtle">
              {formatDay(letter.at)} {formatClock(letter.at)}
            </p>
            <div className="mt-6 space-y-4">
              {letter.body.split(/\n{2,}|\n/).map((para, i) => (
                <p
                  key={i}
                  className="aster-letter-para font-serif text-[16px] leading-8 text-fg"
                  style={{ animationDelay: `${Math.min(i * 160, 1200)}ms` }}
                >
                  {para}
                </p>
              ))}
            </div>
            <div className="mt-10 flex justify-center">
              <span className="h-px w-16 bg-fg/15" />
            </div>
            <p className="mt-4 text-center font-serif text-[13px] text-subtle">
              这封信只存在这台设备。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
