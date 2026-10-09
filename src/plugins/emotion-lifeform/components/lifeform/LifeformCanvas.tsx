import { useEffect, useRef } from "react";
import type { VisualParams } from "@/plugins/emotion-lifeform/lib/emotion/types";
import { createDust, drawLifeform, stepDust, type Dust, type MemoryNode } from "./draw-lifeform";

type Props = {
  params: VisualParams;
  nodes: MemoryNode[];
  reduced: boolean;
};

function lerpHue(a: number, b: number, t: number) {
  const delta = ((b - a + 540) % 360) - 180;
  return (a + delta * t + 360) % 360;
}

function lerpParams(current: VisualParams, target: VisualParams, t: number): VisualParams {
  const next = { ...current };
  (Object.keys(target) as (keyof VisualParams)[]).forEach((key) => {
    next[key] = key === "hue" || key === "hue2" ? lerpHue(current[key], target[key], t) : current[key] + (target[key] - current[key]) * t;
  });
  return next;
}

export function LifeformCanvas({ params, nodes, reduced }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paramsRef = useRef(params);
  const nodesRef = useRef(nodes);
  const reducedRef = useRef(reduced);
  paramsRef.current = params;
  nodesRef.current = nodes;
  reducedRef.current = reduced;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dust: Dust[] = createDust();
    const pointer = { x: 0, y: 0 };
    let frame = 0;
    let last = performance.now();
    let current = { ...paramsRef.current };
    let frozen = 1.8;
    let running = true;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    };
    const onLeave = () => {
      pointer.x = 0;
      pointer.y = 0;
    };
    canvas.addEventListener("pointermove", onPointer);
    canvas.addEventListener("pointerleave", onLeave);

    const paint = (time: number, dt: number) => {
      const target = paramsRef.current;
      const glide = reducedRef.current ? 1 : 1 - Math.exp(-dt * 2.6);
      current = lerpParams(current, target, glide);
      if (!reducedRef.current) stepDust(dust, current, dt);
      const rect = canvas.getBoundingClientRect();
      drawLifeform(ctx, rect.width, rect.height, time, current, dust, nodesRef.current, reducedRef.current ? { x: 0, y: 0 } : pointer);
    };

    const loop = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!reducedRef.current) frozen += dt;
      paint(frozen, reducedRef.current ? 0 : dt);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointermove", onPointer);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />;
}
