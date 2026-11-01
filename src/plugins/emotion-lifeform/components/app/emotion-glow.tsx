"use client";

/**
 * 「情绪」页的视觉原子：背景星海 / 光团 / 关键帧。
 *
 * 设计稿见仓库根 `preview-emotion-glow3.html`（三屏：今天、详情、轨迹）。
 * 这里只管**画东西**，不读 store、不碰数据 —— 面板与页面共用同一套色和尺寸。
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { LEXICON } from "@/plugins/emotion-lifeform/lib/emotion/lexicon";
import type { EmotionEvent } from "@/plugins/emotion-lifeform/lib/emotion/types";

/** 设计稿那三句手写英文用的字体栈（Windows 上先落 Segoe Script） */
export const SCRIPT_FONT = '"Segoe Script","Brush Script MT","Bradley Hand","Snell Roundhand",cursive';

/** 深底 + 暖白的一小套色，散落在组件里就容易走样，集中放这儿 */
export const PAPER = {
  bg: "#0d0a14",
  cream: "#f7f1e7",
  body: "#d7cbbd",
  muted: "#a99fb2",
  faint: "#8f8699",
  panel: "rgba(22,18,28,.94)",
  panelBorder: "rgba(255,255,255,.11)",
} as const;

type LexiconGroup = (typeof LEXICON)[number];

export type EmotionGroup = {
  id: string;
  /** 分组字母：G */
  letter: string;
  /** 分组名：心动 */
  name: string;
  /** 光团外圈色相（0~360） */
  hue: number;
  /** 设计稿那种"奶白打底、外圈淡色相"的小圆点颜色 */
  tint: string;
};

/**
 * 10 组的色相。`src/lib/emotion-lexicon.ts` 里那份 `GROUP_COLORS` 没导出，
 * 而且原色偏艳（`rgb(244,114,182)` 这种），设计稿要的是奶白底 + 淡色相，
 * 所以这里按组 id 另存一份**柔和版**，不改 lexicon。
 */
const GROUP_HUE: Record<string, number> = {
  bright: 36,
  calm: 210,
  low: 232,
  angry: 6,
  uneasy: 268,
  close: 18,
  flutter: 332,
  jealous: 168,
  restrained: 250,
  curious: 150,
};

const GROUP_TINT: Record<string, string> = {
  bright: "#ffe3c2",
  calm: "#d9e8ff",
  low: "#cfd4ff",
  angry: "#ffd0cc",
  uneasy: "#e3ddf0",
  close: "#ffdcc0",
  flutter: "#ffd1e0",
  jealous: "#c9f0e6",
  restrained: "#dfe7f2",
  curious: "#d3f0dc",
};

/** 事件没带组别时按大类兜底 */
const CATEGORY_GROUP: Record<string, string> = {
  base: "calm",
  intimacy: "close",
  tension: "uneasy",
  cognition: "curious",
  expression: "curious",
};

function toGroup(group: LexiconGroup): EmotionGroup {
  return {
    id: group.id,
    letter: group.title.slice(0, 1),
    name: group.title.replace(/^[A-Za-z]\.\s*/, ""),
    hue: GROUP_HUE[group.id] ?? 268,
    tint: GROUP_TINT[group.id] ?? "#ffd9c6",
  };
}

/**
 * 推出这笔情绪属于 10 组里的哪一组。
 *
 * 插件里没有组别字段：`EmotionEvent.group` 是可选的，栖岛映射（qidao-scenes）
 * 又没带，所以顺序是 —— 显式 group → 主情绪命中参考词 → 次情绪命中 →
 * 按大类兜底 → 平静。
 */
export function groupOf(
  event: Pick<EmotionEvent, "group" | "primaryEmotion" | "secondaryEmotions" | "category">,
): EmotionGroup {
  const explicit = event.group ? LEXICON.find((group) => group.id === event.group) : undefined;
  const byPrimary = LEXICON.find((group) => group.terms.includes(event.primaryEmotion));
  const bySecondary = LEXICON.find((group) =>
    event.secondaryEmotions.some((tag) => group.terms.includes(tag)),
  );
  const byCategory = LEXICON.find((group) => group.id === CATEGORY_GROUP[event.category]);
  return toGroup(explicit ?? byPrimary ?? bySecondary ?? byCategory ?? LEXICON[0]);
}

/**
 * 只取 ISO 字符串里**记录自带的墙上时间**（`2026-10-09T09:10:00+08:00` → `09:10`）。
 *
 * 不能用 `Intl` / `getHours()` —— 服务端（UTC）和浏览器（Asia/Shanghai）会算出
 * 两个不同的钟点，SSR 与首屏一对不上就是 hydration mismatch，整棵树重画。
 */
