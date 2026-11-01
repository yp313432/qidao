"use client";

import { useMemo } from "react";
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
          <rect x="15" y="7" width="1" height="1" />
          <rect x="16" y="6" width="1" height="1" />
          <rect x="17" y="7" width="1" height="1" />
        </g>
      );
    case "half":
      return (
        <g fill={EYE}>
          <rect x="8" y="10" width="2" height="1" />
          <rect x="15" y="10" width="2" height="1" />
        </g>
      );
    case "squint":
      return (
        <g fill={EYE}>
          <rect x="8" y="7" width="1" height="1" />
          <rect x="9" y="8" width="1" height="1" />
          <rect x="10" y="7" width="1" height="1" />
          <rect x="15" y="7" width="1" height="1" />
          <rect x="16" y="8" width="1" height="1" />
          <rect x="17" y="7" width="1" height="1" />
        </g>
      );
    case "look":
      return (
        <g fill={EYE}>
          <rect x="7" y="6" width="2" height="4" />
          <rect x="16" y="6" width="2" height="4" />
        </g>
      );
    case "heart":
      return (
        <g fill={EYE}>
          <rect x="8" y="6" width="1" height="1" />
          <rect x="10" y="6" width="1" height="1" />
          <rect x="9" y="7" width="1" height="2" />
          <rect x="15" y="6" width="1" height="1" />
          <rect x="17" y="6" width="1" height="1" />
          <rect x="16" y="7" width="1" height="2" />
        </g>
      );
    case "wide":
      return (
        <g fill={EYE}>
          <rect x="8" y="5" width="2" height="6" />
          <rect x="15" y="5" width="2" height="6" />
        </g>
      );
    case "blink":
      return (
        <g fill={EYE}>
          <rect x="8" y="9" width="2" height="1" />
          <rect x="15" y="9" width="2" height="1" />
        </g>
      );
    default:
      return (
        <g fill={EYE}>
          <rect x="8" y="6" width="2" height="4" />
          <rect x="15" y="6" width="2" height="4" />
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
        height: Math.round((size / 24) * 18),
      }}
      aria-hidden="true"
    >
      {look.fx ? <span className="crab-fx">{look.fx}</span> : null}
      <svg viewBox="0 0 24 18" width="100%" height="100%" shapeRendering="crispEdges">
        {/* 侧钳：4×4，贴在壳的中部 */}
        <g fill={SHELL}>
          <rect x="1" y="8" width="4" height="4" />
          <rect x="19" y="8" width="4" height="4" />
        </g>
        {/* 壳：14×11，接近方形（用户："之前那个身子有点扁"） */}
        <rect x="5" y="3" width="14" height="11" fill={SHELL} />
        <rect x="5" y="3" width="14" height="1" fill={SHELL_DARK} opacity="0.45" />
        {/* 四条短粗腿：2 宽 3 高（用户："手和脚太细长"） */}
        <g fill={SHELL}>
          <rect x="6" y="14" width="2" height="3" />
          <rect x="10" y="14" width="2" height="3" />
          <rect x="14" y="14" width="2" height="3" />
          <rect x="18" y="14" width="2" height="3" />
        </g>
        <g className={look.eye !== "flat" ? "crab-eyes-base" : undefined}>
          <Eyes kind="flat" />
        </g>
        {look.eye !== "flat" ? (
          <g className="crab-eyes-mood">
            <Eyes kind={look.eye} />
          </g>
        ) : null}
        <rect x="11" y="12" width="3" height="1" fill={MOUTH} />
      </svg>
    </div>
  );
}

/**
 * 组别推导：真实上报里 `group` 可能没填（演示场景就没有），
 * 所以再按主情绪 / 次情绪去 lexicon 的词表里认一下，认不出来就当没有。
 */
function groupOfEvent(e?: {
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
 */
export function DrawerMood() {
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

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-16 flex flex-col items-center">
      <CrabPixels group={gid} intensity={current?.intensity ?? 55} reduced={reduced} size={126} />
      {current && label ? (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
          他现在的情绪
          <span
            className="rounded-full px-2 py-0.5 text-[11px]"
            style={{ background: "rgba(20,17,15,.86)", color: "#f7f2ea" }}
          >
            {gid ? `${gid[0].toUpperCase()} · ${label}` : label}
          </span>
        </p>
      ) : null}
    </div>
  );
}
