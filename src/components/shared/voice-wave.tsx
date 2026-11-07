import { cn } from "@/lib/utils";

/**
 * 通话页的波形。
 *
 * 两种状态**来源不一样**，这点必须说清楚（不然就是骗人）：
 *   · **听你说**（`phase === "listening"`）：柱子高度来自**真实的麦克风音量**
 *     （`lib/vad.ts` 每 50ms 算一次 RMS，一路传到这里）—— 你说话它就跳。
 *   · **他在说 / 他在想**：拿不到他声音的电平（那段 mp3 播放不经过我们的分析器），
 *     所以用的是**匀速错开的动画**，表示"有声音在流动"，而不是真实振幅。
 *
 * 柱子数量固定、形状由 index 决定（不用随机数）—— 免得 SSR 首帧跟客户端不一致
 * 触发 hydration 报错（这个项目踩过好几次）。
 */
const BARS = 17;

/** 固定的权重形状：中间高两边低，看起来像声波而不是一堵墙 */
const WEIGHT = Array.from({ length: BARS }, (_, i) => {
  const center = (BARS - 1) / 2;
  const d = Math.abs(i - center) / center; // 0 中间 → 1 两边
  return 0.35 + (1 - d) * 0.65;
});

export function VoiceWave({
  level,
  phase,
  className,
}: {
  /** 实时音量 0-1（听你说时才有意义） */
  level: number;
  phase: "idle" | "listening" | "thinking" | "speaking" | "unsupported";
  className?: string;
}) {
  const live = phase === "listening";
  // 真实的音量条：做一个温和的压缩，不然小声时几乎不动、大声时爆表
  const amp = live ? Math.min(1, Math.pow(level * 6, 0.6)) : 0;
  const animated = phase === "speaking" || phase === "thinking" || phase === "idle";

  return (
    <div
      className={cn(
        "flex h-10 items-center justify-center gap-[3px]",
        phase === "speaking" && "voice-wave-speaking",
        className,
      )}
      aria-hidden="true"
    >
      {WEIGHT.map((w, i) => {
        // 说话时给每根柱子不同的时长/延迟，错开才像声波
        const dur = 0.45 + ((i * 7) % 5) * 0.07;
        const delay = ((i * 3) % 7) * 0.06;
        const height = live
          ? 6 + amp * w * 30
          : animated
            ? undefined
            : 6;
        return (
          <span
            key={i}
            className={cn(
              "w-[3px] rounded-full bg-fg/45",
              animated && "voice-wave-bar",
              phase === "speaking" && "bg-accent/70",
            )}
            style={
              live
                ? { height: `${height}px`, transformOrigin: "center" }
                : animated
                  ? {
                      height: `${8 + w * 22}px`,
                      transformOrigin: "center",
                      animationDuration: `${dur}s`,
                      animationDelay: `${delay}s`,
                    }
                  : { height: "6px" }
            }
          />
        );
      })}
    </div>
  );
}
