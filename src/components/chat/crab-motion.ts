export type CrabPose = "idle" | "walk" | "think" | "work" | "rest" | "poke";
export type CrabMotionOptions = {
  width: number;
  quiet: boolean;
  reduced: boolean;
  paused: boolean;
  busy: boolean;
  working: boolean;
};

/** Position belongs to the pet's lifetime, never to a reply/scroll/keyboard event. */
export function createCrabMotion(
  layer: HTMLElement,
  actor: HTMLElement,
  options: () => CrabMotionOptions,
) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let disposed = false;
  let last = 0;
  let x = 8;
  let target = x;
  let awakeAt = performance.now();
  let nextWalk = awakeAt + 900;
  let pokedUntil = 0;
  let pose: CrabPose | undefined;
  const wake = () => {
    awakeAt = performance.now();
    nextWalk = Math.min(nextWalk, awakeAt + 900);
  };
  const poke = () => {
    wake();
    target = x;
    pokedUntil = awakeAt + 1200;
    actor.dataset.pose = "idle";
    void actor.offsetWidth;
    pose = undefined;
  };
  const tick = (now: number) => {
    if (disposed || document.hidden) return;
    const dt = last ? Math.min(40, now - last) / 1000 : 0;
    last = now;
    const o = options();
    const reduced = o.reduced || media.matches;
    const maxX = Math.max(0, layer.clientWidth - Math.max(44, o.width + 12) - 4);
    const minX = Math.min(4, maxX);
    actor.dataset.reduced = String(reduced);
    layer.dataset.paused = String(o.paused);
    if (!o.paused) {
      if (o.busy || o.working) awakeAt = now;
      const resting = now - awakeAt >= 45000;
      const reacting = now < pokedUntil;
      target = Math.max(minX, Math.min(maxX, target));
      if (o.busy || o.working || resting || reacting || reduced) target = x;
      if (!o.busy && !o.working && !resting && !reacting && !reduced && now >= nextWalk) {
        const direction = x < (minX + maxX) / 2 ? 1 : -1;
        target = Math.max(minX, Math.min(maxX, x + direction * (64 + Math.random() * 120)));
        nextWalk = Infinity;
      }
      // Resizing changes the legal range; walk back into it instead of teleporting.
      target = Math.max(minX, Math.min(maxX, target));
      const distance = target - x;
      const step = (o.quiet ? 22 : 38) * dt;
      const moving = !reduced && Math.abs(distance) > 0.4;
      if (moving) {
        actor.dataset.direction = distance > 0 ? "right" : "left";
        x += Math.sign(distance) * Math.min(Math.abs(distance), step);
      } else if (reduced) x = Math.max(minX, Math.min(maxX, x));
      if (Math.abs(target - x) < 0.5 && nextWalk === Infinity) {
        nextWalk = now + (o.quiet ? 5200 : 1800) + Math.random() * 1600;
      }
      const next: CrabPose = reacting ? "poke" : o.working ? "work" : o.busy ? "think" :
        resting ? "rest" : moving ? "walk" : "idle";
      if (next !== pose) {
        pose = next;
        actor.dataset.pose = next;
      }
      actor.style.transform = `translateX(${x.toFixed(2)}px)`;
      actor.hidden = false;
    }
    frame = requestAnimationFrame(tick);
  };
  const resume = () => {
    cancelAnimationFrame(frame);
    last = 0;
    if (!document.hidden) frame = requestAnimationFrame(tick);
  };
  document.addEventListener("visibilitychange", resume);
  frame = requestAnimationFrame(tick);
  return {
    wake,
    poke,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", resume);
    },
  };
}
