import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ArrowUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { resolveAiName } from "@/lib/branding";
import type { ChatRequest } from "@/lib/chat-client";
import { streamChat } from "@/lib/chat-client";
import { CHESS_EPIGRAPH, GARDEN_BASE } from "@/lib/garden";
import { aiMove, BOARD, boardFull, emptyBoard, idx, lineOfFive, type Point, type Stone } from "@/lib/gobang";
import { useApp } from "@/lib/store";
import { useActivity } from "@/lib/use-activity";
import { stripActions } from "@/lib/use-chat";
import { cn } from "@/lib/utils";

/**
 * `/play/garden/qi` —— 棋桌：**陪伴式**五子棋。
 *
 * 用户要的形态（原话）：
 *   "我要陪伴式的花园，下五子棋的时候，我们要能对话，就是界面左右是各自的头像，
 *    头像上面是聊天气泡，文字从左到右逐渐浮现，上面的文字往上走消失在气泡界限里，
 *    防止他发的内容太多导致气泡直接塞满整个屏幕，我们是可以实时对话的，
 *    显示当前该谁下了，可以留个对战记录"
 *
 * 所以：棋盘只占下半屏，上半屏全是「他和我」的对话空间；
 * 气泡区能往上翻（用户 m01840：他写得快，看不完就没了）；
 * 底部输入框随时能跟他说话 —— 走的是**跟主对话同一条上游**（lib/chat-client）。
 *
 * ⚠️ 2026-10 用户 m01840 的要求，别再加回来：
 *   · **不要示例开场对话**（"坐下吧，今天不赶时间"那种）—— 他说的每句都必须是模型真的说的
 *   · **不要中途随机台词**（每 4 手塞一句 AI_TALK）—— 同上
 *   · 气泡里**不能出现动作参数**（`{"kind":"emotion.report",…}`、``` 围栏）——
 *     走 `stripActions` 洗一遍再显示，跟主对话一个规矩
 *   · 这些对话要**并回主对话**（`appendGardenTalk`），不然一局下完问他，他不知道
 */
export const Route = createFileRoute("/_app/play/garden/qi")({
  component: ChessTable,
});

type Side = "ai" | "me";
type Bubble = { id: number; side: Side; text: string; streaming?: boolean };
type Phase = "play" | "win" | "lose" | "draw";

const STARS: Point[] = [
  { r: 3, c: 3 },
  { r: 3, c: 11 },
  { r: 11, c: 3 },
  { r: 11, c: 11 },
  { r: 7, c: 7 },
];

/**
 * 一局结束该不该开口、说什么 —— 交给模型，不用写死台词。
 * （只给一句"发生了什么"的提示，不替他编话。）
 */
function endingNote(phase: Exclude<Phase, "play">, aiName: string): string {
  if (phase === "win") return `（这一局我赢了，你连成五子。不用安慰我，说一句就好。）`;
  if (phase === "lose") return `（这一局${aiName}赢了，他连成五子。说一句就好。）`;
  return `（棋盘满了，和棋。说一句就好。）`;
}

/*
 * 逐字浮现交给上游的流式输出（`d.content` 一块块到）—— 以前这里还有一个
 * `Typed` 组件做二次打字机，结果是"流完再从第一个字重打一遍"，看着像闪回。
 * 用户 m01840 说"他写得快、看不完就没了"，所以：字随流出来即可，别再重打。
 */

