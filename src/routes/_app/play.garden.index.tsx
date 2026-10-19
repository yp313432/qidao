import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveAiName } from "@/lib/branding";
import {
  GARDEN_AI_LINES,
  GARDEN_BASE,
  GARDEN_SPOTS,
  GARDEN_TRAIL,
} from "@/lib/garden";
import { GardenWalker } from "@/components/play/garden-walker";
import { WALK_HOME, nearestPlace, placeOf, walkMs } from "@/lib/garden-walk";
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
  const line = useMemo(() => lineOfToday(), []);

  // 他站/走到哪儿：位置存 store（跨页面、跨重启都记得）
  const walk = useApp((s) => s.gardenWalk);
  const walkTo = useApp((s) => s.walkTo);
  const stage = useRef<HTMLDivElement | null>(null);
  const [walking, setWalking] = useState(false);
  const [ms, setMs] = useState(900);
  const timer = useRef<number | null>(null);

  const go = useCallback(
    (target: { x: number; y: number; place: string }) => {
      const from = walk;
      if (Math.hypot(from.x - target.x, from.y - target.y) < 1.2) return;
      const d = walkMs(from, target);
      setMs(d);
      setWalking(true);
      walkTo(target);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setWalking(false), d + 60);
    },
    [walk, walkTo],
  );

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  // 点画面：落到最近的落脚点（花丛/水面/栏杆上没有落脚点，会被拉回最近的）
  const onStageClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = stage.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 100;
      const y = ((e.clientY - r.top) / r.height) * 100;
      const p = nearestPlace(x, y);
      go({ x: p.x, y: p.y, place: p.zh });
    },
    [go],
  );

  const place = placeOf(walk.place) ?? WALK_HOME;

  return (
    <div
      ref={stage}
      onClick={onStageClick}
      className="fixed inset-0 z-40 overflow-hidden bg-[#f6dfe6]"
    >
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
        {/*
          ⚠️ 这个 Link 外面那层是 `pointer-events-none`（虚线路径与时刻都不该吃点击），
          Link 自己必须显式 `pointer-events-auto`，否则画上有"踪迹"两个字但**点不动**
          （用户 m07120："踪迹点不开没反应"）。别把这一行删掉。
        */}
        <Link
          to={GARDEN_TRAIL.label.to}
          className="garden-spot garden-spot-live pointer-events-auto"
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

      {/* 他在这儿：会走的小人 + 名字 + 一句安静的话（不是"状态卡"，就是画上的一处） */}
      <GardenWalker
        x={walk.x}
        y={walk.y}
        face={place.face}
        walking={walking}
        ms={ms}
        name={`${aiName} · ${walk.place}`}
        say={line}
      />
      {/* 水印遮罩：让点击落到舞台上，同时不挡底部返回区 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#f6dfe6]/45 to-transparent" />
    </div>
  );
}
