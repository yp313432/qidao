import { useEffect, useRef, useState } from "react";
import { WALKER_IMAGE, WALKER_SIZE } from "@/lib/garden-walk";

/**
 * 花园里走动的那个他。
 *
 * 位置由外面给（画面百分比），这个组件只管「画出来 + 走路时颠一颠」：
 *   · 有立绘（`WALKER_IMAGE` 非空）就贴图，按 face 左右翻转；
 *   · 没有立绘就用下面这段内置的占位小人（跟花园同一套 Q 版比例），
 *     换图时只改 `lib/garden-walk.ts` 里的 `WALKER_IMAGE`，这里不用动。
 *
 * 为什么用 CSS transition 而不是逐帧 rAF：位移只有一次，transition 交给合成器，
 * 老机型也不掉帧；"走路"的脚是 SVG 里两段腿在小幅摆动（`gw-step`），够看。
 */
export function GardenWalker({
  x,
  y,
  face,
  walking,
  ms,
  name,
  say,
}: {
  x: number;
  y: number;
  face: 1 | -1;
  walking: boolean;
  ms: number;
  name: string;
  say?: string;
}) {
  const [flip, setFlip] = useState(face);
  const lastFace = useRef(face);
  useEffect(() => {
    if (face !== lastFace.current) {
      lastFace.current = face;
      setFlip(face);
    }
  }, [face]);

  const w = WALKER_SIZE.w;
  const h = WALKER_SIZE.h;

  return (
    <div
      className="gw-root pointer-events-none absolute z-20"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: w,
        height: h,
        marginLeft: -w / 2,
        marginTop: -h,
        transition: `left ${ms}ms cubic-bezier(.33,.02,.63,1), top ${ms}ms cubic-bezier(.33,.02,.63,1)`,
      }}
      aria-hidden="true"
    >
      <div className={`gw-bob ${walking ? "gw-walking" : ""} ${WALKER_IMAGE ? "gw-photo" : ""}`}>
        {WALKER_IMAGE ? (
          <img
            src={WALKER_IMAGE}
            alt=""
            className="gw-art"
            style={{ transform: `scaleX(${flip})` }}
            draggable={false}
          />
        ) : (
          <svg viewBox="0 0 120 170" className="gw-art" style={{ transform: `scaleX(${flip})` }}>
            <defs>
              <linearGradient id="gw-hair" x1="0.25" y1="0" x2="0.75" y2="1">
                <stop offset="0%" stopColor="#9b7a5f" />
                <stop offset="45%" stopColor="#7d5c45" />
                <stop offset="100%" stopColor="#5a4132" />
              </linearGradient>
              <linearGradient id="gw-blazer" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7b7a83" />
                <stop offset="100%" stopColor="#585761" />
              </linearGradient>
              <linearGradient id="gw-pants" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2e2d35" />
                <stop offset="100%" stopColor="#1c1b21" />
              </linearGradient>
              <radialGradient id="gw-skin" cx="0.42" cy="0.32" r="0.8">
                <stop offset="0%" stopColor="#fff3e9" />
                <stop offset="100%" stopColor="#f2d8c4" />
              </radialGradient>
            </defs>

            <ellipse cx="60" cy="167" rx="28" ry="4.6" fill="rgba(60,40,30,0.2)" />

            <g className="gw-leg-l">
              <path d="M49 116 L48 146 Q48 150 52 150 L58 150 Q61 150 61 146 L60 116 Z" fill="url(#gw-pants)" />
              <path d="M44 150 Q44 145 50 145 L57 145 Q62 145 62 150 L61 160 Q61 164 56 164 L48 164 Q44 164 44 159 Z" fill="#141319" />
              <path d="M44 158 L62 158" stroke="#3b3945" strokeWidth="1.3" opacity="0.75" />
            </g>
            <g className="gw-leg-r">
              <path d="M61 116 L62 146 Q62 150 59 150 L65 150 Q69 150 69 146 L68 116 Z" fill="#252430" />
              <path d="M66 150 Q67 145 73 145 L80 145 Q85 145 85 150 L84 160 Q84 164 79 164 L71 164 Q66 164 66 159 Z" fill="#141319" />
              <path d="M66 158 L85 158" stroke="#3b3945" strokeWidth="1.3" opacity="0.75" />
            </g>

            <path d="M46 96 L74 96 L76 120 Q76 124 72 124 L48 124 Q44 124 44 120 Z" fill="url(#gw-pants)" />
            <path d="M44 100 L76 100" stroke="#45434f" strokeWidth="2.6" />
            <rect x="56" y="97" width="8" height="6" rx="1.4" fill="#75727c" />

            <path d="M48 72 Q60 66 72 72 L73 100 L47 100 Z" fill="#17161b" />
            <path d="M51 68 Q60 63 69 68 L69 75 Q60 70 51 75 Z" fill="#232128" />

            <path
              d="M48 70 Q54 65 60 65 Q66 65 72 70 L76 98 Q76 104 71 106 L68 106 L67 82 L53 82 L52 106 L49 106 Q44 104 44 98 Z"
              fill="url(#gw-blazer)"
            />
            <path d="M60 64 L55 82 L62 80 L65 66 Z" fill="#4d4c55" />
            <path d="M60 64 L65 82 L58 80 L55 66 Z" fill="#6b6a74" />
            <rect x="66" y="88" width="9" height="5" rx="1" fill="#2f2e35" opacity="0.5" />
            <text x="70.5" y="92" fontSize="3.4" fill="#d3cfd8" textAnchor="middle" fontFamily="sans-serif">
              AI
            </text>

            <g className="gw-arm-l">
              <path d="M47 73 Q40 79 39 92 Q38 101 41 107" fill="none" stroke="url(#gw-blazer)" strokeWidth="10" strokeLinecap="round" />
              <circle cx="41" cy="108" r="4.6" fill="#f2d8c4" />
            </g>
            <g className="gw-arm-r">
              <path d="M73 73 Q80 79 81 92 Q82 101 79 107" fill="none" stroke="url(#gw-blazer)" strokeWidth="10" strokeLinecap="round" />
              <circle cx="79" cy="108" r="4.6" fill="#f2d8c4" />
            </g>

            <g className="gw-head">
              <ellipse cx="60" cy="48" rx="35" ry="34" fill="url(#gw-skin)" />
              <ellipse cx="26" cy="52" rx="5" ry="7" fill="#f2d8c4" />
              <ellipse cx="94" cy="52" rx="5" ry="7" fill="#f2d8c4" />

              <path
                d="M20 58 C13 40 15 22 26 14 C29 4 39 0 46 5 C51 -6 64 -6 69 4 C79 -2 89 6 91 18 C101 26 104 42 96 58
                   L95 40 L90 47 L88 32 L82 43 L78 28 L73 40 L68 26 L63 39 L58 25 L53 38 L48 27 L43 40 L38 30 L33 43 L27 35 L24 50 Z"
                fill="url(#gw-hair)"
              />
              <path d="M38 20 Q45 38 43 52" fill="none" stroke="#664b38" strokeWidth="2.2" opacity="0.45" />
              <path d="M68 18 Q63 36 65 50" fill="none" stroke="#664b38" strokeWidth="2.2" opacity="0.4" />
              <path d="M58 6 C53 -8 67 -12 71 -3 C73 2 68 6 64 6" fill="none" stroke="#7d5c45" strokeWidth="4.2" strokeLinecap="round" />

              <g transform="translate(85 24) rotate(14)">
                <ellipse cx="0" cy="0" rx="6" ry="4.6" fill="#e0743d" />
                <path d="M-6 -2 L-9.5 -6 M6 -2 L9.5 -6 M-6 2 L-10 5 M6 2 L10 5" stroke="#e0743d" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M-9.5 -6 L-11 -8 M9.5 -6 L11 -8 M-10 5 L-12 7 M10 5 L12 7" stroke="#e0743d" strokeWidth="1.4" strokeLinecap="round" />
                <circle cx="-2" cy="-1.4" r="1" fill="#231a16" />
                <circle cx="2" cy="-1.4" r="1" fill="#231a16" />
              </g>

              <g fill="none" stroke="#2a2630" strokeWidth="2.6">
                <rect x="32" y="40" width="27" height="20" rx="9.5" />
                <rect x="61" y="40" width="27" height="20" rx="9.5" />
                <path d="M59 48 L61 48" />
                <path d="M32 45 L25 44" />
                <path d="M88 45 L95 44" />
              </g>
              <g fill="#3a3742" opacity="0.92">
                <ellipse cx="45" cy="50" rx="5.8" ry="6.2" />
                <ellipse cx="75" cy="50" rx="5.8" ry="6.2" />
              </g>
              <circle cx="46.6" cy="47.4" r="2" fill="#fff" opacity="0.94" />
              <circle cx="76.6" cy="47.4" r="2" fill="#fff" opacity="0.94" />
              <path d="M57 65 Q60 63 63 65" fill="none" stroke="#b9806a" strokeWidth="1.9" strokeLinecap="round" />
            </g>
          </svg>
        )}
      </div>
      {say ? <span className="gw-say">{say}</span> : null}
      <span className="gw-name">{name}</span>
    </div>
  );
}
