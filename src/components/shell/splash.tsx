import { useEffect, useRef, useState } from "react";
import {
  ART_BLACK_D,
  ART_H,
  ART_ORANGE_D,
  ART_W,
  SPLASH_BLACK,
  SPLASH_DUST,
  SPLASH_ORANGE,
  SPLASH_TIMING,
  SPLASH_WORDS,
  WORD_H,
  WORD_Y,
} from "@/lib/splash-art";
import { markSplashPlayed, shouldPlaySplash } from "@/lib/splash-policy";

/*
  开屏：一条线画出人形与花瓶 → 玫瑰绽放 → 墨迹散开 → 手写「waiting for you」。
  节奏、颜色、素材都在别处，这里只管一件事：**按时间轴把属性推过去**。

  为什么不写成纯 CSS 动画：
    墨迹散开要逐帧改滤镜参数（feDisplacementMap 的 scale / 模糊半径），
    手写字要逐帧推裁切窗口的宽度，CSS 表达不了"参数随进度连续变化"。
    一条 rAF 循环同时推这几样，比拆成五六个 CSS 动画更好对齐、也更好调。

  为什么用 data-* 找元素而不是每个都挂 ref：
    33 条笔画各挂一个 ref 就是 33 行样板，而它们只在开始画的那一下被读一次。
*/

const T = SPLASH_TIMING;

/** 兜底：正常 6.5 秒走完，万一计时器出岔子最多挡这么久 */
const WATCHDOG_MS = 9000;

type Phase = "idle" | "run" | "out";

type Dust = {
  node: SVGCircleElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  at: number;
  tint: number;
};

