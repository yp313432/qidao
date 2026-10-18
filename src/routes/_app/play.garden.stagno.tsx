import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FishArt, JunkArt } from "@/components/play/garden-art";
import { PondLife } from "@/components/play/pond-life";
import { resolveAiName } from "@/lib/branding";
import type { ChatRequest } from "@/lib/chat-client";
import { GARDEN_POND } from "@/lib/garden";
import {
  findSpecies,
  gardenStats,
  JUNK_ITEMS,
  readCatches,
  type CatchRecord,
} from "@/lib/garden-catch";
import { gardenTurn } from "@/lib/garden-play";
import { useApp } from "@/lib/store";
import { useActivity } from "@/lib/use-activity";
import { stripActions } from "@/lib/use-chat";

/**
 * `/play/garden/stagno` —— 池塘：**他自己钓**。
 *
 * 三轮要求叠在一起：
 *   · m01134 视觉："池塘风格单独一张底图，垂着鱼竿" —— 底图 `public/garden/pond-b.jpg`（他选的 B 版）
 *   · m01184 节奏："概率随机，不要每次都钓上来，还有其他随机事件"
 *   · m02156 归属："钓鱼也是，不是他钓的，只是我点开池塘，程序自动钓起，最后 ai 只能看到结果"，
 *     要 AE 自己抛竿、自己收线（收早了空手，拖久了鱼跑）
 *
 * 所以这一页现在只做三件事：**摆场景、问他、演他自己调出来的动作**。
 *   `garden.fish.cast` → 竿抛出去（store 记 waiting + 咬钩时刻）
 *   `garden.fish.reel` → 收线（只有咬钩了才收得着；早收空手、拖太久鱼跑）
 * 你是看客：点水面只会丢一圈涟漪，不参与钓鱼。
 */

export const Route = createFileRoute("/_app/play/garden/stagno")({
  component: StagnoView,
});

/** 咬钩后他最多犹豫多久：超时就算"拖久了鱼跑" */
const REEL_GRACE_MS = 9_000;
/** 一轮结束到下一竿之间留一点空（他不是机器） */
const NEXT_CAST_MS = 5_000;

