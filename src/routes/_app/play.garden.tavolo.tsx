import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useRef, useState } from "react";
import { useActivity } from "@/lib/use-activity";

/**
 * `/play/garden/tavolo` —— 棋桌的**二级页**：一个能拨的意大利转盘，选玩哪种。
 *
 * 用户 m05937 起说的方向，最后 m06208 定案"就 AC 吧"：
 *   · 中央 = A（月桂花环 + 八角星芒，**不要人像**，m06152）
 *   · 外环 = C（珠链 + 卷草，古金色、神秘繁复）
 *
 * 交互：手指拨盘 → 松手吸附到最近的一格 → 顶部指针指着的那格就是选中的；
 * 也可以直接点某一格进去。五子棋进 `/play/garden/qi`，塔罗进
 * `/play/garden/tarot`，其余几样还没做，点了给一句人话。
 *
 * ⚠️ 别把这里做成"程序替他选"：转盘是给他/你**入口**，牌是他洗、他抽、他解。
 */

export const Route = createFileRoute("/_app/play/garden/tavolo")({
  component: TavoloView,
});

type Game = {
  id: string;
  zh: string;
  it: string;
  to?: "/play/garden/qi" | "/play/garden/tarot";
};

/** 顺序 = 从正上方开始顺时针（塔罗落在左下那格，跟预览图一致） */
const GAMES: Game[] = [
  { id: "qi", zh: "五子棋", it: "Gomoku", to: "/play/garden/qi" },
  { id: "tris", zh: "井字棋", it: "Tris" },
  { id: "dadi", zh: "骰子", it: "Dadi" },
  { id: "memoria", zh: "翻牌", it: "Memoria" },
  { id: "tarot", zh: "塔罗", it: "Tarocchi", to: "/play/garden/tarot" },
  { id: "sortes", zh: "抽签", it: "Sortes" },
];

const C = 200;
const R_OUT = 176;
const R_PLATE = 174;
const R_IN = 92;
const STEP = 360 / GAMES.length;

/** 圆上取点。坐标**统一四舍五入到两位**：服务端 Node 和浏览器 V8 的
 *  Math.sin/cos 末位会差一个 ulp，不取整就会在 hydration 时判成"属性不一致"。 */
function pt(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  const round = (n: number) => Math.round(n * 100) / 100;
  return [round(C + r * Math.sin(a)), round(C - r * Math.cos(a))];
}

function sectorPath(i: number): string {
  const a0 = i * STEP - STEP / 2 + 1.1;
  const a1 = i * STEP + STEP / 2 - 1.1;
  const [x0, y0] = pt(R_PLATE, a0);
  const [x1, y1] = pt(R_PLATE, a1);
  const [x2, y2] = pt(R_IN, a1);
  const [x3, y3] = pt(R_IN, a0);
  return `M${x0} ${y0} A${R_PLATE} ${R_PLATE} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${R_IN} ${R_IN} 0 0 0 ${x3} ${y3} Z`;
}

function star8(s = 1): string {
  const pts: string[] = [];
  for (let i = 0; i < 16; i += 1) {
    const [x, y] = pt((i % 2 ? 7.5 : 26) * s, i * 22.5);
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return pts.join(" ");
}

/** 月桂花环：绕一圈叶子（上下留口），中间几片大、两头小 */
function wreath(r = 62, count = 18): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  for (let k = 0; k < count; k += 1) {
    const a = 24 + (k * (360 - 48)) / (count - 1);
    const [x, y] = pt(r, a);
    const k2 = 1 - 0.35 * Math.abs(k / (count - 1) - 0.5) * 2;
    out.push(
      <ellipse
        key={`l${k}`}
        cx={x}
        cy={y}
        rx={3.6 * k2}
        ry={8 * k2}
        transform={`rotate(${a} ${x} ${y})`}
        fill="rgba(176,138,69,.5)"
        stroke="#8d6b2c"
        strokeWidth="0.55"
      />,
    );
    if (k % 3 === 1) {
      const [bx, by] = pt(r - 8, a);
      out.push(<circle key={`b${k}`} cx={bx} cy={by} r="1.6" fill="#b08a45" opacity="0.85" />);
    }
  }
  return out;
}

