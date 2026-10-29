/** 底色：深紫黑（用户 m 要求「不要纯黑，淡紫金色的星空」） */
export const VOID = "#08060f"

export const GOLD = { r: 201, g: 170, b: 114 }
export const GOLD_BRIGHT = { r: 232, g: 213, b: 163 }
export const CREAM = { r: 230, g: 225, b: 214 }
export const MIST = { r: 139, g: 132, b: 148 }
/** 星云紫：底色和银河带用 */
export const VIOLET = { r: 138, g: 108, b: 176 }
export const VIOLET_DEEP = { r: 58, g: 40, b: 86 }

export type RGB = { r: number; g: number; b: number }

export function rgba(c: RGB, a: number): string {
  return `rgba(${c.r},${c.g},${c.b},${Math.max(0, Math.min(1, a))})`
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  }
}
