/**
 * 顶部题字 + 底部那句诗。
 *
 * 用户 2026-10 的原话：「上面的标题换一个斜体手写英文句子，契合星空记忆的」
 * —— 于是左上角换成了一句手写的英文诗。
 *
 * 用户 2026-11（实机截图，三件事）：
 *   ① 「把返回键也放到左上角统一一下」→ 原来那排字的位置让给返回键，
 *      按钮直接长在页头里（跟情绪页 `EmotionApp` 的页头同一个做法，尺寸/底色一致），
 *      这样它天然吃 `.mu-chrome-top` 的 24px 边距和安全区，不用量像素。
 *   ② 「把句子放在下面比较空白的地方」→ 诗挪到星空下 1/4、底部中文说明上方一点。
 *   ③ 「这个句子是跟背景融为一体的那种」「句子周围有星光粒子」「一个一个字的自然涌现」
 *      → `.mu-poem` / `.mu-poem-char` / `.mu-poem-spark`（见 memory-universe.css）：
 *      不做卡片不做描边，暖白低透明度 + 轻微发光；每字 62ms 依次淡入上浮；
 *      周围 5 颗小十字星缓慢闪烁。
 *
 * ⚠️ 动效只播一次（之后只剩极轻的呼吸微光），不循环 —— 理由写在那段 CSS 上方。
 * ⚠️ 选了一颗记忆时这句诗会先让位（底部记忆区正好占住它那一块），回到星空再重新涌现。
 */
import { useNavigate } from "@tanstack/react-router"
import { ChevronLeft } from "lucide-react"

/** 那句诗 —— 两行是原设计（一行主句 + 一行小字），别合并成一行 */
const POEM_LINES = ["Every light up there", "is a day we kept."]
/** 逐字涌现：每个字比上一个晚 62ms（用户要的 60~90ms 区间内，整句约 2.3s 长完） */
const CHAR_STEP_MS = 62
/** 第二行比第一行晚一点起头，读起来才像"一句话"而不是两行同时刷 */
const LINE_STEP_MS = 260
/** 星星粒子个数（用户要的 3~8 颗，取 5 颗：够散开，又不喧宾夺主） */
const SPARK_COUNT = 5

/** 把诗句摊平成"每个字 + 它自己的延迟"（在模块级算一次，渲染时纯查表） */
const POEM_CHARS: { ch: string; delay: number }[][] = (() => {
  const rows: { ch: string; delay: number }[][] = []
  let index = 0
  POEM_LINES.forEach((line, lineIndex) => {
    const row: { ch: string; delay: number }[] = []
    for (const ch of line) {
      row.push({ ch, delay: lineIndex * LINE_STEP_MS + index * CHAR_STEP_MS })
      index += 1
    }
    rows.push(row)
  })
  return rows
})()

export function UniverseChrome({
  query,
  onQuery,
  onReset,
  selected,
}: {
  query: string
  onQuery: (q: string) => void
  onReset: () => void
  selected: boolean
}) {
  const navigate = useNavigate()

  const goBack = () => {
    if (window.history.length > 1) window.history.back()
    else void navigate({ to: "/play/plugins" })
  }

  return (
    <>
      <header className="mu-chrome-top">
        {/* 返回键：跟情绪页/插件外壳同一个尺寸与底色（圆形 size-8、white/10、毛玻璃） */}
        <button
          type="button"
          aria-label="返回插件"
          onClick={goBack}
          className="mu-back grid size-8 shrink-0 place-items-center rounded-full border border-white/15 bg-white/10 text-[#e6e1d6] backdrop-blur-sm transition-colors active:bg-white/20"
        >
          <ChevronLeft className="size-4" strokeWidth={2} />
        </button>

        <label className="mu-search">
          <span className="mu-sr">寻找一颗记忆</span>
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="寻找一颗记忆"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </header>

      <div className="mu-chrome-side">
        <button type="button" className="mu-text-btn" onClick={onReset}>
          回到星空
        </button>
      </div>

      {/*
        那句诗：飘在画面下方、底部中文说明的上方一点。
        逐字拆成 span 只是**给 CSS 一个挂动画延迟的钩子** —— 每个 span 里是原文的字符
        （空格也是真空格，靠 CSS `white-space: pre` 撑住宽度），所以读屏读出来的
        还是完整的一句，不需要额外的 aria-label。
        选了一颗记忆时先让位：底部记忆区（`.mu-dock`）正好压住它那一块。
      */}
      {!selected ? (
        <div className="mu-poem">
          <div className="mu-poem-inner">
            {Array.from({ length: SPARK_COUNT }, (_, i) => (
              <span key={`spark-${i}`} className="mu-poem-spark" aria-hidden="true" />
            ))}
            {POEM_CHARS.map((row, lineIndex) => (
              <p key={`line-${lineIndex}`} className={`mu-poem-line mu-poem-line-${lineIndex + 1}`}>
                {row.map(({ ch, delay }, charIndex) => (
                  <span
                    key={`char-${charIndex}`}
                    className="mu-poem-char"
                    style={{ animationDelay: `${delay}ms` }}
                  >
                    {ch}
                  </span>
                ))}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {!selected ? (
        <p className="mu-verse">
          每一颗星，都是被留下的一部分。
          <br />
          点一颗星，相关的记忆会从星空中被牵引出来。
        </p>
      ) : null}
    </>
  )
}