function StagnoView() {
  useActivity("在池塘边钓鱼");
  const aiName = useApp((s) => resolveAiName(s.settings.aiName));
  const aiAvatar = useApp((s) => s.settings.aiAvatar);
  const pond = useApp((s) => s.gardenPond);

  const [line, setLine] = useState("在钓鱼，你来了正好。");
  const [hint, setHint] = useState("");
  const [caught, setCaught] = useState<CatchRecord | null>(null);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const [tally, setTally] = useState(() => gardenStats().todayFish);

  const askedCast = useRef(-1);
  const askedReel = useRef(-1);
  const timers = useRef<number[]>([]);
  const heardRef = useRef("");

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
    },
    [],
  );

  /** 通用的"问他一句"，把他说的话放到水边，把动作执行掉 */
  async function ask(opts: {
    instruction: string;
    allow: readonly ("garden.fish.cast" | "garden.fish.reel")[];
  }) {
    const st = useApp.getState();
    const setting = st.settings;
    const req: ChatRequest = {
      model: st.model,
      messages: [
        ...(heardRef.current
          ? [{ role: "user" as const, content: heardRef.current }]
          : []),
        { role: "user", content: opts.instruction },
      ],
      style: setting.replyStyle,
      tools: [],
      customBaseUrl: setting.customBaseUrl || undefined,
      customApiKey: setting.customApiKey || undefined,
      upstreamModel: setting.upstreamModel || undefined,
      maxTokens: setting.maxTokens,
      name: setting.displayName,
      aiName,
      persona: setting.persona || undefined,
      context: {
        activity:
          "在花园的池塘边钓鱼。" +
          (st.gardenPond.phase === "idle"
            ? "还没抛竿。"
            : st.gardenPond.phase === "waiting"
              ? `竿抛在${st.gardenPond.spot || "岸边"}，等水面。`
              : st.gardenPond.phase === "bite"
                ? "浮漂沉下去了，有鱼咬钩。"
                : "这一竿刚收。"),
        now: new Date().toLocaleString("zh-CN"),
      },
      permissions: setting.permissions,
    };
    try {
      const r = await gardenTurn({
        req,
        allow: opts.allow,
        onText: (t, streaming) => {
          if (streaming || t) {
            const clean = stripActions(t).trim();
            if (clean) setLine(clean);
          }
        },
      });
      const clean = stripActions(r.text).trim();
      if (clean) {
        setLine(clean);
        if (!r.failed) heardRef.current = `（你刚才在池塘边说过：${clean}）`;
      }
      return r;
    } catch {
      return { text: "", acted: false, failed: true, results: [] };
    }
  }

  /* ── 1. 闲着的时候：问他要不要抛竿 ───────────────────────────────── */
  useEffect(() => {
    if (pond.phase !== "idle") return;
    if (askedCast.current === pond.at) return;
    askedCast.current = pond.at;
    setCaught(null);
    const t = window.setTimeout(() => {
      void ask({
        instruction:
          "（你在花园的池塘边，水很静。想钓就抛一竿：在回复末尾写\n" +
          "```qidao\n" +
          '{"kind":"garden.fish.cast","spot":"有阴影的那块水面"}\n' +
          "```\n" +
          "spot 随口写一句你在心里挑的位置就行。不想钓就只说一句话，什么都不写。\n" +
          "除了这个动作，别的动作都不要写。）",
        allow: ["garden.fish.cast"],
      }).then((r) => {
        const st = useApp.getState();
        if (!r.acted && st.gardenPond.phase === "idle") {
          setHint(
            r.failed
              ? "还没接上模型：去「我的 → 自定义上游」填地址和密钥，他才能自己钓。"
              : "",
          );
          // 没抛竿也别僵着：过一会儿再问他一次
          later(() => {
            const s2 = useApp.getState();
            if (s2.gardenPond.phase === "idle") {
              askedCast.current = s2.gardenPond.at;
              void ask({
                instruction:
                  "（水面很静。你要不要抛一竿？要就写动作块 garden.fish.cast，不要就只说一句话。）",
                allow: ["garden.fish.cast"],
              });
            }
          }, 8_000);
        } else {
          setHint("");
        }
      });
    }, 900);
    return () => window.clearTimeout(t);
    // ask 是稳定的一次性函数（只读 store、写 store），不需要进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pond.phase, pond.at]);

  /* ── 2. 竿支着：到点咬钩 ──────────────────────────────────────── */
  useEffect(() => {
    if (pond.phase !== "waiting") return;
    const ms = Math.max(400, pond.biteAt - Date.now());
    const t = window.setTimeout(() => useApp.getState().pondBite(), ms);
    return () => window.clearTimeout(t);
  }, [pond.phase, pond.biteAt]);

  /* ── 3. 咬钩了：问他要不要收线；拖太久鱼跑 ────────────────────── */
  useEffect(() => {
    if (pond.phase !== "bite") return;
    const at = pond.at;
    if (askedReel.current !== at) {
      askedReel.current = at;
      void ask({
        instruction:
          "（浮漂沉下去了 —— 咬钩了。\n" +
          "现在收线：在回复末尾写\n" +
          "```qidao\n" +
          '{"kind":"garden.fish.reel"}\n' +
          "```\n" +
          "拖太久鱼会跑（大概 9 秒）。除了这个动作，别的动作都不要写。）",
        allow: ["garden.fish.reel"],
      });
    }
    const t = window.setTimeout(() => {
      const st = useApp.getState();
      if (st.gardenPond.phase === "bite") {
        st.pondSettle("lost");
        setHint("他犹豫得太久，鱼跑了。");
      }
    }, REEL_GRACE_MS);
    return () => window.clearTimeout(t);
    // ask 是稳定的一次性函数（只读 store、写 store），不需要进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pond.phase, pond.at]);

  /* ── 4. 这一竿收完了：亮一下结果，然后歇一会儿再问下一竿 ──────── */
  useEffect(() => {
    if (pond.phase !== "caught" && pond.phase !== "empty" && pond.phase !== "lost") return;
    if (pond.phase === "caught") {
      const latest = readCatches()[0] ?? null;
      setCaught(latest);
      setTally(gardenStats().todayFish);
      later(() => setCaught(null), 7_000);
    }
    const t = window.setTimeout(() => useApp.getState().pondReset(), NEXT_CAST_MS);
    return () => window.clearTimeout(t);
  }, [pond.phase, pond.at]);

  /** 点水面：只丢一圈涟漪（你是看客，不参与钓鱼） */
  function onWaterTap(e: React.MouseEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * 100;
    const y = ((e.clientY - box.top) / box.height) * 100;
    const id = Date.now() + Math.random();
    setRipples((list) => [...list.slice(-4), { id, x, y }]);
    later(() => setRipples((list) => list.filter((r) => r.id !== id)), 2_600);
  }

  /** 画面上的连续状态（store 的 5 个相位 → 动画用的 4 个） */
  const visual: "idle" | "nibble" | "sink" | "taut" | "leap" =
    pond.phase === "waiting"
      ? "idle"
      : pond.phase === "bite"
        ? "nibble"
        : pond.phase === "caught"
          ? "leap"
          : pond.phase === "lost"
            ? "taut"
            : pond.phase === "empty"
              ? "sink"
              : "idle";

  const species = caught?.kind === "fish" ? findSpecies(caught.ref) : null;
  const junk = caught?.kind === "junk" ? JUNK_ITEMS.find((j) => j.id === caught.ref) : null;
  const showName = pond.phase === "caught" && Boolean(species || junk);

  return (
    <div className="pond fixed inset-0 z-40 overflow-hidden">
      {/* 水面：池塘专用整图（用户 m01839 选的 B 版，换图只覆盖 public/garden/pond-b.jpg） */}
      <div className="pond-water pond-water-full" style={{ backgroundImage: `url(${GARDEN_POND})` }} aria-hidden="true" />
      <PondLife curious={visual === "nibble" || visual === "sink" || visual === "taut"} />
      <div className="pond-shimmer" aria-hidden="true" />

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

      {/* 鱼竿 + 鱼线：竿在右下角外，线从竿尖垂到浮漂；收线时线绷直 */}
      <svg className="pond-rod" viewBox="0 0 390 844" preserveAspectRatio="none" aria-hidden="true">
        <path d="M400 762 C 352 722 306 684 258 646" fill="none" stroke="rgba(48,36,26,.62)" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M400 762 C 372 742 344 720 318 700" fill="none" stroke="rgba(48,36,26,.28)" strokeWidth="7" strokeLinecap="round" />
        <path
          className={visual === "taut" ? "pond-line taut" : "pond-line"}
          d={
            visual === "taut" || visual === "sink" || visual === "leap"
              ? "M258 646 C 232 600 208 560 186 526"
              : "M258 646 C 230 610 206 574 186 528"
          }
          fill="none"
          stroke="rgba(255,253,246,.72)"
          strokeWidth="1"
        />
      </svg>

      {/* 浮漂 */}
      <span className={cnFloat(visual)} aria-hidden="true">
        <span className="tip" />
        <span className="body" />
      </span>

      {/* 起竿那一刻：鱼 / 杂物翻出水面 */}
      {visual === "leap" && caught ? (
        <span className="pond-fish leap" aria-hidden="true">
          {caught.kind === "fish" ? <FishArt id={caught.ref} className="size-full" /> : <JunkArt id={caught.ref} className="size-full" />}
        </span>
      ) : null}

      {/* 钓上来的名字：停 7 秒 */}
      {showName && species ? (
        <div className="pond-catch">
          <p className="zh">{species.zh}</p>
          <p className="la">{species.la}</p>
          <p className="note">
            {caught?.kind === "fish" ? `${caught.weight} g · ${caught.length} cm` : ""}
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

      {/* 他在岸边：头像 + 名字 + 他刚说的那句 */}
      <div className="pond-who">
        <span className="min-w-0 text-right">
          <span className="name">{aiName} · 岸边</span>
          <span className="say">{hint || line}</span>
        </span>
        <span className="pond-avatar">
          {aiAvatar ? <img src={aiAvatar} alt="" className="size-full rounded-full object-cover" /> : aiName.slice(0, 1)}
        </span>
      </div>

      <p className="pond-tally">
        他今天钓到
        <br />
        {tally} 条
      </p>

      <Link to="/play/garden/cesta" aria-label="看竹篮" className="pond-cesta">
        竹 篮
      </Link>

      <div className="absolute inset-0 z-10" onClick={onWaterTap} aria-hidden="true" />
    </div>
  );
}

/** 浮漂的四种姿态（Store 相位 → 动画类名） */
function cnFloat(visual: "idle" | "nibble" | "sink" | "taut" | "leap") {
  if (visual === "sink" || visual === "taut") return "pond-float sink";
  if (visual === "nibble" || visual === "leap") return "pond-float nibble";
  return "pond-float";
}
