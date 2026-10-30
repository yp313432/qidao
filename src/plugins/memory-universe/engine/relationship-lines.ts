import { quadPoint } from "./easing"

const WARM_LINE = { r: 226, g: 200, b: 160 }

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
  // 弧度比首版小一半：选中态是"牵出来"的丝线，不是网络图的连线
  const bulge = (7 + len * 0.055) * sign
  return { cx: mx + nx * bulge, cy: my + ny * bulge }
}

/**
 * 选中某颗星时，它和"最相关的几颗"之间的细线（最多 4 条，由 universe.ts 控制）。
 *
 * 首版：金色、0.55–1.45px、沿线还有跑动的光点 —— 远看就是一坨网络图。
 * 现在：暖白、固定 1px、两端渐隐（中间实、两头化开），alpha 压到 0.18 左右，
 * 只在选中时出现，其余时候画面里一条线都没有。
 */
export function drawEdge(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  appear: number,
  seed: number,
  time = 0,
): void {
  if (appear < 0.02) return
  const { cx, cy } = bezierControl(x1, y1, x2, y2, seed)
  const alpha = 0.26 * appear

  // 两端留 4px 空隙：线不要真的插进星核里，看起来才"轻"
  const p0 = quadPoint(0.03, x1, y1, cx, cy, x2, y2)
  const p2 = quadPoint(0.97, x1, y1, cx, cy, x2, y2)

  const grad = ctx.createLinearGradient(p0.x, p0.y, p2.x, p2.y)
  grad.addColorStop(0, `rgba(${WARM_LINE.r},${WARM_LINE.g},${WARM_LINE.b},0)`)
  grad.addColorStop(0.22, `rgba(${WARM_LINE.r},${WARM_LINE.g},${WARM_LINE.b},${alpha})`)
  grad.addColorStop(0.78, `rgba(${WARM_LINE.r},${WARM_LINE.g},${WARM_LINE.b},${alpha})`)
  grad.addColorStop(1, `rgba(${WARM_LINE.r},${WARM_LINE.g},${WARM_LINE.b},0)`)

  ctx.save()
  // "lighter" 让线在暗底上像一层极细的光，而不是一条灰线
  ctx.globalCompositeOperation = "lighter"
  const steps = 16
  ctx.beginPath()
  ctx.moveTo(p0.x, p0.y)
  for (let i = 1; i <= steps; i++) {
    const t = 0.03 + (i / steps) * 0.94
    const p = quadPoint(t, x1, y1, cx, cy, x2, y2)
    ctx.lineTo(p.x, p.y)
  }
  ctx.strokeStyle = grad
  ctx.lineWidth = 1
  ctx.lineCap = "round"
  ctx.stroke()

  /*
   * 沿线流动的光点（2026-10-30 用户：「连线加回流动粒子，太寡淡了」）。
   * 每条线 2 颗，慢速、相位按 seed 错开；两头淡出，看起来像光顺着丝线走。
   */
  for (let i = 0; i < 2; i++) {
    const speed = 0.028 + (seed % 5) * 0.004
    const phase = time * speed + i * 0.5 + ((seed % 7) * 0.09)
    const t = 0.06 + ((phase % 1) * 0.88)
    const p = quadPoint(t, x1, y1, cx, cy, x2, y2)
    const fade = Math.min(1, Math.min(t, 1 - t) / 0.13)
    const a = alpha * 3.1 * fade
    const glowR = 6.5
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR)
    g.addColorStop(0, `rgba(255, 246, 224, ${a})`)
    g.addColorStop(0.34, `rgba(${WARM_LINE.r},${WARM_LINE.g},${WARM_LINE.b},${a * 0.55})`)
    g.addColorStop(1, `rgba(${WARM_LINE.r},${WARM_LINE.g},${WARM_LINE.b},0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}
