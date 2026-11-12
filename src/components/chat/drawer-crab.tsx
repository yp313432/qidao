"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LEXICON } from "@/plugins/emotion-lifeform/lib/emotion/lexicon";
import { activeScenes } from "@/plugins/emotion-lifeform/lib/emotion/scenes";
import { toEmotionEvents } from "@/plugins/emotion-lifeform/lib/emotion/qidao-scenes";
import { useApp } from "@/lib/store";
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
 * 再后来对着自己的参考图又提了一条：
 *   "螃蟹按照这个标准来，之前那个有点身子有点扁，手和脚太细长了"
 *   → 身体从 14×7 改成 **14×11（接近方形）**，腿从 1×4 的细长条改成 **2×3 的短粗腿**，
 *     眼睛从 2×3 改成 **2×4 的高眼睛**，侧钳加到 4×4 —— 整体比上一版"敦"很多。
 *
 * 所以这文件里只有一只**永远橙色**的像素蟹：
 *   · 24×18 的整数格，硬边（crispEdges），放大不糊；
 *   · 颜色只有三个：主体 #ff8a5c、暗部 #d8653c、眼睛 #3a241d；
 *   · 十种情绪靠**动作 + 眼睛/嘴的形状 + 一个小符号**区分，不换色；
 *   · 眼睛是**两层**：横线眼常驻，情绪眼按周期淡入淡出 ——
 *     用户要"能看出动画"，所以能真的看到"横线眼 → 弯眼 → 横线眼"的切换。
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
        {/*
          比例按用户 2026-11-01 的定稿：
            · 身子**横向拉长**（16×9，不是正方形）
            · 两只手（侧钳）小一点：3×3
        */}
        <g fill={SHELL}>
          <rect className="crab-claw crab-claw-left" x="0" y="8" width="3" height="3" />
          <rect className="crab-claw crab-claw-right" x="21" y="8" width="3" height="3" />
        </g>
        {/* 壳：18×8，按用户参考图的比例（宽:高 ≈ 2.25:1） */}
        <rect x="3" y="3" width="18" height="10" fill={SHELL} />
        <rect x="3" y="3" width="18" height="1" fill={SHELL_DARK} opacity="0.45" />
        {/*
          四条短粗腿：2 宽 3 高，**全部落在壳的范围内**（壳 x=5..19）。
          2026-11-01 用户："四条腿没做好" —— 原来 x=18 那条伸出壳外半个像素格，
          看起来最右边那条腿是"挂"在外面的，所以改成对称的 6/9/13/16。
        */}
        <g className="crab-legs" fill={SHELL}>
          {/* 对称轴是壳的中心 x=12：5 与 17、8 与 14 互为镜像，左右各留 2 格 */}
          <rect className="crab-leg crab-leg-a" x="5" y="13" width="2" height="4" />
          <rect className="crab-leg crab-leg-b" x="8" y="13" width="2" height="4" />
          <rect className="crab-leg crab-leg-b" x="14" y="13" width="2" height="4" />
          <rect className="crab-leg crab-leg-a" x="17" y="13" width="2" height="4" />
        </g>
        {/* 眨眼：单独一层 React 状态驱动（170ms），比 CSS 周期动画干净；
            用户要"能看出动画"，所以情绪眼常显、到点眨一下。 */}
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

/** 组别的中文名（去掉 lexicon 里 "A. " 这种前缀） */
export function groupName(id?: string): string {
  const g = LEXICON.find((x) => x.id === id);
  if (!g) return "";
  return g.title.replace(/^[A-Z]\.\s*/, "");
}

/**
 * 抽屉里「他现在的情绪」这一块：像素蟹 + 底下一个小标签。
 * 没有情绪记录时只显示螃蟹（安静状态），不显示标签。
 *
 * `className` 是给「挪到对话页」用的（第 3 条）：抽屉里它是贴着底部的 absolute，
 * 到对话页要换位置，由调用方传类名、CSS 覆盖定位；不传就还是原来抽屉里那样。
 */
export function DrawerMood({ className }: { className?: string } = {}) {
  const scenes = useEmotionStore((s) => s.scenes);
  const sceneId = useEmotionStore((s) => s.sceneId);
  const settings = useEmotionStore((s) => s.settings);

  // 真数据从宿主 store 拿：抽屉可能比情绪插件先挂载，插件的 store 那时还是空的，
  // 所以不能只依赖 useEmotionStore().scenes（那样会一直显示演示场景里的"平静"）。
  const events = useApp((s) => s.emotionEvents);
  const current = useMemo(() => {
    const real = toEmotionEvents(events ?? []);
    if (real.length) {
      return [...real].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0];
    }
    const list = scenes.length ? scenes : activeScenes();
    return list.find((s) => s.eventId === sceneId) ?? list[0];
  }, [events, scenes, sceneId]);

  const reduced = Boolean(settings.reducedMotion);
  const gid = groupOfEvent(current);
  const label = current ? groupName(gid) : "";

  /**
   * 桌宠：点它一下，头顶冒一个情绪气泡（只写情绪词），3 秒自己收。
   * 用户 2026-11-01："我点击它，它头顶上冒出现在的情绪，不用再下面加解释"，"不用跳转"。
   */
  const [bubble, setBubble] = useState(false);
  const bubbleTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(bubbleTimer.current), []);
  const poke = () => {
    if (!label) return;
    setBubble(true);
    window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(false), 3000);
  };

  return (
    <div
      className={["pointer-events-none absolute inset-x-0 bottom-16 flex flex-col items-center", className]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={`relative ${reduced ? "" : "crab-roam"}`}>
        {bubble ? <span className="crab-bubble">{label}</span> : null}
        <button
          type="button"
          onClick={poke}
          aria-label={label ? `他现在的情绪：${label}` : "戳一下他"}
          className="pointer-events-auto block"
        >
          <CrabPixels group={gid} intensity={current?.intensity ?? 55} reduced={reduced} size={126} />
        </button>
      </div>
    </div>
  );
}
