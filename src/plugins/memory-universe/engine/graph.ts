import type { MemoryRelationship } from "../types"

export type Neighbor = { id: string; strength: number }

export type Adjacency = Map<string, Neighbor[]>

export function buildAdjacency(rels: MemoryRelationship[]): Adjacency {
  const adj: Adjacency = new Map()
  const add = (a: string, b: string, strength: number) => {
    const list = adj.get(a) ?? []
    const existing = list.find((n) => n.id === b)
    if (existing) existing.strength = Math.max(existing.strength, strength)
    else list.push({ id: b, strength })
    adj.set(a, list)
  }
  for (const r of rels) {
    add(r.sourceId, r.targetId, r.strength)
    add(r.targetId, r.sourceId, r.strength)
  }
  return adj
}

export type LayerMap = Map<string, number>

/** BFS from a memory. Depth 0 is the focus. Caps at maxDepth (2–3). */
export function expandFrom(
  id: string,
  adj: Adjacency,
  maxDepth = 2,
): LayerMap {
  const layers: LayerMap = new Map([[id, 0]])
  const queue: Array<{ id: string; depth: number }> = [{ id, depth: 0 }]
  while (queue.length) {
    const cur = queue.shift()
    if (!cur || cur.depth >= maxDepth) continue
    const neighbors = adj.get(cur.id) ?? []
    for (const n of neighbors) {
      if (layers.has(n.id)) continue
      layers.set(n.id, cur.depth + 1)
      queue.push({ id: n.id, depth: cur.depth + 1 })
    }
  }
  return layers
}

export function edgeStrength(adj: Adjacency, a: string, b: string): number {
  const n = adj.get(a)?.find((x) => x.id === b)
  return n?.strength ?? 0
}

/** Parent used to place a depth-2 node: strongest neighbor closer to the focus. */
export function parentTowardFocus(
  id: string,
  focusId: string,
  adj: Adjacency,
  layers: LayerMap,
): string | null {
  const neighbors = adj.get(id) ?? []
  let best: Neighbor | null = null
  for (const n of neighbors) {
    const d = layers.get(n.id)
    if (d === undefined) continue
    if (d >= (layers.get(id) ?? 99)) continue
    if (!best || n.strength > best.strength) best = n
  }
  return best?.id ?? (layers.has(focusId) ? focusId : null)
}
