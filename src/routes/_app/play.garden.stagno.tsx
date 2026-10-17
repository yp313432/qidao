import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FishArt, JunkArt } from "@/components/play/garden-art";
import { PondLife } from "@/components/play/pond-life";
import { GARDEN_POND } from "@/lib/garden";
import {
  DEFAULT_MOOD,
  findSpecies,
  JUNK_ITEMS,
  recordOutcome,
  rollRound,
  type RoundOutcome,
} from "@/lib/garden-catch";
import { resolveAiName } from "@/lib/branding";
import { useApp } from "@/lib/store";
import { useActivity } from "@/lib/use-activity";

/**
 * `/play/garden/stagno` —— 池塘。
 *
 * 用户定的三件事（原话）：
 *   · "点池塘就进入钓鱼页面，不在花园里"
 *   · "要做成动态效果（湖面涟漪、鱼竿抛下、拉起），不要文字版的你懂吗"
 *   · "这个主要是给 AI 玩的，你先给我预览图吧" —— **他在钓，你是看客**
 *
 * 所以你在这页能做的事只有一件：点水面丢一圈涟漪陪着他。屏幕上一行按钮都没有。
 * 一轮 20–60 秒抽一次结果（`lib/garden-catch` 的 ROUND_RATE）：没鱼 / 有动静没咬实 /
 * 咬实跑掉 / 上鱼 / 上别的东西。钓上来就落一条记录 —— 踪迹、竹篮、感知层读的都是这一份。
 */

export const Route = createFileRoute("/_app/play/garden/stagno")({
  component: StagnoView,
});

type Phase =
  | { kind: "idle" }
  | { kind: "nibble" }
  | { kind: "sink" }
  | { kind: "taut" }
  | { kind: "leap"; outcome: Extract<RoundOutcome, { kind: "fish" | "junk" }> }
  | { kind: "catch"; outcome: Extract<RoundOutcome, { kind: "fish" | "junk" }> };

/** 一轮多久：第一次快一点（别让人盯着死水等 40 秒），之后按用户定的 20–60 秒 */
const FIRST_ROUND_MS = 6_000;
const roundGap = () => 20_000 + Math.random() * 25_000;

