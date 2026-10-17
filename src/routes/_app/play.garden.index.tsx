import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useMemo } from "react";
import { resolveAiName } from "@/lib/branding";
import {
  GARDEN_AI,
  GARDEN_AI_LINES,
  GARDEN_BASE,
  GARDEN_SPOTS,
  GARDEN_TRAIL,
} from "@/lib/garden";
import { useApp } from "@/lib/store";
import { useActivity } from "@/lib/use-activity";

/**
 * `/play/garden` —— 花园主屏。
 *
 * 用户定的方向（原话）：
 *   "花园放在玩乐区的游戏那里，就是把游戏取代了，变成花园，因为之后游戏我打算塞到花园里"
 *   "先给我预览图，我说欧克了再修改，不要直接上手"
 *
 * 所以这一屏只有三件事：**画是全屏的、地名是题字、房间能点的才点**。
 * 不做顶部状态卡、不做底部第二套导航（App 自己的底部导航在这里本来就被隐藏 ——
 * 见 lib/nav-tree 的 FULL_BLEED_PREFIXES：`/play/` 开头都是整屏页）。
 */
export const Route = createFileRoute("/_app/play/garden/")({
  component: GardenView,
});

/** 今天他说哪句（按日期取，不用随机 —— 同一份画面反复渲染结果要一致） */
function lineOfToday() {
  const now = new Date();
  const day = Math.floor(now.getTime() / 86_400_000);
  return GARDEN_AI_LINES[day % GARDEN_AI_LINES.length]!;
}

function GardenView() {
  useActivity("在花园里");
  const aiName = useApp((s) => resolveAiName(s.settings.aiName));
  const aiAvatar = useApp((s) => s.settings.aiAvatar);
  const line = useMemo(() => lineOfToday(), []);

  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-[#f6dfe6]">
      {/* 底图：换图只覆盖 public/garden/base.jpg，见 lib/garden 顶部注释 */}
      <img
        src={GARDEN_BASE}
        alt=""
        aria-hidden="true"
        className="garden-scene absolute inset-0 size-full object-cover"
      />

      {/* 发丝线石板路 + 三个时刻（还没做时间线页，所以只是地标，不接点击） */}
      <div className="pointer-events-none absolute inset-0">
        <svg
          className="absolute inset-0 size-full"
          viewBox="0 0 390 844"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d={GARDEN_TRAIL.d}
            fill="none"
            stroke="rgba(47,38,26,.42)"
            strokeWidth="1.1"
            strokeDasharray="2.5 6.5"
            strokeLinecap="round"
          />
        </svg>
        {GARDEN_TRAIL.marks.map((m) => (
          <span
            key={m.t}
            className="garden-trail-t"
            style={{ left: `${(m.x / 390) * 100}%`, top: `${(m.y / 844) * 100}%` }}
          >
            {m.t}
          </span>
        ))}
        <Link
          to={GARDEN_TRAIL.label.to}
          className="garden-spot garden-spot-live"
          aria-label={`看${GARDEN_TRAIL.label.zh}`}
          style={{ left: `${GARDEN_TRAIL.label.x}%`, top: `${GARDEN_TRAIL.label.y}%` }}
        >
          <span className="zh">{GARDEN_TRAIL.label.zh}</span>
          <span className="la">{GARDEN_TRAIL.label.la}</span>
        </Link>
      </div>

      {/*
        页眉铭牌 + 返回。
        返回钮放在 <header> 里：`verify-hierarchy.mjs` 靠
        `header a[aria-label^="返回"]` 对账"上一级对不对"，别挪出 header。
      */}
      <header
        className="absolute inset-x-0 top-0 z-20"
        style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}
      >
        <div className="relative flex h-11 items-center justify-center gap-4 px-[54px]">
          <Link
            to="/play"
            aria-label="返回玩乐"
            className="absolute left-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center text-[#4a3a2c]/85"
          >
            <ChevronLeft className="size-6" strokeWidth={1.4} />
          </Link>
          <span className="garden-rule" />
          <div className="shrink-0 text-center">
            <p className="garden-plaque">花 园</p>
            <p className="garden-plaque-la">GIARDINO</p>
          </div>
          <span className="garden-rule" />
        </div>
      </header>

      {/* 五个房间的地名（有 to 的能点：棋桌、池塘；其余只是画上的题字） */}
      {GARDEN_SPOTS.map((s) => {
        const inner = (
          <>
            <span className="zh">{s.zh}</span>
            <span className="la">{s.la}</span>
          </>
        );
        const style = { left: `${s.x}%`, top: `${s.y}%` };
        return s.to ? (
          <Link
            key={s.id}
            to={s.to}
            style={style}
            className="garden-spot garden-spot-live"
            aria-label={`去${s.zh}`}
          >
            {inner}
          </Link>
        ) : (
          <span key={s.id} style={style} className="garden-spot">
            {inner}
          </span>
        );
      })}

      {/* 他在这儿：头像 + 名字 + 一句安静的话（不是"状态卡"，就是画上的一处） */}
      <div
        className="garden-ai absolute z-20 flex items-center gap-2.5"
        style={{ left: `${GARDEN_AI.x}%`, top: `${GARDEN_AI.y}%` }}
      >
        <span className="garden-avatar">
          {aiAvatar ? <img src={aiAvatar} alt="" className="size-full rounded-full object-cover" /> : aiName.slice(0, 1)}
        </span>
        <span className="min-w-0">
          <span className="garden-ai-name">
            {aiName} · {GARDEN_AI.place}
          </span>
          <span className="garden-ai-say">{line}</span>
        </span>
      </div>
    </div>
  );
}
