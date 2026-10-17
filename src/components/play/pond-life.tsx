import { useEffect, useRef } from "react";

/**
 * 池塘里"活的东西"：水下游的鱼、漂着的花瓣、岸边的水草、浮着的荷叶。
 *
 * 为什么单独一个组件：
 *   · 用户 m01776 说池塘"有点稀疏"，要真的有鱼在游、有花有水草；
 *   · 这些动效跟钓鱼的回合逻辑无关（回合在 `play.garden.stagno.tsx` 里），
 *     放一个文件里方便调，也方便以后换底图时只改 `WATER` 一个常量；
 *   · 全用 CSS + 内联 SVG，不加任何图片资源（APK 体积不变）。
 *
 * `curious`：咬钩前（`nibble / sink / taut`）让最近的一条鱼游到浮漂边上，
 * 这样你比浮漂先看到"有鱼来了"。
 */

/** 水面范围（画面高度的比例）——换底图只改这行。B 图：水从石栏下面开始。 */
const WATER = { top: 0.515, bottom: 0.9 };

/** 浮漂的位置（跟 styles.css 里 `.pond-float` 的 left/top 一致，390×844 基准） */
const FLOAT = { x: 186 / 390, y: 528 / 844 };

type Kind = "slim" | "deep" | "gold";

type Fish = {
  kind: Kind;
  /** 身长（px） */
  w: number;
  /** 在水面里的纵向位置（0 = 靠岸浅水，1 = 最远那侧） */
  yf: number;
  /** 起始横向位置（画面宽度的比例） */
  x: number;
  /** 游速 px/s */
  speed: number;
  /** 上下摆动的幅度 px */
  amp: number;
  dir: 1 | -1;
  /** 0 = 贴近水面清楚，1 = 深一点虚 */
  depth: number;
};

const FISH: Fish[] = [
  { kind: "slim", w: 42, yf: 0.1, x: 0.12, speed: 14, amp: 8, dir: 1, depth: 0.28 },
  { kind: "gold", w: 30, yf: 0.26, x: 0.62, speed: -11, amp: 7, dir: -1, depth: 0.44 },
  { kind: "deep", w: 50, yf: 0.46, x: 0.3, speed: 9, amp: 10, dir: 1, depth: 0.72 },
  { kind: "slim", w: 28, yf: 0.64, x: 0.78, speed: -15, amp: 6, dir: -1, depth: 0.2 },
  { kind: "gold", w: 34, yf: 0.84, x: 0.2, speed: 12, amp: 8, dir: 1, depth: 0.5 },
];

/** 三种鱼身：淡青、深绿、金。都是奶油淡彩，不用写实色。 */
const SKIN: Record<Kind, { a: string; b: string; c: string }> = {
  slim: { a: "#547a76", b: "#a8c0b8", c: "#e6e8d8" },
  deep: { a: "#46603f", b: "#93a97b", c: "#dde2c4" },
  gold: { a: "#96692b", b: "#cfa96a", c: "#f0e2bd" },
};

const PETALS = [
  { top: 54, dur: 46, delay: -6, size: 7, tone: "rgba(246,222,226,.92)" },
  { top: 61, dur: 62, delay: -22, size: 6, tone: "rgba(253,246,234,.9)" },
  { top: 67, dur: 54, delay: -35, size: 8, tone: "rgba(243,214,220,.88)" },
  { top: 74, dur: 70, delay: -12, size: 6, tone: "rgba(250,240,232,.92)" },
  { top: 80, dur: 58, delay: -44, size: 7, tone: "rgba(246,224,222,.85)" },
  { top: 86, dur: 66, delay: -28, size: 5, tone: "rgba(252,244,236,.9)" },
];

const PADS = [
  { left: 8, top: 74, w: 52, h: 20, delay: 0 },
  { left: 20, top: 82, w: 40, h: 15, delay: -2.4 },
  { left: 62, top: 88, w: 58, h: 21, delay: -1.2 },
  { left: 34, top: 90, w: 34, h: 13, delay: -3.6 },
];

