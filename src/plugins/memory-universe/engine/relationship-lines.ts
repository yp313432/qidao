import { hash32, quadPoint, TAU } from "./easing"
import { GOLD, GOLD_BRIGHT, rgba } from "./palette"

export interface VisibleEdge {
  a: string
  b: string
  strength: number
  appear: number
  seed: number
}

export function bezierControl(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number,
): { cx: number; cy: number } {
  const mx = (x1 + x2) * 0.5
  const my = (y1 + y2) * 0.5
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const sign = seed % 2 === 0 ? 1 : -1
  const bulge = (14 + len * 0.14) * sign
  return { cx: mx + nx * bulge, cy: my + ny * bulge }
}

export function drawEdge(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  strength: number,
  appear: number,
  time: number,
  seed: number,
  reduced: boolean,
): void {
  if (appear < 0.02) return
  const { cx, cy } = bezierControl(x1, y1, x2, y2, seed)
  const tEnd = appear
  const steps = Math.max(8, Math.floor(18 * appear))
  const alpha = (0.12 + strength * 0.5) * appear
  const width = 0.55 + strength * 0.9

  ctx.beginPath()
  const p0 = quadPoint(0, x1, y1, cx, cy, x2, y2)
  ctx.moveTo(p0.x, p0.y)
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * tEnd
    const p = quadPoint(t, x1, y1, cx, cy, x2, y2)
    ctx.lineTo(p.x, p.y)
  }
  ctx.strokeStyle = rgba(GOLD, alpha)
  ctx.lineWidth = width
  ctx.lineCap = "round"
  ctx.stroke()

  if (reduced || strength < 0.28) return

  const nDots = strength > 0.72 ? 2 : 1
  for (let i = 0; i < nDots; i++) {
    const speed = 0.07 + (hash32(String(seed + i)) % 10) * 0.004
    const t =
      ((time * speed + i * 0.37 + (seed % 11) * 0.01) % 1) * appear
    const p = quadPoint(t, x1, y1, cx, cy, x2, y2)
    const da = alpha * 1.4
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 5)
    g.addColorStop(0, rgba(GOLD_BRIGHT, da))
    g.addColorStop(1, rgba(GOLD, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(p.x, p.y, 5, 0, TAU)
    ctx.fill()
    ctx.fillStyle = rgba(GOLD_BRIGHT, Math.min(1, da + 0.2))
    ctx.beginPath()
    ctx.arc(p.x, p.y, 1.15, 0, TAU)
    ctx.fill()
  }
}

