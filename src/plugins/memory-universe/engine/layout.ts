import type { Memory } from "../types"
import { hash32, lerp, mulberry32 } from "./easing"
import type { Adjacency, LayerMap } from "./graph"
import { edgeStrength, parentTowardFocus } from "./graph"

export interface RestPos {
  x: number
  y: number
}

const CATEGORY_ANCHOR: Record<string, RestPos> = {
  identity: { x: 40, y: -30 },
  time: { x: -80, y: 210 },
  person: { x: -520, y: 40 },
  affection: { x: -560, y: 310 },
  place: { x: 520, y: 140 },
  motif: { x: 280, y: 20 },
  quality: { x: 160, y: -390 },
}

/** Stable, clustered rest positions. Visual-only — not stored on Memory. */
export function assignRestPositions(memories: Memory[]): Map<string, RestPos> {
  const counts = new Map<string, number>()
  const used = new Map<string, number>()
  for (const m of memories) {
    const c = m.category ?? "identity"
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  const out = new Map<string, RestPos>()
  for (const m of memories) {
    const c = m.category ?? "identity"
    const anchor = CATEGORY_ANCHOR[c] ?? { x: 0, y: 0 }
    const i = used.get(c) ?? 0
    used.set(c, i + 1)
    const n = counts.get(c) ?? 1
    const rng = mulberry32(hash32(m.id))
    const spread = 70 + n * 28
    const ang = (i / Math.max(1, n)) * Math.PI * 2 + rng() * 0.6
    const rad = (0.25 + rng() * 0.75) * spread
    out.set(m.id, {
      x: anchor.x + Math.cos(ang) * rad,
      y: anchor.y + Math.sin(ang) * rad * 0.82,
    })
  }
  return out
}

export function desiredDistance(strength: number, depth: number): number {
  if (depth <= 1) return lerp(175, 88, strength)
  return lerp(250, 168, strength)
}

export function computeConstellationTarget(
  id: string,
  focusId: string,
  rest: Map<string, RestPos>,
  layers: LayerMap,
  adj: Adjacency,
): RestPos {
  const self = rest.get(id) ?? { x: 0, y: 0 }
  const depth = layers.get(id) ?? 0
  if (depth === 0) return self

  const parentId =
    depth === 1 ? focusId : (parentTowardFocus(id, focusId, adj, layers) ?? focusId)
  const parent = rest.get(parentId) ?? self
  const dx = self.x - parent.x
  const dy = self.y - parent.y
  const dist = Math.hypot(dx, dy) || 1
  const angle = Math.atan2(dy, dx)
  const strength = edgeStrength(adj, parentId, id)
  const want = desiredDistance(strength, depth)
  // Pull along the original sky direction — stars are drawn in, not rearranged.
  const targetDist = lerp(dist, want, 0.9)
  const jitter = ((hash32(id) % 17) - 8) * 1.2
  const nx = -Math.sin(angle)
  const ny = Math.cos(angle)
  return {
    x: parent.x + Math.cos(angle) * targetDist + nx * jitter,
    y: parent.y + Math.sin(angle) * targetDist + ny * jitter,
  }
}
