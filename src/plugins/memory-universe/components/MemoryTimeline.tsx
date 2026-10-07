import type { MemoryFormationStage } from "../types"

const LABELS: Record<MemoryFormationStage["kind"], string> = {
  first_mention: "第一次提及",
  remention: "再次提及",
  strengthened: "关系增强",
  long_term: "成为长期记忆",
}

export function MemoryTimeline({ stages }: { stages: MemoryFormationStage[] }) {
  if (!stages.length) return null
  return (
    <ol className="mu-timeline" aria-label="记忆形成">
      {stages.map((s, i) => (
        <li key={`${s.kind}-${s.at}-${i}`} className="mu-timeline-item">
          <span className="mu-timeline-dot" />
          {i < stages.length - 1 ? <span className="mu-timeline-line" /> : null}
          <div>
            <p className="mu-timeline-kind">{LABELS[s.kind]}</p>
            <p className="mu-timeline-meta">
              {s.at}
              {s.note ? ` · ${s.note}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}
