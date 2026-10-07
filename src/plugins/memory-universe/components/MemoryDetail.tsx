import type { Memory } from "../types"
import { MemoryTimeline } from "./MemoryTimeline"

function formatDate(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) {
    return iso.slice(0, 10).replaceAll("-", ".")
  }
  return iso
}

function sourceLabel(memory: Memory): string | null {
  if (!memory.source) return null
  const when = memory.source.at ?? formatDate(memory.createdAt)
  return `${memory.source.label} · ${when}`
}

export function MemoryDetail({
  memory,
  related,
  onSelectRelated,
  onClose,
}: {
  memory: Memory
  related: Memory[]
  onSelectRelated: (id: string) => void
  onClose: () => void
}) {
  const important = (memory.importance ?? 0) >= 0.85
  const src = sourceLabel(memory)

  return (
    <aside className="mu-dossier" aria-label={`${memory.title} 档案`}>
      <header className="mu-dossier-head">
        <div>
          <h2 className="mu-dossier-title">{memory.title}</h2>
          <p className="mu-dossier-date">{formatDate(memory.createdAt)}</p>
        </div>
        <button type="button" className="mu-icon-btn" onClick={onClose} aria-label="关闭档案">
          关闭
        </button>
      </header>

      {important ? <p className="mu-mark">重要记忆</p> : null}

      <p className="mu-dossier-body">{memory.content}</p>

      {related.length ? (
        <section className="mu-section">
          <h3 className="mu-section-label">相关记忆</h3>
          <ul className="mu-related">
            {related.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="mu-related-btn"
                  onClick={() => onSelectRelated(r.id)}
                >
                  {r.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {src ? (
        <p className="mu-source">
          <span className="mu-section-label">来源</span>
          {src}
        </p>
      ) : null}

      {memory.formation?.length ? (
        <section className="mu-section">
          <h3 className="mu-section-label">记忆形成</h3>
          <MemoryTimeline stages={memory.formation} />
        </section>
      ) : null}
    </aside>
  )
}
