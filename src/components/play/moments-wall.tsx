import { useEffect, useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, Heart, ImagePlus, Send } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { FileButton } from "@/components/file-button";
import { resolveAiName } from "@/lib/branding";
import { readImageFile } from "@/lib/image-file";
import { backLabelOf, parentOf } from "@/lib/nav-tree";
import { useApp } from "@/lib/store";
import type { Moment } from "@/lib/types";
import { cn, formatClock, formatDay } from "@/lib/utils";

/**
 * 朋友圈 —— 「玩乐 → 动态空间 → 动态」那一页。
 *
 * ── 2026-10 第二轮：用户拿微信截图来对齐（他原话）────────────────
 *   "上面是不是一个背景，这个背景点击还可以从相册面换。然后中间靠右边是头像，
 *    然后下面是动态消息，不要用玻璃组件，就是纯纯的仿微信朋友圈的风格。"
 *
 * 所以这一页**故意不跟栖岛那套玻璃**（不 `SceneBackdrop`、不 `bg-surface`、
 * 不毛玻璃、不圆角卡），照微信那条结构来：
 *
 *   ┌──────────────────────────────┐
 *   │  封面图（整块，点一下从相册换）      │  ← 顶到状态栏（背景铺满那条规矩还在）
 *   │  ‹                    [头像] 我 │  ← 返回钮压在封面上；名字+头像贴右下
 *   ├──────────────────────────────┤
 *   │  ✎ 这一刻的想法…          发表  │  ← 发表入口
 *   │  ○ 我      一条动态…            │  ← 纯白信息流：头像 + 蓝名字 + 正文
 *   │     ♡ 谁赞了 / 谁：评论          │  ← 浅灰互动块
 *   │     [评论…]          发送  ♡    │
 *   └──────────────────────────────┘
 *
 * ⚠️ 两条不能破的规矩（这页只换皮，不换纪律）：
 *   · **返回目标仍从 `lib/nav-tree.ts` 读**（`parentOf` / `backLabelOf`），
 *     而且必须放在 `<header>` 里 —— `verify-hierarchy.mjs` 就是靠
 *     `header a[aria-label^="返回"]` 对账的；
 *   · **首帧不读"浏览器才有"的东西**（相对时间那种要 `useEffect` 之后再显示），
 *     否则 SSR 首帧跟客户端不一致 → `Hydration failed`。
 *
 * ── 配色是**写死的微信色**（不跟主题）─────────────────────────────
 *   正文 `#191919` / 名字与赞 `#576b95` / 时间 `#b2b2b2` / 互动块 `#f7f7f7`。
 *   用户要的是"纯纯的微信风格"，所以墨色主题下这一页也是白的 ——
 *   这是他的选择，不是漏改（要跟随主题的话改这几个常量就行）。
 */
const WX = {
  text: "#191919",
  link: "#576b95",
  time: "#b2b2b2",
  block: "#f7f7f7",
  page: "#ffffff",
  line: "#ededed",
};

