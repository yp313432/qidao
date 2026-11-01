"use client";

import { useMemo } from "react";
import { LEXICON } from "@/plugins/emotion-lifeform/lib/emotion/lexicon";
import { useEmotionStore } from "@/plugins/emotion-lifeform/lib/store";

/**
 * 抽屉底部的**像素小螃蟹** —— 他现在什么情绪，一眼就能看见。
 *
 * 用户的要求（原话）：
 *   "他的情绪我要点开才能看到，找入口很麻烦，我想在主页一眼就看到……
 *    之前那个下面不是画的星球体，现在把星球体去掉，但后面的粒子星星可以保留，
 *    上面的不用动，然后把这个小螃蟹放到星球体那里，
 *    根据我们的十个组别，设计十个动态效果"
 * 后来又补：
 *   "我想要像素风格的，能画出来吗，然后能不能就用橙色的，然后靠动画区分情绪"
 *
 * 所以这文件里只有一只**永远橙色**的像素蟹：
 *   · 22×16 的整数格，硬边（crispEdges），放大不糊；
 *   · 颜色只有三个：主体 #ff8a5c、暗部 #d8653c、眼睛 #3a241d；
 *   · 十种情绪靠**动作 + 眼睛/嘴的形状 + 一个小符号**区分，不换色。
 *
 * 组别 → 形态的映射刻意不写死成十份 SVG：
 * 身体（壳+腿+钳）是同一份，只有眼睛和嘴在变，这样十种之间不会"长得不像一家人"。
 */

const SHELL = "#ff8a5c";
const SHELL_DARK = "#d8653c";
const EYE = "#3a241d";
const MOUTH = "#ffc7ab";

type EyeKind = "happy" | "flat" | "half" | "squint" | "look" | "heart" | "wide" | "blink";

/** 组别 id → 表情 + 动作类（动作类在 styles.css 的 .crab-* 里）*/
const GROUP_LOOK: Record<string, { eye: EyeKind; act: string; fx?: string }> = {
  bright: { eye: "happy", act: "crab-bob", fx: "✦" },
  calm: { eye: "flat", act: "crab-breathe" },
  low: { eye: "half", act: "crab-sink" },
  angry: { eye: "squint", act: "crab-shake", fx: "≋" },
  uneasy: { eye: "look", act: "crab-sway", fx: "?" },
  close: { eye: "happy", act: "crab-lean", fx: "♡" },
  flutter: { eye: "heart", act: "crab-hop", fx: "♡" },
  jealous: { eye: "wide", act: "crab-puff", fx: "◦" },
  restrained: { eye: "blink", act: "crab-idle" },
  curious: { eye: "look", act: "crab-peek", fx: "?" },
};

/** 没有情绪时的样子：不跳不动，眼睛就是两条竖线 */
const NEUTRAL: { eye: EyeKind; act: string; fx?: string } = { eye: "flat", act: "crab-still" };

function Eyes({ kind }: { kind: EyeKind }) {
  switch (kind) {
    case "happy":
      return (
        <g fill={EYE}>
          <rect x="8" y="6" width="1" height="1" />
          <rect x="9" y="5" width="1" height="1" />
          <rect x="10" y="6" width="1" height="1" />
          <rect x="15" y="6" width="1" height="1" />
          <rect x="16" y="5" width="1" height="1" />
          <rect x="17" y="6" width="1" height="1" />
        </g>
      );
    case "half":
      return (
        <g fill={EYE}>
          <rect x="8" y="7" width="2" height="1" />
          <rect x="16" y="7" width="2" height="1" />
        </g>
      );
    case "squint":
      return (
        <g fill={EYE}>
          <rect x="8" y="6" width="1" height="1" />
          <rect x="9" y="7" width="1" height="1" />
          <rect x="10" y="6" width="1" height="1" />
          <rect x="15" y="6" width="1" height="1" />
          <rect x="16" y="7" width="1" height="1" />
          <rect x="17" y="6" width="1" height="1" />
        </g>
      );
    case "look":
      return (
        <g fill={EYE}>
          <rect x="7" y="6" width="2" height="3" />
          <rect x="16" y="6" width="2" height="3" />
        </g>
      );
    case "heart":
      return (
        <g fill={EYE}>
          <rect x="8" y="6" width="1" height="1" />
          <rect x="10" y="6" width="1" height="1" />
          <rect x="9" y="7" width="1" height="1" />
          <rect x="15" y="6" width="1" height="1" />
          <rect x="17" y="6" width="1" height="1" />
          <rect x="16" y="7" width="1" height="1" />
        </g>
      );
    case "wide":
      return (
        <g fill={EYE}>
          <rect x="8" y="5" width="2" height="4" />
          <rect x="15" y="5" width="2" height="4" />
        </g>
      );
    case "blink":
      return (
        <g fill={EYE}>
          <rect x="8" y="7" width="2" height="1" />
          <rect x="15" y="7" width="2" height="1" />
        </g>
      );
    default:
      return (
        <g fill={EYE}>
          <rect x="8" y="6" width="2" height="3" />
          <rect x="15" y="6" width="2" height="3" />
        </g>
      );
  }
}

