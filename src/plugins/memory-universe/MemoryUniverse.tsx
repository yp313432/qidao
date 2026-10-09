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
      /**
       * ⚠️⚠️ **动效听"宿主"的，不听手机的**（用户真机踩到的坑；改这里之前是直接问系统）
       *
       * 现象（用户原话）："你网页拉起来后我点击记忆，每条连接的记忆线里有粒子在运动，
       * 而手机里的只有线" —— 手机上 `prefers-reduced-motion` 为真时，
       * `engine/relationship-lines.ts:63` 那句 `if (reduced || …) return`
       * 会把**线上跑的粒子整段跳过**，只剩线。
       *
       * 为什么不能只问系统：栖岛早就有「动画」开关（`settings.motion`：
       * auto=跟随系统 / on=始终开启 / off=关闭），而且**已经写在 `<html data-motion>`** 上
       * （见 `src/lib/store.ts` 的 `applyAppearance`）。用户设成「始终开启」后，
       * 栖岛自己的 CSS 动画是活的 —— 但插件的动画是 **JS 画的 canvas**，CSS 管不到，
       * 于是出现"栖岛活着、插件死着"的割裂。
       *
       * 所以：**先看宿主怎么说；宿主没说（独立跑这个组件时）才问系统。**
       * 与美术无关 —— 不改颜色、形状、动画曲线，只改"听谁的"。
       */
      (() => {
        const host = document.documentElement.dataset.motion
        if (host === "on") return false
        if (host === "off") return true
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches
      })()

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
