import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { resolveAiName } from "@/lib/branding";
import type { ChatRequest } from "@/lib/chat-client";
import { CHESS_EPIGRAPH, GARDEN_BASE } from "@/lib/garden";
import { gardenTurn } from "@/lib/garden-play";
import { BOARD } from "@/lib/gobang";
import { boardOf, useApp } from "@/lib/store";
import { useActivity } from "@/lib/use-activity";
import { stripActions } from "@/lib/use-chat";
import { cn } from "@/lib/utils";

/**
 * `/play/garden/qi` —— 棋桌：**他自己下**的陪伴式五子棋。
 *
 * 用户的两轮要求叠在一起：
 *   · m01840（语气与显示）：不要示例开场、不要随机台词、气泡里别漏动作参数、
 *     气泡区要能往上翻、这些对话要并回主对话上下文。
 *   · m02156（谁在下棋）："ai 不能控制棋局，是程序在下，我要的是 ai 自己下，
 *     他能控制下哪里，比如我要他让我两手，他就不下子。"
 *
 * 所以现在的分工是：
 *   页面 = 棋盘 + 气泡 + 输入框，**不代下**；
 *   你落一手 → 轮到他 → 这里发一次模型请求（带完整局面），
 *   他想下就在回复末尾写 `{"kind":"garden.gomoku.play","x":8,"y":8}`，
 *   `gardenTurn` 把它执行掉（过权限闸门）→ store 里的棋局变了 → 页面照着渲染。
 *   他不想下 / 让你两手，就写 `garden.gomoku.pass` —— 这一手就空着。
 *
 * ⚠️ 别再加回来的东西：
 *   · 本地 `aiMove()` 代下（那是"程序在下棋"，用户点名不要）
 *   · 示例开场 / 每 4 手塞一句随机台词 / `Typed` 二次打字机
 *   · 气泡里出现 `{"kind":…}`（显示前过 `stripActions`）
 */
export const Route = createFileRoute("/_app/play/garden/qi")({
  component: ChessTable,
});

type Side = "ai" | "me";
type Bubble = { id: number; side: Side; text: string; streaming?: boolean };

const STARS = [
  { r: 3, c: 3 },
  { r: 3, c: 11 },
  { r: 11, c: 3 },
  { r: 11, c: 11 },
  { r: 7, c: 7 },
];

const COLS = "ABCDEFGHIJKLMNO";

function coord(r: number, c: number) {
  return `${COLS[c] ?? "?"}${r + 1}`;
}

/** 棋盘摆成"哪边有子"的一行，让他能看懂局面（比给 15 行矩阵省 token，也不容易数错） */
function boardLines(flat: readonly number[]): string {
  const out: string[] = [];
  for (let r = 0; r < BOARD; r += 1) {
    const row = flat.slice(r * BOARD, r * BOARD + BOARD);
    out.push(`${String(r + 1).padStart(2, " ")} ${row.map((v) => (v === 1 ? "●" : v === 2 ? "○" : "·")).join("")}`);
  }
  return out.join("\n");
}