export function MomentsWall() {
  const settings = useApp((s) => s.settings);
  const moments = useApp((s) => s.moments);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const myName = settings.displayName || "我";
  const cover = settings.momentsCover || "";

  function pickCover(files: File[]) {
    const file = files[0];
    if (!file) return;
    // 封面是整屏铺一张的大图 → 缩到最长边 1440 再存，别让设置里塞进几 MB 原图
    readImageFile(file, (url) => useApp.getState().patchSettings({ momentsCover: url }), 1440);
  }

  /**
   * 视差：封面比内容慢半拍（用户 m14665 要的"图二那种"）。
   *
   * 实现方式刻意选"流里 + transform 反向抵消"：封面仍然在滚动流里占 36dvh，
   * 滚动 ↑ y 时再 `translateY(+0.45y)` 把它推回去一点，视觉上就只走了 0.55y；
   * 因为内容紧随其后且是不透明底色，滚上来会把封面下半截盖住。
   *
   * 下拉（y < 0）时放大到最多 1.25 倍（用户参照的参考稿里的参数）。
   * 直接改 style 不 setState —— 滚动每帧都 setState 会重渲染整条消息流。
   */
  const heroRef = useRef<HTMLDivElement>(null);
  /**
   * 封面滚过一半后，顶栏的白字要变回深色（否则白字压白底看不见）。
   * 只在跨阈值时 setState 一次，滚动过程中不重渲染。
   */
  const [onLight, setOnLight] = useState(false);
  const onLightRef = useRef(false);
  function parallax(el: HTMLElement) {
    const y = el.scrollTop;
    const hero = heroRef.current;
    if (!hero) return;
    const pull = Math.min(Math.max(-y, 0) / 900, 0.25);
    const next = y > el.clientHeight * 0.45;
    if (next !== onLightRef.current) {
      onLightRef.current = next;
      setOnLight(next);
    }
    hero.style.transform = `translate3d(0, ${(y * 0.45).toFixed(1)}px, 0) scale(${(1 + pull).toFixed(3)})`;
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" style={{ backgroundColor: WX.page }}>
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onScroll={(e) => parallax(e.currentTarget)}
      >
      {/* ── 封面：整块背景图，点一下从相册换 ── */}
      <div
        ref={heroRef}
        className="relative h-[36dvh] shrink-0 overflow-hidden"
        style={{ backgroundColor: WX.line, transformOrigin: "center top", willChange: "transform" }}
      >
        <FileButton
          ariaLabel="换一张封面（从相册选）"
          accept="image/*"
          onPick={pickCover}
          className="absolute inset-0 block h-full w-full"
        >
          {cover ? (
            <img src={cover} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex size-full flex-col items-center justify-center gap-2 text-white/90">
              <ImagePlus className="size-7" strokeWidth={1.6} />
              <span className="text-[12px]">点一下，从相册选一张封面</span>
            </span>
          )}
        </FileButton>

        {/*
          返回钮压在封面上（微信就是这么放的）。
          `pointer-events-none` 让整条 header 都不挡封面点击 —— 只有返回钮自己收事件，
          所以点封面任意位置都能换图。
          ⚠️ 规格跟全 App 一样（size-11 / ChevronLeft size-6 / strokeWidth 1.6），别自己发明尺寸。
        */}

        {/* 名字 + 头像：微信那样贴在封面右下角（名字在左、头像压着封面下沿） */}
        <div className="pointer-events-none absolute right-4 -bottom-7 flex items-end gap-3">
          <span
            className="mb-8 max-w-[55vw] truncate text-[17px] font-medium text-white"
            style={{ textShadow: "0 1px 4px rgba(0,0,0,0.5)" }}
          >
            {myName}
          </span>
          <Avatar role="user" size={64} className="border-2 border-white shadow-sm" />
        </div>
      </div>

      {/* ── 动态消息（纯白信息流，没有玻璃）── */}
      <div className="pt-8" style={{ backgroundColor: WX.page }}>
        <Composer />
        {moments.length === 0 ? (
          <p className="px-4 py-12 text-center text-[14px]" style={{ color: WX.time }}>
            还没有动态。上面写一条试试。
          </p>
        ) : (
          <ul>
            {moments.map((m) => (
              <li key={m.id} className="border-b last:border-b-0" style={{ borderColor: WX.line }}>
                <MomentPost moment={m} />
              </li>
            ))}
          </ul>
        )}
        <p className="py-8 text-center text-[11px] tracking-[0.2em]" style={{ color: "#d0d0d0" }}>
          FEELINGS ARRIVE BEFORE WORDS DO
        </p>
      </div>

        {/* 返回 + 标题固定在最上层（不跟封面一起缩放） */}
        <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-1 px-2 inset-top-50 pb-1">
          <Link
            to={(parentOf(pathname) ?? "/play") as never}
            aria-label={backLabelOf(pathname)}
            className="pointer-events-auto flex size-11 shrink-0 items-center justify-center"
            style={{ color: onLight ? "var(--aster-fg)" : "#fff", filter: onLight ? "none" : "drop-shadow(0 1px 3px rgba(0,0,0,.5))" }}
          >
            <ChevronLeft className="size-6" strokeWidth={1.6} />
          </Link>
          <span
            className="min-w-0 flex-1 truncate font-serif text-lg font-medium"
            style={{ color: onLight ? "var(--aster-fg)" : "#fff", textShadow: onLight ? "none" : "0 1px 3px rgba(0,0,0,.5)" }}
          >
            朋友圈
          </span>
        </header>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 发表 */

/** 发表入口：平时一行（微信那种"这一刻的想法…"），点开才出输入框 */
function Composer() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  function publish() {
    const t = text.trim();
    if (!t) return;
    useApp.getState().addMoment(t, "me");
    setText("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 border-b px-4 py-3 text-left"
        style={{ borderColor: WX.line }}
      >
        <Avatar role="user" size={40} />
        <span className="min-w-0 flex-1 truncate text-[15px]" style={{ color: WX.time }}>
          这一刻的想法…
        </span>
        <span className="shrink-0 text-[15px] font-medium" style={{ color: WX.link }}>
          发表
        </span>
      </button>
    );
  }

  return (
    <div className="border-b px-4 py-3" style={{ borderColor: WX.line }}>
      <textarea
        autoFocus
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="写一条动态"
        placeholder="这一刻的想法…"
        className="w-full resize-none text-[15px] leading-6 outline-none placeholder:text-[#c8c8c8]"
        style={{ color: WX.text }}
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setText("");
          }}
          className={cn("rounded px-3 py-1.5 text-[14px]")}
          style={{ color: WX.time, backgroundColor: WX.block }}
        >
          取消
        </button>
        <button
          type="button"
          onClick={publish}
          disabled={!text.trim()}
          className="flex items-center gap-1.5 rounded px-3 py-1.5 text-[14px] font-medium text-white disabled:opacity-40"
          style={{ backgroundColor: "#07c160" }}
        >
          <Send className="size-3.5" />
          发表
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 一条动态 */

function MomentPost({ moment }: { moment: Moment }) {
  const settings = useApp((s) => s.settings);
  const aiName = resolveAiName(settings.aiName);
  const myName = settings.displayName || "我";
  const [text, setText] = useState("");

  const likes = moment.likes ?? [];
  const comments = moment.comments ?? [];
  const mine = moment.by === "me";
  const likedByMe = likes.some((l) => l.by === "me");
  /** 名字只有一处口径：他 = AI 名字，我 = 用户填的显示名（没填就"我"） */
  const nameOf = (by: "ai" | "me") => (by === "ai" ? aiName : myName);

  function comment() {
    const t = text.trim();
    if (!t) return;
    useApp.getState().addMomentComment(moment.id, "me", t);
    setText("");
  }

  return (
    <article className="flex items-start gap-3 px-4 py-4">
      <Avatar role={mine ? "user" : "ai"} size={40} />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium" style={{ color: WX.link }}>
          {nameOf(moment.by)}
        </p>

        <p className="mt-1 text-[15px] leading-6 break-words whitespace-pre-wrap" style={{ color: WX.text }}>
          {moment.text}
        </p>

        <div className="mt-1.5 flex items-center gap-3 text-[12px]" style={{ color: WX.time }}>
          <MomentTime at={moment.at} />
          <button
            type="button"
            aria-label="删掉这条动态"
            onClick={() => useApp.getState().deleteMoment(moment.id)}
            className="ml-auto shrink-0"
          >
            删除
          </button>
        </div>

        {/* 赞 + 评论：微信是一块浅灰底（不是玻璃） */}
        {(likes.length > 0 || comments.length > 0) && (
          <div className="mt-2 space-y-1 rounded px-2.5 py-2" style={{ backgroundColor: WX.block }}>
            {likes.length > 0 && (
              <p className="flex items-start gap-1.5 text-[13px] leading-5">
                <Heart
                  className="mt-1 size-3.5 shrink-0"
                  style={{ color: WX.link }}
                  fill="currentColor"
                  strokeWidth={0}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 break-words" style={{ color: WX.link }}>
                  {likes.map((l) => nameOf(l.by)).join("，")}
                </span>
              </p>
            )}
            {comments.map((c) => (
              <p key={c.id} className="text-[13px] leading-5 break-words" style={{ color: WX.text }}>
                <span style={{ color: WX.link }}>{nameOf(c.by)}</span>
                <span>：</span>
                <span>{c.text}</span>
              </p>
            ))}
          </div>
        )}

        {/* 底部一行：写评论 + 点赞（用户要的"底部一行输入"） */}
        <div className="mt-2 flex items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") comment();
            }}
            aria-label="写评论"
            placeholder="评论"
            className="min-w-0 flex-1 rounded px-2.5 py-1.5 text-[13px] outline-none placeholder:text-[#c8c8c8]"
            style={{ backgroundColor: WX.block, color: WX.text }}
          />
          {text.trim() !== "" && (
            <button
              type="button"
              onClick={comment}
              className="shrink-0 rounded px-2.5 py-1.5 text-[13px] font-medium text-white"
              style={{ backgroundColor: "#07c160" }}
            >
              发送
            </button>
          )}
          <button
            type="button"
            onClick={() => useApp.getState().toggleMomentLike(moment.id, "me")}
            aria-label={likedByMe ? "取消赞" : "点赞"}
            aria-pressed={likedByMe}
            className="flex size-8 shrink-0 items-center justify-center rounded"
            style={{ backgroundColor: WX.block, color: likedByMe ? WX.link : WX.time }}
          >
            <Heart
              className="size-4"
              strokeWidth={1.7}
              fill={likedByMe ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ 时间 */

/**
 * 时间：**首帧先给绝对时间，挂载之后再换成微信那种相对时间**。
 *
 * ⚠️ 为什么不能首帧就算"3 分钟前"：那要读 `Date.now()`，
 * 而这是 SSR 应用 —— 服务端渲染时算出来的是另一个值 → `Hydration failed`。
 * 规矩写在 UI统一规范 §8：首帧不读"浏览器才有"的东西。
 */
function MomentTime({ at }: { at: number }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setLabel(relativeTime(at));
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, [at]);

  return <span suppressHydrationWarning>{label ?? `${formatDay(at)} ${formatClock(at)}`}</span>;
}

/** 微信那种"刚刚 / 5 分钟前 / 3 小时前 / 昨天 / 10月12日" */
export function relativeTime(at: number, now = Date.now()): string {
  const diff = now - at;
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 172800_000) return "昨天";
  const d = new Date(at);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
