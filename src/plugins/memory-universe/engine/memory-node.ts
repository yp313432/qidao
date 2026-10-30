import type { Memory } from "../types"
import { clamp, TAU } from "./easing"
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
  /*
   * 纵深。首版只是"稍微小一点"，近处和远处几乎看不出差别（用户说"没有 3D 效果"）。
   * 现在把两端的差拉开：近处（persp≈1.61）比远处（persp≈0.72）大近一倍、亮三倍。
   * 只改这一处就能让整片星云有前后层次，因为位置本身已经折过透视。
   */
  const depthSize = 0.3 + 0.95 * node.persp
  const depthFade = 0.4 + 0.6 * clamp((node.persp - 0.7) / 0.95, 0, 1)
  /*
   * 核要小、晕要大：概念稿里的星是"很小的白点 + 一大团化开的光"。
   * 首版核半径给到 3–5px，放大后是一颗颗实心白盘，像贴纸不像星。
   */
  let r = (0.8 + imp * 1.5) * breath * depthSize
  if (opts.selected) r *= 1.2
  else if (opts.related) r *= 1.1
  if (opts.hovered) r *= 1.08

  const goldMix = opts.selected ? 1 : opts.related ? 0.55 : opts.searchHit ? 0.4 : imp > 0.85 ? 0.22 : 0
  const col: RGB = mixRgb(CREAM, GOLD, goldMix)
  const a = opts.alpha * depthFade

  // 光晕：概念稿里每颗星都是一团化开的光，不是一个硬圆点
  const glowR = r * (opts.selected ? 9.5 : 7.5)
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR)
  glow.addColorStop(0, rgba(opts.selected ? GOLD_BRIGHT : col, a * (opts.selected ? 0.6 : 0.46)))
  glow.addColorStop(0.2, rgba(col, a * 0.14))
  glow.addColorStop(1, rgba(col, 0))
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(sx, sy, glowR, 0, TAU)
  ctx.fill()

  // 星芒只在"被选中"时出现。之前 related 也画，一选中就满屏十字，
  // 像星座连线图而不像星空 —— 星芒是"点名"的特权，不是普通星的特效。
  // 选中那颗也不要十字：概念稿里只有一圈细描边，十字会让它像准星。

  ctx.fillStyle = rgba(opts.selected ? mixRgb(CREAM, GOLD_BRIGHT, 0.35) : CREAM, Math.min(1, a * 1.15))
  ctx.beginPath()
  ctx.arc(sx, sy, r, 0, TAU)
  ctx.fill()

  if (opts.selected) {
    /*
     * 选中态：一颗细描边圆 + 中心亮点。
     * 概念稿里这颗星就是这样被"圈"出来的 —— 不靠放大、不靠飞走，
     * 只是安静地多了一圈，所以这里额外画环而不是继续把星放大。
     * 环半径压到 ~r*2：再大就盖住 21px 外的标签了。
     */
    ctx.save()
    const ring = Math.max(10, r * 2.1)
    ctx.strokeStyle = rgba({ r: 255, g: 240, b: 205 }, Math.min(1, a * 0.9))
    ctx.lineWidth = 1.1
    ctx.beginPath()
    ctx.arc(sx, sy, ring, 0, TAU)
    ctx.stroke()
    ctx.fillStyle = rgba(CREAM, a)
    ctx.beginPath()
    ctx.arc(sx, sy, r * 0.4, 0, TAU)
    ctx.fill()
    ctx.restore()
  }

  return r
}

/**
 * 标签文案：1–2 个字。
 * 一屏最多只写 8 个（universe.ts 里选 importance 最高的 8 条），
 * 所以这里必须足够短 —— 沿用整句 title 一多就变成"网络图的节点标注"。
 */
export function labelOf(title: string): string {
  const start = title.search(/[\u3400-\u9fff]/)
  if (start >= 0) return title.slice(start, start + 2)
  return title.trim().slice(0, 2)
}

export interface LabelPlacement {
  /** 屏幕尺寸（clamp 用） */
  width: number
  height: number
  /** 画面中心：标签沿"远离中心"的方向外推，避免压住星本身 */
  centerX: number
  centerY: number
}

export function drawMemoryLabel(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  label: string,
  opts: { selected: boolean; related: boolean; alpha: number } & LabelPlacement,
): void {
  if (opts.alpha < 0.04) return

  /*
   * 位置：从星心朝"远离画面中心"的方向推 21px。
   * 之前是固定画在星下面 (sy + r + 8)，星一密字就互相压；
   * 往外推以后，字总是落在星的"外侧"，屏幕边的星也不会把字挤出画面。
   */
  const dx = sx - opts.centerX
  const dy = sy - opts.centerY
  const len = Math.hypot(dx, dy) || 1
  const lx = clamp(sx + (dx / len) * 21, 26, opts.width - 26)
  const ly = clamp(sy + (dy / len) * 21 + 2, 64, opts.height * 0.66)

  const size = opts.selected ? 12 : 11
  ctx.save()
  ctx.font = `${opts.selected ? 500 : 400} ${size}px "Noto Serif SC", "Cormorant Garamond", serif`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  // 黑色投影：银河带亮的地方没有它，字就化在光里了
  ctx.shadowColor = "rgba(0,0,0,0.92)"
  ctx.shadowBlur = 7
  ctx.fillStyle = opts.selected
    ? rgba({ r: 255, g: 246, b: 224 }, Math.min(1, opts.alpha))
    : rgba({ r: 238, g: 229, b: 212 }, Math.min(1, opts.alpha * 0.8))
  ctx.fillText(label, lx, ly)
  ctx.restore()
}
