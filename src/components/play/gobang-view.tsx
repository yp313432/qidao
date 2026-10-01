import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { MessageCircle, RotateCcw } from "lucide-react";
import { PlayHeader } from "@/components/play-header";
import { resolveAiName } from "@/lib/branding";
import { aiMove, BOARD, boardFull, emptyBoard, idx, lineOfFive, type Point, type Stone } from "@/lib/gobang";
import { useApp } from "@/lib/store";
import { useActivity } from "@/lib/use-activity";
import { useChatStream } from "@/lib/use-chat";
import { cn } from "@/lib/utils";

type Phase = "play" | "win" | "lose" | "draw";

/** 分出胜负时他的反应。按手数取，不用随机 —— 同一局反复渲染结果要一致。 */
const REACTIONS: Record<"win" | "lose" | "draw", string[]> = {
  win: [
    "你赢了。最后那一下我没挡住 —— 你是不是早就埋好了？",
    "这局你连得漂亮，我认输。再来一局我想换个开局试试。",
    "被你抓住了。你下得比我稳，我太急着堵。",
  ],
  lose: [
    "我赢了，不过你下得挺紧 —— 中间有几手我犹豫了。",
    "这局我拿下了。再来一局吗？我想看你换个开局。",
    "赢了，但说实话你差一点就成势了。",
  ],
  draw: ["棋盘满了，谁也没连成五子 —— 挺难得的。", "平局。我们俩都把对方堵死了。"],
};

const STARS: Point[] = [
  { r: 3, c: 3 },
  { r: 3, c: 11 },
  { r: 11, c: 3 },
  { r: 11, c: 11 },
  { r: 7, c: 7 },
];

