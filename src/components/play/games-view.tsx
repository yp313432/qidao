import { Link } from "@tanstack/react-router";
import { ChevronRight, Grid3x3, Spade } from "lucide-react";
import { SceneBackdrop } from "@/components/background-layer";
import { PlayHeader } from "@/components/play-header";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * 「小游戏」分区 —— 玩乐区下面的一个**子分区**，不是单个房间。
 *
 * 用户："把五子棋放到真心话那里，他们俩做成一个分区叫小游戏，
 *       点进去有这两个游戏，后续我还要加小游戏类型的。"
 *
 * 所以这一页是**游戏菜单**：跟「小日子」同一套卡片写法（ToolCard 的规格搬过来），
 * 以后加新游戏就往 GAMES 里加一条，不用再设计一次版式。
 */
const GAMES: {
  to: string;
  title: string;
  desc: string;
  /** 一句话说清"跟谁玩、玩什么"——以后加游戏也照这个格式写 */
  icon: React.ReactNode;
  tone: string;
}[] = [
  {
    to: "/play/games/gobang",
    title: "五子棋",
    desc: "跟他下一局",
    icon: <Grid3x3 className="size-5" strokeWidth={1.6} />,
    tone: "from-amber-200/50 via-transparent to-rose-200/25",
  },
  {
    to: "/play/games/truth",
    title: "真心话",
    desc: "抽一张，回答他",
    icon: <Spade className="size-5" strokeWidth={1.6} />,
    tone: "from-violet-200/50 via-transparent to-sky-200/25",
  },
];

export function GamesView() {
  const settings = useApp((s) => s.settings);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SceneBackdrop image={settings.diaryImage} />
      <PlayHeader title="小游戏" />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-above-nav">
        <p className="text-center text-[10px] tracking-[0.28em] text-subtle uppercase">
          little games
        </p>
        <p className="mt-2 px-2 text-center text-[12px] leading-5 text-muted">
          赢不赢都行，主要是跟你待一会儿。
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {GAMES.map((g, i) => (
            <GameCard key={g.to} {...g} wide={GAMES.length % 2 === 1 && i === 0} />
          ))}
        </div>

        <p className="mt-10 text-center text-[10px] tracking-[0.28em] text-subtle uppercase">
          play a while
        </p>
      </div>
    </div>
  );
}

/**
 * 卡片规格跟「小日子」的 ToolCard **完全一致**（圆角 1.6rem、内边距 16、
 * 图标块 40、标题 15、说明 11）——
 * 这就是"造组件只有一套写法"：同类卡片不重新设计一遍。
 */
function GameCard({
  to,
  title,
  desc,
  icon,
  tone,
  wide = false,
}: {
  to: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
  tone: string;
  wide?: boolean;
}) {
  return (
    <Link
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      to={to as any}
      className={cn(
        "aster-card relative overflow-hidden rounded-[1.6rem] border border-line px-4 py-4",
        wide && "col-span-2",
      )}
    >
      <span className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br", tone)} />
      <span className="relative flex items-start justify-between gap-2">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-elevated text-accent">
          {icon}
        </span>
        <ChevronRight className="mt-2 size-4 text-subtle" />
      </span>
      <span className="relative mt-3 block">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-muted">{desc}</span>
      </span>
    </Link>
  );
}