export function Splash() {
  const [phase, setPhase] = useState<Phase>("idle");
  const hostRef = useRef<HTMLDivElement | null>(null);
  const dustRef = useRef<SVGGElement | null>(null);

  /* 播不播：4 小时一次 + 冷启动 + 尊重「减少动态效果」。判断放在 effect 里，
     localStorage 在服务端不存在，首屏渲染不能读它。 */
  useEffect(() => {
    if (!shouldPlaySplash()) return;
    markSplashPlayed();
    setPhase("run");
  }, []);

  /* 淡出后再卸载 */
  useEffect(() => {
    if (phase !== "out") return;
    const id = window.setTimeout(() => setPhase("idle"), 280);
    return () => window.clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "run") return;
    const host = hostRef.current;
    if (!host) return;

    const q = <E extends Element>(sel: string) => host.querySelector<E>(sel);
    const inkStrokes = Array.from(host.querySelectorAll<SVGPathElement>("[data-ink='ink']"));
    const roseStrokes = Array.from(host.querySelectorAll<SVGPathElement>("[data-ink='rose']"));
    const disp = q<SVGFEDisplacementMapElement>("#k-splash-disp");
    const blur = q<SVGFEGaussianBlurElement>("#k-splash-blur");
    const inkLayer = q<SVGGElement>("#k-splash-inklayer");
    const roseLayer = q<SVGGElement>("#k-splash-roselayer");
    const dustLayer = dustRef.current;
    const wordRects = SPLASH_WORDS.map((_, i) => q<SVGRectElement>(`#k-splash-cr${i}`)).filter(
      (r): r is SVGRectElement => Boolean(r),
    );

    /** 一笔接一笔地画；返回"全部画完"的时刻 */
    const drawPhase = (paths: SVGPathElement[], at: number, pxPerSec: number) => {
      let cursor = at;
      for (const path of paths) {
        const len = Number(path.dataset.len ?? 0);
        const dur = Math.max(0.06, len / pxPerSec);
        path.style.animation = `k-splash-draw ${dur.toFixed(2)}s cubic-bezier(.42,.06,.28,1) ${cursor.toFixed(2)}s forwards`;
        cursor += dur * T.overlap;
      }
      return cursor;
    };

    /* 墨点：沿笔画采的点，按离开画心的方向飞出去 */
    const buildDust = (at: number): Dust[] => {
      if (!dustLayer) return [];
      dustLayer.replaceChildren();
      const cx = 1000;
      const cy = 720;
      return SPLASH_DUST.map(([x, y, tint]) => {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.hypot(dx, dy) || 1;
        const speed = 26 + Math.random() * 62;
        const node = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        const r = 2.2 + Math.random() * 3.4;
        node.setAttribute("cx", String(x));
        node.setAttribute("cy", String(y));
        node.setAttribute("r", r.toFixed(1));
        node.setAttribute("opacity", "0");
        node.setAttribute("class", tint ? "k-splash__speck" : "k-splash__speck-rose");
        dustLayer.appendChild(node);
        return {
          node,
          x,
          y,
          vx: (dx / dist) * speed * (0.55 + Math.random() * 0.8) + (Math.random() - 0.5) * 34,
          vy: (dy / dist) * speed * 0.5 - (36 + Math.random() * 54),
          r,
          life: 0.85 + Math.random() * 0.7,
          at: at + Math.random() * 0.34,
          tint,
        };
      });
    };

    const blackEnd = drawPhase(inkStrokes, T.blackAt, T.blackPxPerSec);
    const orangeEnd = drawPhase(roseStrokes, blackEnd + T.gap, T.orangePxPerSec);
    const fadeAt = orangeEnd + T.hold;
    const wordsAt = fadeAt + T.dissolve + 0.3;
    const wordTimes = SPLASH_WORDS.map((_, i) => wordsAt + i * T.wordGap);
    const wordsEnd = wordTimes[wordTimes.length - 1] + T.wordDur;
    const endAt = wordsEnd + T.tail;

    let dust: Dust[] = [];
    let dustAt = -1;
    let raf = 0;
    let finished = false;
    const t0 = performance.now();

    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      setPhase("out");
    };

    const frame = (now: number) => {
      const t = (now - t0) / 1000;

      /* 散开：笔画被湍流揉碎、轻微模糊、整体退场 */
      const p = Math.min(1, Math.max(0, (t - fadeAt) / T.dissolve));
      const ease = p * p;
      disp?.setAttribute("scale", (52 * ease).toFixed(1));
      blur?.setAttribute("stdDeviation", (2.8 * ease).toFixed(2));
      inkLayer?.setAttribute("opacity", Math.pow(1 - p, 1.5).toFixed(3));
      roseLayer?.setAttribute(
        "opacity",
        Math.max(0, (Math.pow(1 - p, 1.5) - 0.1) / 0.9).toFixed(3),
      );

      if (t >= fadeAt && dustAt < 0) {
        dustAt = fadeAt + 0.16;
        dust = buildDust(dustAt);
      }
      for (const speck of dust) {
        const age = t - speck.at;
        if (age <= 0 || age > speck.life) {
          speck.node.setAttribute("opacity", "0");
          continue;
        }
        const k = age / speck.life;
        speck.node.setAttribute("cx", (speck.x + speck.vx * age).toFixed(1));
        speck.node.setAttribute("cy", (speck.y + speck.vy * age + 26 * age * age).toFixed(1));
        speck.node.setAttribute("r", (speck.r * (1 + k * 0.85)).toFixed(2));
        speck.node.setAttribute(
          "opacity",
          (0.9 * Math.sin(Math.PI * Math.min(1, k * 1.1)) * 0.85).toFixed(3),
        );
      }

      /* 手写字：裁切窗口从左往右推，看起来像笔尖沿纸面走 */
      for (let i = 0; i < wordRects.length; i++) {
        const word = SPLASH_WORDS[i];
        const prog = Math.min(1, Math.max(0, (t - wordTimes[i]) / T.wordDur));
        const easeOut = 1 - Math.pow(1 - prog, 3);
        const width = (word.x1 - word.x0 + 14) * easeOut;
        wordRects[i].setAttribute("width", width.toFixed(1));
      }

      if (t < endAt) raf = requestAnimationFrame(frame);
      else finish();
    };

    raf = requestAnimationFrame(frame);
    const watchdog = window.setTimeout(finish, WATCHDOG_MS);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(watchdog);
      dustLayer?.replaceChildren();
    };
  }, [phase]);

  if (phase === "idle") return null;

  return (
    <div className={phase === "out" ? "k-splash k-splash--out" : "k-splash"} ref={hostRef}>
      <svg
        className="k-splash__art"
        viewBox={`0 0 ${ART_W} ${ART_H}`}
        role="presentation"
        aria-hidden="true"
      >
        <defs>
          {/*
            散开用的滤镜。区域留 6% 余量 —— 位移会把笔画甩到轮廓盒外面，
            不留边就会被切成直边。
          */}
          <filter
            id="k-splash-dissolve"
            x="-6%"
            y="-6%"
            width="112%"
            height="112%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.01 0.014"
              numOctaves={2}
              seed={9}
              result="n"
            />
            <feDisplacementMap
              id="k-splash-disp"
              in="SourceGraphic"
              in2="n"
              scale={0}
              xChannelSelector="R"
              yChannelSelector="G"
            />
            <feGaussianBlur id="k-splash-blur" stdDeviation={0} />
          </filter>

          {/*
            两个遮罩：里面放"能一笔画出来"的中线笔画，笔画画到哪儿，外面的
            填充轮廓就露到哪儿。遮罩里的白色不是配色（见 splash.css 的说明）——
            SVG 遮罩默认按亮度算，深色笔画会让整幅画隐形。
          */}
          <mask id="k-splash-mask-ink" className="k-splash__mask">
            <g id="k-splash-gink">
              {SPLASH_BLACK.map((stroke) => (
                <path
                  key={stroke.d}
                  className="k-splash__draw"
                  data-ink="ink"
                  data-len={stroke.len}
                  d={stroke.d}
                  strokeWidth={stroke.w}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={1000}
                />
              ))}
            </g>
          </mask>
          <mask id="k-splash-mask-rose" className="k-splash__mask">
            <g id="k-splash-grose">
              {SPLASH_ORANGE.map((stroke) => (
                <path
                  key={stroke.d}
                  className="k-splash__draw"
                  data-ink="rose"
                  data-len={stroke.len}
                  d={stroke.d}
                  strokeWidth={stroke.w}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={1000}
                />
              ))}
            </g>
          </mask>

          {SPLASH_WORDS.map((word, i) => (
            <clipPath id={`k-splash-cw${i}`} key={word.d}>
              <rect id={`k-splash-cr${i}`} x={word.x0} y={WORD_Y} width={0} height={WORD_H} />
            </clipPath>
          ))}
        </defs>

        <g id="k-splash-inklayer" filter="url(#k-splash-dissolve)">
          <path
            mask="url(#k-splash-mask-ink)"
            fill="currentColor"
            fillRule="evenodd"
            d={ART_BLACK_D}
          />
        </g>
        <g id="k-splash-roselayer" className="k-splash__rose" filter="url(#k-splash-dissolve)">
          <path
            mask="url(#k-splash-mask-rose)"
            fill="currentColor"
            fillRule="evenodd"
            d={ART_ORANGE_D}
          />
        </g>

        <g ref={dustRef} className="k-splash__rose" />

        {SPLASH_WORDS.map((word, i) => (
          <g className="k-splash__word" clipPath={`url(#k-splash-cw${i})`} key={word.d}>
            <path fill="currentColor" fillRule="evenodd" d={word.d} />
          </g>
        ))}
      </svg>
    </div>
  );
}
