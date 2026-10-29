import { Camera } from "./camera"
import { mulberry32, TAU } from "./easing"
import { CREAM, GOLD, VIOLET, VIOLET_DEEP, VOID, mixRgb, rgba } from "./palette"

export interface Dust {
  x: number
  y: number
  z: number
  s: number
  a: number
  phase: number
}

export interface FieldStar {
  x: number
  y: number
  r: number
  a: number
  phase: number
  freq: number
  spike: boolean
  gold: boolean
}

export function createDust(count: number, seed: number): Dust[] {
  const rng = mulberry32(seed)
  const out: Dust[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      x: (rng() - 0.5) * 4200,
      y: (rng() - 0.5) * 3200,
      z: 0.12 + rng() * 0.78,
      s: 0.5 + rng() * 1.4,
      a: 0.12 + rng() * 0.38,
      phase: rng() * TAU,
    })
  }
  return out
}

export function createFieldStars(count: number, seed: number): FieldStar[] {
  const rng = mulberry32(seed)
  const out: FieldStar[] = []
  for (let i = 0; i < count; i++) {
    const bright = rng() > 0.82
    out.push({
      x: (rng() - 0.5) * 3600,
      y: (rng() - 0.5) * 2800,
      r: bright ? 1.15 + rng() * 0.7 : 0.45 + rng() * 0.55,
      a: bright ? 0.45 + rng() * 0.4 : 0.12 + rng() * 0.28,
      phase: rng() * TAU,
      freq: 0.25 + rng() * 0.9,
      spike: bright && rng() > 0.55,
      gold: rng() > 0.88,
    })
  }
  return out
}

export function paintBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  nebula: HTMLImageElement | null,
): void {
  /*
   * 底色：深紫黑 + 一条斜向的紫银河带 + 两团柔光。
   * 用户 2026-10 的要求：「不要纯黑的背景，类似于这种淡紫金色的星空」——
   * 所以底色往紫里偏，银河带中间掺一点金，不再是原先那种冷灰黑。
   */
  ctx.fillStyle = VOID
  ctx.fillRect(0, 0, w, h)

  const g = ctx.createRadialGradient(
    w * 0.5,
    h * 0.42,
    20,
    w * 0.5,
    h * 0.5,
    Math.max(w, h) * 0.78,
  )
  g.addColorStop(0, rgba(VIOLET_DEEP, 0.62))
  g.addColorStop(0.45, rgba(VIOLET_DEEP, 0.26))
  g.addColorStop(1, rgba(VIOLET_DEEP, 0))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  // 银河带：斜着一条，中间金、两边紫
  ctx.save()
  ctx.translate(w * 0.5, h * 0.5)
  ctx.rotate(-0.52)
  const smear = ctx.createLinearGradient(0, -h * 0.2, 0, h * 0.2)
  smear.addColorStop(0, rgba(VIOLET, 0))
  smear.addColorStop(0.34, rgba(VIOLET, 0.085))
  smear.addColorStop(0.5, rgba(GOLD, 0.1))
  smear.addColorStop(0.66, rgba(VIOLET, 0.085))
  smear.addColorStop(1, rgba(VIOLET, 0))
  ctx.fillStyle = smear
  ctx.fillRect(-w, -h * 0.2, w * 2, h * 0.4)
  ctx.restore()

  if (nebula && nebula.complete && nebula.naturalWidth > 0) {
    ctx.save()
    ctx.globalAlpha = 0.3
    ctx.globalCompositeOperation = "lighter"
    const scale = Math.max(w / nebula.naturalWidth, h / nebula.naturalHeight)
    const dw = nebula.naturalWidth * scale
    const dh = nebula.naturalHeight * scale
    ctx.drawImage(nebula, (w - dw) * 0.5, (h - dh) * 0.5, dw, dh)
    ctx.restore()
  }

  // 两团柔光：上紫下金，给纵深一点"呼吸"
  const violet = ctx.createRadialGradient(
    w * 0.36,
    h * 0.34,
    10,
    w * 0.36,
    h * 0.34,
    Math.max(w, h) * 0.42,
  )
  violet.addColorStop(0, rgba(VIOLET, 0.1))
  violet.addColorStop(1, rgba(VIOLET, 0))
  ctx.fillStyle = violet
  ctx.fillRect(0, 0, w, h)

  const warm = ctx.createRadialGradient(
    w * 0.64,
    h * 0.58,
    10,
    w * 0.64,
    h * 0.58,
    Math.max(w, h) * 0.34,
  )
  warm.addColorStop(0, rgba(GOLD, 0.075))
  warm.addColorStop(1, rgba(GOLD, 0))
  ctx.fillStyle = warm
  ctx.fillRect(0, 0, w, h)
}

export function drawDust(
  ctx: CanvasRenderingContext2D,
  dust: Dust[],
  cam: Camera,
  time: number,
): void {
  for (const d of dust) {
    const parallax = 0.18 + d.z * 0.7
    const driftX = Math.sin(time * 0.03 + d.phase) * 18 * d.z
    const driftY = Math.cos(time * 0.022 + d.phase) * 12 * d.z
    const wx = d.x * parallax + driftX
    const wy = d.y * parallax + driftY
    const s = cam.worldToScreen(wx, wy)
    if (s.x < -8 || s.y < -8 || s.x > cam.width + 8 || s.y > cam.height + 8) {
      continue
    }
    const twinkle = 0.75 + 0.25 * Math.sin(time * 0.4 + d.phase)
    ctx.fillStyle = rgba(CREAM, d.a * twinkle)
    ctx.fillRect(s.x, s.y, d.s, d.s)
  }
}

export function drawFieldStars(
  ctx: CanvasRenderingContext2D,
  stars: FieldStar[],
  cam: Camera,
  time: number,
  dim: number,
): void {
  for (const st of stars) {
    const p = cam.worldToScreen(st.x, st.y)
    if (p.x < -20 || p.y < -20 || p.x > cam.width + 20 || p.y > cam.height + 20) {
      continue
    }
    const breath = 0.72 + 0.28 * Math.sin(time * st.freq + st.phase)
    const a = st.a * breath * dim
    const col = st.gold ? mixRgb(GOLD, CREAM, 0.35) : CREAM
    const r = st.r * (0.9 + 0.12 * breath)

    if (st.spike && a > 0.2) {
      ctx.strokeStyle = rgba(col, a * 0.45)
      ctx.lineWidth = 0.6
      ctx.beginPath()
      ctx.moveTo(p.x - r * 7, p.y)
      ctx.lineTo(p.x + r * 7, p.y)
      ctx.moveTo(p.x, p.y - r * 7)
      ctx.lineTo(p.x, p.y + r * 7)
      ctx.stroke()
    }

    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 5)
    glow.addColorStop(0, rgba(col, a * 0.55))
    glow.addColorStop(0.4, rgba(col, a * 0.12))
    glow.addColorStop(1, rgba(col, 0))
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(p.x, p.y, r * 5, 0, TAU)
    ctx.fill()

    ctx.fillStyle = rgba(st.gold ? GOLD : CREAM, Math.min(1, a * 1.25))
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, TAU)
    ctx.fill()
  }
}

export function drawVignette(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  const v = ctx.createRadialGradient(
    w * 0.5,
    h * 0.5,
    Math.min(w, h) * 0.28,
    w * 0.5,
    h * 0.5,
    Math.max(w, h) * 0.72,
  )
  v.addColorStop(0, "rgba(0,0,0,0)")
  v.addColorStop(1, "rgba(0,0,0,0.55)")
  ctx.fillStyle = v
  ctx.fillRect(0, 0, w, h)
}

