import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  ListMusic,
  Link2,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Volume2,
} from "lucide-react";
import { FileButton } from "@/components/file-button";
import { SceneBackdrop } from "@/components/background-layer";
import { SongStage } from "@/components/play/song-stage";
import { activeLineIndex, parseLrc, readEmbeddedLyrics } from "@/lib/lyrics";
import { embedHeight, kindLabel } from "@/lib/music-embed";
import { usePlayer } from "@/lib/player";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

const AUDIO_ACCEPT = "audio/*,.mp3,.m4a,.wav,.flac,.ogg,.aac";

function mmss(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "0:00";
  const m = Math.floor(v / 60);
  const s = Math.floor(v % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 每家一个机身色 —— 白色屏幕放在同色系的机身上才像一台机器。 */
const SERVICE_BRAND: Record<string, string> = {
  qq: "from-emerald-200/45 via-transparent to-lime-200/25",
  netease: "from-rose-200/45 via-transparent to-orange-200/20",
  spotify: "from-green-200/45 via-transparent to-emerald-200/20",
};

/**
 * 第 3 层：播放页。
 *
 * 本地音乐是一台黑胶：转着放，中间是封面，下面是实时歌词（点一下展开全部）。
 * 外链放的是**对方的官方播放器** —— 那部分我改不了样式，只能给它一个好看的框。
 */
export function PlayerView() {
  const tracks = usePlayer((s) => s.tracks);
  const currentId = usePlayer((s) => s.currentId);
  const playing = usePlayer((s) => s.playing);
  const time = usePlayer((s) => s.time);
  const duration = usePlayer((s) => s.duration);
  const loop = usePlayer((s) => s.loop);
  const volume = usePlayer((s) => s.volume);
  const busy = usePlayer((s) => s.busy);
  const notice = usePlayer((s) => s.notice);
  const toggle = usePlayer((s) => s.toggle);
  const step = usePlayer((s) => s.step);
  const seek = usePlayer((s) => s.seek);

  const embeds = useApp((s) => s.musicEmbeds);
  const currentEmbedId = useApp((s) => s.currentEmbedId);
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patchSettings);
  const embed = embeds.find((e) => e.id === currentEmbedId) ?? null;
  const [quoteDraft, setQuoteDraft] = useState(settings.embedQuote);

  useEffect(() => {
    setQuoteDraft(settings.embedQuote);
  }, [settings.embedQuote]);

  /**
   * 那句话边打边存。
   *
   * 原来只在 `onBlur` 存 —— 可 blur 不冒泡（React 要的是 focusout），
   * 而且你没点别处就退出的话改动会丢。改成停手 600ms 就写进去。
   */
  const quoteTimer = useRef(0);
  function onQuoteChange(v: string) {
    const t = v.slice(0, 40);
    setQuoteDraft(t);
    window.clearTimeout(quoteTimer.current);
    quoteTimer.current = window.setTimeout(() => {
      const trimmed = t.trim();
      if (trimmed) patch({ embedQuote: trimmed });
    }, 600);
  }
  useEffect(() => () => window.clearTimeout(quoteTimer.current), []);

  const [fullLyrics, setFullLyrics] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [finding, setFinding] = useState(false);
  const [findMsg, setFindMsg] = useState("");
  /** 已经自动找过的曲目，避免来回重试 */
  const triedRef = useRef<Set<string>>(new Set());
  const lyricBox = useRef<HTMLDivElement>(null);

  const current = tracks.find((t) => t.id === currentId) ?? null;
  const lines = useMemo(() => (current ? parseLrc(current.lyrics) : []), [current]);
  const plain = current && lines.length === 0 ? current.lyrics.trim() : "";
  const active = activeLineIndex(lines, time);
  const activeText = active >= 0 ? (lines[active]?.text ?? "").trim() : "";
  const nextText = active >= 0 ? (lines[active + 1]?.text ?? "").trim() : "";

  // 展开歌词时把当前行滚到中间
  useEffect(() => {
    if (!fullLyrics) return;
    const box = lyricBox.current;
    if (!box || active < 0) return;
    box.querySelector<HTMLElement>(`[data-line="${active}"]`)?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [active, fullLyrics]);

  async function commitLyrics() {
    if (!current) return;
    await usePlayer.getState().writeLyrics(current.id, draft, "manual");
    setEditorOpen(false);
  }

  async function loadLrcFile(file: File | undefined) {
    if (!file || !current) return;
    const text = await file.text();
    setDraft(text);
  }

  /** 从音频文件里读内嵌歌词（ID3 USLT / m4a ©lyr）。 */
  async function pullEmbedded() {
    if (!current) return;
    const asFile = new File([current.blob], current.name, { type: current.type || "audio/mpeg" });
    const embedded = await readEmbeddedLyrics(asFile);
    if (!embedded) {
      usePlayer.getState().flash("这个文件里没有内嵌歌词");
      return;
    }
    await usePlayer.getState().writeLyrics(current.id, embedded, "embedded");
    setEditorOpen(false);
  }

  /**
   * 自动找歌词：先看文件内嵌，没有就查网络歌词库（LRCLIB）。
   * 走的是我们自己的服务端接口，所以没有跨域问题。
   */
  async function findLyrics(manual = false) {
    if (!current || finding) return;
    setFinding(true);
    setFindMsg("");

    // 1) 文件里有没有内嵌歌词
    if (!manual) {
      try {
        const embedded = await readEmbeddedLyrics(
          new File([current.blob], current.name, { type: current.type || "audio/mpeg" }),
        );
        if (embedded) {
          await usePlayer.getState().writeLyrics(current.id, embedded, "embedded");
          setFinding(false);
          setFindMsg("从文件里读到了内嵌歌词");
          return;
        }
      } catch {
        /* 读不出来就继续查网络 */
      }
    }

    // 2) 查歌词库
    const base = current.name.replace(/\.[^.]+$/, "").trim();
    try {
      const res = await fetch(
        `/api/lyrics?q=${encodeURIComponent(base)}&duration=${Math.round(duration || 0)}`,
      );
      const out = (await res.json()) as {
        ok?: boolean;
        message?: string;
        synced?: string;
        plain?: string;
        title?: string;
        artist?: string;
      };
      if (!out.ok) {
        setFindMsg(out.message ?? "没找到歌词");
        return;
      }
      const text = (out.synced ?? "").trim() || (out.plain ?? "").trim();
      if (!text) {
        setFindMsg("找到了歌，但它没有歌词");
        return;
      }
      await usePlayer.getState().writeLyrics(current.id, text, "online");
      setFindMsg(
        `找到了：${out.title ?? ""}${out.artist ? ` · ${out.artist}` : ""}${
          out.synced ? "（逐行同步）" : "（纯文本）"
        }`,
      );
    } catch {
      setFindMsg("找歌词失败 —— 网络不通，或者这个环境没有服务端。");
    } finally {
      setFinding(false);
    }
  }

  // 换了歌、而且这首歌还没歌词 → 自动找一次
  useEffect(() => {
    if (!current) return;
    if (current.lyrics.trim()) return;
    if (triedRef.current.has(current.id)) return;
    triedRef.current.add(current.id);
    void findLyrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.lyrics]);

  const sourceLabel =
    current?.lyricsSource === "embedded"
      ? " · 歌词来自文件内嵌"
      : current?.lyricsSource === "online"
        ? " · 歌词来自网络歌词库"
        : "";

  const pct = duration > 0 ? (time / duration) * 100 : 0;
  const hasLocal = Boolean(current);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 这一页自己的背景；没设就跟着主页那张走 —— 和下面装饰块的配图用**同一个来源**，
          否则会出现「换了背景只有小组件变、页面不变」的错位。 */}
      <SceneBackdrop image={settings.musicImage || settings.background.image} />
      <header className="flex items-center gap-1 px-2 inset-top-60 pb-1">
        <Link
          to="/play/listen"
          aria-label="返回音乐列表"
          className="flex size-11 items-center justify-center"
        >
          <ChevronLeft className="size-6" strokeWidth={1.6} />
        </Link>
        <h1 className="flex-1 truncate font-serif text-lg font-medium">正在播放</h1>
        <Link
          to="/play/listen"
          aria-label="音乐列表"
          className="flex size-11 items-center justify-center text-muted"
        >
          <ListMusic className="size-5" strokeWidth={1.7} />
        </Link>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-above-nav-lg">
        {/* ---------- 外链：放对方官方播放器 ---------- */}
        {embed ? (
          <div className="space-y-3">
            {/* ---- 装饰块（我设计的，纯装饰）----
                 外面这层是「好看」的部分：配图 + 一句唯美的话 + 波形纹理 + 呼吸的柔光。
                 底下那个才是真能干活的官方播放器。
                 故意**不画假按钮、假进度条** —— 按不动的东西比不好看更糟。 */}
            <div className="aster-card relative overflow-hidden rounded-[2rem] border border-line">
              {/* 配图：和这一页的背景**同一个来源**（音乐页背景优先，否则主页背景）。
                  以前这里只读主页背景，于是「换了音乐页背景」只有小组件变、页面不变。 */}
              {settings.musicImage || settings.background.image ? (
                <img
                  src={settings.musicImage || settings.background.image}
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                  style={{ filter: "saturate(0.85)" }}
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-sky-200/50 via-transparent to-violet-200/40" />
              )}
              {/* 服务色 + 压暗，保证字看得清 */}
              <div
                className={cn(
                  "absolute inset-0 bg-gradient-to-br mix-blend-soft-light",
                  SERVICE_BRAND[embed.service],
                )}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-transparent" />

              <div className="relative px-5 pt-5 pb-5 text-center">
                {/* 双人头像 + 心跳线：和本地播放页同一套视觉语言（QQ 那两个字删了，
                    下面官方播放器上本来就有它的标）。

                    故意走**暂停时的慢速**：我读不到对方到底在不在放（跨域），
                    用播放时的快节奏就等于在骗你说「正在播放」。 */}
                <SongStage playing={false} />

                <p className="mt-3 font-serif text-[17px] leading-7 text-white drop-shadow-sm">
                  {settings.embedQuote}
                </p>

                <p className="mt-3 inline-flex rounded-full bg-black/25 px-3.5 py-1.5 text-[11px] text-white/90 backdrop-blur-sm">
                  {embed.serviceLabel} · {kindLabel(embed.kind)} · 画面与音源来自它，不是我
                </p>
              </div>
            </div>

            {/* ---- 功能块：官方播放器 ---- */}
            <div className="rounded-3xl border border-line bg-surface px-4 py-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">官方播放器</p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    播放 / 暂停 / 切歌都在这一块里面
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => useApp.getState().setCurrentEmbed(null)}
                  className="shrink-0 rounded-full bg-chip px-3.5 py-2 text-[12px] font-medium text-fg"
                >
                  停止
                </button>
              </div>

              <div className="rounded-[1.4rem] bg-white p-2.5 shadow-[0_14px_36px_rgba(0,0,0,0.16)]">
                <div
                  id="embed-slot"
                  className="w-full overflow-hidden"
                  style={{ height: embedHeight(embed.service, embed.kind), borderRadius: 14 }}
                />
              </div>

              <p className="mt-2.5 text-[11px] leading-4 text-subtle">
                这块是 {embed.serviceLabel} 自己的界面 —— 封面、按钮、能不能放都由它决定（会员歌通常只能试听约
                1 分钟），我改不动里面。切到别的页面它会继续放，底部有迷你条可以随时停。
              </p>
            </div>

            {/* ---- 那句话可以自己改 ---- */}
            <div className="rounded-3xl border border-line bg-surface px-4 py-4">
              <p className="text-[12px] font-medium">上面那句话</p>
              <textarea
                value={quoteDraft}
                onChange={(e) => onQuoteChange(e.target.value)}
                rows={2}
                aria-label="装饰句子"
                className="mt-2 w-full resize-none rounded-2xl bg-chip px-3.5 py-2.5 text-[13px] leading-6 outline-none"
              />
              <p className="mt-1.5 text-[11px] text-subtle">
                写你自己的就行（停下就自动保存）· 配图用的是你在「我的 → 背景空间」里设的那张图
              </p>
            </div>

            <div className="rounded-3xl border border-line bg-surface px-4 py-4">
              <p className="text-[12px] leading-5 text-muted">
                想要<span className="text-fg">从头到尾都由这个 App 控制</span>
                的播放器（黑胶、逐行歌词、后台播放）？回列表导入本地音乐文件就行。
              </p>
              <div className="mt-3 flex gap-2">
                <Link
                  to="/play/listen"
                  className="rounded-full bg-chip px-4 py-2.5 text-[12px] font-medium"
                >
                  回音乐列表
                </Link>
                <Link
                  to="/play/add"
                  className="rounded-full bg-ink px-4 py-2.5 text-[12px] font-medium text-ink-fg"
                >
                  导入本地音乐
                </Link>
              </div>
            </div>
          </div>
        ) : !hasLocal ? (
          /* ---------- 什么都没选 ---------- */
          <div className="mt-6 rounded-3xl border border-line bg-surface px-6 py-12 text-center">
            <p className="text-[15px] font-medium">还没有选歌</p>
            <p className="mt-2 text-[13px] leading-6 text-muted">
              回到音乐列表点一首，或者点右上角的 ＋ 添加。
            </p>
            <Link
              to="/play/listen"
              className="mt-5 inline-flex rounded-full bg-ink px-5 py-3 text-[13px] font-medium text-ink-fg"
            >
              去音乐列表
            </Link>
          </div>
        ) : (
          /* ---------- 本地：黑胶 ---------- */
          <>
            <div className="relative mx-auto mt-2 size-60">
              <div
                className={cn(
                  "aster-vinyl absolute inset-0 rounded-full",
                  playing && "aster-spin-slow",
                )}
              >
                {/* 中心封面 */}
                <span className="absolute inset-[31%] flex items-center justify-center overflow-hidden rounded-full bg-elevated">
                  <span className="font-serif text-2xl text-accent">
                    {current!.name.replace(/\.[^.]+$/, "").trim().slice(0, 1) || "♪"}
                  </span>
                </span>
              </div>
            </div>

            <div className="mt-4 text-center">
              <p className="truncate font-serif text-xl font-medium">
                {current!.name.replace(/\.[^.]+$/, "")}
              </p>
              <p className="mt-1 text-[12px] text-muted">
                {busy ? "正在导入…" : playing ? "正在播放" : "已暂停"}
                {sourceLabel}
              </p>
            </div>

            <SongStage playing={playing} />

            {/* 进度 */}
            <div className="mt-4 flex items-center gap-3">
              <span className="w-10 shrink-0 text-[11px] tabular-nums text-muted">{mmss(time)}</span>
              <input
                type="range"
                min={0}
                max={Math.max(1, duration)}
                step={0.1}
                value={Math.min(time, duration || 1)}
                onChange={(e) => seek(Number(e.target.value))}
                aria-label="播放进度"
                className="w-full"
                style={{
                  accentColor: "var(--aster-accent)",
                  background: `linear-gradient(to right, var(--aster-accent) ${pct}%, transparent ${pct}%)`,
                }}
              />
              <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted">
                {mmss(duration)}
              </span>
            </div>

            {/* 控制 */}
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                type="button"
                aria-label="上一步"
                onClick={() => seek(Math.max(0, time - 15))}
                className="flex size-11 items-center justify-center rounded-full bg-chip"
              >
                <SkipBack className="size-5" />
              </button>
              <button
                type="button"
                aria-label={playing ? "暂停" : "播放"}
                onClick={() => toggle()}
                className="flex size-16 items-center justify-center rounded-full bg-ink text-ink-fg"
              >
                {playing ? (
                  <Pause className="size-6 fill-current" />
                ) : (
                  <Play className="size-6 fill-current" />
                )}
              </button>
              <button
                type="button"
                aria-label="下一步"
                onClick={() => step(1)}
                className="flex size-11 items-center justify-center rounded-full bg-chip"
              >
                <SkipForward className="size-5" />
              </button>
            </div>

            <div className="mt-3 flex items-center justify-center gap-4 text-[11px] text-muted">
              <button
                type="button"
                aria-label={loop ? "关闭循环" : "循环播放"}
                onClick={() => usePlayer.getState().setLoop(!loop)}
                className={cn("flex items-center gap-1", loop && "text-accent")}
              >
                <Repeat className="size-3.5" />
                {loop ? "循环中" : "循环"}
              </button>
              <label className="flex items-center gap-1.5">
                <Volume2 className="size-3.5" />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  aria-label="音量"
                  onChange={(e) => usePlayer.getState().setVolume(Number(e.target.value))}
                  className="w-24"
                  style={{ accentColor: "var(--aster-accent)" }}
                />
              </label>
            </div>

            {/* 歌词：平时只显示此刻这一句，点开看全部 */}
            <div className="mt-5 rounded-3xl border border-line bg-surface px-4 py-4 text-center">
              <button
                type="button"
                onClick={() => setFullLyrics(true)}
                className="w-full"
                aria-label="打开完整歌词"
              >
                {activeText ? (
                  <>
                    <span className="block font-serif text-[17px] leading-7 text-fg">
                      {activeText}
                    </span>
                    {nextText && (
                      <span className="mt-1 block text-[13px] leading-5 text-subtle">
                        {nextText}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="block text-[13px] text-muted">
                    {lines.length > 0
                      ? "前奏中 · 歌词会到点滚出来"
                      : plain
                        ? "有纯文本歌词 · 点开看"
                        : "还没有歌词"}
                  </span>
                )}
                <span className="mt-2 block text-[10px] text-subtle">点一下看完整歌词</span>
              </button>

              <button
                type="button"
                aria-label="自动找歌词"
                disabled={finding}
                onClick={() => void findLyrics(true)}
                className="mt-3 rounded-full bg-chip px-4 py-2 text-[12px] font-medium disabled:opacity-50"
              >
                {finding ? "正在找…" : "自动找歌词"}
              </button>
              {findMsg && (
                <p className="mt-2 text-[11px] leading-4 text-subtle">{findMsg}</p>
              )}
            </div>

            {notice && <p className="mt-3 text-center text-[11px] text-warn">{notice}</p>}
          </>
        )}
      </div>

      {/* 全屏歌词 */}
      {fullLyrics && hasLocal && (
        <div className="fixed inset-0 z-40 flex flex-col bg-bg">
          <header className="flex items-center gap-1 px-2 inset-top-60 pb-1">
            <button
              type="button"
              aria-label="收起歌词"
              onClick={() => setFullLyrics(false)}
              className="flex size-11 items-center justify-center"
            >
              <ChevronLeft className="size-6 rotate-[-90deg]" strokeWidth={1.6} />
            </button>
            <h2 className="flex-1 truncate font-serif text-lg font-medium">{current!.name}</h2>
            <button
              type="button"
              onClick={() => {
                setDraft(current!.lyrics);
                setEditorOpen(true);
              }}
              className="px-3 text-[12px] text-accent"
            >
              编辑
            </button>
          </header>

          <div ref={lyricBox} className="min-h-0 flex-1 overflow-y-auto px-6 py-8 pb-above-nav">
            {lines.length > 0 ? (
              lines.map((l, i) => (
                <button
                  key={`${l.time}-${i}`}
                  type="button"
                  data-line={i}
                  onClick={() => seek(l.time)}
                  className={cn(
                    "block w-full py-2 text-left text-[16px] leading-7 transition-all",
                    i === active ? "font-medium text-fg" : "text-muted/60",
                  )}
                >
                  {l.text || "♪"}
                </button>
              ))
            ) : plain ? (
              <pre className="font-sans text-[15px] leading-7 whitespace-pre-wrap text-muted">
                {plain}
              </pre>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDraft("");
                  setEditorOpen(true);
                }}
                className="w-full rounded-2xl border border-dashed border-line py-6 text-[13px] text-muted"
              >
                还没有歌词 · 点这里粘贴或上传 .lrc
              </button>
            )}
          </div>
        </div>
      )}

      {/* 歌词编辑 */}
      {editorOpen && current && (
        <div className="fixed inset-0 z-50 flex items-end">
          <button
            type="button"
            aria-label="关闭"
            className="absolute inset-0 bg-fg/20"
            onClick={() => setEditorOpen(false)}
          />
          <div className="glass-panel relative z-10 max-h-[85vh] w-full overflow-y-auto rounded-t-[2.5rem] px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <p className="font-serif text-lg">歌词 · {current.name}</p>
            <p className="mt-1 text-[12px] leading-5 text-muted">
              粘贴 LRC（形如 <code className="font-mono">[00:12.34]这一句</code>
              ）就能逐行同步；只贴纯文本也可以，但不会滚动。
            </p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={10}
              placeholder="[00:00.00]第一句&#10;[00:05.20]第二句"
              className="mt-3 w-full resize-none rounded-2xl border border-line bg-surface px-4 py-3 font-mono text-[13px] leading-6 outline-none placeholder:text-subtle"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void commitLyrics()}
                className="rounded-full bg-ink px-4 py-2.5 text-[13px] font-medium text-ink-fg"
              >
                保存
              </button>
              <FileButton
                ariaLabel="上传歌词文件"
                accept=".lrc,text/plain"
                className="rounded-full bg-chip px-4 py-2.5 text-[13px]"
                onPick={(files) => void loadLrcFile(files[0])}
              >
                上传 .lrc
              </FileButton>
              <button
                type="button"
                onClick={() => void pullEmbedded()}
                className="rounded-full bg-chip px-4 py-2.5 text-[13px]"
              >
                从文件里读
              </button>
              <button
                type="button"
                disabled={finding}
                onClick={() => void findLyrics(true)}
                className="rounded-full bg-chip px-4 py-2.5 text-[13px] disabled:opacity-50"
              >
                {finding ? "正在找…" : "自动找歌词"}
              </button>
            </div>
            {findMsg && <p className="mt-2 text-[11px] leading-4 text-subtle">{findMsg}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