/**
 * 像素蟹本体。
 * @param group  情绪组别（bright/calm/…），未知就按平静处理
 * @param intensity 0~100，只影响**动得多快/多大**，不影响颜色
 * @param reduced  "减少动态"开着 → 完全静止
 */
export function CrabPixels({
  group,
  intensity = 60,
  reduced = false,
  className,
  size = 150,
}: {
  group?: string;
  intensity?: number;
  reduced?: boolean;
  className?: string;
  size?: number;
}) {
  const look = (group && GROUP_LOOK[group]) || NEUTRAL;
  const amp = Math.max(0.35, Math.min(1.5, 0.4 + intensity / 90));
  const act = reduced ? "crab-still" : look.act;

  return (
    <div
      className={`crab-shell ${act} ${className ?? ""}`}
      style={{
        ["--crab-amp" as string]: amp.toFixed(2),
        width: size,
        height: Math.round((size / 22) * 16),
      }}
      aria-hidden="true"
    >
      {look.fx ? <span className="crab-fx">{look.fx}</span> : null}
      <svg viewBox="0 0 22 16" width="100%" height="100%" shapeRendering="crispEdges">
        {/* 侧钳 */}
        <g fill={SHELL}>
          <rect x="0" y="6" width="4" height="3" />
          <rect x="18" y="6" width="4" height="3" />
        </g>
        {/* 壳 */}
        <rect x="4" y="4" width="14" height="7" fill={SHELL} />
        {/* 壳上一道浅暗边，让它有点体积 */}
        <rect x="4" y="4" width="14" height="1" fill={SHELL_DARK} opacity="0.45" />
        {/* 四条腿 */}
        <g fill={SHELL}>
          <rect x="6" y="11" width="1" height="4" />
          <rect x="9" y="11" width="1" height="4" />
          <rect x="13" y="11" width="1" height="4" />
          <rect x="16" y="11" width="1" height="4" />
        </g>
        <Eyes kind={look.eye} />
        <rect x="10" y="10" width="3" height="1" fill={MOUTH} />
      </svg>
    </div>
  );
}

/** 组别的中文名（去掉 lexicon 里 "A. " 这种前缀） */
export function groupName(id?: string): string {
  const g = LEXICON.find((x) => x.id === id);
  if (!g) return "";
  return g.title.replace(/^[A-Z]\.\s*/, "");
}

/**
 * 抽屉里「他现在的情绪」这一块：像素蟹 + 底下一个小标签。
 * 没有情绪记录时只显示螃蟹（安静状态），不显示标签。
 */
export function DrawerMood() {
  const scenes = useEmotionStore((s) => s.scenes);
  const sceneId = useEmotionStore((s) => s.sceneId);
  const settings = useEmotionStore((s) => s.settings);

  const current = useMemo(
    () => scenes.find((s) => s.eventId === sceneId) ?? scenes[0],
    [scenes, sceneId],
  );

  const reduced = Boolean(settings.reducedMotion);
  const label = current ? groupName(current.group) : "";

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-16 flex flex-col items-center">
      <CrabPixels
        group={current?.group}
        intensity={current?.intensity ?? 55}
        reduced={reduced}
        size={118}
      />
      {current && label ? (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
          他现在的情绪
          <span className="rounded-full border border-line bg-bg-elev px-2 py-0.5 text-[11px] text-fg">
            {current.group ? `${current.group[0].toUpperCase()} · ${label}` : label}
          </span>
        </p>
      ) : null}
    </div>
  );
}
