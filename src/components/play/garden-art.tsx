/**
 * 池塘里那套手画的小图（16 条鱼 + 5 样杂物）。
 *
 * 为什么是内联 SVG 而不是 PNG：
 *   · 用户要"不要写实的，卡通的就行"——扁平填充 + 1px 深色细边这种，SVG 画得比生图准；
 *   · 离线可用（APK 里没有网络也要出图），改颜色只是改一个 stop；
 *   · 一张图在竹篮 / 图鉴 / 详情里会同时出现 → 渐变 id 必须每次唯一，
 *     否则后面的取不到渐变、整条鱼变成白的（预览阶段踩过这个坑）。
 *
 * 这套图的规矩（用户定的）：奶油／雾绿／灰蓝／淡粉，一个种类一种颜色，
 * 不要写实纹理、不要高光。稀有鱼只是"画得不一样"，不加任何稀有感装饰。
 */

import { useId } from "react";

/* 四种身型：细长 / 高背 / 贴底 / 圆润 */
const BODIES = {
  slim: "M9 19 C 19 7 44 6 55 13 L67 7 L64 19 L67 31 L55 25 C 44 32 19 31 9 19 Z",
  deep: "M12 19 C 17 5 42 3 54 11 L67 6 L63 19 L67 32 L54 27 C 42 35 17 33 12 19 Z",
  low: "M6 21 C 19 14 42 13 54 18 L66 13 L62 21 L66 29 L54 25 C 42 29 19 28 6 21 Z",
  round: "M11 19 C 15 7 38 3 51 10 L63 4 L60 19 L63 34 L51 28 C 38 35 15 31 11 19 Z",
} as const;

type BodyKind = keyof typeof BODIES;

type FishLook = {
  body: BodyKind;
  /** 渐变三段：背 / 中 / 腹 */
  stops: [string, string, string];
  /** 花纹 */
  marks?:
    | "stripes"
    | "spots"
    | "moon"
    | "copper"
    | "glass"
    | "whisker"
    | "amber";
  /** 一条淡淡的侧线（可选） */
  line?: string;
};

const LOOKS: Record<string, FishLook> = {
  argento: { body: "slim", stops: ["#bfcacb", "#e9eee6", "#fbf8ef"], line: "M31 9 C 40 11 50 14 56 16" },
  persico: { body: "deep", stops: ["#7f8d6f", "#bcc6a9", "#f2efdf"], marks: "stripes" },
  ciprino: { body: "round", stops: ["#d9b48d", "#ecd2b7", "#fbf6ea"], line: "M30 9 C 40 12 48 15 54 16" },
  alice: { body: "slim", stops: ["#a7b6bd", "#dbe2dd", "#fbf8ee"] },
  ghiozzo: { body: "low", stops: ["#877b64", "#b3a68c", "#f1ebdb"], marks: "whisker" },
  occhiata: { body: "deep", stops: ["#6f8899", "#bccbd3", "#fbf8f0"] },
  carice: { body: "low", stops: ["#9aa87f", "#ccd3b6", "#f7f3e6"], line: "M20 19 C 34 17 46 18 54 19" },
  muschio: { body: "deep", stops: ["#7e8d6c", "#b7c3a0", "#f1efe0"], marks: "spots" },
  lunare: { body: "round", stops: ["#c9ccd8", "#e8e9ef", "#fdfbf3"], marks: "moon" },
  bronzeo: { body: "deep", stops: ["#a9855c", "#cbb28c", "#f7f0e2"], marks: "copper" },
  nero: { body: "round", stops: ["#4b4a48", "#79746c", "#cabfb0"], line: "M32 10 C 41 13 48 15 54 16" },
  porcellana: { body: "slim", stops: ["#e8e2d6", "#f6f1e6", "#fffdf7"] },
  vetro: { body: "low", stops: ["#b9ccd0", "#dde8e6", "#fcfbf4"], marks: "glass" },
  dorata: { body: "deep", stops: ["#c8a06a", "#e3c79c", "#fbf5e7"], marks: "amber" },
  barbiglio: { body: "low", stops: ["#6f6a5c", "#a49a84", "#ece5d5"], marks: "whisker" },
  centro: { body: "round", stops: ["#c0a887", "#dcc9ae", "#faf4e6"], marks: "moon" },
};

const INK = "rgba(59,50,39,.42)";