export function formatClock(iso: string): string {
  const wall = /T(\d{2}):(\d{2})/.exec(iso);
  if (wall) return `${wall[1]}:${wall[2]}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

/** 一天里的第几分钟 —— 同样按记录自带的时区算，跟 `formatClock` 对齐 */
export function clockMinutes(iso: string): number {
  const wall = /T(\d{2}):(\d{2})/.exec(iso);
  if (wall) return Number(wall[1]) * 60 + Number(wall[2]);
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 0;
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

/** 手写英文句的统一样式（21px / 16px、暖白、微微倾斜） */
export function scriptStyle(fontSize: number, opacity: number, rotate: number): CSSProperties {
  return {
    fontFamily: SCRIPT_FONT,
    fontStyle: "italic",
    color: "#e6dccd",
    fontSize,
    opacity,
    transform: `rotate(${rotate}deg)`,
    lineHeight: 1.3,
    letterSpacing: ".01em",
  };
}

type Star = { left: number; top: number; size: number; opacity: number; color: string };

/** 12 颗小星点，位置写死，避免每次重排闪一下 */
const STARS: Star[] = [
  { left: 8, top: 12, size: 1.6, opacity: 0.5, color: "#fff" },
  { left: 22, top: 7, size: 1.2, opacity: 0.35, color: "#ffe9c9" },
  { left: 36, top: 16, size: 1.8, opacity: 0.55, color: "#fff" },
  { left: 52, top: 6, size: 1.1, opacity: 0.3, color: "#fff" },
  { left: 66, top: 14, size: 1.5, opacity: 0.45, color: "#ffe9c9" },
  { left: 82, top: 9, size: 1.3, opacity: 0.4, color: "#fff" },
  { left: 92, top: 22, size: 1.7, opacity: 0.5, color: "#fff" },
  { left: 14, top: 38, size: 1.2, opacity: 0.3, color: "#fff" },
  { left: 74, top: 44, size: 1.4, opacity: 0.35, color: "#ffe9c9" },
  { left: 46, top: 62, size: 1.2, opacity: 0.25, color: "#fff" },
  { left: 88, top: 70, size: 1.6, opacity: 0.3, color: "#fff" },
  { left: 26, top: 78, size: 1.1, opacity: 0.22, color: "#ffe9c9" },
];

/**
 * 两屏共用背景：深紫黑底 + 一条斜的紫金银河 + 星点 + 四角压暗。
 * `intensity` 高的时候，光团周围再被染一点情绪色（透明度跟强度走）。
 */
export function GlowBackdrop({
  hue,
  intensity,
  reduced,
}: {
  hue: number;
  intensity: number;
  reduced: boolean;
}) {
  const closeness = Math.max(0, Math.min(1, (intensity - 40) / 60));
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 8%, #1a1430 0%, #120e1e 44%, #060409 100%)",
        }}
      />
      <div
        className="absolute"
        style={{
          left: "-30%",
          right: "-30%",
          top: "20%",
          height: "56%",
          transform: "rotate(-17deg)",
          background:
            "linear-gradient(90deg, rgba(126,96,178,0) 0%, rgba(126,96,172,.14) 26%, rgba(178,150,190,.09) 46%, rgba(206,182,150,.11) 58%, rgba(126,96,172,.13) 78%, rgba(126,96,178,0) 100%)",
          filter: "blur(30px)",
          opacity: 0.9,
        }}
      />
      <div
        className="absolute"
        style={{
          left: "50%",
          top: "34%",
          width: 470,
          height: 470,
          marginLeft: -235,
          marginTop: -235,
          borderRadius: 9999,
          background: `radial-gradient(circle, hsla(${hue} 80% 78% / .62) 0%, transparent 66%)`,
          filter: "blur(16px)",
          opacity: 0.16 + closeness * 0.26,
          transition: reduced ? undefined : "opacity .8s ease",
        }}
      />
      {STARS.map((star, index) => (
        <span
          key={index}
          className="absolute rounded-full"
          style={{
            left: `${star.left}%`,
            top: `${star.top}%`,
            width: star.size,
            height: star.size,
            backgroundColor: star.color,
            opacity: star.opacity,
            boxShadow: `0 0 ${star.size * 2}px ${star.color}`,
          }}
        />
      ))}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 40%, transparent 40%, rgba(4,2,8,.55) 100%)",
        }}
      />
    </div>
  );
}

/**
 * 光团：三层 CSS（外层模糊色相 / 中心近白 / 光晕），
 * 强度越高越亮、光晕越大；`eventId` 一变就落地一次（缩 1.13 再回弹 + 光环外扩）。
 */
export function EmotionOrb({
  eventId,
  hue,
  intensity,
  reduced,
  size = 176,
  dimmed = false,
}: {
  eventId: string;
  hue: number;
  intensity: number;
  reduced: boolean;
  size?: number;
  dimmed?: boolean;
}) {
  const [landing, setLanding] = useState(false);
  const previous = useRef(eventId);

  useEffect(() => {
    if (previous.current === eventId) return;
    previous.current = eventId;
    if (reduced) return;
    setLanding(true);
    const timer = window.setTimeout(() => setLanding(false), 760);
    return () => window.clearTimeout(timer);
  }, [eventId, reduced]);

  const glow = dimmed ? 0.12 : 0.3 + (Math.max(0, Math.min(100, intensity)) / 100) * 0.22;
  const core = Math.round(size * 0.52);
  const animations: string[] = [];
  if (!reduced && !dimmed) {
    animations.push("emo-breathe 8s ease-in-out infinite");
    if (landing) animations.push("emo-land .6s cubic-bezier(.22,1.2,.36,1)");
  }

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <span
        aria-hidden
        style={{
          position: "absolute",
          width: size * 1.42,
          height: size * 1.42,
          borderRadius: 9999,
          background: `radial-gradient(circle, hsla(${hue} 82% 78% / .55) 0%, transparent 70%)`,
          filter: "blur(52px)",
          opacity: glow,
          transition: reduced ? undefined : "opacity .8s ease",
        }}
      />
      <span
        aria-hidden
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: 9999,
          filter: "blur(13px)",
          background: `radial-gradient(circle at 41% 37%, #fffdf8 0%, #fff3e8 24%, hsla(${hue}, 72%, 82%, .85) 52%, rgba(255,224,207,0) 76%)`,
          opacity: dimmed ? 0.32 : 0.92,
          animation: animations.length ? animations.join(", ") : undefined,
        }}
      />
      <span
        aria-hidden
        style={{
          position: "absolute",
          width: core,
          height: core,
          borderRadius: 9999,
          background:
            "radial-gradient(circle at 45% 41%, #fffdf8 0%, #fff6ee 58%, rgba(255,246,238,0) 84%)",
          filter: "blur(9px)",
          opacity: dimmed ? 0.5 : 1,
        }}
      />
      {landing && !reduced ? (
        <span
          key={eventId}
          aria-hidden
          className="emo-ring"
          style={{
            position: "absolute",
            width: size,
            height: size,
            borderRadius: 9999,
            border: "1px solid rgba(255,238,224,.5)",
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * 动效关键帧。设计稿的呼吸是 6.4s / 1.045，用户要求 8s / 1.04 / 亮度 86%→100%，
 * 这里按用户说的来；全部由 `settings.reducedMotion` 在 JS 侧决定挂不挂。
 */
export function EmotionGlowStyle() {
  return (
    <style>{`
      @keyframes emo-breathe {
        0%, 100% { transform: scale(1); opacity: .86; }
        50% { transform: scale(1.04); opacity: 1; }
      }
      @keyframes emo-land {
        0% { transform: scale(1.13); }
        100% { transform: scale(1); }
      }
      @keyframes emo-ring {
        0% { transform: scale(.74); opacity: .5; }
        100% { transform: scale(1.66); opacity: 0; }
      }
      @keyframes emo-word-in {
        0% { opacity: 0; transform: translateY(6px); }
        100% { opacity: 1; transform: none; }
      }
      @keyframes emo-sheet-up {
        0% { opacity: 0; transform: translateY(100%); }
        100% { opacity: 1; transform: none; }
      }
      @keyframes emo-fade {
        0% { opacity: 0; }
        100% { opacity: 1; }
      }
      @keyframes emo-draw {
        0% { stroke-dashoffset: 1; }
        100% { stroke-dashoffset: 0; }
      }
      @keyframes emo-flow {
        0% { stroke-dashoffset: 0; }
        100% { stroke-dashoffset: -100; }
      }
      .emo-ring { animation: emo-ring .9s ease-out forwards; }
      .emo-word-in { animation: emo-word-in .5s ease-out both; }
      .emo-sheet { animation: emo-sheet-up .32s cubic-bezier(.22,1.2,.36,1) both; }
      .emo-fade { animation: emo-fade .22s ease-out both; }
      .emo-spark-line { animation: emo-draw .5s ease-out both; }
      .emo-spark-flow { animation: emo-flow 4s linear infinite; }
    `}</style>
  );
}
