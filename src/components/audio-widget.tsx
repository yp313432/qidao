import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown, Disc3, Link2, Pause, Play, SkipForward, X } from "lucide-react";
import { hidesNav } from "@/lib/nav-tree";
import { usePlayer } from "@/lib/player";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

/** 悬浮球直径（px） */
const ORB = 46;
/** 离屏幕边的距离（px），跟 `left-3` / `right-3` 对齐 */
const EDGE = 12;
/** ⭐ 用户指定的过冲曲线（"Q 弹"就靠它） */
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

function sideClass(side: "left" | "right"): string {
  return side === "left" ? "left-3" : "right-3";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

/**
 * ⭐ 全局音频悬浮窗（用户 m03024 第 5 条，2026-11）
 *
 * 用户原话：
 *   "我希望把这个音乐播放器（包括本地音乐和外部链接）改成一个全局的音频悬浮窗（overlay）。
 *    离开主界面后，音频可以后台播放，并自动最小化为一个悬浮球（带个旋转的唱片 icon）。
 *    点击悬浮球，以弹性动画（Spring Animation）展开成一个横向的胶囊迷你播放条。
 *    点击该播放条上的关闭（✕）按钮，需销毁悬浮窗（Destroy Widget）并彻底终止音频后台播放。
 *    Q 弹参数：用 cubic-bezier(0.34, 1.56, 0.64, 1)（过冲）或 spring(stiffness 300)，
 *    不要 ease 匀速。多任务遮罩：小球不能遮挡底部导航等关键按钮 → 允许拖拽贴边（Edge Docking）。
 *    生命周期：点叉必须真正 audio.stop() + destroy（清 src），不能只 v-if 关 UI。"
 *
 * ── 为什么是"一个"悬浮窗，而不是在原来的两处迷你条上改 ─────────────────────
 *
 * 本地音乐和外链其实是**两个播放器**：
 *   · 本地：`PlayerHost`（`player-host.tsx`）里那个唯一的 `<audio>` + `usePlayer`（zustand）
 *   · 外链：`EmbedHost`（`play/embed-host.tsx`）里那个常驻 iframe + `useApp.currentEmbedId`
 * 它们原来**各画一条迷你条**，而且两条用的还是同一个位置
 * （两个宿主都是 `fixed inset-x-0 inset-chip z-30`）—— 一起响的时候会叠在一起。
 * 所以这里收成**一个**悬浮窗：谁在响就显示谁，✕ 一次把两边都停掉（"彻底终止"）。
 *
 * ── 两条必须守住的纪律 ─────────────────────────────────────────────────
 *
 * ① **✕ 不是藏 UI**：本地走 `usePlayer.getState().close()`（pause → 清 src → load() →
 *    清 dataset.track，见 `player.ts` 里 `close()` 的注释）；外链走
 *    `useApp.getState().setCurrentEmbed(null)`（`embed-host.tsx` 里 `if (!embed) return null`
 *    会把 iframe 整个卸载，声音自然断）。
 * ② **位置**：默认贴在底部导航**上方**（不遮导航），可以拖着走、松手吸附到最近的左右边
 *    （Edge Docking）；"底部导航在不在"用 `nav-tree.ts` 的 `hidesNav()` 判断 ——
 *    不要在页面里自己写路径判断（`nav-tree.ts` 里那段注释专门批评过）。
 */
export function AudioWidget() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  /* —— 本地曲目（<audio> 在 PlayerHost 里，这里只读状态）—— */
  const tracks = usePlayer((s) => s.tracks);
  const currentId = usePlayer((s) => s.currentId);
  const playing = usePlayer((s) => s.playing);
  const time = usePlayer((s) => s.time);
  const track = tracks.find((t) => t.id === currentId) ?? null;

  /* —— 外链（iframe 在 EmbedHost 里，这里只读状态）—— */
  const embeds = useApp((s) => s.musicEmbeds);
  const currentEmbedId = useApp((s) => s.currentEmbedId);
  const embed = embeds.find((e) => e.id === currentEmbedId) ?? null;

  const localOn = Boolean(track) && (playing || time > 0);
  /**
   * 谁在响：**正在放的那个优先**（两个都挂着时，响的那个才是用户在听的）；
   * 都停着就谁还挂着显示谁 —— 这样总有个地方能一键把它停掉。
   */
  const via: "local" | "embed" | null =
    track && playing ? "local" : embed ? "embed" : localOn ? "local" : null;

  const onMusicPage = pathname === "/play/listen" || pathname === "/play/player";
  const show = Boolean(via) && !onMusicPage;

  /* ── 展开 / 收起 + 拖拽贴边（纯 UI，不进 store）── */
  const [expanded, setExpanded] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ px: 0, py: 0, ox: 0, oy: 0, moved: false });

  /* 换页就把球收回去（用户："离开主界面后自动最小化成悬浮球"） */
  useEffect(() => {
    setExpanded(false);
  }, [pathname]);

  if (!show || !via) return null;

  const title =
    via === "local" ? (track?.name ?? "本地音乐") : `${embed?.serviceLabel ?? "外链"} 外链播放中`;
  /** 默认竖位置：让开**输入框**和底部导航（整页页面没有导航，就只让安全区）
   *
   * ⚠️ 2026-10 实测：原来写 `navH + 0.75rem`，球正好落在**悬浮输入框卡片底下** ——
   * 对话页的输入框是个 `absolute z-30` 的浮层（`chat-view.tsx`），球在它下面既看不见也点不到
   * （Playwright 报 `subtree intercepts pointer events`）。输入框的高度由 chat-view 用
   * ResizeObserver 量好、发布成 `--q-composer-h`（那个值已含导航高度）→ 有它就抬到输入框上面，
   * 没有它（别的页面）就退回"导航上面一点"。
   */
  const dockBottom = hidesNav(pathname)
    ? "bottom-[calc(var(--q-inset-bottom,env(safe-area-inset-bottom,0px))+0.75rem)]"
    : "bottom-[calc(var(--q-composer-h,calc(var(--q-inset-bottom,env(safe-area-inset-bottom,0px))+var(--aster-nav-h)))+0.5rem)]";

  /** 贴左还是贴右（按球心在屏幕哪半边） */
  const side: "left" | "right" = pos && pos.x + ORB / 2 < window.innerWidth / 2 ? "left" : "right";
  const horizontal = sideClass(side);
  /**
   * 拖动过之后，胶囊按**球贴的那条边**对齐展开 —— 直接拿 `pos.x` 当左边界的话，
   * 球停在右边时胶囊会从球的位置往右长、直接捅出屏幕外。
   */
  const capsulePos = pos
    ? {
        top: clamp(pos.y, EDGE, window.innerHeight - 64),
        ...(side === "right"
          ? { right: Math.max(EDGE, window.innerWidth - (pos.x + ORB)) }
          : { left: Math.max(EDGE, pos.x) }),
      }
    : null;

  const stopAll = () => {
    usePlayer.getState().close(); // 本地：真停 + 清 src（见 player.ts 里 close()）
    useApp.getState().setCurrentEmbed(null); // 外链：卸载 iframe → 断声
    setExpanded(false);
  };

  const onDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    drag.current = { px: e.clientX, py: e.clientY, ox: r.left, oy: r.top, moved: false };
    setPos({ x: r.left, y: r.top }); // 从 CSS 定位切成绝对定位（同一像素，不会跳）
    setDragging(true);
    el.setPointerCapture(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    const d = drag.current;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) d.moved = true;
    setPos({
      x: clamp(d.ox + dx, EDGE, window.innerWidth - ORB - EDGE),
      y: clamp(d.oy + dy, EDGE + 8, window.innerHeight - ORB - EDGE),
    });
  };

  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragging(false);
    const d = drag.current;
    // 没怎么动 → 当成"点了一下"：展开成胶囊播放条
    if (!d.moved) {
      setExpanded(true);
      return;
    }
    // 松手吸附到最近的左/右边（Edge Docking），竖位置留在原地
    setPos((p) => {
      const x = p?.x ?? d.ox;
      return {
        x: x + ORB / 2 < window.innerWidth / 2 ? EDGE : window.innerWidth - ORB - EDGE,
        y: p?.y ?? d.oy,
      };
    });
  };

  /** 拖拽时跟手（无过渡）；松手吸附、展开收起都走**过冲**曲线（用户给的参数） */
  const spring = dragging
    ? "none"
    : `left 0.42s ${SPRING}, top 0.42s ${SPRING}, right 0.42s ${SPRING}, bottom 0.42s ${SPRING}`;

  return (
    <>
      {/* ── 悬浮球（最小化态）──────────────────────────────────────── */}
      {!expanded && (
        <button
          type="button"
          aria-label="展开播放条"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => setDragging(false)}
          style={{
            width: ORB,
            height: ORB,
            transition: spring,
            ...(pos ? { left: pos.x, top: pos.y } : {}),
          }}
          className={cn(
            /* z-[95]：要**盖住输入框那一层**（`chat-view` 的浮层是 `z-30`）和对话页自己的层
               （chat 里有 z-[80]/[90]），又不能越过底部导航（z-[60]，在更外层）——
               又因为本组件挂在 `relative z-10` 那一列里，95 只在那一列内部比大小，
               外面比它高的（导航、弹层）照样盖在它上面。
               ⚠️ 原来写 z-30：跟输入框浮层**同值**，DOM 顺序一吃亏就变成"点不到球"。 */
            "spring-in glass-float fixed z-[95] flex touch-none items-center justify-center rounded-full border border-line shadow-lg",
            pos ? "" : `${horizontal} ${dockBottom}`,
            dragging && "scale-105",
          )}
        >
          <Disc3
            className={cn("size-5 text-accent", playing ? "aster-spin" : "opacity-70")}
            aria-hidden
          />
          {/* 一眼分出本地 / 外链 */}
          {via === "embed" && (
            <Link2
              className="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full bg-surface p-0.5 text-accent"
              aria-hidden
            />
          )}
        </button>
      )}

      {/* ── 胶囊迷你播放条（展开态）────────────────────────────────── */}
      {expanded && (
        <div
          className={cn("fixed z-[95]", capsulePos ? "" : `${horizontal} ${dockBottom}`)}
          style={{
            transition: spring,
            ...(capsulePos ?? {}),
          }}
        >
          <div className="spring-in glass-float flex w-[min(84vw,21rem)] items-center gap-1.5 rounded-full border border-line py-1.5 pr-1.5 pl-3 shadow-lg">
            <Disc3
              className={cn("size-4 shrink-0 text-accent", playing ? "aster-spin" : "opacity-70")}
              aria-hidden
            />
            <Link
              /* 点歌名去"能管它"的那一页：本地曲目在播放页（`music-list.tsx:28`
                 点一首也是去 `/play/player`），外链在音乐库那页 */
              to={via === "local" ? "/play/player" : "/play/listen"}
              className="min-w-0 flex-1 truncate text-[12px]"
            >
              {title}
            </Link>
            {via === "local" && (
              <>
                <button
                  type="button"
                  aria-label={playing ? "暂停" : "播放"}
                  onClick={() => usePlayer.getState().toggle()}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-chip"
                >
                  {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                </button>
                <button
                  type="button"
                  aria-label="下一首"
                  onClick={() => usePlayer.getState().step(1)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-chip"
                >
                  <SkipForward className="size-3.5" />
                </button>
              </>
            )}
            <button
              type="button"
              aria-label="收成小球"
              onClick={() => setExpanded(false)}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-chip text-muted"
            >
              <ChevronDown className="size-4" />
            </button>
            {/* ★ 关闭 = 真的停（本地清 src、外链卸 iframe），不是只藏起来 */}
            <button
              type="button"
              aria-label="关闭并停止播放"
              onClick={stopAll}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-chip text-muted"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
