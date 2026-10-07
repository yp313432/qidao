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
          <p className="mu-brand-kicker">QIDAO</p>
          <h1 className="mu-brand-title">记忆宇宙</h1>
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
