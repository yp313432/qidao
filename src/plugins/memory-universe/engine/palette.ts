export const VOID = "#05040a"

export const GOLD = { r: 201, g: 170, b: 114 }
export const GOLD_BRIGHT = { r: 232, g: 213, b: 163 }
export const CREAM = { r: 230, g: 225, b: 214 }
export const MIST = { r: 139, g: 132, b: 148 }

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
