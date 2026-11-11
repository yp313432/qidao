import { useEffect, useRef, type RefObject } from "react";
import { CrabPixels, groupOfEvent } from "./drawer-crab";
import { useApp } from "@/lib/store";
import { useEmotionStore } from "@/plugins/emotion-lifeform/lib/store";

type Point = { x: number; y: number };
type Props = {
  scroller: RefObject<HTMLDivElement | null>;
  composer: RefObject<HTMLDivElement | null>;
  paused: boolean;
  busy: boolean;
  working: boolean;
  replay: number;
};

export function ChatCrab({ scroller, composer, paused, busy, working, replay }: Props) {
  const pet = useApp((s) => s.settings.chatCrab);
  const event = useApp((s) => s.emotionEvents[0]);
  const reduced = useEmotionStore((s) => Boolean(s.settings.reducedMotion));
  const host = useRef<HTMLDivElement>(null);
  const actor = useRef<HTMLButtonElement>(null);
  const width = pet?.size ?? 32;
  const height = Math.round(width * 0.75);

  useEffect(() => {
    const layer = host.current;
    const crab = actor.current;
    const list = scroller.current;
    if (!layer || !crab || !list || paused || pet?.enabled === false) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const root = document.documentElement;
    const duration = pet?.activity === "quiet" ? 8500 : 3800;
    let timer = 0;
    let motion: Animation | undefined;
    let last = "";
    let appeared = false;
    let idleSince = Date.now();

    const stop = () => {
      window.clearTimeout(timer);
      motion?.cancel();
      crab.hidden = true;
    };
    const transform = ({ x, y }: Point) => `translate(${x}px, ${y}px)`;
    const measure = () => {
      const bounds = layer.getBoundingClientRect();
      const viewport = list.getBoundingClientRect();
      const input = composer.current?.getBoundingClientRect();
      const minX = Math.max(bounds.left, viewport.left) + 4;
      const maxX = Math.min(bounds.right, viewport.right) - width - 4;
      const minY = Math.max(bounds.top, viewport.top) + 4;
      const maxY = Math.min(bounds.bottom, viewport.bottom, input?.top ?? Infinity) - height - 8;
      const obstacles = Array.from(list.querySelectorAll(".k-bubble, .chat-meta, img, button"))
        .filter((el) => el !== crab)
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width && r.height && r.bottom >= minY && r.top <= maxY + height);
      const clear = ({ x, y }: Point) =>
        x >= minX && x <= maxX && y >= minY && y <= maxY &&
        obstacles.every((r) => x + width <= r.left || x >= r.right || y + height <= r.top || y >= r.bottom);
      const points = Array.from(list.querySelectorAll(".k-bubble")).flatMap((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < width || !r.height || r.top < viewport.top || r.bottom > viewport.bottom) return [];
        return [r.left + 4, r.right - width - 4].map((x) => ({ x, y: r.top - height }));
      }).filter(clear);
      const edges = [minX, maxX].flatMap((x) =>
        [maxY, maxY - 48, maxY - 96].map((y) => ({ x, y })),
      ).filter(clear);
      const local = (p: Point) => ({ x: p.x - bounds.left, y: p.y - bounds.top });
      return { points, edges, clear, local };
    };
    const tick = () => {
      if (root.dataset.keyboard === "up" || document.hidden) return;
      const { points, edges, clear, local } = measure();
      const pool = points.length ? points : edges;
      const from = pool.find((p) => transform(local(p)) === last) ??
        pool[Math.floor(Math.random() * pool.length)];
      if (!from) {
        timer = window.setTimeout(tick, duration);
        return;
      }
      const frames = [{ transform: transform(local(from)) }];
      let current = from;
      const resting = Date.now() - idleSince > 45000;
      const animated = !reduced && !media.matches;
      if (!busy && !resting && animated) {
        if (!appeared && edges.includes(from)) {
          const x = local(from).x;
          const outside = x < layer.clientWidth / 2 ? x - width : x + width;
          frames.unshift({ transform: transform({ x: outside, y: local(from).y }) });
        }
        for (let hop = 0; hop < 2; hop += 1) {
          const targets = pool.filter((p) =>
            Math.hypot(p.x - current.x, p.y - current.y) >= 12 &&
            Math.hypot(p.x - current.x, p.y - current.y) <= 180,
          );
          if (targets.length > 1 && Math.random() < 0.5) targets.reverse();
          const path = targets.map((to) => Array.from({ length: 17 }, (_, i) => {
            const t = i / 16;
            const rise = Math.abs(to.y - current.y) < 3 ? 0 : 24 * 4 * t * (1 - t);
            return { x: current.x + (to.x - current.x) * t, y: current.y + (to.y - current.y) * t - rise };
          })).find((candidate) => candidate.every(clear));
          if (!path) break;
          frames.push(...path.slice(1).map((p) => ({ transform: transform(local(p)) })));
          current = path[path.length - 1]!;
        }
      }
      crab.hidden = false;
      appeared = true;
      last = transform(local(current));
      crab.style.transform = last;
      crab.dataset.pose = working ? "work" : busy ? "think" : resting ? "rest" : "idle";
      motion?.cancel();
      if (frames.length > 1) {
        motion = crab.animate(frames, { duration: Math.max(320, frames.length * 32), easing: "linear" });
        motion.onfinish = () => {
          crab.querySelector(".crab-claw")?.animate(
            [{ transform: "translateY(0)" }, { transform: "translateY(-2px)" }, { transform: "translateY(0)" }],
            { duration: 220 },
          );
        };
      }
      timer = window.setTimeout(tick, duration);
    };
    const reset = () => {
      stop();
      idleSince = Date.now();
      appeared = false;
      if (root.dataset.keyboard !== "up" && !document.hidden) timer = window.setTimeout(tick, replay ? 220 : 420);
    };
    const resize = new ResizeObserver(reset);
    resize.observe(list);
    if (list.firstElementChild) resize.observe(list.firstElementChild);
    if (composer.current) resize.observe(composer.current);
    const keyboard = new MutationObserver(reset);
    keyboard.observe(root, { attributes: true, attributeFilter: ["data-keyboard"] });
    list.addEventListener("scroll", reset, { passive: true });
    document.addEventListener("visibilitychange", reset);
    media.addEventListener("change", reset);
    reset();
    return () => {
      stop();
      resize.disconnect();
      keyboard.disconnect();
      list.removeEventListener("scroll", reset);
      document.removeEventListener("visibilitychange", reset);
      media.removeEventListener("change", reset);
    };
  }, [scroller, composer, paused, busy, working, replay, pet?.enabled, pet?.activity, width, height, reduced]);

  if (pet?.enabled === false) return null;
  return (
    <div ref={host} className="chat-crab-layer">
      <button ref={actor} className="chat-crab-actor" type="button" aria-label="戳一下小螃蟹" hidden
        onClick={(e) => {
          if (reduced || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
          e.currentTarget.firstElementChild?.animate(
            [{ scale: "1" }, { scale: "0.78 0.85" }, { scale: "1.12 0.95" }, { scale: "1" }],
            { duration: 340 },
          );
        }}>
        <CrabPixels group={groupOfEvent(event)} intensity={event?.intensity} size={width} reduced={reduced} />
      </button>
    </div>
  );
}
