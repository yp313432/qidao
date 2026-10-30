import { Camera } from "./camera"
import { mulberry32, TAU } from "./easing"
import { CREAM, GOLD, VIOLET, VIOLET_DEEP, VOID, mixRgb, rgba } from "./palette"

/** 银河带的倾角：负数是"左下→右上"，和概念稿一致 */
const BAND_ANGLE = -0.44

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

/** 焦外星：离镜头太近、已经虚掉的光斑（不是"星星"，是镜头语言） */
export interface Bokeh {
  x: number
  y: number
  r: number
  a: number
  warm: boolean
  phase: number
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

export function createBokeh(count: number, seed: number): Bokeh[] {
  const rng = mulberry32(seed)
  const out: Bokeh[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      x: (rng() - 0.5) * 2600,
      y: (rng() - 0.5) * 2200,
      // 半径 26–88：够大才像"虚焦"，不是一颗普通的星
      r: 26 + rng() * 62,
      // 透明度压到 0.02–0.05：它是空气，不是糊在屏幕上的一团白
      a: 0.018 + rng() * 0.03,
      warm: rng() > 0.45,
      phase: rng() * TAU,
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
   * 用户 2026-10 原话：「那个星云没改成那种星云」——说的是背景还是从中心化开的一团紫雾，
   * 不像概念稿里那条斜穿画面的银河。所以这里整个换掉：
   *   1. 底色只留深紫黑（屏角 #0d0a14 附近，不纯黑也不整屏发白）；
   *   2. 一条绕 -0.44rad 旋转的宽带：紫 → 银金 → 紫；
   *   3. 沿带撒 26 团柔光云（半径 40–140，透明度 0.04–0.08），叠出银河的"厚度"；
   *   4. 带内再烘一层细星尘（画进离屏底图，省的每帧画一千个点）；
   *   5. 最后才是可动的星尘 / 亮星（在 universe.ts 里逐帧画）。
   * 整个背景随窗口尺寸重烘一次，拖动缩放时不会跳。
   */
  ctx.fillStyle = VOID
  ctx.fillRect(0, 0, w, h)

  const cx = w * 0.5
  const cy = h * 0.42
  // 带宽跟着屏幕高度走：手机上是 0.16h，和概念稿 130/830 的比例一致
  const bh = Math.max(96, h * 0.16)

  // 一层很大的淡紫雾，只负责把银河带"托"起来，不负责发光
  const haze = ctx.createRadialGradient(cx, cy, bh * 0.3, cx, cy, Math.max(w, h) * 0.85)
  haze.addColorStop(0, rgba(VIOLET_DEEP, 0.2))
  haze.addColorStop(0.55, rgba(VIOLET_DEEP, 0.08))
  haze.addColorStop(1, rgba(VIOLET_DEEP, 0))
  ctx.fillStyle = haze
  ctx.fillRect(0, 0, w, h)

  /*
   * 银河带本体。用 "lighter" 叠加：几层半透明的紫/银金叠在一起才会发"光"，
   * 换成 source-over 就是一块脏的灰紫色色块。
   */
  ctx.save()
  ctx.globalCompositeOperation = "lighter"
  ctx.translate(cx, cy)
  ctx.rotate(BAND_ANGLE)
  const band = ctx.createLinearGradient(0, -bh, 0, bh)
  band.addColorStop(0, "rgba(126,96,172,0)")
  band.addColorStop(0.28, "rgba(126,96,172,0.17)")
  band.addColorStop(0.46, "rgba(178,150,190,0.14)")
  band.addColorStop(0.54, "rgba(206,182,150,0.22)")
  band.addColorStop(0.72, "rgba(126,96,172,0.17)")
  band.addColorStop(1, "rgba(126,96,172,0)")
  ctx.fillStyle = band
  ctx.fillRect(-w * 1.1, -bh, w * 2.2, bh * 2)

  // 再叠一条更窄的银金芯：银河的"中子"部分，让带子有厚度而不是一条均匀的色带。
  // 芯色偏银白（不是金）：纯金会显得像一条暖色灯带，银白发蓝才像星尘。
  const core = ctx.createLinearGradient(0, -bh * 0.42, 0, bh * 0.42)
  core.addColorStop(0, "rgba(210,200,225,0)")
  core.addColorStop(0.5, "rgba(210,200,225,0.08)")
  core.addColorStop(1, "rgba(210,200,225,0)")
  ctx.fillStyle = core
  ctx.fillRect(-w * 1.1, -bh * 0.42, w * 2.2, bh * 0.84)

  // 沿带随机撒云团：亮部随机偏银金，暗部随机偏紫，才不会是一条均匀的色带
  const rng = mulberry32(20261020)
  for (let i = 0; i < 30; i++) {
    const bx = (rng() - 0.5) * w * 1.15
    const by = (rng() - 0.5) * bh * 1.5
    const gx = cx + bx * Math.cos(BAND_ANGLE) - by * Math.sin(BAND_ANGLE)
    const gy = cy + bx * Math.sin(BAND_ANGLE) + by * Math.cos(BAND_ANGLE) + h * 0.02
    const rad = 40 + rng() * 100
    const warm = rng()
    const cr = Math.round(150 + warm * 92)
    const cg = Math.round(126 + warm * 66)
    const cb = Math.round(196 - warm * 34)
    const a = 0.04 + rng() * 0.04
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, rad)
    g.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`)
    g.addColorStop(0.6, `rgba(${cr},${cg},${cb},${a * 0.45})`)
    g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(gx, gy, rad, 0, TAU)
    ctx.fill()
  }

  // 带内细星尘：烘进底图。密度比带外高一个量级，"银河"才成立。
  // 用一层很便宜的低频"结块"把密度打散 —— 均匀撒点会像电视雪花，
  // 银河的颗粒本来就是一团一团的。
  const dustRng = mulberry32(9021)
  for (let i = 0; i < 1300; i++) {
    const x = (dustRng() - 0.5) * w * 1.25
    const y = (dustRng() - 0.5) * bh * 2 * (0.28 + dustRng() * 0.72)
    const clump =
      0.5 +
      0.5 *
        Math.sin(x * 0.011 + y * 0.024) *
        Math.sin(y * 0.019 - x * 0.006)
    const r = 0.35 + dustRng() * 1.25
    const a = (0.1 + dustRng() * 0.42) * (0.35 + 0.9 * clump)
    ctx.fillStyle = `rgba(246,238,224,${a})`
    ctx.fillRect(x, y, r, r)
  }

  // 带里再撒一百多颗"看得见"的亮砂：细尘只提供体量，这些才提供颗颗分明的质感
  const gritRng = mulberry32(7777)
  for (let i = 0; i < 130; i++) {
    const x = (gritRng() - 0.5) * w * 1.2
    const y = (gritRng() - 0.5) * bh * 2 * (0.15 + gritRng() * 0.85)
    const r = 0.7 + gritRng() * 1.1
    const a = 0.28 + gritRng() * 0.45
    ctx.fillStyle = `rgba(250,244,232,${a})`
    ctx.fillRect(x, y, r, r)
  }
  ctx.restore()

  // 可选的星云贴图：只当一层很淡的暖色纹理用，压到 0.12，
  // 不然那张图里的褐色噪点会把银河带盖掉（用户截图里的"脏"点就是它）
  if (nebula && nebula.complete && nebula.naturalWidth > 0) {
    ctx.save()
    ctx.globalAlpha = 0.12
    ctx.globalCompositeOperation = "lighter"
    const scale = Math.max(w / nebula.naturalWidth, h / nebula.naturalHeight)
    const dw = nebula.naturalWidth * scale
    const dh = nebula.naturalHeight * scale
    ctx.drawImage(nebula, (w - dw) * 0.5, (h - dh) * 0.5, dw, dh)
    ctx.restore()
  }

  // 两团极淡的补光：给屏角一点颜色，别让四角死黑
  const violet = ctx.createRadialGradient(
    w * 0.3,
    h * 0.24,
    10,
    w * 0.3,
    h * 0.24,
    Math.max(w, h) * 0.42,
  )
  violet.addColorStop(0, rgba(VIOLET, 0.07))
  violet.addColorStop(1, rgba(VIOLET, 0))
  ctx.fillStyle = violet
  ctx.fillRect(0, 0, w, h)

  const warm = ctx.createRadialGradient(
    w * 0.68,
    h * 0.6,
    10,
    w * 0.68,
    h * 0.6,
    Math.max(w, h) * 0.36,
  )
  warm.addColorStop(0, rgba(GOLD, 0.05))
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

export function drawBokeh(
  ctx: CanvasRenderingContext2D,
  bokeh: Bokeh[],
  cam: Camera,
  time: number,
  dim: number,
): void {
  /*
   * 焦外星：镜头前的"虚焦"光斑。真正的景深要 filter: blur()，
   * 但 canvas 每帧跑 filter 会掉帧（手机上尤其），所以用"大半径 + 极低透明度"的
   * 径向渐变模拟——视觉上就是一团化开的暖光，代码里一个像素都不用模糊。
   * 视差比记忆星更大（1.28 倍），拖拽时能明显感觉"它在最前面"。
   */
  ctx.save()
  ctx.globalCompositeOperation = "lighter"
  for (const b of bokeh) {
    const driftX = Math.sin(time * 0.02 + b.phase) * 16
    const driftY = Math.cos(time * 0.016 + b.phase) * 12
    const px = cam.width * 0.5 + (b.x + driftX - cam.x) * cam.scale * 1.28
    const py = cam.height * 0.5 + (b.y + driftY - cam.y) * cam.scale * 1.28
    const rad = b.r * (0.7 + 0.45 * cam.scale)
    if (px < -rad || py < -rad || px > cam.width + rad || py > cam.height + rad) continue
    const a = b.a * dim
    const col = b.warm ? mixRgb(CREAM, GOLD, 0.55) : CREAM
    const g = ctx.createRadialGradient(px, py, 0, px, py, rad)
    g.addColorStop(0, rgba(col, a))
    g.addColorStop(0.55, rgba(col, a * 0.45))
    g.addColorStop(1, rgba(col, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(px, py, rad, 0, TAU)
    ctx.fill()
  }
  ctx.restore()
}

export function drawVignette(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  // 只压到 0.3：再深屏角就成纯黑了，用户要的是"深紫黑 #0d0a14 附近"
  const v = ctx.createRadialGradient(
    w * 0.5,
    h * 0.5,
    Math.min(w, h) * 0.28,
    w * 0.5,
    h * 0.5,
    Math.max(w, h) * 0.72,
  )
  v.addColorStop(0, "rgba(0,0,0,0)")
  v.addColorStop(1, "rgba(0,0,0,0.3)")
  ctx.fillStyle = v
  ctx.fillRect(0, 0, w, h)
}
