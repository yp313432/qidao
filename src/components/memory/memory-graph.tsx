import { useEffect, useMemo, useRef, useState } from "react";
import { KIND_LABEL, retention } from "@/lib/memory";
import type { Memory } from "@/lib/types";

/**
 * 神经元图：每条记忆是一个节点，连线是它们之间的关联。
 *
 * 做法说明（为什么自己写、不用三方图库）：
 *   · 只有几十到一两百个节点，写个力导向就够了，不值得塞一个几百 KB 的图库
 *   · 全部画在 canvas 上：**节点多了也不卡**（DOM 每个节点一个 div 会卡死手机）
 *   · 力导向只在开场跑固定帧数（约 1 秒）算完就停 —— 不是一直动，
 *     省电，也不会跟"动效开关"打架
 *
 * 视觉上要一眼看懂：
 *   节点大小 = 记忆强度   节点亮度 = 清晰度（快忘的变暗）
 *   颜色 = 类型           孤立的点会自己飘到外围
 */

const KIND_COLOR: Record<Memory["kind"], string> = {
  profile: "96,165,250", // 天蓝
  preference: "251,113,133", // 玫瑰
  project: "251,191,36", // 琥珀
  relationship: "167,139,250", // 紫罗兰
  timeline: "52,211,153", // 翡翠
};

type Node = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  memory: Memory;
  retention: number;
};