function ChessTable() {
  useActivity("在花园的棋桌边下五子棋");

  const aiName = useApp((s) => resolveAiName(s.settings.aiName));
  const aiAvatar = useApp((s) => s.settings.aiAvatar);
  const myAvatar = useApp((s) => s.settings.userAvatar);
  const myName = useApp((s) => s.settings.displayName);
  const stats = useApp((s) => s.gameStats.gobang);
  const chess = useApp((s) => s.gardenChess);

  const board = boardOf(chess.moves);
  const last = chess.moves.length ? chess.moves[chess.moves.length - 1]! : null;
  const ended = Boolean(chess.result);
  const thinking = chess.turn === "ai" && !ended;

  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const nextId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  /** 已经为"第几手"问过他 —— 防止 StrictMode / 重渲染把他问两遍（问两遍就会落两颗子） */
  const askedFor = useRef(-1);
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
   * 用户 m01220："不管我在哪里跟他说话，都是和主页面相通的，五子棋那个我问他，
   * 他只知道我去了花园，但是干了什么，棋局状态和说的话就不知道。"
   * → detail 必须够他回答"下到哪了、谁占优、你刚说了什么"。
   */
  useEffect(() => {
    const black = board.filter((x) => x === 1).length;
    const white = board.filter((x) => x === 2).length;
    const total = stats.win + stats.loss + stats.draw;
    const no = chess.gameNo;
    const recent = chess.moves
      .slice(-4)
      .map((m) => `${m.side === "you" ? "你" : "我"} ${coord(m.r, m.c)}`)
      .join("、");
    const state =
      chess.result === "win"
        ? "这局你赢了"
        : chess.result === "loss"
          ? "这局我赢了"
          : chess.result === "draw"
            ? "这局和棋"
            : thinking
              ? "我在想落哪（轮到我）"
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
    void total;
  }, [board, chess.gameNo, chess.moves, chess.result, thinking, bubbles, stats]);

  /** 他这一手：问模型 → 他写动作块 → gardenTurn 执行（store 里的棋局因此改变） */
  async function heMove() {
    const st = useApp.getState();
    const cur = st.gardenChess;
    if (cur.result || cur.turn !== "ai") return;

    const setting = st.settings;
    const rows = boardOf(cur.moves);
    const mine = cur.moves.filter((m) => m.side === "you").length;
    const his = cur.moves.filter((m) => m.side === "ai").length;
    const history = bubbles
      .filter((b) => !b.streaming && b.text)
      .slice(-10)
      .map((b) => ({
        role: b.side === "me" ? ("user" as const) : ("assistant" as const),
        content: b.text,
      }));

    const bubbleId = nextId.current++;
    setBubbles((prev) => [...prev, { id: bubbleId, side: "ai" as const, text: "", streaming: true }].slice(-60));
    setSending(true);

    /** 只把这几个动作给他 —— 写别的（放歌、写日记）会被 gardenTurn 丢掉 */
    const allow = ["garden.gomoku.play", "garden.gomoku.pass"] as const;

    const instruction =
      `（花园的棋桌。这一局你执白（○），我执黑（●）。已落 ${mine + his} 手。\n` +
      `当前棋盘（行号在左，列 A~O）：\n${boardLines(rows)}\n` +
      (cur.moves.length ? `我最后落在 ${coord(cur.moves[cur.moves.length - 1]!.r, cur.moves[cur.moves.length - 1]!.c)}。\n` : "") +
      `轮到你了。要落子就在回复末尾写一个动作块：\n` +
      "```qidao\n" +
      `{"kind":"garden.gomoku.play","x":8,"y":8}\n` +
      "```\n" +
      `x = 列（1~15，A 是 1），y = 行（1~15，最上面是 1）。只能落在空格上，落在有子的地方会被拒绝。\n` +
      `不想下、或者要让着我，就写 {"kind":"garden.gomoku.pass"}，这一手就空着。\n` +
      `除了这两个动作，别的动作都不要写。想说什么就说一句，我在棋桌这边看着。）`;

    const req: ChatRequest = {
      model: st.model,
      messages: [...history, { role: "user", content: instruction }],
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
        activity:
          "在花园的棋桌边和我下五子棋（这一局是你执白，我执黑）。当前局面：" +
          `${boardLines(rows).split("\n").join(" / ")}`,
        now: new Date().toLocaleString("zh-CN"),
      },
      permissions: setting.permissions,
    };

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await gardenTurn({
        req,
        allow,
        signal: ac.signal,
        onText: (text, streaming) => {
          setBubbles((prev) =>
            prev.map((b) => (b.id === bubbleId ? { ...b, text, streaming } : b)),
          );
        },
      });

      // 他说的话并回主对话（没接模型/报错的那种提示不算）
      const clean = stripActions(r.text).trim();
      if (clean && !r.failed) {
        useApp.getState().appendGardenTalk([{ role: "assistant", content: clean }]);
      }
      setBubbles((prev) =>
        prev
          // 报错（没接模型 / 上游断了）不留在气泡里：下面会给一句人话，
          // 否则同一件事横着两条，看起来就是两遍"还没接模型"
          .map((b) => (b.id === bubbleId ? { ...b, text: r.failed ? "" : clean, streaming: false } : b))
          .filter((b) => b.side === "me" || b.text),
      );

      /**
       * 他没落子（模型没写动作块 / 上游断了）——**不替他下**（用户 m02176 定的 B）。
       * 给一次重试，再不行就如实说，把棋子留在"轮到他"那里等着。
       */
      const after = useApp.getState().gardenChess;
      if (!r.acted && !after.result && after.turn === "ai") {
        await new Promise((res) => window.setTimeout(res, 600));
        const again = await gardenTurn({
          req: {
            ...req,
            messages: [
              ...history,
              { role: "user", content: instruction },
              { role: "user", content: "（只写动作块：你要落子就用 garden.gomoku.play，不下就 pass。）" },
            ],
          },
          allow,
          signal: ac.signal,
        });
        const still = useApp.getState().gardenChess;
        if (!again.acted && !still.result && still.turn === "ai") {
          setBubbles((prev) =>
            [
              ...prev,
              {
                id: nextId.current++,
                side: "ai" as const,
                text: again.failed || r.failed
                  ? "还没接上模型：去「我的 → 自定义上游」填地址和密钥，我才能自己下。"
                  : "（他没落子，这一手空着。）",
              },
            ].slice(-60),
          );
        }
      }
    } catch {
      setBubbles((prev) =>
        [
          ...prev.filter((b) => b.id !== bubbleId),
          { id: nextId.current++, side: "ai" as const, text: "（他这一手没走成，稍等一下。）" },
        ].slice(-60),
      );
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  /** 轮到他了 → 问一次（同一手只问一次） */
  useEffect(() => {
    if (ended || chess.turn !== "ai") return;
    if (askedFor.current === chess.moves.length) return;
    askedFor.current = chess.moves.length;
    void heMove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chess.turn, chess.moves.length, ended]);

  /** 跟他说一句（聊天，不影响棋局） */
  async function talk(text: string) {
    const said = text.trim();
    if (!said || sending) return;
    setDraft("");
    setBubbles((prev) => [...prev, { id: nextId.current++, side: "me" as const, text: said }].slice(-60));

    const st = useApp.getState();
    const setting = st.settings;
    const cur = st.gardenChess;
    const rows = boardOf(cur.moves);
    const history = bubbles
      .filter((b) => !b.streaming && b.text)
      .slice(-10)
      .map((b) => ({ role: b.side === "me" ? ("user" as const) : ("assistant" as const), content: b.text }));

    const bubbleId = nextId.current++;
    setBubbles((prev) => [...prev, { id: bubbleId, side: "ai" as const, text: "", streaming: true }].slice(-60));
    setSending(true);

    const ac = new AbortController();
    abortRef.current = ac;
    const req: ChatRequest = {
      model: st.model,
      messages: [...history, { role: "user", content: said }],
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
        activity:
          "在花园的棋桌边下五子棋。当前局面：" +
          `${boardLines(rows).split("\n").join(" / ")}` +
          (cur.result ? "（这局已经下完了）" : ""),
        now: new Date().toLocaleString("zh-CN"),
      },
      permissions: setting.permissions,
    };
    try {
      const r = await gardenTurn({
        req,
        allow: ["garden.gomoku.play", "garden.gomoku.pass", "garden.gomoku.new"],
        signal: ac.signal,
        onText: (t, streaming) =>
          setBubbles((prev) => prev.map((b) => (b.id === bubbleId ? { ...b, text: t, streaming } : b))),
      });
      const clean = stripActions(r.text).trim();
      setBubbles((prev) =>
        prev
          // 报错（没接模型 / 上游断了）不留在气泡里：下面会给一句人话，
          // 否则同一件事横着两条，看起来就是两遍"还没接模型"
          .map((b) => (b.id === bubbleId ? { ...b, text: r.failed ? "" : clean, streaming: false } : b))
          .filter((b) => b.side === "me" || b.text),
      );
      if (clean && !r.failed) {
        useApp.getState().appendGardenTalk([
          { role: "user", content: said },
          { role: "assistant", content: clean },
        ]);
      }
    } catch {
      setBubbles((prev) =>
        prev
          .map((b) => (b.id === bubbleId ? { ...b, text: "（没接上，稍后再试）", streaming: false } : b))
          .filter((b) => b.side === "me" || b.text),
      );
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  useEffect(() => () => abortRef.current?.abort(), []);

  function reset() {
    askedFor.current = -1;
    useApp.getState().chessReset();
  }

  const lastN = BOARD - 1;

  return (
    <div className="qi">
      <img src={GARDEN_BASE} alt="" aria-hidden="true" className="qi-bg" />
      <div className="qi-veil" aria-hidden="true" />

      {/*
        返回键：**必须活在安全区下面**。
        用户 m03612 第 1 条："五子棋界面没办法切其他界面" —— 真机箭头贴在 y≈12px，
        一大半落在状态栏那一条里，点下去被系统吃掉（安卓 WebView 里
        `env(safe-area-inset-top)` 恒为 0，安全区只能靠原生推的 `--q-inset-top`）。
        所以这里用 `--q-inset-top` + 24px 偏移，热区也放大到 44px。
      */}
      <header
        className="absolute left-0 top-0 z-30"
        style={{
          paddingTop: "calc(max(12px, var(--q-inset-top, env(safe-area-inset-top, 0px))) + 8px)",
        }}
      >
        <Link
          to="/play/garden"
          aria-label="返回花园"
          className="ml-1 flex size-11 items-center justify-center text-[#F7F0E2]/85"
        >
          <ChevronLeft className="size-6" strokeWidth={1.4} />
        </Link>
      </header>

      <div className="qi-rec">
        对战记录
        <b>
          第 {chess.gameNo} 局 · 你 {stats.win} : {stats.loss} {aiName}
        </b>
      </div>

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
          <p className="qi-hint">棋盘摆好了。落一子，或者先说句话。</p>
        )}
      </div>

      <div className="qi-avrow">
        <div className="flex items-center">
          <span className="qi-av">
            {aiAvatar ? <img src={aiAvatar} alt="" className="size-full object-cover" /> : aiName.slice(0, 1)}
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
            {myAvatar ? <img src={myAvatar} alt="" className="size-full object-cover" /> : (myName || "我").slice(0, 1)}
          </span>
        </div>
      </div>

      <div className="qi-status">
        <p className="qi-status-k">{
          ended ? "FINITA" : thinking ? "PENSA" : chess.turn === "ai" ? "TOCCA A LUI" : "TOCCA A TE"
        }</p>
        <p className="qi-status-t">
          {chess.result === "win"
            ? "你连成五子"
            : chess.result === "loss"
              ? `${aiName}连成五子`
              : chess.result === "draw"
                ? "和棋"
                : thinking
                  ? `${aiName}在想…`
                  : chess.turn === "ai"
                    ? "轮到他 · 他还没落子"
                    : "轮到你 · 你执黑"}
        </p>
        {ended && (
          <button type="button" onClick={reset} className="qi-again">
            再来一局
          </button>
        )}
      </div>

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
              disabled={ended || thinking}
              onClick={() => {
                const ok = useApp.getState().chessYou(r, c);
                if (!ok) return;
              }}
              className="qi-cell"
              style={{ left: `${6 + (c / lastN) * 88}%`, top: `${6 + (r / lastN) * 88}%` }}
            >
              {s !== 0 && (
                <span className={cn("qi-stone", s === 1 ? "qi-stone-black" : "qi-stone-white", isLast && "qi-stone-last")} />
              )}
            </button>
          );
        })}
      </div>

      <form
        className="qi-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void talk(draft);
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
    </div>
  );
}