function ChessTable() {
  useActivity("在花园的棋桌边下五子棋");

  const aiName = useApp((s) => resolveAiName(s.settings.aiName));
  const aiAvatar = useApp((s) => s.settings.aiAvatar);
  const myAvatar = useApp((s) => s.settings.userAvatar);
  const myName = useApp((s) => s.settings.displayName);
  const stats = useApp((s) => s.gameStats.gobang);

  const [board, setBoard] = useState<Stone[]>(() => emptyBoard());
  const [last, setLast] = useState<Point | null>(null);
  /** 每一手都记下来：主对话里他能说出"你在 H8 落子"这种细节 */
  const [moves, setMoves] = useState<Array<{ side: Side; r: number; c: number }>>([]);
  const [phase, setPhase] = useState<Phase>("play");
  const [busy, setBusy] = useState(false);

  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const nextId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  /** 气泡区：默认贴着底，往上翻的时候别被新消息拽回去 */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);

  const aiNameRef = useRef(aiName);
  aiNameRef.current = aiName;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (atBottom.current) el.scrollTop = el.scrollHeight;
  }, [bubbles]);

  /**
   * 把棋局 + 刚才的对话同步给感知层。
   *
   * 用户 m01220 的原话："不管我在哪里跟他说话，都是和主页面相通的，五子棋那个我问他，
   * 他只知道我去了花园，但是干了什么，棋局状态和说的话就不知道。"
   * → 所以这里写的 detail 必须够他回答"下到哪了、谁占优、你刚说了什么"，
   *   而不是一句"轮到我"。
   */
  useEffect(() => {
    const black = board.filter((x) => x === 1).length;
    const white = board.filter((x) => x === 2).length;
    const total = stats.win + stats.loss + stats.draw;
    const no = total + (phase === "play" ? 1 : 0);
    const coord = (r: number, c: number) => `${"ABCDEFGHIJKLMNO"[c] ?? "?"}${r + 1}`;
    const recent = moves
      .slice(-4)
      .map((m) => `${m.side === "me" ? "你" : "我"} ${coord(m.r, m.c)}`)
      .join("、");
    const state =
      phase === "win"
        ? "这局你赢了"
        : phase === "lose"
          ? "这局我赢了"
          : phase === "draw"
            ? "这局和棋"
            : busy
              ? `我在想落哪（轮到我）`
              : "轮到你落子";
    const talk = bubbles
      .slice(-3)
      .map((b) => `${b.side === "me" ? "你" : "我"}：${b.text.replace(/\s+/g, " ").slice(0, 40)}`)
      .join(" / ");
    useApp.getState().setGameContext({
      game: "五子棋",
      detail:
        `第 ${no} 局 · 你执黑、我执白 · 已落 ${black + white} 手（黑 ${black} 白 ${white}）· ${state}` +
        (recent ? ` · 最后几手：${recent}` : "") +
        ` · 战绩：你 ${stats.win} 胜 ${stats.loss} 负 ${stats.draw} 和` +
        (talk ? ` · 刚才在棋桌说的话：${talk}` : ""),
    });
  }, [board, phase, busy, aiName, moves, bubbles, stats]);

  const ended = phase !== "play";
  const stoneCount = useMemo(() => board.filter((x) => x !== 0).length, [board]);

  function reset() {
    setBoard(emptyBoard());
    setLast(null);
    setMoves([]);
    setPhase("play");
    setBusy(false);
  }

  function playAt(r: number, c: number) {
    if (phase !== "play" || busy) return;
    if (board[idx(r, c)]) return;
    const next = board.slice();
    next[idx(r, c)] = 1;
    const win = lineOfFive(next, r, c);
    setBoard(next);
    setLast({ r, c });
    setMoves((m) => [...m, { side: "me", r, c }]);
    if (win) {
      finish("win");
      return;
    }
    if (boardFull(next)) {
      finish("draw");
      return;
    }
    setBusy(true);
    window.setTimeout(() => {
      const mv = aiMove(next, 2);
      const after = next.slice();
      after[idx(mv.r, mv.c)] = 2;
      const aiWin = lineOfFive(after, mv.r, mv.c);
      setBoard(after);
      setLast(mv);
      setMoves((m) => [...m, { side: "ai", r: mv.r, c: mv.c }]);
      setBusy(false);
      if (aiWin) {
        finish("lose");
        return;
      }
      if (boardFull(after)) {
        finish("draw");
        return;
      }
    }, 240);
  }

  /**
   * 一局结束：记账 + **让他说一句真的**。
   * 以前这里写死了三句台词（REACTION），用户 m01840 明确不要那种"手写的旁白"。
   */
  function finish(p: Exclude<Phase, "play">) {
    setPhase(p);
    useApp.getState().recordGame(p === "win" ? "win" : p === "lose" ? "loss" : "draw");
    window.setTimeout(() => {
      void talk({ note: endingNote(p, aiNameRef.current) });
    }, 420);
  }

  /**
   * 跟他说一句（`text`），或者只让他对某件事开口（`note`，不显示成你的话）。
   *
   * 显示出去的文字先过 `stripActions`：模型爱在正文后面挂一段
   * `{"kind":"emotion.report",…}`，主对话里早洗掉了，棋桌这边以前没洗，
   * 用户 m01839 的截图里就漏出来一大坨参数。
   */
  async function talk({ text, note }: { text?: string; note?: string }) {
    if (sending) return;
    const said = text?.trim();
    if (!said && !note) return;
    if (said) setDraft("");
    if (said) {
      const meId = nextId.current++;
      setBubbles((prev) => [...prev, { id: meId, side: "me" as const, text: said }].slice(-60));
    }

    const st = useApp.getState();
    const setting = st.settings;
    const history = bubbles
      .filter((b) => !b.streaming && b.text)
      .slice(-14)
      .map((b) => ({
        role: b.side === "me" ? ("user" as const) : ("assistant" as const),
        content: b.text,
      }));

    const bubbleId = nextId.current++;
    setBubbles((prev) =>
      [...prev, { id: bubbleId, side: "ai" as const, text: "", streaming: true }].slice(-60),
    );
    setSending(true);

    const ac = new AbortController();
    abortRef.current = ac;
    let acc = "";
    /** 这一轮是不是"上游没通/报错"——那种提示不该当成他说的话存进主对话 */
    let failed = false;
    const req: ChatRequest = {
      model: st.model,
      messages: [...history, { role: "user", content: said || note || "" }],
      style: setting.replyStyle,
      tools: [],
      customBaseUrl: setting.customBaseUrl || undefined,
      customApiKey: setting.customApiKey || undefined,
      upstreamModel: setting.upstreamModel || undefined,
      maxTokens: setting.maxTokens,
      name: setting.displayName,
      aiName: aiNameRef.current,
      persona: setting.persona || undefined,
      context: {
        // 棋盘状态直接写进上下文：他此刻能看到"下到第几手、谁在哪落的子"
        activity:
          "在花园的棋桌边和我下五子棋。当前局面：" +
          `黑子(你)${board.filter((x) => x === 1).length} 颗、白子(我)${board.filter((x) => x === 2).length} 颗；` +
          (moves.length
            ? `最后几手：${moves
                .slice(-4)
                .map((m) => `${m.side === "me" ? "你" : "我"}在${"ABCDEFGHIJKLMNO"[m.c] ?? "?"}${m.r + 1}落子`)
                .join("，")}；`
            : "还没落子；") +
          (phase === "play"
            ? board.filter((x) => x !== 0).length % 2 === 0
              ? "轮到你落子。"
              : "轮到我落子。"
            : "这局已经结束。"),
        now: new Date().toLocaleString("zh-CN"),
      },
      permissions: setting.permissions,
    };

    try {
      await streamChat(
        req,
        (d) => {
          if (d.error) {
            // 一句人话直接落进气泡（没接模型 / 上游报错都是这条路）
            failed = true;
            acc = acc || d.error;
            setBubbles((prev) =>
              prev.map((b) => (b.id === bubbleId ? { ...b, text: stripActions(acc) } : b)),
            );
          }
          if (d.content) {
            acc += d.content;
            setBubbles((prev) =>
              prev.map((b) => (b.id === bubbleId ? { ...b, text: stripActions(acc) } : b)),
            );
          }
          if (d.done) {
            setBubbles((prev) =>
              prev.map((b) => (b.id === bubbleId ? { ...b, streaming: false } : b)),
            );
          }
        },
        ac.signal,
      );
    } catch {
      /* 上面已经把错误写进气泡了 */
    } finally {
      setSending(false);
      abortRef.current = null;
      const clean = stripActions(acc).trim();
      setBubbles((prev) =>
        prev
          .map((b) => (b.id === bubbleId ? { ...b, text: clean, streaming: false } : b))
          .filter((b) => b.side === "me" || b.text),
      );
      // 并回主对话：一局下完，主对话里问他"刚才那局怎么样"他要答得出来
      // （没接模型/报错的那种提示不算他说的话，不落库）
      if (clean && !failed) {
        useApp.getState().appendGardenTalk([
          ...(said ? [{ role: "user" as const, content: said }] : []),
          { role: "assistant" as const, content: clean },
        ]);
      }
    }
  }

  const send = () => void talk({ text: draft });

  useEffect(() => () => abortRef.current?.abort(), []);

  const lastN = BOARD - 1;
  const round = stats.win + stats.loss + stats.draw + 1;

  return (
    <div className="qi">
      <img src={GARDEN_BASE} alt="" aria-hidden="true" className="qi-bg" />
      <div className="qi-veil" aria-hidden="true" />

      {/* 返回花园（放 <header> 里，verify-hierarchy 靠它核对上一级） */}
      <header
        className="absolute left-0 top-0 z-20"
        style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}
      >
        <Link
          to="/play/garden"
          aria-label="返回花园"
          className="flex size-10 items-center justify-center text-[#F7F0E2]/85"
        >
          <ChevronLeft className="size-6" strokeWidth={1.4} />
        </Link>
      </header>

      {/* 对战记录（这一版只显示，历史列表不做） */}
      <div className="qi-rec">
        对战记录
        <b>
          第 {round} 局 · 你 {stats.win} : {stats.loss} {aiName}
        </b>
      </div>

      {/* 顶部题词 */}
      <div className="qi-epi">
        <svg className="mx-auto mb-[9px] block h-[23px] w-[126px]" viewBox="0 0 132 24" fill="none" aria-hidden="true">
          <path d="M2 12H46" stroke="rgba(250,243,229,.5)" strokeWidth=".8" />
          <path d="M86 12H130" stroke="rgba(250,243,229,.5)" strokeWidth=".8" />
          <g stroke="rgba(250,243,229,.62)" strokeWidth=".9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M66 3.2v4.2M64 5.3h4" />
            <path d="M62.4 10.4c-.7 2.2-1.1 4.4-1.3 6.6h9.8c-.2-2.2-.6-4.4-1.3-6.6" />
            <path d="M60 20.6h12" />
          </g>
          <circle cx="53" cy="12" r="1.1" fill="rgba(250,243,229,.55)" />
          <circle cx="79" cy="12" r="1.1" fill="rgba(250,243,229,.55)" />
        </svg>
        <p className="it">{CHESS_EPIGRAPH.it}</p>
        <p className="cn">{CHESS_EPIGRAPH.cn}</p>
      </div>

      {/*
        一条时间线，左右分边；**能往上翻**（用户 m01840：他写得又快又多，
        看不及就被顶走了）。默认贴底，翻上去之后就不再被新消息拽回底部。
      */}
      <div
        className="qi-scroll"
        aria-live="polite"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
        }}
      >
        {bubbles.map((b) => (
          <div key={b.id} className={cn("qi-row", b.side === "me" ? "qi-row-me" : "qi-row-ai")}>
            <div className="qi-bub">
              {b.text}
              {b.streaming && <span className="qi-caret" />}
            </div>
          </div>
        ))}
        {bubbles.length === 0 && (
          <p className="qi-hint">棋盘摆好了。落子，或者先说句话。</p>
        )}
      </div>

      {/* 两个头像 */}
      <div className="qi-avrow">
        <div className="flex items-center">
          <span className="qi-av">
            {aiAvatar ? (
              <img src={aiAvatar} alt="" className="size-full object-cover" />
            ) : (
              aiName.slice(0, 1)
            )}
          </span>
          <span className="qi-av-name">
            {aiName}
            <em>seduto</em>
          </span>
        </div>
        <div className="flex items-center">
          <span className="qi-av-name qi-av-name-me">
            {myName || "我"}
            <em>io</em>
          </span>
          <span className="qi-av">
            {myAvatar ? (
              <img src={myAvatar} alt="" className="size-full object-cover" />
            ) : (
              (myName || "我").slice(0, 1)
            )}
          </span>
        </div>
      </div>

      {/* 该谁下了 */}
      <div className="qi-status">
        <p className="qi-status-k">{ended ? "FINITA" : busy ? "PENSA" : "TOCCA A TE"}</p>
        <p className="qi-status-t">
          {phase === "win"
            ? "你连成五子"
            : phase === "lose"
              ? `${aiName}连成五子`
              : phase === "draw"
                ? "和棋"
                : busy
                  ? `${aiName}在想`
                  : "轮到你 · 你执黑"}
        </p>
        {ended && (
          <button type="button" onClick={reset} className="qi-again">
            再来一局
          </button>
        )}
      </div>

      {/* 棋盘 */}
      <div className="qi-board">
        <svg viewBox={`0 0 ${lastN} ${lastN}`} aria-hidden="true">
          {Array.from({ length: BOARD }, (_, i) => (
            <g key={i}>
              <line x1={i} y1={0} x2={i} y2={lastN} stroke="#8a6b47" strokeOpacity="0.4" strokeWidth="0.035" />
              <line x1={0} y1={i} x2={lastN} y2={i} stroke="#8a6b47" strokeOpacity="0.4" strokeWidth="0.035" />
            </g>
          ))}
          {STARS.map((p) => (
            <circle key={`${p.r}-${p.c}`} cx={p.c} cy={p.r} r="0.1" fill="#8a6b47" fillOpacity="0.5" />
          ))}
        </svg>
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
              className="qi-cell"
              style={{ left: `${6 + (c / lastN) * 88}%`, top: `${6 + (r / lastN) * 88}%` }}
            >
              {s !== 0 && (
                <span
                  className={cn(
                    "qi-stone",
                    s === 1 ? "qi-stone-black" : "qi-stone-white",
                    isLast && "qi-stone-last",
                  )}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* 随时能跟他说一句 */}
      <form
        className="qi-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={sending ? "他在写…" : "跟他说点什么…"}
          disabled={sending}
          enterKeyHint="send"
          className="placeholder:text-[#3b3227]/45"
        />
        <button type="submit" aria-label="发送" className="qi-send" disabled={!draft.trim() || sending}>
          <ArrowUp className="size-4" strokeWidth={1.6} />
        </button>
      </form>
      <span className="sr-only">{stoneCount} 手</span>
    </div>
  );
}
