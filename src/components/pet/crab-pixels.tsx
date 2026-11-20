"use client";

import { useEffect, useState } from "react";
import { LEXICON } from "@/plugins/emotion-lifeform/lib/emotion/lexicon";

/**
 * 像素小螃蟹（只有一只，全 App 共用）。
 *
 * 来历（用户原话）：
 *   "我想要像素风格的，能画出来吗，然后能不能就用橙色的，然后靠动画区分情绪"
 *   "螃蟹按照这个标准来，之前那个有点身子有点扁，手和脚太细长了"
 *   → 身体 18×10（宽:高 ≈ 2.25:1），腿 2×3 短粗且**全在壳内**，眼睛 2×4。
 *
 * 2026-11-18 从 `src/components/chat/drawer-crab.tsx` 挪过来（用户 m01345/m01541：
 * 老的那只 126px 抽屉蟹删掉，只留对话页这只）。现在只有两个使用方：
 *   · `src/components/chat/chat-crab.tsx` —— 对话页那只活的（可走、可拖、会说话）
 *   · `src/components/pet/pet-page.tsx` —— 设置页预览
 *
 * 画法：24×18 的整数格、硬边（crispEdges）、放大不糊；
 * 颜色只有三个：主体 #ff8a5c、暗部 #d8653c、眼睛 #3a241d；
 * 十种情绪靠**动作 + 眼睛/嘴的形状 + 一个小符号**区分，不换色。
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

/** 眼睛都以「左眼 x=8、右眼 x=15」为基准画（2 格宽） */
function Eyes({ kind }: { kind: EyeKind }) {
  switch (kind) {
    case "happy":
      return (
        <g fill={EYE}>
          <rect x="8" y="7" width="1" height="1" />
          <rect x="9" y="6" width="1" height="1" />
          <rect x="10" y="7" width="1" height="1" />
          <rect x="14" y="7" width="1" height="1" />
          <rect x="15" y="6" width="1" height="1" />
          <rect x="16" y="7" width="1" height="1" />
        </g>
      );
    case "half":
      return (
        <g fill={EYE}>
          <rect x="8" y="10" width="2" height="1" />
          <rect x="14" y="10" width="2" height="1" />
        </g>
      );
    case "squint":
      return (
        <g fill={EYE}>
          <rect x="8" y="7" width="1" height="1" />
          <rect x="9" y="8" width="1" height="1" />
          <rect x="10" y="7" width="1" height="1" />
          <rect x="14" y="7" width="1" height="1" />
          <rect x="15" y="8" width="1" height="1" />
          <rect x="16" y="7" width="1" height="1" />
        </g>
      );
    case "look":
      return (
        <g fill={EYE}>
          <rect x="7" y="6" width="2" height="4" />
          <rect x="15" y="6" width="2" height="4" />
        </g>
      );
    case "heart":
      return (
        <g fill={EYE}>
          <rect x="8" y="6" width="1" height="1" />
          <rect x="10" y="6" width="1" height="1" />
          <rect x="9" y="7" width="1" height="2" />
          <rect x="14" y="6" width="1" height="1" />
          <rect x="16" y="6" width="1" height="1" />
          <rect x="15" y="7" width="1" height="2" />
        </g>
      );
    case "wide":
      return (
        <g fill={EYE}>
          <rect x="8" y="5" width="2" height="6" />
          <rect x="14" y="5" width="2" height="6" />
        </g>
      );
    case "blink":
      return (
        <g fill={EYE}>
          <rect x="8" y="9" width="2" height="1" />
          <rect x="14" y="9" width="2" height="1" />
        </g>
      );
    default:
      return (
        <g fill={EYE}>
          <rect x="8" y="6" width="2" height="4" />
          <rect x="14" y="6" width="2" height="4" />
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
  articulated = false,
}: {
  group?: string;
  intensity?: number;
  reduced?: boolean;
  className?: string;
  size?: number;
  articulated?: boolean;
}) {
  const look = (group && GROUP_LOOK[group]) || NEUTRAL;
  const amp = Math.max(0.35, Math.min(1.5, 0.4 + intensity / 90));
  const act = articulated ? "crab-articulated" : reduced ? "crab-still" : look.act;

  /**
   * 眨眼是"帧动画"：每 2.6–6.2 秒随机闭一次，闭 170ms。
   * 用户 2026-11-01："它不需要呼吸感……就跟桌宠类似，是可以动的那种"。
   */
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (reduced) return;
    let open = 0;
    let shut = 0;
    const loop = () => {
      open = window.setTimeout(() => {
        setBlink(true);
        shut = window.setTimeout(() => {
          setBlink(false);
          loop();
        }, 170);
      }, 2600 + Math.random() * 3600);
    };
    loop();
    return () => {
      window.clearTimeout(open);
      window.clearTimeout(shut);
    };
  }, [reduced]);

  return (
    <div
      className={`crab-shell ${act} ${className ?? ""}`}
      data-mood={group || "calm"}
      style={{
        ["--crab-amp" as string]: amp.toFixed(2),
        width: size,
        height: Math.round((size / 24) * 18),
      }}
      aria-hidden="true"
    >
      {look.fx ? <span className="crab-fx">{look.fx}</span> : null}
      <svg viewBox="0 0 24 18" width="100%" height="100%" shapeRendering="crispEdges">
        <g className="crab-body">
          {/* 壳 18×10 + 两只 3×3 侧钳 */}
          <g fill={SHELL}>
            <rect className="crab-claw crab-claw-left" x="0" y="8" width="3" height="3" />
            <rect className="crab-claw crab-claw-right" x="21" y="8" width="3" height="3" />
          </g>
          <rect x="3" y="3" width="18" height="10" fill={SHELL} />
          <rect x="3" y="3" width="18" height="1" fill={SHELL_DARK} opacity="0.45" />
          {/* 四条短粗腿：2 宽 3 高，**全部落在壳的范围内**（壳 x=5..19）——
              2026-11-01 用户："四条腿没做好"（原来 x=18 那条伸出壳外半个像素格） */}
          <g className="crab-legs" fill={SHELL}>
            <rect className="crab-leg crab-leg-a" x="5" y="13" width="2" height="4" />
            <rect className="crab-leg crab-leg-b" x="8" y="13" width="2" height="4" />
            <rect className="crab-leg crab-leg-b" x="14" y="13" width="2" height="4" />
            <rect className="crab-leg crab-leg-a" x="17" y="13" width="2" height="4" />
          </g>
          {/* 眨眼：单独一层 React 状态驱动（170ms），比 CSS 周期动画干净 */}
          <g className="crab-awake-eyes"><Eyes kind={!reduced && blink ? "blink" : look.eye} /></g>
          {articulated && <g className="crab-sleep-eyes"><Eyes kind="blink" /></g>}
          <rect x="11" y="10" width="2" height="1" fill={MOUTH} />
        </g>
      </svg>
    </div>
  );
}

/**
 * 组别推导：真实上报里 `group` 可能没填（演示场景就没有），
 * 所以再按主情绪 / 次情绪去 lexicon 的词表里认一下，认不出来就当没有。
 */
export function groupOfEvent(e?: {
  group?: string;
  primaryEmotion?: string;
  secondaryEmotions?: string[];
}): string | undefined {
  if (!e) return undefined;
  if (e.group) return e.group;
  const byPrimary = e.primaryEmotion
    ? LEXICON.find((g) => g.terms.includes(e.primaryEmotion as string))
    : undefined;
  if (byPrimary) return byPrimary.id;
  const bySecond = LEXICON.find((g) =>
    (e.secondaryEmotions ?? []).some((tag) => g.terms.includes(tag)),
  );
  return bySecond?.id;
}
