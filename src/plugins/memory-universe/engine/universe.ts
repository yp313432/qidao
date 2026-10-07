import type { Memory, MemoryRelationship } from "../types"
import { Camera } from "./camera"
import { clamp, hash32, lerp, mulberry32, spring } from "./easing"
import { buildAdjacency, expandFrom, type Adjacency, type LayerMap } from "./graph"
import { assignRestPositions, computeConstellationTarget } from "./layout"
import {
  drawMemoryLabel,
  drawMemoryStar,
  drawOrbits,
  type StarNode,
} from "./memory-node"
import { drawEdge } from "./relationship-lines"
import {
  createDust,
  createFieldStars,
  drawDust,
  drawFieldStars,
  drawVignette,
  paintBackground,
  type Dust,
  type FieldStar,
} from "./star-field"

const MAX_DEPTH = 2
const NEBULA_SRC = "/memory-universe/nebula.jpg"

export interface UniverseOptions {
  memories: Memory[]
  relationships: MemoryRelationship[]
  onSelect: (memory: Memory | null) => void
  reducedMotion: boolean
}

export interface UniverseHandle {
  setData: (memories: Memory[], relationships: MemoryRelationship[]) => void
  setSearch: (q: string) => void
  select: (id: string | null) => void
  resetView: () => void
  locateStars: () => Array<{ id: string; title: string; x: number; y: number }>
  destroy: () => void
}

interface Pointer {
  id: number
  x: number
  y: number
}

