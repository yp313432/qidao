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
 * 像碎钻一样"。所以：
 *   · 粒子用 canvas 画，半径 0.5~1.4px，峰值透明度很低（0.25~0.75）
 *   · 每颗粒子自己呼吸（sin 相位错开），不是整体一起闪
 *   · 细线只有 1px、低对比，像挂星星的丝线，不是"网络图"
 *   · 动效只跑 transform / opacity（合成层），不触发布局重排
 *
 * 「减弱动态效果」照 App 的统一规则（html[data-motion]）自动降级 ——
 * 粒子循环会检查并跳过绘制，见下面的 motionOff()。
 */

/** 用户把系统的"减弱动态效果"关掉了动画？ */
function motionOff(): boolean {
  if (typeof document === "undefined") return false;
  const m = document.documentElement.dataset.motion;
  if (m === "off") return true;
  if (m === "on") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

type Particle = { x: number; y: number; r: number; phase: number; speed: number; drift: number };

/** 碎钻粒子画布：细、闪、柔和。 */
function Sparkles({ className, count = 26 }: { className?: string; count?: number }) {
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

    const setup = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      parts = Array.from({ length: count }, (_, i) => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.5 + Math.random() * 0.9,
        phase: (i / count) * Math.PI * 2 + Math.random(),
        speed: 0.5 + Math.random() * 0.9,
        drift: (Math.random() - 0.5) * 0.06,
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
          const pulse = 0.5 + 0.5 * Math.sin(t * 0.0016 * p.speed + p.phase);
          const a = 0.12 + 0.55 * pulse;
          p.y += p.drift;
          if (p.y < -2) p.y = h + 2;
          if (p.y > h + 2) p.y = -2;

          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
          g.addColorStop(0, `rgba(255,255,255,${a})`);
          g.addColorStop(0.4, `rgba(255,252,240,${a * 0.45})`);
          g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
          ctx.fill();

          // 星芒：只有最亮的几颗才带，别让整片都长刺
          if (pulse > 0.82) {
            ctx.strokeStyle = `rgba(255,255,255,${(pulse - 0.82) * 2.2})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(p.x - p.r * 5, p.y);
            ctx.lineTo(p.x + p.r * 5, p.y);
            ctx.moveTo(p.x, p.y - p.r * 5);
            ctx.lineTo(p.x, p.y + p.r * 5);
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
  // 五角星路径：外半径 r，内半径 0.42r
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.42;
    // 从正上方开始（-90°）
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(x + Math.cos(a) * rad).toFixed(2)},${(y + Math.sin(a) * rad).toFixed(2)}`);
  }
  return <polygon points={pts.join(" ")} fill="currentColor" opacity={opacity} />;
}

/** 上面那片：垂下来的细线 + 挂着的星星 + 月亮 + 流星。 */
function SkyDecor() {
  return (
    <div aria-hidden="true" className="relative h-[68px] shrink-0 overflow-hidden">
      <Sparkles count={18} />

      <svg viewBox="0 0 300 68" preserveAspectRatio="none" className="absolute inset-0 size-full text-accent">
        {/* 挂星星的细线：极细、低对比，像丝线（不要做成"网络图"那种实线） */}
        <g stroke="currentColor" strokeWidth="0.4" opacity="0.16" fill="none">
          <path d="M38 0 V20" />
          <path d="M74 0 V34" />
          <path d="M118 0 V15" />
          <path d="M158 0 V27" />
          <path d="M214 0 V22" />
          <path d="M252 0 V38" />
        </g>
        {/* 线上的小端点 */}
        <g fill="currentColor" opacity="0.28">
          {[
            [38, 20],
            [74, 34],
            [118, 15],
            [158, 27],
            [214, 22],
            [252, 38],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="0.8" />
          ))}
        </g>
      </svg>

      {/* 挂着的小星星：每颗自己呼吸（CSS 延迟错开） */}
      {[
        { l: "12%", t: 22, d: "0s", s: 5 },
        { l: "24%", t: 36, d: "0.7s", s: 3.5 },
        { l: "39%", t: 17, d: "1.3s", s: 4 },
        { l: "52%", t: 29, d: "0.4s", s: 3 },
        { l: "70%", t: 24, d: "1.8s", s: 4.5 },
        { l: "83%", t: 40, d: "1s", s: 3.2 },
      ].map((st) => (
        <svg
          key={st.l}
          viewBox="0 0 10 10"
          className="aster-twinkle absolute text-accent"
          style={{
            left: st.l,
            top: st.t,
            width: st.s * 2,
            height: st.s * 2,
            animationDelay: st.d,
          }}
        >
          <Star x={5} y={5} r={4.4} />
        </svg>
      ))}

      {/* 月亮：柔光晕 + 一点点缺口 */}
      <div className="absolute top-3 right-5">
        <div className="aster-moon relative size-[26px] rounded-full">
          <div
            className="absolute inset-0 rounded-full"
            style={{ boxShadow: "inset -7px 2px 0 0 var(--aster-accent)", opacity: 0.5 }}
          />
        </div>
      </div>

      {/* 流星：偶尔划过（长周期，安静），会自己循环 */}
      <svg viewBox="0 0 300 68" className="absolute inset-0 size-full" aria-hidden="true">
        <g className="aster-meteor" fill="none" strokeLinecap="round">
          <path d="M0 0 L-26 9" stroke="url(#meteorGrad)" strokeWidth="1.2" />
        </g>
        <defs>
          <linearGradient id="meteorGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--aster-accent)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--aster-accent)" stopOpacity="0.65" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

/** 下面那块：小宇宙 —— 带星环的行星 + 小卫星 + 粒子。 */
function CosmosDecor() {
  return (
    <div aria-hidden="true" className="relative h-[132px] shrink-0 overflow-hidden">
      {/* 上面那条线：用户说"下面那个范围以上面那条线为准" */}
      <div className="glass-tray absolute inset-x-0 top-0 h-px" />

      <Sparkles count={22} />

      <svg viewBox="0 0 300 132" className="absolute inset-0 size-full" aria-hidden="true">
        <defs>
          <radialGradient id="planetBody" cx="36%" cy="30%" r="78%">
            <stop offset="0%" stopColor="var(--aster-accent)" stopOpacity="0.55" />
            <stop offset="55%" stopColor="var(--aster-accent)" stopOpacity="0.26" />
            <stop offset="100%" stopColor="var(--aster-accent)" stopOpacity="0.1" />
          </radialGradient>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--aster-accent)" stopOpacity="0.06" />
            <stop offset="50%" stopColor="var(--aster-accent)" stopOpacity="0.42" />
            <stop offset="100%" stopColor="var(--aster-accent)" stopOpacity="0.06" />
          </linearGradient>
        </defs>

        {/* 带星环的行星（右边） */}
        <g className="aster-orbit-slow">
          <ellipse cx="212" cy="66" rx="40" ry="11" fill="none" stroke="url(#ringGrad)" strokeWidth="1.4" />
          <circle cx="212" cy="66" r="21" fill="url(#planetBody)" />
          {/* 环在行星前面的那一段（画在行星之上） */}
          <path
            d="M172 66 A40 11 0 0 0 252 66"
            fill="none"
            stroke="url(#ringGrad)"
            strokeWidth="1.6"
            opacity="0.9"
          />
        </g>

        {/* 小卫星（左） */}
        <g className="aster-orbit">
          <circle cx="74" cy="52" r="8.5" fill="url(#planetBody)" />
          <circle cx="74" cy="52" r="12" fill="none" stroke="var(--aster-accent)" strokeWidth="0.5" opacity="0.18" />
        </g>
        <circle cx="120" cy="96" r="4" fill="var(--aster-accent)" opacity="0.3" />
        <circle cx="268" cy="104" r="2.6" fill="var(--aster-accent)" opacity="0.24" />

        {/* 星尘：一小撮固定的细小点 */}
        <g fill="var(--aster-accent)">
          {[
            [40, 100, 0.9, 0.22],
            [96, 26, 0.7, 0.2],
            [140, 62, 0.8, 0.18],
            [166, 110, 0.7, 0.2],
            [246, 30, 0.9, 0.22],
            [22, 44, 0.7, 0.16],
          ].map(([x, y, r, o]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={r} opacity={o} />
          ))}
        </g>
      </svg>
    </div>
  );
}

/** 抽屉上下两块装饰，一起挂。 */
export function DrawerDecor({ where }: { where: "top" | "bottom" }) {
  return where === "top" ? <SkyDecor /> : <CosmosDecor />;
}
