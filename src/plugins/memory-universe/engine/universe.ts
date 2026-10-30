import type { Memory, MemoryRelationship } from "../types"
import { Camera } from "./camera"
import { clamp, hash32, lerp, mulberry32, spring } from "./easing"
import { buildAdjacency, expandFrom, type Adjacency, type LayerMap } from "./graph"
import { assignRestPositions } from "./layout"
import {
  drawMemoryLabel,
  drawMemoryStar,
  labelOf,
  type StarNode,
} from "./memory-node"
import { drawEdge } from "./relationship-lines"
import { VOID } from "./palette"
import {
  createBokeh,
  createDust,
  createFieldStars,
  drawBokeh,
  drawDust,
  drawFieldStars,
  drawVignette,
  paintBackground,
  type Bokeh,
  type Dust,
  type FieldStar,
} from "./star-field"

const MAX_DEPTH = 2
const NEBULA_SRC = "/memory-universe/nebula.jpg"
/** 透视焦距：z 越大（越远）星越小、越靠中心 */
const PERSP_F = 1000
/** 一屏只写 8 个标签：再多就是"网络图节点标注"，用户明确否掉了 */
const TOP_LABELS = 8
/** 选中时最多牵出 4 条线 */
const MAX_LINKS = 4

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
  /** 调试用（截图脚本核对"默认 0 条线 / 选中 ≤4 条 / 一屏 8 个标签"） */
  debug: () => {
    nodes: number
    labels: string[]
    links: Array<{ a: string; b: string; strength: number }>
  }
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
  const reduced = options.reducedMotion
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
  const edgeAppear = new Map<string, number>()
  /** 选中态要画的那几条线（预先按 strength 取前 4，逐帧不用再排序） */
  let links: Array<{ a: string; b: string; strength: number }> = []

  const dust: Dust[] = createDust(260, 7)
  const fieldStars: FieldStar[] = createFieldStars(190, 13)
  /** 焦外星（近景虚焦光斑）：给画面一点"镜头在前"的纵深 */
  const bokeh: Bokeh[] = createBokeh(6, 71)

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
      /*
       * 3D 纵深（2026-10 加）：每颗星一个 z（负=更近），把透视折算进"世界坐标"本身 ——
       * 这样相机、命中、连线、聚焦全都不用改：远处的星在世界里天然靠向中心，
       * 近处的散开、变大变亮。制图层面看就是一片有厚度的星云，而不是一层贴纸。
       */
      const z = (rng() - 0.5) * 760
      const persp = PERSP_F / (PERSP_F + z)
      return {
        memory: m,
        restX: r.x * persp,
        restY: r.y * persp,
        x: old?.x ?? r.x * persp,
        y: old?.y ?? r.y * persp,
        vx: old?.vx ?? 0,
        vy: old?.vy ?? 0,
        tx: r.x * persp,
        ty: r.y * persp,
        phase: rng() * Math.PI * 2,
        freq: 0.45 + rng() * 0.85,
        depth: old?.depth ?? null,
        reveal: old?.reveal ?? 0,
        dim: old?.dim ?? 1,
        z,
        persp,
      }
    })
  }

  /** 选中一颗星时，只保留"最相关的 4 条"作为要画的线 */
  function refreshLinks() {
    links = []
    if (!selectedId) return
    const near = [...(adj.get(selectedId) ?? [])]
      .sort((p, q) => q.strength - p.strength)
      .slice(0, MAX_LINKS)
    for (const n of near) links.push({ a: selectedId, b: n.id, strength: n.strength })
  }

  function retarget() {
    /*
     * 第二版：选中时不再把相关星"吸"到选中星周围。
     * 首版会算 constellation 目标位、再把相机推近——结果点一下星，整片星空哗地重排、
     * 镜头飞过去，用户说"星别飞走"。现在选中只做两件事：标出层级（用于变暗）、
     * 记下要画的 4 条线；星星本身待在原地，画面只是"被圈出重点"。
     */
    if (!selectedId) {
      layers = new Map()
      for (const n of nodes) n.depth = null
      refreshLinks()
      return
    }
    layers = expandFrom(selectedId, adj, MAX_DEPTH)
    for (const n of nodes) {
      const d = layers.get(n.memory.id)
      n.depth = d === undefined ? null : d
    }
    refreshLinks()
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
      const pad = 180
      const w = maxX - minX + pad * 2
      const h = maxY - minY + pad * 2
      const scale = Math.min(cam.width / w, cam.height / h, 1.05) * 1.1
      // 把星场整体往画面上方推 5%：下面 33% 是记忆区，星别贴着它
      cam.lookAt(
        (minX + maxX) * 0.5,
        (minY + maxY) * 0.5 + (cam.height * 0.05) / scale,
        scale,
      )
      return
    }
    const n = nodes.find((x) => x.memory.id === id)
    if (!n) return
    const related = [...layers.values()].filter((d) => d > 0).length
    const z = related > 6 ? 1.32 : related > 3 ? 1.48 : 1.62
    frameFocus(n.tx, n.ty, z)
  }

  function select(id: string | null) {
    if (selectedId === id) return
    selectedId = id
    // 选中 / 取消选中都只重算层级和连线，不动相机、不动星 —— 「星本身不飞走」
    retarget()
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
        // 只把"跟选中星完全无关"的压暗一点，留着它们当背景星；
        // 压太狠（首版 0.18）会把画面变成"黑底 + 一颗星 + 几条线"，就没有星空了
        if (n.depth === null) wantDim = 0.62
        else if (n.depth === 0) wantDim = 1
        else if (n.depth === 1) wantDim = 1
        else wantDim = 0.82
      }
      if (search && !matchesSearch(n.memory)) wantDim *= 0.16
      n.dim = lerp(n.dim, wantDim, 1 - Math.exp(-5 * dt))
    }
  }

  function stepEdges(dt: number) {
    /*
     * 只在选中时存在线，而且只有 links 里那 4 条。
     * 首版是把"层级里所有两端都可见的关系"全画出来 —— 40+ 条记忆时满屏都是线，
     * 用户截图里的"网络图"就是这么来的。现在默认一条都不画。
     */
    const next = new Set<string>()
    for (const l of links) next.add(edgeKey(l.a, l.b))
    for (const key of next) {
      const cur = edgeAppear.get(key) ?? 0
      const speed = reduced ? 8 : 2.4
      edgeAppear.set(key, Math.min(1, cur + dt * speed))
    }
    for (const [key, v] of [...edgeAppear]) {
      if (next.has(key)) continue
      const nv = v - dt * (reduced ? 8 : 3)
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
    stepNodes(dt)
    stepEdges(dt)

    ensureBg()
    const w = cam.width
    const h = cam.height
    if (bg) ctx.drawImage(bg, 0, 0, w, h)
    else {
      ctx.fillStyle = VOID
      ctx.fillRect(0, 0, w, h)
    }

    const fieldDim = selectedId ? 0.8 : 1
    drawDust(ctx, dust, cam, time)
    drawFieldStars(ctx, fieldStars, cam, time, fieldDim * intro)

    // 线画在星下面：细线从星核里"长"出来，压在星上面会显得脏
    if (edgeAppear.size) {
      const pos = new Map(nodes.map((n) => [n.memory.id, n]))
      for (const l of links) {
        const key = edgeKey(l.a, l.b)
        const appear = edgeAppear.get(key)
        if (!appear) continue
        const a = pos.get(l.a)
        const b = pos.get(l.b)
        if (!a || !b) continue
        const pa = cam.worldToScreen(a.x, a.y)
        const pb = cam.worldToScreen(b.x, b.y)
        drawEdge(ctx, pa.x, pa.y, pb.x, pb.y, appear, hash32(key))
      }
    }

    // 一屏只写 8 个标签：这是用户最在意的一条，宁少勿多
    const labelIds = topLabelIds(selectedId)
    const centerX = w * 0.5
    const centerY = h * 0.42

    // 远的先画、近的后画：遮挡关系对了，纵深才成立（选中的那颗永远压最上面）
    const ordered = [...nodes].sort((a, b) => {
      const da = a.memory.id === selectedId ? 1 : 0
      const db = b.memory.id === selectedId ? 1 : 0
      return da - db || a.persp - b.persp
    })

    for (const n of ordered) {
      const p = cam.worldToScreen(n.x, n.y)
      if (p.x < -80 || p.y < -80 || p.x > w + 80 || p.y > h + 80) continue
      const selected = n.memory.id === selectedId
      const related = n.depth !== null && n.depth > 0
      const hovered = n.memory.id === hoveredId
      const searchHit = Boolean(search) && matchesSearch(n.memory)
      const alpha = clamp(n.dim * intro, 0, 1)
      drawMemoryStar(ctx, p.x, p.y, n, {
        selected,
        related,
        hovered,
        searchHit,
        time,
        alpha,
      })

      if (!labelIds.has(n.memory.id)) continue
      // 远处的星字也淡一点：一屏 8 个字如果一样重，纵深就没了
      let labelA = alpha * (0.72 + 0.28 * Math.min(1, n.persp))
      if (selected) labelA = Math.min(1, alpha * 1.05)
      else if (hovered) labelA = Math.min(1, labelA + 0.12)
      if (search && !matchesSearch(n.memory)) labelA *= 0.2
      drawMemoryLabel(ctx, p.x, p.y, labelOf(n.memory.title), {
        selected,
        related,
        alpha: labelA,
        width: w,
        height: h,
        centerX,
        centerY,
      })
    }

    // 焦外星压在记忆星之上：它离镜头最近，本来就该挡住后面的东西
    drawBokeh(ctx, bokeh, cam, time, selectedId ? 0.7 : 1)

    drawVignette(ctx, w, h)
    raf = requestAnimationFrame(draw)
  }

  /**
   * 取 importance 最高的 8 条；选中那颗不在其中时顶掉最暗的一个，标签总数恒为 8。
   * 搜索时命中的星优先占位 —— 一次只画 8 个标签之后，命中星如果没有标签，
   * 用户只能看到"某处亮了一下"，等于搜不到，所以这里必须给命中星让位。
   */
  function topLabelIds(selected: string | null): Set<string> {
    const sorted = [...nodes].sort(
      (a, b) => (b.memory.importance ?? 0.55) - (a.memory.importance ?? 0.55),
    )
    const out = new Set<string>()
    if (search) {
      for (const n of sorted) {
        if (out.size >= TOP_LABELS) break
        if (n.memory.id === selected || matchesSearch(n.memory)) out.add(n.memory.id)
      }
    }
    for (const n of sorted) {
      if (out.size >= TOP_LABELS) break
      out.add(n.memory.id)
    }
    if (selected && !out.has(selected)) {
      // 顶掉集合里最暗的一个：搜索时集合顺序已被命中星打乱，不能直接删"最后一个"
      let weakest: StarNode | null = null
      for (const n of nodes) {
        if (!out.has(n.memory.id)) continue
        const imp = n.memory.importance ?? 0.55
        if (!weakest || imp < (weakest.memory.importance ?? 0.55)) weakest = n
      }
      if (weakest) out.delete(weakest.memory.id)
      out.add(selected)
    }
    return out
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
      select(id)
    },
    resetView() {
      select(null)
      // 「回到星空」把镜头也归位：取消选中本身不该动画面，
      // 但这个按钮的语义就是"我要看全"。
      focusCamera(null)
      cam.vx = 0
      cam.vy = 0
    },
    locateStars() {
      return nodes.map((n) => {
        const p = cam.worldToScreen(n.x, n.y)
        return { id: n.memory.id, title: n.memory.title, x: p.x, y: p.y }
      })
    },
    debug() {
      return {
        nodes: nodes.length,
        labels: [...topLabelIds(selectedId)],
        links: links.map((l) => ({ ...l })),
      }
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