export function mountUniverse(
  canvas: HTMLCanvasElement,
  options: UniverseOptions,
): UniverseHandle {
  const rawCtx = canvas.getContext("2d", { alpha: false, desynchronized: true })
  if (!rawCtx) throw new Error("Canvas 2D unavailable")
  const ctx: CanvasRenderingContext2D = rawCtx

  const cam = new Camera()
  let memories = options.memories
  let relationships = options.relationships
  let adj: Adjacency = buildAdjacency(relationships)
  let nodes: StarNode[] = []
  let layers: LayerMap = new Map()
  let selectedId: string | null = null
  let hoveredId: string | null = null
  let search = ""
  let reduced = options.reducedMotion
  let running = true
  let raf = 0
  let last = performance.now()
  let time = 0
  let intro = 0
  let idle = 0
  let bg: HTMLCanvasElement | null = null
  let bgW = 0
  let bgH = 0
  let nebula: HTMLImageElement | null = null
  let dpr = 1
  let dragging = false
  let moved = false
  let lastPX = 0
  let lastPY = 0
  let lastMoveT = 0
  const pointers = new Map<number, Pointer>()
  let pinchDist = 0
  let edgeAppear = new Map<string, number>()

  const dust: Dust[] = createDust(160, 7)
  const fieldStars: FieldStar[] = createFieldStars(110, 13)

  const img = new Image()
  img.crossOrigin = "anonymous"
  img.onload = () => {
    nebula = img
    bg = null
  }
  img.src = NEBULA_SRC

  function rebuildNodes() {
    const rest = assignRestPositions(memories)
    const prev = new Map(nodes.map((n) => [n.memory.id, n]))
    nodes = memories.map((m) => {
      const r = rest.get(m.id) ?? { x: 0, y: 0 }
      const old = prev.get(m.id)
      const rng = mulberry32(hash32(m.id))
      return {
        memory: m,
        restX: r.x,
        restY: r.y,
        x: old?.x ?? r.x,
        y: old?.y ?? r.y,
        vx: old?.vx ?? 0,
        vy: old?.vy ?? 0,
        tx: r.x,
        ty: r.y,
        phase: rng() * Math.PI * 2,
        freq: 0.45 + rng() * 0.85,
        depth: old?.depth ?? null,
        reveal: old?.reveal ?? 0,
        dim: old?.dim ?? 1,
      }
    })
  }

  function retarget() {
    if (!selectedId) {
      for (const n of nodes) {
        n.tx = n.restX
        n.ty = n.restY
        n.depth = null
      }
      return
    }
    layers = expandFrom(selectedId, adj, MAX_DEPTH)
    const rest = new Map(nodes.map((n) => [n.memory.id, { x: n.restX, y: n.restY }]))
    for (const n of nodes) {
      const d = layers.get(n.memory.id)
      n.depth = d === undefined ? null : d
      if (d === undefined) {
        n.tx = n.restX
        n.ty = n.restY
      } else {
        const t = computeConstellationTarget(n.memory.id, selectedId, rest, layers, adj)
        n.tx = t.x
        n.ty = t.y
      }
    }
  }

  function frameFocus(wx: number, wy: number, scale: number) {
    let sx = cam.width * 0.5
    let sy = cam.height * 0.48
    if (cam.width >= 760) sx = cam.width * 0.64
    else sy = cam.height * 0.36
    cam.lookAt(
      wx - (sx - cam.width * 0.5) / scale,
      wy - (sy - cam.height * 0.5) / scale,
      scale,
    )
  }

  function focusCamera(id: string | null) {
    if (!id) {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const n of nodes) {
        minX = Math.min(minX, n.restX)
        minY = Math.min(minY, n.restY)
        maxX = Math.max(maxX, n.restX)
        maxY = Math.max(maxY, n.restY)
      }
      const pad = 220
      const w = maxX - minX + pad * 2
      const h = maxY - minY + pad * 2
      const scale = Math.min(cam.width / w, cam.height / h, 1.05)
      cam.lookAt((minX + maxX) * 0.5, (minY + maxY) * 0.5, scale)
      return
    }
    const n = nodes.find((x) => x.memory.id === id)
    if (!n) return
    const related = [...layers.values()].filter((d) => d > 0).length
    const z = related > 6 ? 1.32 : related > 3 ? 1.48 : 1.62
    frameFocus(n.tx, n.ty, z)
  }

  function select(id: string | null, fromUser = true) {
    if (selectedId === id) {
      if (id && fromUser) focusCamera(id)
      return
    }
    selectedId = id
    if (id) layers = expandFrom(id, adj, MAX_DEPTH)
    else layers = new Map()
    retarget()
    focusCamera(id)
    idle = 0
    const mem = id ? (memories.find((m) => m.id === id) ?? null) : null
    options.onSelect(mem)
  }

  function resize() {
    const parent = canvas.parentElement ?? canvas
    const w = parent.clientWidth || window.innerWidth
    const h = parent.clientHeight || window.innerHeight
    dpr = Math.min(window.devicePixelRatio || 1, 1.75)
    canvas.width = Math.max(1, Math.floor(w * dpr))
    canvas.height = Math.max(1, Math.floor(h * dpr))
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    cam.resize(w, h)
    bg = null
  }

  function ensureBg() {
    if (bg && bgW === cam.width && bgH === cam.height) return
    bgW = Math.max(1, Math.floor(cam.width))
    bgH = Math.max(1, Math.floor(cam.height))
    bg = document.createElement("canvas")
    bg.width = bgW
    bg.height = bgH
    const bctx = bg.getContext("2d")
    if (!bctx) return
    paintBackground(bctx, bgW, bgH, nebula)
  }

  function hitTest(sx: number, sy: number): StarNode | null {
    let best: StarNode | null = null
    let bestD = 28
    for (const n of nodes) {
      const p = cam.worldToScreen(n.x, n.y)
      const d = Math.hypot(p.x - sx, p.y - sy)
      const rad = Math.max(22, 14 + (n.memory.importance ?? 0.5) * 16)
      if (d < rad && d < bestD + 8) {
        best = n
        bestD = d
      }
    }
    return best
  }

  function edgeKey(a: string, b: string) {
    return a < b ? `${a}|${b}` : `${b}|${a}`
  }

  function matchesSearch(m: Memory): boolean {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      m.title.toLowerCase().includes(q) ||
      m.content.toLowerCase().includes(q) ||
      (m.tags ?? []).some((t) => t.toLowerCase().includes(q))
    )
  }

  function stepNodes(dt: number) {
    const stiff = reduced ? 40 : 16
    const damp = reduced ? 14 : 8.2
    for (const n of nodes) {
      ;[n.x, n.vx] = spring(n.x, n.vx, n.tx, dt, stiff, damp)
      ;[n.y, n.vy] = spring(n.y, n.vy, n.ty, dt, stiff, damp)
      const wantReveal = n.depth !== null ? 1 : 0
      n.reveal = lerp(n.reveal, wantReveal, 1 - Math.exp(-(reduced ? 14 : 3.4) * dt))
      let wantDim = 1
      if (selectedId) {
        if (n.depth === null) wantDim = 0.18
        else if (n.depth === 0) wantDim = 1
        else if (n.depth === 1) wantDim = 0.95
        else wantDim = 0.78
      }
      if (search && !matchesSearch(n.memory)) wantDim *= 0.16
      n.dim = lerp(n.dim, wantDim, 1 - Math.exp(-5 * dt))
    }
  }

  function stepEdges(dt: number) {
    const next = new Set<string>()
    if (selectedId) {
      for (const rel of relationships) {
        const da = layers.get(rel.sourceId)
        const db = layers.get(rel.targetId)
        if (da === undefined || db === undefined) continue
        next.add(edgeKey(rel.sourceId, rel.targetId))
      }
    }
    for (const key of next) {
      const cur = edgeAppear.get(key) ?? 0
      const speed = reduced ? 8 : 2.1
      edgeAppear.set(key, Math.min(1, cur + dt * speed))
    }
    for (const [key, v] of [...edgeAppear]) {
      if (next.has(key)) continue
      const nv = v - dt * (reduced ? 8 : 2.6)
      if (nv <= 0) edgeAppear.delete(key)
      else edgeAppear.set(key, nv)
    }
  }

  function draw(now: number) {
    if (!running) return
    const raw = (now - last) / 1000
    const dt = Math.min(raw, 0.1)
    last = now
    time += dt
    intro = Math.min(1, intro + dt * 0.55)
    idle += dt

    if (!dragging && pointers.size === 0 && !selectedId && idle > 4 && !reduced) {
      cam.x += Math.sin(time * 0.05) * 2.2 * dt
      cam.y += Math.cos(time * 0.04) * 1.6 * dt
    }

    cam.step(dt, reduced)
    if (selectedId) {
      const n = nodes.find((x) => x.memory.id === selectedId)
      if (n && cam.following) {
        frameFocus(n.x, n.y, cam.tScale)
      }
    }
    stepNodes(dt)
    stepEdges(dt)

    ensureBg()
    const w = cam.width
    const h = cam.height
    if (bg) ctx.drawImage(bg, 0, 0, w, h)
    else {
      ctx.fillStyle = "#05040a"
      ctx.fillRect(0, 0, w, h)
    }

    const fieldDim = selectedId ? 0.38 : 0.85
    drawDust(ctx, dust, cam, time)
    drawFieldStars(ctx, fieldStars, cam, time, fieldDim * intro)

    // Lines under stars
    if (edgeAppear.size) {
      const pos = new Map(nodes.map((n) => [n.memory.id, n]))
      for (const rel of relationships) {
        const key = edgeKey(rel.sourceId, rel.targetId)
        const appear = edgeAppear.get(key)
        if (!appear) continue
        const a = pos.get(rel.sourceId)
        const b = pos.get(rel.targetId)
        if (!a || !b) continue
        const pa = cam.worldToScreen(a.x, a.y)
        const pb = cam.worldToScreen(b.x, b.y)
        drawEdge(
          ctx,
          pa.x,
          pa.y,
          pb.x,
          pb.y,
          rel.strength,
          appear,
          time,
          hash32(key),
          reduced,
        )
      }
    }

    const ordered = [...nodes].sort((a, b) => {
      const da = a.memory.id === selectedId ? 1 : 0
      const db = b.memory.id === selectedId ? 1 : 0
      return da - db
    })

    for (const n of ordered) {
      const p = cam.worldToScreen(n.x, n.y)
      if (p.x < -80 || p.y < -80 || p.x > w + 80 || p.y > h + 80) continue
      const selected = n.memory.id === selectedId
      const related = n.depth !== null && n.depth > 0
      const hovered = n.memory.id === hoveredId
      const searchHit = Boolean(search) && matchesSearch(n.memory)
      const alpha = clamp(n.dim * intro, 0, 1)
      const r = drawMemoryStar(ctx, p.x, p.y, n, {
        selected,
        related,
        hovered,
        searchHit,
        time,
        alpha,
      })
      if (selected) drawOrbits(ctx, p.x, p.y, r, time, alpha)

      let labelA = alpha
      if (!selected && !related && !hovered) {
        labelA *= clamp((cam.scale - 0.45) / 0.5, 0.28, 0.72)
      } else if (related) labelA *= 0.92
      else if (selected) labelA = Math.min(1, alpha)
      if (hovered && !selected) labelA = Math.min(1, 0.95 * intro)
      if (search && !matchesSearch(n.memory)) labelA *= 0.15
      drawMemoryLabel(ctx, p.x, p.y, r, n.memory.title, {
        selected,
        related: related || hovered,
        alpha: labelA,
      })
    }

    drawVignette(ctx, w, h)
    raf = requestAnimationFrame(draw)
  }

  function onPointerDown(e: PointerEvent) {
    canvas.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY })
    moved = false
    idle = 0
    if (pointers.size === 1) {
      dragging = true
      lastPX = e.clientX
      lastPY = e.clientY
      lastMoveT = performance.now()
      cam.vx = 0
      cam.vy = 0
      cam.following = false
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
    }
  }

  function onPointerMove(e: PointerEvent) {
    const rec = pointers.get(e.pointerId)
    if (rec) {
      rec.x = e.clientX
      rec.y = e.clientY
    }
    const rect = canvas.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinchDist > 0 && dist > 0) {
        const midX = (a.x + b.x) * 0.5 - rect.left
        const midY = (a.y + b.y) * 0.5 - rect.top
        cam.zoomAt(midX, midY, dist / pinchDist)
        pinchDist = dist
        moved = true
      }
      canvas.style.cursor = "grabbing"
      return
    }

    if (dragging && pointers.size === 1) {
      const dx = e.clientX - lastPX
      const dy = e.clientY - lastPY
      if (Math.hypot(dx, dy) > 3) moved = true
      cam.pan(dx, dy)
      const now = performance.now()
      const dt = Math.max(8, now - lastMoveT) / 1000
      cam.vx = -dx / dt / cam.scale
      cam.vy = -dy / dt / cam.scale
      lastPX = e.clientX
      lastPY = e.clientY
      lastMoveT = now
      canvas.style.cursor = "grabbing"
      return
    }

    const hit = hitTest(sx, sy)
    hoveredId = hit?.memory.id ?? null
    canvas.style.cursor = hit ? "pointer" : "grab"
  }

  function onPointerUp(e: PointerEvent) {
    pointers.delete(e.pointerId)
    if (pointers.size < 2) pinchDist = 0
    if (pointers.size === 0) {
      dragging = false
      if (!moved) {
        const rect = canvas.getBoundingClientRect()
        const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top)
        select(hit?.memory.id ?? null)
      } else {
        cam.following = false
      }
    }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    idle = 0
    const rect = canvas.getBoundingClientRect()
    const factor = Math.exp(-e.deltaY * 0.0012)
    cam.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor)
  }

  function onLostCapture() {
    pointers.clear()
    dragging = false
    pinchDist = 0
  }

  const ro = new ResizeObserver(() => resize())
  ro.observe(canvas.parentElement ?? canvas)

  canvas.addEventListener("pointerdown", onPointerDown)
  canvas.addEventListener("pointermove", onPointerMove)
  canvas.addEventListener("pointerup", onPointerUp)
  canvas.addEventListener("pointercancel", onPointerUp)
  canvas.addEventListener("lostpointercapture", onLostCapture)
  canvas.addEventListener("wheel", onWheel, { passive: false })
  canvas.style.touchAction = "none"
  canvas.style.cursor = "grab"

  function onVis() {
    if (document.hidden) {
      cancelAnimationFrame(raf)
    } else {
      last = performance.now()
      raf = requestAnimationFrame(draw)
    }
  }
  document.addEventListener("visibilitychange", onVis)

  rebuildNodes()
  resize()
  focusCamera(null)
  cam.x = cam.tx
  cam.y = cam.ty
  cam.scale = cam.tScale
  raf = requestAnimationFrame(draw)

  return {
    setData(nextM, nextR) {
      memories = nextM
      relationships = nextR
      adj = buildAdjacency(relationships)
      rebuildNodes()
      retarget()
    },
    setSearch(q) {
      search = q.trim()
    },
    select(id) {
      select(id, true)
    },
    resetView() {
      select(null)
      cam.vx = 0
      cam.vy = 0
    },
    locateStars() {
      return nodes.map((n) => {
        const p = cam.worldToScreen(n.x, n.y)
        return { id: n.memory.id, title: n.memory.title, x: p.x, y: p.y }
      })
    },
    destroy() {
      running = false
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener("pointerdown", onPointerDown)
      canvas.removeEventListener("pointermove", onPointerMove)
      canvas.removeEventListener("pointerup", onPointerUp)
      canvas.removeEventListener("pointercancel", onPointerUp)
      canvas.removeEventListener("lostpointercapture", onLostCapture)
      canvas.removeEventListener("wheel", onWheel)
      document.removeEventListener("visibilitychange", onVis)
    },
  }
}