function StagnoView() {
  useActivity("在池塘边钓鱼");
  const aiName = useApp((s) => resolveAiName(s.settings.aiName));
  const aiAvatar = useApp((s) => s.settings.aiAvatar);
  const mood = useApp((s) => s.emotionEvents[0]?.primaryEmotion ?? DEFAULT_MOOD);

  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [tally, setTally] = useState(0);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const timers = useRef<number[]>([]);
  const lastKind = useRef<RoundOutcome["kind"] | undefined>(undefined);
  const moodRef = useRef(mood);
  moodRef.current = mood;

  const clearTimers = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  /** 摇一轮，按结果播动画，播完排下一轮 */
  const playRound = useCallback((first = false) => {
    let outcome = rollRound(lastKind.current);
    // 第一轮别让人盯着死水等一分钟：抽到"没鱼"就换一次（40% → 0%）
    if (first && outcome.kind === "none") outcome = rollRound(lastKind.current);
    lastKind.current = outcome.kind;

    const finish = (delay: number) => later(() => {
      setPhase({ kind: "idle" });
      later(playRound, delay);
    }, 0);

    if (outcome.kind === "none") {
      setPhase({ kind: "idle" });
      later(playRound, roundGap());
      return;
    }
    if (outcome.kind === "nibble") {
      setPhase({ kind: "nibble" });
      finish(2_200);
      return;
    }
    if (outcome.kind === "escape") {
      setPhase({ kind: "sink" });
      later(() => setPhase({ kind: "taut" }), 1_100);
      later(() => {
        setPhase({ kind: "idle" });
        later(playRound, 2_400);
      }, 2_600);
      return;
    }
    // 上鱼 / 上别的东西
    setPhase({ kind: "sink" });
    later(() => setPhase({ kind: "leap", outcome }), 1_300);
    later(() => {
      setPhase({ kind: "catch", outcome });
      const rec = recordOutcome(outcome, moodRef.current);
      if (rec) setTally((n) => n + 1);
    }, 2_500);
    later(() => {
      setPhase({ kind: "idle" });
      later(playRound, roundGap());
    }, 7_000);
  }, [later]);

  useEffect(() => {
    later(() => playRound(true), FIRST_ROUND_MS);
    return clearTimers;
  }, [clearTimers, later, playRound]);

  /** 点水面：只丢一圈涟漪（用户是看客，不参与钓鱼） */
  function onWaterTap(e: React.MouseEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * 100;
    const y = ((e.clientY - box.top) / box.height) * 100;
    const id = Date.now() + Math.random();
    setRipples((list) => [...list.slice(-4), { id, x, y }]);
    later(() => setRipples((list) => list.filter((r) => r.id !== id)), 2_600);
  }

  const caught = phase.kind === "leap" || phase.kind === "catch" ? phase.outcome : null;
  const showName = phase.kind === "catch" && caught;
  const species = caught?.kind === "fish" ? findSpecies(caught.species.id) : null;
  const junk = caught?.kind === "junk" ? JUNK_ITEMS.find((j) => j.id === caught.item.id) : null;

  return (
    <div className="pond fixed inset-0 z-40 overflow-hidden">
      {/* 水面：池塘专用整图（用户 m01839 选的 B 版，换图只覆盖 public/garden/pond-b.jpg） */}
      <div className="pond-water pond-water-full" style={{ backgroundImage: `url(${GARDEN_POND})` }} aria-hidden="true" />
      {/* 水下的鱼 / 漂的花瓣 / 水草 / 荷叶；咬钩前那条鱼会游到浮漂边上 */}
      <PondLife curious={phase.kind === "nibble" || phase.kind === "sink" || phase.kind === "taut"} />
      <div className="pond-shimmer" aria-hidden="true" />

      {/* 涟漪：三层错开循环 + 点水面时的一次性圈 */}
      <div className="pond-ripples" aria-hidden="true">
        <span className="r1" />
        <span className="r2" />
        <span className="r3" />
      </div>
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {ripples.map((r) => (
          <span key={r.id} className="pond-tap-ripple" style={{ left: `${r.x}%`, top: `${r.y}%` }} />
        ))}
      </div>

      {/* 鱼竿 + 鱼线：竿在右下角外，线从竿尖垂到浮漂 */}
      <svg className="pond-rod" viewBox="0 0 390 844" preserveAspectRatio="none" aria-hidden="true">
        <path d="M400 762 C 352 722 306 684 258 646" fill="none" stroke="rgba(48,36,26,.62)" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M400 762 C 372 742 344 720 318 700" fill="none" stroke="rgba(48,36,26,.28)" strokeWidth="7" strokeLinecap="round" />
        <path
          className={phase.kind === "taut" ? "pond-line taut" : "pond-line"}
          d={
            phase.kind === "taut" || phase.kind === "sink"
              ? "M258 646 C 232 600 208 560 186 526"
              : "M258 646 C 230 610 206 574 186 528"
          }
          fill="none"
          stroke="rgba(255,253,246,.72)"
          strokeWidth="1"
        />
      </svg>

      {/* 浮漂：8×24，白上红下；`sink` 时沉下去，`nibble` 时轻轻逗两下 */}
      <span
        className={
          phase.kind === "sink" || phase.kind === "taut"
            ? "pond-float sink"
            : phase.kind === "nibble"
              ? "pond-float nibble"
              : "pond-float"
        }
        aria-hidden="true"
      >
        <span className="tip" />
        <span className="body" />
      </span>

      {/* 起竿那一刻：鱼/杂物翻出水面 */}
      {caught ? (
        <span className={phase.kind === "leap" ? "pond-fish leap" : "pond-fish"} aria-hidden="true">
          {caught.kind === "fish" ? <FishArt id={caught.species.id} className="size-full" /> : <JunkArt id={caught.item.id} className="size-full" />}
        </span>
      ) : null}

      {/* 鱼名：淡入、停两秒、淡出 */}
      {showName && species ? (
        <div className="pond-catch">
          <p className="zh">{species.zh}</p>
          <p className="la">{species.la}</p>
          <p className="note">
            {caught && caught.kind === "fish" ? `${caught.weight} g · ${caught.length} cm` : ""}
            {caught?.kind === "fish" && caught.firstTime ? " · 第一次钓到" : ""}
            {caught?.kind === "fish" && caught.record ? " · 破纪录" : ""}
          </p>
        </div>
      ) : null}
      {showName && junk ? (
        <div className="pond-catch">
          <p className="zh">{junk.zh}</p>
          <p className="la">{junk.la}</p>
          <p className="note">{junk.sub}</p>
        </div>
      ) : null}

      {/* 页眉：池塘铭牌 + 返回花园 */}
      <header className="absolute inset-x-0 top-0 z-20" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <div className="relative flex h-11 items-center justify-center gap-4 px-[54px]">
          <Link
            to="/play/garden"
            aria-label="返回花园"
            className="absolute left-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center text-[#f4ede0]/90"
          >
            <ChevronLeft className="size-6" strokeWidth={1.4} />
          </Link>
          <span className="garden-rule pale" />
          <div className="shrink-0 text-center">
            <p className="garden-plaque pale">池 塘</p>
            <p className="garden-plaque-la pale">STAGNO</p>
          </div>
          <span className="garden-rule pale" />
        </div>
      </header>

      {/* 他在岸边：头像 + 名字 + 一句（不是状态卡，是水边上的一处） */}
      <div className="pond-who">
        <span className="min-w-0 text-right">
          <span className="name">
            {aiName} · 岸边
          </span>
          <span className="say">在钓鱼，你来了正好。</span>
        </span>
        <span className="pond-avatar">
          {aiAvatar ? <img src={aiAvatar} alt="" className="size-full rounded-full object-cover" /> : aiName.slice(0, 1)}
        </span>
      </div>

      {/* 今天钓到几条（右下角，极淡） */}
      <p className="pond-tally">
        他今天钓到
        <br />
        {tally} 条
      </p>

      {/* 竹篮入口：一页画到底，只有这一个小口子 */}
      <Link to="/play/garden/cesta" aria-label="看竹篮" className="pond-cesta">
        竹 篮
      </Link>

      {/* 点水面（涟漪）—— 盖住整片水，但不挡上面的链接 */}
      <div className="absolute inset-0 z-10" onClick={onWaterTap} aria-hidden="true" />
    </div>
  );
}