/** 六瓣小蔷薇（外环上的节点装饰） */
function rosette(cx: number, cy: number, s = 1): React.ReactNode {
  const petals: React.ReactNode[] = [];
  for (let i = 0; i < 6; i += 1) {
    petals.push(
      <ellipse
        key={i}
        cy={-4.6 * s}
        rx={1.9 * s}
        ry={3.6 * s}
        transform={`rotate(${i * 60} ${cx} ${cy})`}
        fill="rgba(176,138,69,.55)"
        stroke="#8d6b2c"
        strokeWidth="0.5"
      />,
    );
  }
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <g>{petals}</g>
      <circle r={1.5 * s} fill="#8d6b2c" opacity="0.8" />
    </g>
  );
}

function TavoloView() {
  useActivity("在花园的棋桌边拨转盘，挑玩什么");

  const navigate = useNavigate();
  const box = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<{ start: number; base: number; moved: number } | null>(null);
  const [angle, setAngle] = useState(0);
  const [snapping, setSnapping] = useState(false);
  const [notice, setNotice] = useState("");

  const mod6 = (n: number) => ((n % GAMES.length) + GAMES.length) % GAMES.length;
  const selected = mod6(Math.round(-angle / STEP));

  function pointerAngle(clientX: number, clientY: number) {
    const el = box.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const dx = clientX - (r.left + r.width / 2);
    const dy = clientY - (r.top + r.height / 2);
    return (Math.atan2(dx, -dy) * 180) / Math.PI;
  }

  function open(game: Game) {
    if (game.to) {
      void navigate({ to: game.to });
      return;
    }
    setNotice(`「${game.zh}」还没开张 —— 现在能玩的是五子棋和塔罗。`);
    window.setTimeout(() => setNotice(""), 2600);
  }

  function onDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setSnapping(false);
    gesture.current = { start: pointerAngle(e.clientX, e.clientY), base: angle, moved: 0 };
  }

  function onMove(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    let d = pointerAngle(e.clientX, e.clientY) - g.start;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    g.moved = Math.max(g.moved, Math.abs(d));
    setAngle(g.base + d);
  }

  function onUp(e: React.PointerEvent) {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;

    // 没怎么动 = 点了一下：算点到哪一格
    if (g.moved < 8) {
      const el = box.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const dist = Math.hypot(dx, dy) / (r.width / 2);
        if (dist <= 1) {
          const local = mod6(Math.round((pointerAngle(e.clientX, e.clientY) - angle) / STEP));
          if (dist < R_IN / C) {
            open(GAMES[selected]!);
          } else {
            open(GAMES[local]!);
          }
        }
      }
      return;
    }

    // 拨完吸附到最近的一格
    setSnapping(true);
    setAngle(Math.round(angle / STEP) * STEP);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") {
      setSnapping(true);
      setAngle(angle - STEP);
    } else if (e.key === "ArrowLeft") {
      setSnapping(true);
      setAngle(angle + STEP);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(GAMES[selected]!);
    }
  }

  const current = GAMES[selected]!;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#17110c] text-[#f6ead3]">
      {/* 底：一团暖褐的雾，跟花园同色系 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(58% 46% at 50% 44%, #4a3521 0%, #2c2015 46%, #17110c 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(115deg, rgba(255,236,198,.5) 0 1px, transparent 1px 7px)",
        }}
      />

      <header
        className="relative z-20 shrink-0 px-4"
        style={{ paddingTop: "max(14px, env(safe-area-inset-top))" }}
      >
        <div className="relative flex h-11 items-center justify-center">
          <Link
            to="/play/garden"
            aria-label="返回花园"
            className="absolute left-0 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center text-[#e6cf9f]/80"
          >
            <ChevronLeft className="size-6" strokeWidth={1.4} />
          </Link>
          <div className="text-center">
            <p className="text-[15px] tracking-[0.42em] text-[#f4e4c4]">棋 桌</p>
            <p className="mt-1 text-[8.5px] tracking-[0.34em] text-[#c9a24a]/70">
              TAVOLO · GIOCHI
            </p>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 flex-col items-center overflow-y-auto overscroll-contain px-4 pb-10 [&>*]:shrink-0">
        <div
          ref={box}
          data-anchor="tavolo-wheel"
          role="application"
          aria-label="转盘：拨动或点选玩法"
          tabIndex={0}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onKeyDown={onKey}
          className="mt-2 w-full max-w-[420px] cursor-grab touch-none select-none outline-none active:cursor-grabbing"
        >
          <svg viewBox="0 0 400 400" className="w-full">
            <defs>
              <radialGradient id="tw-plate" cx="0.5" cy="0.42" r="0.72">
                <stop offset="0" stopColor="#fdf7e9" />
                <stop offset="0.62" stopColor="#f2e3c6" />
                <stop offset="1" stopColor="#dfc79c" />
              </radialGradient>
              <radialGradient id="tw-in" cx="0.5" cy="0.4" r="0.8">
                <stop offset="0" stopColor="#fffaf0" />
                <stop offset="1" stopColor="#e8d3aa" />
              </radialGradient>
              <radialGradient id="tw-gold" cx="0.5" cy="0.4" r="0.7">
                <stop offset="0" stopColor="#f0d79a" />
                <stop offset="0.55" stopColor="#c9a24a" />
                <stop offset="1" stopColor="#8d6b2c" />
              </radialGradient>
            </defs>

            {/* 外圈的金边 */}
            <circle cx={C} cy={C} r={R_OUT + 8} fill="none" stroke="#6b5024" strokeWidth="1.2" opacity="0.55" />
            <circle cx={C} cy={C} r={R_PLATE} fill="url(#tw-plate)" stroke="#8d6b2c" strokeWidth="1.6" />
            <circle cx={C} cy={C} r={R_OUT} fill="none" stroke="url(#tw-gold)" strokeWidth="6" opacity="0.9" />
            <circle cx={C} cy={C} r={R_OUT - 4} fill="none" stroke="#6b5024" strokeWidth="0.7" opacity="0.5" />

            {/* 会转的部分 */}
            <g
              style={{
                transform: `rotate(${angle}deg)`,
                transformBox: "view-box",
                transformOrigin: "200px 200px",
                transition: snapping ? "transform .52s cubic-bezier(.22,.86,.24,1)" : undefined,
              }}
            >
              {GAMES.map((g, i) => (
                <g key={g.id}>
                  <path
                    d={sectorPath(i)}
                    fill={i === selected ? "rgba(201,162,74,.24)" : i % 2 ? "rgba(201,162,74,.055)" : "rgba(255,255,255,.14)"}
                    stroke={i === selected ? "#a5813a" : "rgba(141,107,44,.34)"}
                    strokeWidth={i === selected ? 1.3 : 0.8}
                  />
                  {(() => {
                    const [x, y] = pt(128, i * STEP);
                    // 字反着转回来：盘子会转，玩法名要一直正着（不然拨完像倒了）
                    return (
                      <g
                        transform={`rotate(${-angle} ${x} ${y})`}
                        style={{
                          transition: snapping
                            ? "transform .52s cubic-bezier(.22,.86,.24,1)"
                            : undefined,
                        }}
                      >
                        <text
                          x={x}
                          y={y - 1}
                          textAnchor="middle"
                          fontSize="16"
                          letterSpacing="2"
                          fill="#4a3020"
                          fontFamily="'Noto Serif SC', 'Songti SC', serif"
                        >
                          {g.zh}
                        </text>
                        <text
                          x={x}
                          y={y + 13}
                          textAnchor="middle"
                          fontSize="8.5"
                          letterSpacing="1.4"
                          fontStyle="italic"
                          fill="#8d6b2c"
                          fontFamily="Georgia, serif"
                        >
                          {g.it}
                        </text>
                        {!g.to && (
                          <text x={x} y={y + 25} textAnchor="middle" fontSize="7" fill="#a08a63">
                            准备中
                          </text>
                        )}
                      </g>
                    );
                  })()}
                </g>
              ))}

              {/* 外环 C：珠链 + 卷草 + 节点小花 */}
              <circle cx={C} cy={C} r={171} fill="none" stroke="#8d6b2c" strokeWidth="0.7" opacity="0.5" />
              <circle
                cx={C}
                cy={C}
                r={168}
                fill="none"
                stroke="#b08a45"
                strokeWidth="1.1"
                strokeDasharray="2 4"
                opacity="0.75"
              />
              <circle
                cx={C}
                cy={C}
                r={163}
                fill="none"
                stroke="#c9a24a"
                strokeWidth="0.8"
                strokeDasharray="6 5"
                opacity="0.5"
              />
              {Array.from({ length: 108 }).map((_, i) => {
                const [x, y] = pt(171, (i * 360) / 108);
                return <circle key={`bd${i}`} cx={x} cy={y} r={i % 2 ? 1.05 : 1.5} fill="#b08a45" opacity="0.8" />;
              })}
              {Array.from({ length: GAMES.length }).map((_, i) => {
                const [x, y] = pt(R_OUT + 2, i * STEP);
                return <g key={`rs${i}`}>{rosette(x, y, 1.15)}</g>;
              })}
            </g>

            {/* 中央：不跟着转（徽章 + 花环 + 星芒） */}
            <circle cx={C} cy={C} r={R_IN + 6} fill="none" stroke="#8d6b2c" strokeWidth="1.1" opacity="0.7" />
            <circle cx={C} cy={C} r={R_IN} fill="url(#tw-in)" stroke="#8d6b2c" strokeWidth="1.4" />
            <circle cx={C} cy={C} r={R_IN - 5} fill="none" stroke="#b08a45" strokeWidth="0.8" opacity="0.7" />
            {wreath(64, 18)}
            <polygon points={star8(1.18)} fill="rgba(201,162,74,.34)" stroke="#8d6b2c" strokeWidth="1.2" />
            <circle cx={C} cy={C} r="3.4" fill="#8d6b2c" />

            {/* 顶部指针 */}
            <path d="M200 4 L208 20 L192 20 Z" fill="#c9a24a" stroke="#6b5024" strokeWidth="0.8" />
            <circle cx={C} cy="26" r="3.2" fill="#f6ead3" stroke="#8d6b2c" strokeWidth="0.9" />
          </svg>
        </div>

        <p className="mt-3 text-center text-[11px] tracking-[0.28em] text-[#c9a24a]/70">
          拨动圆盘 · 选择玩法
        </p>

        <p className="mt-1 h-5 text-center text-[12px] text-[#f0d9ab]/85" aria-live="polite">
          {notice || `选中：${current.zh} · ${current.it}`}
        </p>

        {/* 给懒得拨的人（也方便"滚到某一项"这类指令落到文字上） */}
        <div data-anchor="tavolo-games" className="mt-4 grid w-full max-w-[420px] grid-cols-2 gap-2">
          {GAMES.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => open(g)}
              className="flex items-center justify-between rounded-lg border border-[#c9a24a]/25 bg-[#2a1e14]/70 px-3 py-2.5 text-left transition hover:border-[#c9a24a]/55 hover:bg-[#3a2a1b]/70"
            >
              <span>
                <span className="block text-[13px] tracking-[0.18em] text-[#f4e4c4]">{g.zh}</span>
                <span className="block text-[8px] tracking-[0.2em] text-[#c9a24a]/70">{g.it}</span>
              </span>
              <span className={`text-[10px] ${g.to ? "text-[#e8cf9b]/80" : "text-[#8a7350]"}`}>
                {g.to ? "进去 ›" : "准备中"}
              </span>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
