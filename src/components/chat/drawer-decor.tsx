import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * 「对话列表」抽屉上下的装饰。
 *
 * 用户的要求（截图指出）：对话列表**直接顶到头和底**，
 * 上下都是空白，显得像"一块大方块展开了，没有东西很奇怪"。
 * 于是：
 *   上面 —— 垂下来的星野：细闪的线挂着星星，还有一轮月亮，可以划过流星
 *   下面 —— 小宇宙：几颗行星带星环，跟上面的星月呼应
 *
 * 用户对质感的要求很具体："动态效果及粒子特效一定要**细、闪、柔和**，
 * 像碎钻一样"，后来又补了三条：
 *   · "上面那个从顶部开始，不是从我画的框开始" → 星野从抽屉真正的顶边
 *     铺下来（不再是按钮下面那一条）
 *   · "下面……不要有线，看着割裂" → 去掉那条分隔线
 *   · "粒子特效可以再闪一点""行星再加点、放大点，看着好空"
 *
 * 颜色：**跟着 --decor（由文字色推出来）走**，不用强调色。
 * 用户原话："我换背景他们也会跟着统一吧，不能我背景是深色的，
 * 行星还是黄色的吧" —— 深色背景配浅色文字时，星月自动变浅。
 */

/** 用户把系统的"减弱动态效果"关掉了动画？ */
function motionOff(): boolean {
  if (typeof document === "undefined") return false;
  const m = document.documentElement.dataset.motion;
  if (m === "off") return true;
  if (m === "on") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** 把 CSS 变量 --decor 解析成 canvas 能用的 rgba 串。 */
function readDecor(): { rgb: string; a: (alpha: number) => string } {
  const fallback = { rgb: "255,255,255", a: (x: number) => `rgba(255,255,255,${x})` };
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--decor").trim();
  if (!raw) return fallback;
  const el = document.createElement("span");
  el.style.color = raw;
  el.style.display = "none";
  document.body.appendChild(el);
  const resolved = getComputedStyle(el).color;
  el.remove();
  const m = resolved.match(/rgba?\(([^)]+)\)/);
  if (!m) return fallback;
  const nums = m[1].split(/[,/]/).map((v) => parseFloat(v));
  const rgb = `${nums[0] | 0},${nums[1] | 0},${nums[2] | 0}`;
  return { rgb, a: (alpha: number) => `rgba(${rgb},${alpha})` };
}

type Particle = { x: number; y: number; r: number; phase: number; speed: number; drift: number };

