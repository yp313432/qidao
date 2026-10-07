import { useEffect, useMemo, useRef, useState } from "react"
import { MemoryDetail } from "./components/MemoryDetail"
import { UniverseChrome } from "./components/UniverseChrome"
import { mountUniverse, type UniverseHandle } from "./engine/universe"
import { MOCK_MEMORIES, MOCK_RELATIONSHIPS } from "./data/mock-memories"
import type { Memory, MemoryRelationship, MemoryUniverseProps } from "./types"
import "./memory-universe.css"

function relatedOf(
  selected: Memory,
  memories: Memory[],
  relationships: MemoryRelationship[],
): Memory[] {
  const ids = new Set<string>()
  for (const r of relationships) {
    if (r.sourceId === selected.id) ids.add(r.targetId)
    if (r.targetId === selected.id) ids.add(r.sourceId)
  }
  for (const id of selected.relatedMemoryIds ?? []) ids.add(id)
  ids.delete(selected.id)
  const byId = new Map(memories.map((m) => [m.id, m]))
  return [...ids].map((id) => byId.get(id)).filter((m): m is Memory => Boolean(m))
}

export function MemoryUniverse({
  memories,
  relationships,
  onMemorySelect,
  className,
}: MemoryUniverseProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<UniverseHandle | null>(null)
  const onSelectRef = useRef(onMemorySelect)
  onSelectRef.current = onMemorySelect

  const data = useMemo(
    () => ({
      memories: memories?.length ? memories : MOCK_MEMORIES,
      relationships: relationships?.length ? relationships : MOCK_RELATIONSHIPS,
    }),
    [memories, relationships],
  )

  const [selected, setSelected] = useState<Memory | null>(null)
  const [query, setQuery] = useState("")

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches

    const engine = mountUniverse(canvas, {
      memories: data.memories,
      relationships: data.relationships,
      reducedMotion: reduced,
      onSelect: (m) => {
        setSelected(m)
        onSelectRef.current?.(m)
      },
    })
    engineRef.current = engine
    ;(window as unknown as { __memoryUniverse?: UniverseHandle }).__memoryUniverse = engine
    return () => {
      engine.destroy()
      engineRef.current = null
      delete (window as unknown as { __memoryUniverse?: UniverseHandle }).__memoryUniverse
    }
  }, [])

  useEffect(() => {
    engineRef.current?.setData(data.memories, data.relationships)
  }, [data])

  useEffect(() => {
    engineRef.current?.setSearch(query)
  }, [query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") engineRef.current?.select(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const related = selected
    ? relatedOf(selected, data.memories, data.relationships)
    : []

  return (
    <div className={["memory-universe", className].filter(Boolean).join(" ")}>
      <canvas ref={canvasRef} className="mu-canvas" aria-label="记忆星图" />
      <UniverseChrome
        query={query}
        onQuery={setQuery}
        onReset={() => {
          setQuery("")
          engineRef.current?.resetView()
        }}
        selected={Boolean(selected)}
      />
      {selected ? (
        <MemoryDetail
          memory={selected}
          related={related}
          onSelectRelated={(id) => engineRef.current?.select(id)}
          onClose={() => engineRef.current?.select(null)}
        />
      ) : null}
    </div>
  )
}
