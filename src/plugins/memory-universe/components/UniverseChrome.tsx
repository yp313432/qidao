/**
 * 顶部题字。
 *
 * 用户 2026-10 的原话：「上面的标题换一个斜体手写英文句子，契合星空记忆的」——
 * 原来的「记忆宇宙 / QIDAO」改成一句手写的英文诗，中文只留在底部说明行里。
 */
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
  return (
    <>
      <header className="mu-chrome-top">
        <div className="mu-brand">
          <p className="mu-brand-script">Every light up there</p>
          <p className="mu-brand-script-sub">is a day we kept.</p>
        </div>
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
