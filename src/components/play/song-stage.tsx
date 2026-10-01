import { Avatar } from "@/components/avatar";

/**
 * 正在播放的舞台。
 *
 * 关键设计：**这一行只有一个动画** —— 中间那段（放着心电图的空档）自己伸缩，
 * 两个头像是被 flex 布局**推着走**的。
 *
 * 以前是两套动画（头像平移 + 线固定宽度），结果头像滑过去把线盖住了，
 * 看起来像两个互不相干的层级。现在线永远正好顶在两头像的内边缘上，
 * 空档收窄时线被 `overflow` 从两边裁掉、形状不变 —— 所以是「连着的」在收缩。
 *
 * 暂停时不减停，只是把节奏放慢一倍（4.4s → 9s）。
 */
export function SongStage({ playing, line }: { playing: boolean; line?: string }) {
  return (
    <div
      className="relative mt-4"
      // 播放在跑：2.6 秒一次「啪」；暂停时放慢到 4.6 秒，不装成在播放
      style={{ "--duet-dur": playing ? "2.6s" : "4.6s" } as React.CSSProperties}
    >
      <div className="relative flex h-24 items-center justify-center">
        <span className="aster-duet relative z-10">
          <Avatar role="ai" size={56} />
        </span>

        {/* 空档：宽度在动，线在里面被裁 —— 两头像因此始终保持贴在线的两端 */}
        <span className="aster-gap flex items-center justify-center overflow-hidden">
          <svg
            viewBox="0 0 200 60"
            preserveAspectRatio="none"
            className="h-14 w-[140px] shrink-0"
            aria-hidden="true"
          >
            <path
              d="M0 30 H50 L58 10 L66 50 L74 30 H126 L134 13 L142 47 L150 30 H200"
              fill="none"
              stroke="var(--aster-accent)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="aster-beat"
            />
          </svg>
        </span>

        <span className="aster-duet relative z-10">
          <Avatar role="user" size={56} />
        </span>
      </div>

      {line && (
        <p
          key={line}
          className="aster-lyric-fade mt-1 text-center font-serif text-[15px] leading-6 text-fg"
        >
          {line}
        </p>
      )}
    </div>
  );
}