/** 一片鱼（正向朝右画，反向靠 scaleX(-1)） */
function FishBody({ kind, id }: { kind: Kind; id: string }) {
  const s = SKIN[kind];
  return (
    <svg viewBox="0 0 46 18" className="block size-full">
      <defs>
        <linearGradient id={`pl-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={s.a} />
          <stop offset="58%" stopColor={s.b} />
          <stop offset="100%" stopColor={s.c} />
        </linearGradient>
      </defs>
      <path d="M6 9 1 3.2 2.6 9 1 14.8Z" fill={s.a} opacity=".92" />
      <path d="M44 9C40 4.2 31 1.6 23 1.6S9 4 5.6 9c3.4 5 9.4 7.4 17.4 7.4S40 13.8 44 9Z" fill={`url(#pl-${id})`} />
      <path d="M44 9c-4-4.8-13-7.4-21-7.4" fill="none" stroke={s.a} strokeWidth=".8" opacity=".45" />
      <circle cx="38" cy="7.4" r="1.2" fill="#2f2a20" opacity=".8" />
    </svg>
  );
}

export function PondLife({ curious = false }: { curious?: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const fishRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const curiousRef = useRef(curious);
  curiousRef.current = curious;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let w = host.clientWidth;
    let h = host.clientHeight;
    const top = () => h * WATER.top;
    const bottom = () => h * WATER.bottom;

    const state = FISH.map((f, i) => ({
      f,
      px: f.x * w,
      py: top() + f.yf * (bottom() - top()),
      t: i * 1.7,
      boost: 1,
    }));

    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (host.clientWidth !== w || host.clientHeight !== h) {
        w = host.clientWidth;
        h = host.clientHeight;
      }
      const t0 = top();
      const t1 = bottom();

      state.forEach((s, i) => {
        const el = fishRefs.current[i];
        if (!el) return;
        s.t += dt;

        // 咬钩前：把第一条（最靠水面那条）引到浮漂边上徘徊
        if (curiousRef.current && i === 0) {
          const tx = FLOAT.x * w;
          const ty = FLOAT.y * h + 8;
          s.px += (tx - s.px) * Math.min(1, dt * 1.6);
          s.py += (ty - s.py) * Math.min(1, dt * 1.6);
          el.style.transform = `translate3d(${(s.px - s.f.w / 2).toFixed(1)}px, ${(s.py - 9).toFixed(1)}px, 0) scaleX(${s.px < tx ? 1 : -1})`;
          return;
        }

        // 偶尔"窜"一下，别像匀速机器人
        if (s.boost === 1 && Math.random() < dt * 0.16) s.boost = 2.8;
        s.boost = Math.max(1, s.boost - dt * 0.85);

        s.px += s.f.dir * s.f.speed * s.boost * dt;
        const wob = Math.sin(s.t * 1.1 + i) * s.f.amp;
        s.py = t0 + s.f.yf * (t1 - t0) + wob;

        // 游出画面就从另一边进来
        if (s.px < -s.f.w) s.px = w + s.f.w * 0.5;
        if (s.px > w + s.f.w) s.px = -s.f.w * 0.5;

        el.style.transform = `translate3d(${(s.px - s.f.w / 2).toFixed(1)}px, ${(s.py - 9).toFixed(1)}px, 0) scaleX(${s.f.dir})`;
      });

      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={hostRef} className="pond-life" aria-hidden="true">
      {FISH.map((f, i) => (
        <span
          key={i}
          ref={(el) => {
            fishRefs.current[i] = el;
          }}
          className="pl-fish"
          style={{
            width: f.w,
            height: 18,
            opacity: 0.92 - f.depth * 0.34,
            filter: `blur(${(f.depth * 0.9).toFixed(2)}px)`,
          }}
        >
          <FishBody kind={f.kind} id={`f${i}`} />
        </span>
      ))}

      {PETALS.map((p, i) => (
        <span
          key={`p${i}`}
          className="pl-petal"
          style={{
            top: `${p.top}%`,
            width: p.size,
            height: p.size * 0.72,
            background: p.tone,
            animationDuration: `${p.dur}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}

      {PADS.map((p, i) => (
        <span
          key={`l${i}`}
          className="pl-pad"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            width: p.w,
            height: p.h,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}

      {/* 岸边水草：左下角，几片叶子各自摆 */}
      <span className="pl-weeds" style={{ left: "1%", bottom: "4%" }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <i key={i} style={{ animationDelay: `${-i * 0.7}s`, height: `${34 + i * 9}px` }} />
        ))}
      </span>
      <span className="pl-weeds" style={{ right: "6%", bottom: "2%" }}>
        {[0, 1, 2].map((i) => (
          <i key={i} style={{ animationDelay: `${-i * 0.9}s`, height: `${26 + i * 8}px` }} />
        ))}
      </span>
    </div>
  );
}