export function MemoryGraph({
  memories,
  selectedId,
  onSelect,
  /** 最多画多少个节点（按清晰度挑）—— 手机上 120 个已经很密了 */
  limit = 120,
}: {
  memories: Memory[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  limit?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 340, h: 300 });
  /** 布局回调里要读最新尺寸，所以镜像一份进 ref（避免闭包读到旧值） */
  const sizeRef = useRef(size);
  const nodesRef = useRef<Node[]>([]);
  const transform = useRef({ k: 1, x: 0, y: 0 });
  const dragRef = useRef<{ id: string | null; panning: boolean; lastX: number; lastY: number }>({
    id: null,
    panning: false,
    lastX: 0,
    lastY: 0,
  });
  const [hover, setHover] = useState<string | null>(null);

  const active = useMemo(() => {
    const list = memories.filter((m) => m.status === "active");
    return list
      .map((m) => ({ m, r: retention(m) }))
      .sort((a, b) => b.r - a.r)
      .slice(0, limit)
      .map((x) => x.m);
  }, [memories, limit]);

  /* ---------------- 布局：只在数据变化时算一次（跑约 500 帧就停） ---------------- */
  useEffect(() => {
    const nodes: Node[] = active.map((m, i) => {
      const angle = (i / Math.max(1, active.length)) * Math.PI * 2;
      return {
        id: m.id,
        x: Math.cos(angle) * 90 + (Math.random() - 0.5) * 30,
        y: Math.sin(angle) * 90 + (Math.random() - 0.5) * 30,
        vx: 0,
        vy: 0,
        r: 4 + Math.min(9, (m.strength || 1) * 4 + m.recallCount * 0.4),
        memory: m,
        retention: retention(m),
      };
    });
    nodesRef.current = nodes;
    const byId = new Map(nodes.map((n) => [n.id, n]));

    let ticks = 0;
    let raf = 0;
    const step = () => {
      // 斥力：两两相推（一百来个节点，O(n²) 也就一万次，够快）
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i]!;
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j]!;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            d2 = 1;
          }
          const f = 900 / d2;
          const d = Math.sqrt(d2);
          a.vx -= (dx / d) * f;
          a.vy -= (dy / d) * f;
          b.vx += (dx / d) * f;
          b.vy += (dy / d) * f;
        }
      }
      // 引力：有连线的互相拉近
      for (const n of nodes) {
        for (const id of n.memory.links) {
          const other = byId.get(id);
          if (!other) continue;
          const dx = other.x - n.x;
          const dy = other.y - n.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          const f = (d - 62) * 0.012;
          n.vx += (dx / d) * f;
          n.vy += (dy / d) * f;
        }
        // 轻微向心：别飘出画面
        n.vx += -n.x * 0.0022;
        n.vy += -n.y * 0.0022;
        n.vx *= 0.86;
        n.vy *= 0.86;
        n.x += n.vx;
        n.y += n.vy;
      }
      ticks += 1;
      draw();
      if (ticks < 420) {
        raf = requestAnimationFrame(step);
      } else {
        /**
         * 布局跑完，自动"缩放适应"：把所有节点刚好装进画面。
         * 少了这一步，力导向会把一些簇甩到框外面去（实测：右上和右下都被切掉）。
         */
        const { w, h } = sizeRef.current;
        const xs = nodes.map((n) => n.x);
        const ys = nodes.map((n) => n.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const spanX = Math.max(1, maxX - minX);
        const spanY = Math.max(1, maxY - minY);
        const pad = 46;
        const k = Math.max(0.35, Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY, 2));
        transform.current.k = k;
        transform.current.x = -((minX + maxX) / 2) * k;
        transform.current.y = -((minY + maxY) / 2) * k;
        draw();
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.map((m) => m.id).join(",")]);

  /* ---------------------------- 尺寸自适应 ---------------------------- */
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = Math.max(280, Math.min(420, Math.round(w * 0.95)));
      setSize({ w, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ------------------------------- 绘制 ------------------------------- */
  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { w, h } = size;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2 + transform.current.x, h / 2 + transform.current.y);
    ctx.scale(transform.current.k, transform.current.k);

    const nodes = nodesRef.current;
    const byId = new Map(nodes.map((n) => [n.id, n]));

    // 连线
    for (const n of nodes) {
      for (const id of n.memory.links) {
        const o = byId.get(id);
        if (!o) continue;
        const fade = Math.min(n.retention, o.retention);
        ctx.strokeStyle = `rgba(150,150,150,${0.10 + fade * 0.22})`;
        ctx.lineWidth = 0.8 + fade * 0.9;
        ctx.beginPath();
        ctx.moveTo(n.x, n.y);
        ctx.lineTo(o.x, o.y);
        ctx.stroke();
      }
    }

    // 节点
    for (const n of nodes) {
      const rgb = KIND_COLOR[n.memory.kind];
      const dim = 0.28 + n.retention * 0.72;
      const isSel = selectedId === n.id || hover === n.id;
      if (isSel) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 7, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb},0.14)`;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb},${dim})`;
      ctx.fill();
      if (isSel) {
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = `rgba(${rgb},0.95)`;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // 选中的节点/悬停变化时重画
  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, hover, size.w, size.h]);

  /* ------------------------------ 交互 ------------------------------ */
  const hitTest = (clientX: number, clientY: number): Node | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left - size.w / 2 - transform.current.x;
    const py = clientY - rect.top - size.h / 2 - transform.current.y;
    const x = px / transform.current.k;
    const y = py / transform.current.k;
    let best: Node | null = null;
    let bestD = 22;
    for (const n of nodesRef.current) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < Math.max(bestD, n.r + 8)) {
        best = n;
        bestD = d;
      }
    }
    return best;
  };

  return (
    <div ref={wrapRef} className="relative w-full">
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h, touchAction: "none" }}
        className="rounded-3xl border border-line bg-surface"
        onPointerDown={(e) => {
          const hit = hitTest(e.clientX, e.clientY);
          dragRef.current = {
            id: hit?.id ?? null,
            panning: !hit,
            lastX: e.clientX,
            lastY: e.clientY,
          };
          if (hit) onSelect?.(hit.id === selectedId ? null : hit.id);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 0 && e.pointerType === "mouse") {
            const hit = hitTest(e.clientX, e.clientY);
            setHover(hit?.id ?? null);
            return;
          }
          const d = dragRef.current;
          if (d.id) {
            const node = nodesRef.current.find((n) => n.id === d.id);
            if (node) {
              const canvas = canvasRef.current!;
              const rect = canvas.getBoundingClientRect();
              node.x = (e.clientX - rect.left - size.w / 2 - transform.current.x) / transform.current.k;
              node.y = (e.clientY - rect.top - size.h / 2 - transform.current.y) / transform.current.k;
              node.vx = 0;
              node.vy = 0;
              draw();
            }
          } else {
            transform.current.x += e.clientX - d.lastX;
            transform.current.y += e.clientY - d.lastY;
            d.lastX = e.clientX;
            d.lastY = e.clientY;
            draw();
          }
        }}
        onPointerUp={() => {
          dragRef.current = { id: null, panning: false, lastX: 0, lastY: 0 };
        }}
        onWheel={(e) => {
          transform.current.k = Math.max(0.4, Math.min(2.6, transform.current.k * (e.deltaY < 0 ? 1.08 : 0.93)));
          draw();
        }}
      />

      {/* 图例 + 缩放提示（加一层底色，免得压在节点上看不清） */}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-surface/78 px-2.5 py-1.5 text-[10px] text-subtle backdrop-blur-sm">
        {(Object.keys(KIND_COLOR) as Memory["kind"][]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="size-1.5 rounded-full" style={{ background: `rgb(${KIND_COLOR[k]})` }} />
            {KIND_LABEL[k]}
          </span>
        ))}
      </div>

      <p className="pointer-events-none absolute inset-x-4 bottom-11 text-right text-[10px] text-subtle">
        点节点看详情 · 拖空白平移 · 滚轮缩放
      </p>

      {active.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-[13px] text-muted">
          还没有记忆，图上会是空的
        </p>
      )}
    </div>
  );
}
