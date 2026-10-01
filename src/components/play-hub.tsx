import { Link } from "@tanstack/react-router";
import {
  BookHeart,
  CalendarHeart,
  ChevronRight,
  Disc3,
  GraduationCap,
  Hourglass,
  Pause,
  Play,
  SkipForward,
  Spade,
} from "lucide-react";
import { countdown, sortDates } from "@/lib/days";
import { DECK } from "@/lib/truth-deck";
import { usePlayer } from "@/lib/player";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * 玩乐区：不是一串「标题+副标题」，而是**每个玩法一个小组件** ——
 * 点进去之前就能看到里面现在是什么样子（正在放哪首歌、写了多少篇日记、战绩如何）。
 */
export function PlayHub() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-2">
        <p className="text-xs tracking-wide text-muted">娱乐区</p>
        <h1 className="mt-1 font-serif text-2xl font-medium">玩乐</h1>
      </header>
      {/* 滚动放在外层、网格按内容撑高 —— 直接给网格 flex-1 会把行高定死，
          卡片里的文字就会被下边缘切掉。 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-above-nav">
        <div className="grid grid-cols-2 gap-3">
          <MusicWidget />
          <DiaryWidget />
          <ToolsWidget />
          <TruthWidget />
          <LearnWidget />
          <ShiganWidget />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 音乐 */

function MusicWidget() {
  const count = usePlayer((s) => s.tracks.length);
  const playing = usePlayer((s) => s.playing);
  const time = usePlayer((s) => s.time);
  const duration = usePlayer((s) => s.duration);
  const name = usePlayer((s) => {
    const t = s.tracks.find((x) => x.id === s.currentId);
    return t ? t.name : "";
  });
  const toggle = usePlayer((s) => s.toggle);
  const step = usePlayer((s) => s.step);
  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div className="aster-card relative col-span-2 overflow-hidden rounded-[1.75rem] border border-line p-4">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-sky-300/30 via-transparent to-indigo-400/20" />
      <Link to="/play/listen" aria-label="打开音乐" className="absolute inset-0 z-0" />

      <div className="pointer-events-none relative flex items-center gap-4">
        <span className="relative flex size-16 shrink-0 items-center justify-center rounded-2xl bg-elevated">
          <Disc3 className={cn("size-7 text-accent", playing && "aster-spin")} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] tracking-wide text-muted">音乐</p>
          <p className="mt-0.5 truncate text-[15px] font-medium">
            {name || (count > 0 ? "选一首" : "还没有歌")}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-muted">
            {count === 0 ? "点进去上传自己的歌" : playing ? "正在播放" : "已暂停"}
          </p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-fg/10">
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      {count > 0 && (
        <div className="absolute right-4 bottom-4 z-10 flex items-center gap-2">
          <button
            type="button"
            aria-label="下一首"
            onClick={() => step(1)}
            className="flex size-9 items-center justify-center rounded-full bg-elevated text-fg"
          >
            <SkipForward className="size-4" />
          </button>
          <button
            type="button"
            aria-label={playing ? "暂停" : "播放"}
            onClick={() => toggle()}
            className="flex size-11 items-center justify-center rounded-full bg-ink text-ink-fg"
          >
            {playing ? (
              <Pause className="size-4 fill-current" />
            ) : (
              <Play className="size-4 fill-current" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ 日记 */

const MOOD_LABEL: Record<string, string> = {
  calm: "平静",
  joy: "欢喜",
  focus: "专注",
  low: "低落",
  spark: "火花",
};

/**
 * 卡片里的预览按字数截断。
 *
 * 本来用 `line-clamp-2`，但实测它的 `display: -webkit-box` 被压成了
 * `flow-root`，行数截断没生效，文字被卡片下边缘切一半。按字数截最稳。
 */
function clip(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function DiaryWidget() {
  const diary = useApp((s) => s.diary);
  const latest = diary[0];

  return (
    <div className="aster-card relative overflow-hidden rounded-[1.75rem] border border-line p-4">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-200/35 via-transparent to-rose-300/20" />
      <Link to="/play/space" aria-label="打开动态空间" className="absolute inset-0 z-0" />
      <div className="pointer-events-none relative">
        <span className="flex size-9 items-center justify-center rounded-xl bg-elevated text-accent">
          <BookHeart className="size-4" strokeWidth={1.8} />
        </span>
        <p className="mt-2.5 text-[13px] font-medium">动态空间</p>
        <p className="text-[11px] text-muted">
          {diary.length > 0 ? `${diary.length} 篇` : "还没有写过"}
        </p>
        {/* 小纸片预览 */}
        <p className="mt-2 rounded-xl bg-elevated/80 px-2.5 py-2 text-[11px] leading-4 text-muted shadow-sm">
          {latest ? `${MOOD_LABEL[latest.mood] ?? ""} · ${clip(latest.body, 38)}` : "写下今天的一张纸。"}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 小日子 */

/**
 * 小日子：原来这里是「五子棋」单独一格，现在变成一个抽屉。
 *
 * 卡上顺手带一句现状 —— 最近的倒数、还有几件待办没做，
 * 点进去之前就知道里面有没有东西。
 */
function ToolsWidget() {
  const dates = useApp((s) => s.dates);
  const todos = useApp((s) => s.todos);
  const openTodos = todos.filter((t) => !t.done).length;
  const next = sortDates(dates)[0] ?? null;
  const nextLabel = next ? `${countdown(next.at, next.yearly).label} · ${next.title}` : null;

  return (
    <div className="aster-card relative overflow-hidden rounded-[1.75rem] border border-line p-4">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-stone-300/35 via-transparent to-amber-300/20" />
      <Link to="/play/tools" aria-label="打开小日子" className="absolute inset-0 z-0" />
      <div className="pointer-events-none relative">
        <span className="flex size-9 items-center justify-center rounded-xl bg-elevated text-accent">
          <CalendarHeart className="size-4" strokeWidth={1.8} />
        </span>
        <p className="mt-2.5 text-[13px] font-medium">小日子</p>
        <p className="text-[11px] text-muted">五子棋 · 重要日子 · 待办</p>
        <p className="mt-2 rounded-xl bg-elevated/80 px-2.5 py-2 text-[11px] leading-4 text-muted shadow-sm">
          {nextLabel ?? "记一个值得记住的日子"}
        </p>
        {openTodos > 0 && (
          <p className="mt-1.5 text-[11px] text-accent">{openTodos} 件待办没做</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 真心话 */

function TruthWidget() {
  const card = DECK[0]!;
  return (
    <div className="aster-card relative overflow-hidden rounded-[1.75rem] border border-line p-4">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet-300/30 via-transparent to-fuchsia-300/20" />
      <Link to="/play/truth" aria-label="打开真心话" className="absolute inset-0 z-0" />
      <div className="pointer-events-none relative">
        <span className="flex size-9 items-center justify-center rounded-xl bg-elevated text-accent">
          <Spade className="size-4" strokeWidth={1.8} />
        </span>
        <p className="mt-2.5 text-[13px] font-medium">真心话</p>
        <p className="text-[11px] text-muted">{DECK.length} 张牌 · 可调烈度</p>
        <p className="mt-2 rounded-xl bg-elevated/80 px-2.5 py-2 text-[11px] leading-4 text-muted shadow-sm">
          「{clip(card.text, 34)}」
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 时感 */

/**
 * 时感：把那个漂亮的时钟页**直接嵌进栖岛看**。
 *
 * 这里特意不显示"时感的时间" —— 我读不到它的界面（iframe 跨域），
 * 显示一个本机时钟会让人以为是时感在报时。所以卡上只写清楚：
 * 这是另一个页面，点进去看。
 */
function ShiganWidget() {
  const url = useApp((s) => s.settings.shiganUrl);
  const auto =
    typeof window === "undefined"
      ? "localhost:8081"
      : `${window.location.hostname}:8081`;
  const shown = (url.trim() || `http://${auto}/`).replace(/^https?:\/\//, "");

  return (
    <div className="aster-card relative col-span-2 overflow-hidden rounded-[1.75rem] border border-line p-4">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-300/30 via-transparent to-sky-300/20" />
      <Link to="/play/shigan" aria-label="打开时感" className="absolute inset-0 z-0" />
      <div className="pointer-events-none relative flex items-center gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-elevated text-accent">
          <Hourglass className="size-5" strokeWidth={1.6} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">时感</p>
          <p className="mt-0.5 text-[11px] text-muted">十二时辰 · 节气 · 时间间隔 —— 直接看那个页面</p>
          <p className="mt-1 truncate font-mono text-[10px] text-subtle">{shown}</p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-subtle" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 英语 */

function LearnWidget() {
  const stats = useApp((s) => s.learnStats);
  return (
    <div className="aster-card relative overflow-hidden rounded-[1.75rem] border border-line p-4">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-200/35 via-transparent to-teal-300/20" />
      <Link to="/play/learn" aria-label="打开英语学习" className="absolute inset-0 z-0" />
      <div className="pointer-events-none relative">
        <span className="flex size-9 items-center justify-center rounded-xl bg-elevated text-accent">
          <GraduationCap className="size-4" strokeWidth={1.8} />
        </span>
        <p className="mt-2.5 text-[13px] font-medium">英语学习</p>
        <p className="text-[11px] text-muted">
          {stats.seen > 0 ? `看过 ${stats.seen} 次` : "单词 · 翻译 · 阅读"}
        </p>
        <p className="mt-2 rounded-xl bg-elevated/80 px-2.5 py-2 font-serif text-[15px] shadow-sm">
          {stats.recent[0] ?? "serendipity"}
        </p>
      </div>
    </div>
  );
}
