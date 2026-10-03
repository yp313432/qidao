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

        {/* 月亮：透光玻璃 —— 主体 + 边缘光 + 偏心高光，外面套一层呼吸光晕。
            位置挑在左中部：右上角是「关闭」按钮、中间偏下是「新对话」按钮，
            月亮压到它们身上就糊成一团（截图里撞过两次）。 */}
        <g className="aster-moon">
          <circle cx="188" cy="86" r="10" fill="currentColor" opacity="0.2" />
          <circle cx="188" cy="86" r="10" fill="none" stroke="currentColor" strokeWidth="0.9" opacity="0.45" />
          <ellipse cx="184" cy="82" rx="3.2" ry="2.6" fill="url(#spec2)" opacity="0.9" />
          <path
            d="M191 78 A10 10 0 0 1 191 94"
            fill="none"
            stroke="var(--aster-canvas)"
            strokeWidth="3"
            opacity="0.35"
          />
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
          {/* 月亮上那点偏心反光（id 跟小宇宙那边错开，SVG 的 id 是全文档唯一的） */}
          <radialGradient id="spec2" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.6" />
            <stop offset="60%" stopColor="#fff" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
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
          {/*
            「透光玻璃」不是填个色就有的，要三层叠：
              ① 主体：中心偏上一点点的高光 → 往外变淡（透明度都低，才透）
              ② 边缘：一圈稍亮的描边 = 玻璃的厚度边缘光
              ③ 高光：偏心的小亮点 + 内阴影（左下）—— 玻璃反光的那个感觉
          */}
          <radialGradient id="glassBig" cx="34%" cy="26%" r="82%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.42" />
            <stop offset="42%" stopColor="currentColor" stopOpacity="0.2" />
            <stop offset="72%" stopColor="currentColor" stopOpacity="0.1" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.2" />
          </radialGradient>
          <radialGradient id="glassMid" cx="34%" cy="26%" r="82%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.4" />
            <stop offset="45%" stopColor="currentColor" stopOpacity="0.18" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.16" />
          </radialGradient>
          <radialGradient id="glassSmall" cx="34%" cy="26%" r="84%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.38" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.15" />
          </radialGradient>
          {/* 右上角那点反光 */}
          <radialGradient id="spec" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="60%" stopColor="#fff" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          {/* 内阴影：玻璃下缘那圈暗，让球体有厚度（压得很轻，重了就不透） */}
          <radialGradient id="glassShade" cx="72%" cy="78%" r="58%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.14" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.06" />
            <stop offset="50%" stopColor="currentColor" stopOpacity="0.46" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.06" />
          </linearGradient>
        </defs>

        {/*
          主角：带星环的大玻璃行星。

          环要"绕"过去，必须分三段画 —— 直接画整个椭圆会得到一道横切
          行星的条纹，看着像环把行星劈开了（这个坑试了两版才想明白）：
            ① 环在行星**后面**的那半（上弧）
            ② 行星本体（玻璃球）
            ③ 环在行星**前面**的那段（下弧中间 60%）—— 只有这段该压住行星，
               两端留在行星轮廓外，才不会连成一条线
        */}
        <g className="aster-orbit-slow">
          {/*
            整组绕行星中心转 -18°。
            为什么必须转：环是很扁的椭圆（ry 15 对 r29 的球），
            水平放的话前弧一定会横着穿过球体下半部，看着就是一条条纹。
            倾斜之后前弧从右下绕到左下、两端露在球外，才有"环绕过行星"的感觉
            （顺带也跟土星那个经典角度一致）。
          */}
          <g transform="rotate(-18 204 76)">
            {/* ① 后半个环。
                环的比例按 r_y/r_x = 0.44 来（22/50）—— 开始写的是 15/54=0.28，
                太扁了，前弧会浅浅地横切球面、看着像条纹。0.44 这个角度下
                前弧能落到球体下缘之外，才是"环绕过去"的样子。 */}
            <path
              d="M254 76 A50 22 0 0 0 154 76"
              fill="none"
              stroke="url(#ringGrad)"
              strokeWidth="1.6"
              opacity="0.9"
            />

            {/* ② 玻璃球本体 */}
            <circle cx="204" cy="76" r="29" fill="url(#glassBig)" />
            <circle cx="204" cy="76" r="29" fill="url(#glassShade)" />
            <circle
              cx="204"
              cy="76"
              r="28.4"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.9"
              opacity="0.42"
            />
            <ellipse cx="193" cy="65" rx="9" ry="6.5" fill="url(#spec)" opacity="0.85" />

            {/* ③ 前段环（下弧中间 60%） */}
            <path
              d="M179.0 93.9 A50 22 0 0 0 229.0 93.9"
              fill="none"
              stroke="url(#ringGrad)"
              strokeWidth="1.8"
              opacity="0.95"
            />
          </g>
        </g>

        {/* 第二个带环的玻璃行星（左上，中号）—— 同样倾斜 22° */}
        <g className="aster-orbit">
          <g transform="rotate(22 64 44)">
            <path
              d="M87 44 A23 6.4 0 0 0 41 44"
              fill="none"
              stroke="url(#ringGrad)"
              strokeWidth="0.9"
              opacity="0.85"
            />
            <circle cx="64" cy="44" r="12.5" fill="url(#glassMid)" />
            <circle cx="64" cy="44" r="12.1" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.38" />
            <ellipse cx="59" cy="39" rx="4" ry="3" fill="url(#spec)" opacity="0.8" />
            <path
              d="M77.5 48.7 A23 6.4 0 0 0 50.5 48.7"
              fill="none"
              stroke="url(#ringGrad)"
              strokeWidth="1.2"
              opacity="0.9"
            />
          </g>
        </g>

        {/* 第三颗玻璃行星（右中偏下）—— 用户："再加一个小行星吧，两个太空了" */}
        <g className="aster-orbit-slow">
          <circle cx="246" cy="118" r="8.5" fill="url(#glassSmall)" />
          <circle cx="246" cy="118" r="8.2" fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.34" />
          <ellipse cx="243" cy="115" rx="2.8" ry="2.2" fill="url(#spec)" opacity="0.75" />
        </g>

        {/* 小卫星们 */}
        <g className="aster-orbit">
          <circle cx="132" cy="112" r="6" fill="url(#glassSmall)" />
          <circle cx="132" cy="112" r="5.8" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.3" />
        </g>
        <circle cx="34" cy="104" r="3.4" fill="url(#glassSmall)" />
        <circle cx="168" cy="34" r="3" fill="url(#glassSmall)" />
        <circle cx="104" cy="72" r="2.2" fill="currentColor" opacity="0.3" />

        {/* 星尘 */}
        <g fill="currentColor">
          {[
            [40, 128, 1.0, 0.26],
            [96, 24, 0.8, 0.24],
            [140, 72, 0.9, 0.22],
            [166, 122, 0.8, 0.24],
            [246, 30, 1.0, 0.26],
            [22, 44, 0.8, 0.2],
            [112, 62, 0.7, 0.2],
            [284, 76, 0.8, 0.22],
            [196, 140, 0.7, 0.2],
            [272, 96, 0.7, 0.2],
          ].map(([x, y, r, o]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={r} opacity={o} />
          ))}
        </g>
      </svg>
    </div>
  );
}
