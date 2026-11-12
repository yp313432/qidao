export type Point = { x: number; y: number };
export type Surface = Point & { element?: Element };
export type Scene = { width: number; height: number; surfaces: Surface[]; obstacles: DOMRect[]; left: number; top: number };
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(Math.max(lo, hi), v));
export function arc(a: Point, b: Point, t: number): Point {
  const u = t * t * (3 - 2 * t);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u - Math.sin(Math.PI * t) * Math.min(96, 24 + Math.abs(b.x - a.x) * .18 + Math.abs(b.y - a.y) * .25) };
}
export function measureScene(layer: HTMLElement, list: HTMLElement, composer: HTMLElement | null, w: number, h: number): Scene {
  const box = layer.getBoundingClientRect(), view = list.getBoundingClientRect();
  const left = Math.max(box.left, view.left), top = Math.max(box.top, view.top);
  const bottom = Math.min(box.bottom, view.bottom, composer?.getBoundingClientRect().top ?? Infinity,
    (window.visualViewport?.offsetTop ?? 0) + (window.visualViewport?.height ?? window.innerHeight));
  const width = Math.max(0, Math.min(box.right, view.right) - left);
  const height = Math.max(h, bottom - top);
  const obstacles = Array.from(list.querySelectorAll('.k-bubble')).map(el => el.getBoundingClientRect());
  const surfaces: Surface[] = [];
  for (const element of list.querySelectorAll('.k-bubble')) {
    const r = element.getBoundingClientRect(), y = r.top - top - h + 4;
    if (r.width < w || y < 6 || y + h > height) continue;
    for (const x of [r.left - left + 4, r.right - left - w - 4]) {
      const p = { x: clamp(x, 4, width - w - 4), y, element };
      if (obstacles.every(o => o === r || p.x + w - 5 <= o.left - left || p.x + 5 >= o.right - left || p.y + h - 4 <= o.top - top || p.y + 4 >= o.bottom - top)) surfaces.push(p);
    }
  }
  // Safe fallback perches near the input, plus page edges when the chat is dense.
  for (const x of [4, Math.max(4, width - w - 4)]) {
    for (const y of [height - h - 6, height * .55, height * .25]) {
      if (obstacles.every(o => x + w <= o.left - left || x >= o.right - left || y + h <= o.top - top || y >= o.bottom - top)) surfaces.push({ x, y });
    }
  }
  if (!surfaces.length) surfaces.push({ x: 4, y: Math.max(4, height - h - 4) });
  return { width, height, surfaces, obstacles, left: left - box.left, top: top - box.top };
}
export function pathClear(a: Point, b: Point, scene: Scene, w: number, h: number, layer: DOMRect, jumping = true): boolean {
  for (let i = 1; i < 20; i++) {
    const t = i / 20;
    const p = jumping ? arc(a, b, t) : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (p.y < 0) return false;
    if (scene.obstacles.some(r => p.x + w - 7 > r.left - layer.left - scene.left && p.x + 7 < r.right - layer.left - scene.left && p.y + h - 5 > r.top - layer.top - scene.top && p.y + 5 < r.bottom - layer.top - scene.top)) return false;
  }
  return true;
}
export function motionReduced(app: string | undefined, pet: string | undefined, system: boolean): boolean {
  if (app === 'off' || pet === 'off') return true;
  if (pet === 'on' || app === 'on') return false;
  return system;
}

/** Preview routes are chosen as complete valid pairs, never from an arbitrary position. */
export function previewRoute(scene: Scene, w: number, h: number, layer: DOMRect, mode: string): { from: Surface; to: Surface; jump: boolean } | undefined {
  const platforms = scene.surfaces.filter(p => p.element);
  for (const a of [...platforms].reverse()) {
    for (const b of platforms) {
      const jump = a.element !== b.element;
      if ((mode === 'jump') !== jump || Math.hypot(a.x-b.x,a.y-b.y) < 28) continue;
      if (pathClear(a,b,scene,w,h,layer,jump) && pathClear(b,a,scene,w,h,layer,jump)) return { from: a, to: b, jump };
    }
  }
  return undefined;
}
