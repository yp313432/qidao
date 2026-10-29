import type { Memory } from "../types"
import { TAU } from "./easing"
import { CREAM, GOLD, GOLD_BRIGHT, mixRgb, rgba, type RGB } from "./palette"

export interface StarNode {
  memory: Memory
  restX: number
  restY: number
  x: number
  y: number
  vx: number
  vy: number
  tx: number
  ty: number
  phase: number
  freq: number
  depth: number | null
  reveal: number
  dim: number
  /** 3D 纵深：负数=更近，正数=更远（只影响大小与亮度，位置已在世界坐标里折过透视） */
  z: number
  /** 透视系数 F/(F+z)：近大远小 */
  persp: number
}

export function drawMemoryStar(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  node: StarNode,
  opts: {
    selected: boolean
    related: boolean
    hovered: boolean
    searchHit: boolean
    time: number
    alpha: number
  },
): number {
  const imp = node.memory.importance ?? 0.55
  const breath = 1 + 0.07 * Math.sin(opts.time * node.freq + node.phase)
  /** 纵深：远的星更小更暗，近的更大更亮（透视系数 0.70~1.61） */
  const depthSize = 0.55 + 0.62 * node.persp
  const depthFade = 0.5 + 0.5 * Math.min(1, node.persp)
  let r = (1.4 + imp * 1.9) * breath * depthSize
  if (opts.selected) r *= 1.5
  else if (opts.related) r *= 1.15
  if (opts.hovered) r *= 1.12

  const goldMix = opts.selected ? 1 : opts.related ? 0.55 : opts.searchHit ? 0.4 : imp > 0.85 ? 0.22 : 0
  const col: RGB = mixRgb(CREAM, GOLD, goldMix)
  const a = opts.alpha * depthFade

  const glowR = r * (opts.selected ? 6.2 : 4.2)
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR)
  glow.addColorStop(0, rgba(opts.selected ? GOLD_BRIGHT : col, a * (opts.selected ? 0.6 : 0.3)))
  glow.addColorStop(0.24, rgba(col, a * 0.1))
  glow.addColorStop(1, rgba(col, 0))
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(sx, sy, glowR, 0, TAU)
  ctx.fill()

  if (opts.selected || (opts.related && imp > 0.75)) {
    ctx.save()
    ctx.strokeStyle = rgba(GOLD_BRIGHT, a * (opts.selected ? 0.55 : 0.28))
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.moveTo(sx - r * 8, sy)
    ctx.lineTo(sx + r * 8, sy)
    ctx.moveTo(sx, sy - r * 8)
    ctx.lineTo(sx, sy + r * 8)
    ctx.stroke()
    ctx.restore()
  }

  ctx.fillStyle = rgba(opts.selected ? GOLD_BRIGHT : CREAM, Math.min(1, a * 1.15))
  ctx.beginPath()
  ctx.arc(sx, sy, r, 0, TAU)
  ctx.fill()

  if (opts.selected) {
    ctx.fillStyle = rgba(CREAM, a)
    ctx.beginPath()
    ctx.arc(sx, sy, r * 0.45, 0, TAU)
    ctx.fill()
  }

  return r
}

export function drawOrbits(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  r: number,
  time: number,
  alpha: number,
): void {
  ctx.save()
  ctx.translate(sx, sy)
  ctx.rotate(time * 0.12)
  for (let i = 0; i < 2; i++) {
    const rr = r * (5.5 + i * 3.2)
    ctx.strokeStyle = rgba(GOLD, alpha * (0.28 - i * 0.08))
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.ellipse(0, 0, rr, rr * (0.62 + i * 0.08), i * 0.4, 0, TAU)
    ctx.stroke()
  }
  ctx.restore()
}

export function drawMemoryLabel(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  r: number,
  title: string,
  opts: { selected: boolean; related: boolean; alpha: number },
): void {
  if (opts.alpha < 0.04) return
  const size = opts.selected ? 16 : opts.related ? 13 : 11
  ctx.save()
  ctx.font = `${opts.selected ? 500 : 400} ${size}px "Noto Serif SC", "Cormorant Garamond", serif`
  ctx.textAlign = "center"
  ctx.textBaseline = "top"
  ctx.fillStyle = rgba(opts.selected ? GOLD_BRIGHT : CREAM, opts.alpha)
  ctx.fillText(title, sx, sy + r + 8)
  ctx.restore()
}
