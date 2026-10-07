import { clamp, spring } from "./easing"

export class Camera {
  x = 0
  y = 0
  scale = 0.92
  vx = 0
  vy = 0
  vs = 0
  tx = 0
  ty = 0
  tScale = 0.92
  width = 1
  height = 1
  following = true

  resize(w: number, h: number) {
    this.width = w
    this.height = h
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.x) * this.scale + this.width * 0.5,
      y: (wy - this.y) * this.scale + this.height * 0.5,
    }
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.width * 0.5) / this.scale + this.x,
      y: (sy - this.height * 0.5) / this.scale + this.y,
    }
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const before = this.screenToWorld(sx, sy)
    this.scale = clamp(this.scale * factor, 0.32, 3.4)
    this.tScale = this.scale
    const after = this.screenToWorld(sx, sy)
    this.x += before.x - after.x
    this.y += before.y - after.y
    this.tx = this.x
    this.ty = this.y
    this.following = false
  }

  pan(dx: number, dy: number) {
    this.x -= dx / this.scale
    this.y -= dy / this.scale
    this.tx = this.x
    this.ty = this.y
    this.following = false
  }

  lookAt(wx: number, wy: number, scale: number) {
    this.tx = wx
    this.ty = wy
    this.tScale = clamp(scale, 0.32, 3.4)
    this.following = true
  }

  step(dt: number, reduced: boolean) {
    if (!this.following) {
      this.x += this.vx * dt
      this.y += this.vy * dt
      const decay = Math.exp(-(reduced ? 10 : 3.6) * dt)
      this.vx *= decay
      this.vy *= decay
      if (Math.abs(this.vx) < 2) this.vx = 0
      if (Math.abs(this.vy) < 2) this.vy = 0
      return
    }
    const stiff = reduced ? 48 : 9.5
    const damp = reduced ? 14 : 6.2
    ;[this.x, this.vx] = spring(this.x, this.vx, this.tx, dt, stiff, damp)
    ;[this.y, this.vy] = spring(this.y, this.vy, this.ty, dt, stiff, damp)
    ;[this.scale, this.vs] = spring(
      this.scale,
      this.vs,
      this.tScale,
      dt,
      stiff,
      damp,
    )
  }
}