/** 碎钻粒子画布：细、闪、柔和。 */
function Sparkles({ className, count = 30 }: { className?: string; count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let parts: Particle[] = [];
    let w = 0;
    let h = 0;
    let tone = readDecor();

    const setup = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      tone = readDecor();
      parts = Array.from({ length: count }, (_, i) => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.55 + Math.random() * 1.0,
        phase: (i / count) * Math.PI * 2 + Math.random(),
        speed: 0.55 + Math.random() * 1.1,
        drift: (Math.random() - 0.5) * 0.07,
      }));
    };

    setup();
    const ro = new ResizeObserver(setup);
    ro.observe(canvas);

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      if (!motionOff()) {
        for (const p of parts) {
          // 每颗自己呼吸：相位错开，所以是"碎钻闪烁"而不是整体一亮
          const pulse = 0.5 + 0.5 * Math.sin(t * 0.0017 * p.speed + p.phase);
          // 比上一版更亮一档（用户："粒子特效可以再闪一点"）
          const a = 0.18 + 0.75 * pulse;
          p.y += p.drift;
          if (p.y < -2) p.y = h + 2;
          if (p.y > h + 2) p.y = -2;

          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4.5);
          g.addColorStop(0, tone.a(Math.min(1, a)));
          g.addColorStop(0.35, tone.a(a * 0.5));
          g.addColorStop(1, tone.a(0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 4.5, 0, Math.PI * 2);
          ctx.fill();

          // 星芒：只有最亮那几颗才带，别让整片都长刺
          if (pulse > 0.78) {
            ctx.strokeStyle = tone.a((pulse - 0.78) * 3.4);
            ctx.lineWidth = 0.6;
            const L = p.r * 5.5;
            ctx.beginPath();
            ctx.moveTo(p.x - L, p.y);
            ctx.lineTo(p.x + L, p.y);
            ctx.moveTo(p.x, p.y - L);
            ctx.lineTo(p.x, p.y + L);
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [count]);

  return <canvas ref={ref} className={cn("pointer-events-none absolute inset-0 size-full", className)} />;
}

/** 五角星（细，不笨重）。 */
function Star({ x, y, r, opacity = 0.9 }: { x: number; y: number; r: number; opacity?: number }) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.42;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(x + Math.cos(a) * rad).toFixed(2)},${(y + Math.sin(a) * rad).toFixed(2)}`);
  }
  return <polygon points={pts.join(" ")} fill="currentColor" opacity={opacity} />;
}

/**
 * 上面那片：从抽屉**真正的顶边**垂下来。
 * 用户："上面那个从顶部开始，不是从我画的框开始" ——
 * 所以它是绝对定位挂在抽屉顶部（height 158），标题和按钮浮在它上面。
 */
export function DrawerSky() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 h-[158px] overflow-hidden"
    >
      {/*
        粒子只铺在最上面这段（0~104）：「新对话」按钮和列表是半透明的，
        粒子铺满整个 158 会从按钮底下透出来，看着像按钮上长了脏点。
      */}
      <div className="absolute inset-x-0 top-0 h-[104px] overflow-hidden">
        <Sparkles count={22} />
      </div>

      <svg
        viewBox="0 0 300 158"
        preserveAspectRatio="none"
        className="absolute inset-0 size-full"
        style={{ color: "var(--decor)" }}
      >
        {/* 挂星星的细线：从顶上真的垂下来，极细、低对比，像丝线。
            不透明度压得很低 —— 稍高一点就变成"一根根直棍子"，很硬。
            长度也收在 96 以内：再往下就伸进「新对话」按钮和列表里了。 */}
        <g stroke="currentColor" strokeWidth="0.35" opacity="0.1" fill="none">
          <path d="M74 0 V62" />
          <path d="M118 0 V30" />
          <path d="M158 0 V54" />
          <path d="M252 0 V72" />
          <path d="M96 0 V88" />
          <path d="M186 0 V96" />
        </g>
        <g fill="currentColor" opacity="0.22">
          {[
            [74, 62],
            [118, 30],
            [158, 54],
            [252, 72],
            [96, 88],
            [186, 96],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="0.8" />
          ))}
        </g>

        {/* 月亮：柔光晕。
            位置挑在左中部：右上角是「关闭」按钮、中间偏下是「新对话」按钮，
            月亮压到它们身上就糊成一团（截图里撞过两次）。 */}
        <g>
          <circle cx="188" cy="86" r="9.5" fill="currentColor" opacity="0.26" />
          <circle cx="191" cy="83.5" r="7.8" fill="var(--aster-canvas)" opacity="0.45" />
        </g>

        {/* 流星：长周期划过，停很久才再来一次（安静，不抢内容） */}
        <g className="aster-meteor" fill="none" strokeLinecap="round">
          <path d="M0 0 L-30 10" stroke="url(#meteorGrad)" strokeWidth="1.3" />
        </g>
        <defs>
          <linearGradient id="meteorGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--decor)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--decor)" stopOpacity="0.75" />
          </linearGradient>
        </defs>
      </svg>

      {/* 挂着的星星：每颗自己呼吸（CSS 延迟错开）。
          左边 12% 那颗会压在「对话」标题上，所以起始挪到 16%；
          纵向也收在 96 以内，别伸进按钮和列表。 */}
      {[
        { l: "16%", t: 44, d: "0s", s: 5 },
        { l: "26%", t: 62, d: "0.7s", s: 3.5 },
        { l: "39%", t: 30, d: "1.3s", s: 4 },
        { l: "52%", t: 54, d: "0.4s", s: 3 },
        { l: "63%", t: 36, d: "1.8s", s: 4.5 },
        { l: "83%", t: 72, d: "1s", s: 3.2 },
        { l: "31%", t: 88, d: "2.2s", s: 3.8 },
        { l: "72%", t: 96, d: "0.2s", s: 3 },
      ].map((st) => (
        <svg
          key={`${st.l}-${st.t}`}
          viewBox="0 0 10 10"
          className="aster-twinkle absolute"
          style={{
            left: st.l,
            top: st.t,
            width: st.s * 2,
            height: st.s * 2,
            animationDelay: st.d,
            color: "var(--decor)",
          }}
        >
          <Star x={5} y={5} r={4.4} />
        </svg>
      ))}
    </div>
  );
}

/**
 * 下面那块：小宇宙 —— 带星环的行星 + 更多星球 + 粒子。
 * 用户："不要有线，看着割裂""行星再加点，或者放大点，看着好空"。
 */
export function DrawerCosmos() {
  return (
    <div aria-hidden="true" className="relative h-[150px] shrink-0 overflow-hidden">
      <Sparkles count={30} />

      <svg
        viewBox="0 0 300 150"
        className="absolute inset-0 size-full"
        style={{ color: "var(--decor)" }}
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="planetBody" cx="36%" cy="30%" r="78%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.6" />
            <stop offset="55%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.1" />
          </radialGradient>
          <radialGradient id="planetSmall" cx="34%" cy="28%" r="80%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.5" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.14" />
          </radialGradient>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.07" />
            <stop offset="50%" stopColor="currentColor" stopOpacity="0.5" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.07" />
          </linearGradient>
        </defs>

        {/* 主角：带星环的大行星（放大了一档） */}
        <g className="aster-orbit-slow">
          <ellipse cx="204" cy="78" rx="52" ry="14" fill="none" stroke="url(#ringGrad)" strokeWidth="1.6" />
          <circle cx="204" cy="78" r="28" fill="url(#planetBody)" />
          <path
            d="M152 78 A52 14 0 0 0 256 78"
            fill="none"
            stroke="url(#ringGrad)"
            strokeWidth="1.8"
            opacity="0.95"
          />
        </g>

        {/* 第二个带环的小行星（左上） */}
        <g className="aster-orbit">
          <ellipse cx="66" cy="46" rx="22" ry="6" fill="none" stroke="url(#ringGrad)" strokeWidth="1" />
          <circle cx="66" cy="46" r="11.5" fill="url(#planetSmall)" />
          <path d="M44 46 A22 6 0 0 0 88 46" fill="none" stroke="url(#ringGrad)" strokeWidth="1.2" opacity="0.9" />
        </g>

        {/* 小卫星们 */}
        <circle cx="132" cy="112" r="6.5" fill="url(#planetSmall)" className="aster-orbit" />
        <circle cx="258" cy="128" r="4.2" fill="url(#planetSmall)" className="aster-orbit-slow" />
        <circle cx="34" cy="104" r="3.4" fill="currentColor" opacity="0.32" />
        <circle cx="168" cy="34" r="3" fill="currentColor" opacity="0.28" />

        {/* 星尘 */}
        <g fill="currentColor">
          {[
            [40, 128, 1.0, 0.26],
            [96, 24, 0.8, 0.24],
            [140, 72, 0.9, 0.22],
            [166, 120, 0.8, 0.24],
            [246, 30, 1.0, 0.26],
            [22, 44, 0.8, 0.2],
            [112, 62, 0.7, 0.2],
            [282, 78, 0.8, 0.22],
            [196, 138, 0.7, 0.2],
          ].map(([x, y, r, o]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={r} opacity={o} />
          ))}
        </g>
      </svg>
    </div>
  );
}