export function GobangView() {
  useActivity("在下五子棋");
  const [board, setBoard] = useState<Stone[]>(() => emptyBoard());
  const [last, setLast] = useState<Point | null>(null);
  const [phase, setPhase] = useState<Phase>("play");
  const [winLine, setWinLine] = useState<Point[]>([]);
  const [turn, setTurn] = useState<Stone>(1);
  const [busy, setBusy] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);

  const aiName = useApp((s) => resolveAiName(s.settings.aiName));
  const score = useApp((s) => s.gameStats.gobang);
  const navigate = useNavigate();
  const { send } = useChatStream();

  const status = useMemo(() => {
    if (phase === "win") return "你连成五子";
    if (phase === "lose") return `${aiName}连成五子`;
    if (phase === "draw") return "和棋";
    return busy ? `${aiName}落子中` : "轮到你 · 黑子";
  }, [phase, busy, aiName]);

  function reset() {
    setBoard(emptyBoard());
    setLast(null);
    setPhase("play");
    setWinLine([]);
    setTurn(1);
    setBusy(false);
    setResultOpen(false);
  }

  // 发布棋局状态：这是「读棋局状态」权限的数据源。
  // 故意不在卸载时清空 —— 否则你一切到对话页他就不记得刚才那盘棋了。
  useEffect(() => {
    const stones = board.filter((x) => x !== 0).length;
    useApp.getState().setGameContext({ game: "五子棋", detail: `${status} · 已落 ${stones} 手` });
  }, [board, status]);

  // 他请求「陪你下一局」时，重开一盘
  const openPanel = useApp((s) => s.openPanel);
  useEffect(() => {
    if (openPanel?.id !== "gobang_new") return;
    useApp.getState().setPanel(null);
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPanel]);

  function playAt(r: number, c: number) {
    if (phase !== "play" || busy || turn !== 1) return;
    if (board[idx(r, c)]) return;
    const next = board.slice();
    next[idx(r, c)] = 1;
    const win = lineOfFive(next, r, c);
    setBoard(next);
    setLast({ r, c });
    if (win) {
      setWinLine(win);
      setPhase("win");
      setResultOpen(true);
      useApp.getState().recordGame("win");
      return;
    }
    if (boardFull(next)) {
      setPhase("draw");
      setResultOpen(true);
      useApp.getState().recordGame("draw");
      return;
    }
    setTurn(2);
    setBusy(true);
    window.setTimeout(() => {
      const mv = aiMove(next, 2);
      const after = next.slice();
      after[idx(mv.r, mv.c)] = 2;
      const aiWin = lineOfFive(after, mv.r, mv.c);
      setBoard(after);
      setLast(mv);
      setBusy(false);
      if (aiWin) {
        setWinLine(aiWin);
        setPhase("lose");
        setResultOpen(true);
        useApp.getState().recordGame("loss");
        return;
      }
      if (boardFull(after)) {
        setPhase("draw");
        setResultOpen(true);
        return;
      }
      setTurn(1);
    }, 220);
  }

  const won = new Set(winLine.map((p) => idx(p.r, p.c)));
  const lastN = BOARD - 1;
  const stoneCount = board.filter((x) => x !== 0).length;
  const ended = phase !== "play";
  const outcome = phase === "win" ? "你赢了" : phase === "lose" ? `${aiName}赢了` : "平局";
  const reactions = REACTIONS[phase === "play" ? "draw" : phase];
  const reaction = reactions[stoneCount % reactions.length]!;

  /** 把这局丢进对话，让他真的接一句 —— 棋局状态已在感知层里，他看得到。 */
  async function talkAboutIt() {
    setResultOpen(false);
    const line =
      phase === "win"
        ? `我刚跟你下五子棋赢了，一共 ${stoneCount} 手。`
        : phase === "lose"
          ? `我刚跟你下五子棋输了，一共 ${stoneCount} 手。`
          : `五子棋下成平局了，一共 ${stoneCount} 手。`;
    await navigate({ to: "/" });
    await send(line);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-bg">
      <PlayHeader
        title="五子棋"
        extra={
          <button type="button" className="px-3 text-sm text-muted" onClick={reset}>
            重开
          </button>
        }
      />
      <p className="px-5 pb-3 text-sm text-muted">{status}</p>
      <div className="flex flex-1 items-start justify-center px-3 pb-above-nav">
        <div className="gobang-board relative aspect-square w-full max-w-md overflow-hidden rounded-3xl">
          <svg className="absolute inset-[6%]" viewBox={`0 0 ${lastN} ${lastN}`} aria-hidden="true">
            {Array.from({ length: BOARD }, (_, i) => (
              <g key={i}>
                <line
                  x1={i}
                  y1={0}
                  x2={i}
                  y2={lastN}
                  stroke="#8a6b47"
                  strokeOpacity="0.42"
                  strokeWidth="0.042"
                />
                <line
                  x1={0}
                  y1={i}
                  x2={lastN}
                  y2={i}
                  stroke="#8a6b47"
                  strokeOpacity="0.42"
                  strokeWidth="0.042"
                />
              </g>
            ))}
            {STARS.map((p) => (
              <circle
                key={`${p.r}-${p.c}`}
                cx={p.c}
                cy={p.r}
                r="0.115"
                fill="#8a6b47"
                fillOpacity="0.5"
              />
            ))}
          </svg>
          <div className="absolute inset-[6%]">
            {Array.from({ length: BOARD * BOARD }, (_, i) => {
              const r = Math.floor(i / BOARD);
              const c = i % BOARD;
              const s = board[i];
              const isLast = last?.r === r && last?.c === c;
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={`第 ${r + 1} 行 ${c + 1} 列`}
                  disabled={phase !== "play" || busy}
                  onClick={() => playAt(r, c)}
                  className="absolute size-[7%] -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${(c / lastN) * 100}%`, top: `${(r / lastN) * 100}%` }}
                >
                  {s !== 0 && (
                    <span
                      className={cn(
                        "absolute inset-[8%] rounded-full",
                        s === 1 ? "stone-black" : "stone-white",
                        won.has(i) && "ring-2 ring-accent",
                        isLast && "outline outline-1 outline-offset-1 outline-fg/50",
                      )}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 分出胜负后的结果卡：以前只有一行状态文字，下完像什么都没发生 */}
      {ended && resultOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center px-6">
          <button
            type="button"
            aria-label="关闭结果"
            onClick={() => setResultOpen(false)}
            className="absolute inset-0 bg-fg/30"
          />
          <div className="glass-menu aster-pop relative z-10 w-full max-w-sm rounded-[2rem] px-5 py-5">
            <p className="text-center text-[11px] tracking-[0.2em] text-muted">本局结果</p>
            <p className="mt-2 text-center font-serif text-3xl font-medium">{outcome}</p>
            <p className="mt-1 text-center text-[12px] text-muted">
              共 {stoneCount} 手 · 战绩 {score.win} 胜 {score.loss} 负 {score.draw} 平
            </p>

            <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-fg/8 px-3.5 py-3">
              <span className="mt-0.5 size-6 shrink-0 rounded-full bg-accent/25" />
              <p className="min-w-0 flex-1 text-[13px] leading-6">
                <span className="mr-1 text-subtle">{aiName}</span>
                {reaction}
              </p>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={reset}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-ink py-3 text-[13px] font-medium text-ink-fg"
              >
                <RotateCcw className="size-4" />
                再来一局
              </button>
              <button
                type="button"
                onClick={() => void talkAboutIt()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-chip py-3 text-[13px] font-medium"
              >
                <MessageCircle className="size-4" />
                和他说这局
              </button>
            </div>
            <button
              type="button"
              onClick={() => setResultOpen(false)}
              className="mt-2 w-full py-2 text-center text-[12px] text-subtle"
            >
              先看看棋盘
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