function Marks({ kind }: { kind: FishLook["marks"] }) {
  if (!kind) return null;
  switch (kind) {
    case "stripes":
      return (
        <g stroke="rgba(56,66,48,.3)" strokeWidth="2.6" strokeLinecap="round">
          <path d="M27 8 L29 30" />
          <path d="M37 6 L38 32" />
          <path d="M47 8 L47 31" />
        </g>
      );
    case "spots":
      return (
        <g fill="rgba(90,104,72,.28)">
          <circle cx="30" cy="14" r="2.1" />
          <circle cx="40" cy="11" r="1.7" />
          <circle cx="34" cy="24" r="1.9" />
          <circle cx="46" cy="20" r="1.6" />
        </g>
      );
    case "moon":
      return (
        <g>
          <circle cx="34" cy="13" r="5.4" fill="none" stroke="rgba(150,150,170,.34)" strokeWidth="1" />
          <circle cx="45" cy="21" r="2.4" fill="rgba(150,150,170,.2)" />
        </g>
      );
    case "copper":
      return <path d="M20 12 C 22 17 22 23 20 27" fill="none" stroke="rgba(168,116,60,.5)" strokeWidth="2.4" strokeLinecap="round" />;
    case "glass":
      return (
        <g>
          <path d="M36 9 C 39 14 39 24 36 29" fill="none" stroke="rgba(150,178,186,.5)" strokeWidth="1" />
          <circle cx="34" cy="19" r="2.4" fill="rgba(196,150,146,.28)" />
        </g>
      );
    case "whisker":
      return (
        <g stroke="rgba(92,78,58,.5)" strokeWidth="1" strokeLinecap="round">
          <path d="M15 15 l-7 -3" />
          <path d="M15 16 l-8 0" />
          <path d="M15 17 l-7 3" />
        </g>
      );
    case "amber":
      return (
        <g>
          <circle cx="20" cy="17" r="3.1" fill="rgba(206,158,74,.55)" />
          <circle cx="20" cy="17" r="1.5" fill="rgba(60,44,28,.8)" />
        </g>
      );
    default:
      return null;
  }
}

/** 一条鱼（`id` 用 garden-catch 里的 species id） */
export function FishArt({ id, className = "" }: { id: string; className?: string }) {
  const look = LOOKS[id] ?? LOOKS.argento!;
  const uid = useId().replace(/[:]/g, "");
  const gid = `fish-${uid}`;
  return (
    <svg viewBox="0 0 72 40" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={look.stops[0]} />
          <stop offset="0.44" stopColor={look.stops[1]} />
          <stop offset="1" stopColor={look.stops[2]} />
        </linearGradient>
      </defs>
      <path d={BODIES[look.body]} fill={`url(#${gid})`} stroke={INK} strokeWidth="1" strokeLinejoin="round" />
      {look.line ? <path d={look.line} fill="none" stroke="rgba(96,112,104,.3)" strokeWidth="1" /> : null}
      <Marks kind={look.marks} />
      <circle cx="18" cy="17.5" r="1.7" fill="rgba(44,37,29,.84)" />
      <circle cx="17.4" cy="17" r="0.6" fill="rgba(255,253,246,.8)" />
    </svg>
  );
}

/** 一样杂物（`id` 用 garden-catch 里的 junk id） */
export function JunkArt({ id, className = "" }: { id: string; className?: string }) {
  const common = { viewBox: "0 0 46 40", className, "aria-hidden": true } as const;
  switch (id) {
    case "alga":
      return (
        <svg {...common}>
          <g fill="none" stroke="#7d9080" strokeWidth="1.9" strokeLinecap="round">
            <path d="M15 35 C 13 26 17 16 25 7" />
            <path d="M21 29 C 28 27 32 22 32 16" />
            <path d="M19 21 C 12 19 9 14 10 9" />
            <path d="M25 7 C 28 9 29 13 28 16" />
          </g>
          <path d="M32 16 c 3 -1 5 -4 5 -7" fill="none" stroke="#93a390" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "tappo":
      return (
        <svg {...common}>
          <rect x="15" y="9" width="14" height="22" rx="6" fill="#d5b78d" stroke="rgba(59,50,39,.34)" />
          <g stroke="rgba(96,74,46,.3)" strokeWidth="1.1" strokeLinecap="round">
            <path d="M18 15 h8" />
            <path d="M18 20 h8" />
            <path d="M18 25 h6" />
          </g>
        </svg>
      );
    case "granchio":
      return (
        <svg {...common}>
          <ellipse cx="23" cy="25" rx="10" ry="7" fill="#c98f7e" stroke="rgba(59,50,39,.34)" />
          <path d="M17 19 C 18 13 20 11 23 11 C 26 11 28 13 29 19" fill="none" stroke="#c98f7e" strokeWidth="2" />
          <g stroke="#c98f7e" strokeWidth="2" strokeLinecap="round" fill="none">
            <path d="M14 21 l-5 -3" />
            <path d="M32 21 l5 -3" />
            <path d="M14 29 l-4 4" />
            <path d="M32 29 l4 4" />
            <path d="M23 32 l0 5" />
          </g>
          <circle cx="19" cy="20" r="1.2" fill="rgba(40,32,24,.72)" />
          <circle cx="27" cy="20" r="1.2" fill="rgba(40,32,24,.72)" />
        </svg>
      );
    case "foglia":
      return (
        <svg {...common}>
          <path d="M34 6 C 20 6 10 15 10 30 C 22 32 34 24 34 6 Z" fill="#c9bf9e" stroke="rgba(59,50,39,.3)" />
          <path d="M34 6 C 26 14 20 21 16 30" fill="none" stroke="rgba(96,82,56,.4)" strokeWidth="1.1" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="8" y="10" width="30" height="19" rx="2" fill="#fbf6ea" stroke="rgba(59,50,39,.42)" />
          <g stroke="rgba(74,63,49,.42)" strokeWidth="1.2" strokeLinecap="round">
            <path d="M12 17 h20" />
            <path d="M12 21 h13" />
            <path d="M12 25 h8" />
          </g>
          <path d="M8 10 l4 -3 h16 l4 3" fill="#efe4cd" stroke="rgba(59,50,39,.28)" />
        </svg>
      );
  }
}
