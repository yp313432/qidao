import { useEffect, useRef } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Pause, Play, SkipForward } from "lucide-react";
import { attachAudioElement, playerOnEnded, usePlayer } from "@/lib/player";

/**
 * 全局播放宿主：整个 App 只此一个 <audio>。
 *
 * 因为它挂在 AppShell 上而不是音乐页里，所以切页面音乐不会断，
 * MediaSession（锁屏 / 通知栏）也始终有效。
 */
export function PlayerHost() {
  const ref = useRef<HTMLAudioElement>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const load = usePlayer((s) => s.load);
  const syncSource = usePlayer((s) => s.syncSource);
  const currentId = usePlayer((s) => s.currentId);
  const urls = usePlayer((s) => s.urls);
  const volume = usePlayer((s) => s.volume);
  const playing = usePlayer((s) => s.playing);
  const time = usePlayer((s) => s.time);
  const toast = usePlayer((s) => s.toast);
  const tracks = usePlayer((s) => s.tracks);

  const current = tracks.find((t) => t.id === currentId) ?? null;

  useEffect(() => {
    attachAudioElement(ref.current);
    return () => attachAudioElement(null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const onTime = () => usePlayer.setState({ time: a.currentTime });
    const onMeta = () =>
      usePlayer.setState({ duration: Number.isFinite(a.duration) ? a.duration : 0 });
    const onPlay = () => usePlayer.setState({ playing: true });
    const onPause = () => usePlayer.setState({ playing: false });
    const onEnded = () => playerOnEnded();
    const onError = () => usePlayer.getState().flash("这个文件播不了（浏览器可能不支持该格式）");
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    a.addEventListener("error", onError);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("error", onError);
    };
  }, []);

  useEffect(() => {
    syncSource();
  }, [currentId, urls, syncSource]);

  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume]);

  /* --------------------- 锁屏 / 通知栏的媒体控制 --------------------- */
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      if (current && typeof MediaMetadata !== "undefined") {
        ms.metadata = new MediaMetadata({
          title: current.name,
          artist: "栖岛 · 本地音乐库",
          album: "本地",
        });
      }
      ms.playbackState = playing ? "playing" : "paused";
      ms.setActionHandler("play", () => usePlayer.getState().play());
      ms.setActionHandler("pause", () => usePlayer.getState().pause());
      ms.setActionHandler("previoustrack", () => usePlayer.getState().step(-1));
      ms.setActionHandler("nexttrack", () => usePlayer.getState().step(1));
      ms.setActionHandler("seekbackward", () =>
        usePlayer.getState().seek(usePlayer.getState().time - 10),
      );
      ms.setActionHandler("seekforward", () =>
        usePlayer.getState().seek(usePlayer.getState().time + 10),
      );
      ms.setActionHandler("seekto", (d) => {
        if (typeof d.seekTime === "number") usePlayer.getState().seek(d.seekTime);
      });
    } catch {
      /* 有些浏览器不支持全部 action，忽略 */
    }
  }, [current, playing]);

  // 音乐列表和播放页都不需要迷你条：一个是选歌的地方，一个已经是全屏播放器
  const onMusicPage = pathname === "/play/listen" || pathname === "/play/player";
  const showMini = Boolean(current) && !onMusicPage && (playing || time > 0);

  // 让所有页面底部留白自动给迷你播放条让位（styles.css 里的 .pb-above-nav 用它）
  useEffect(() => {
    const root = document.documentElement;
    if (showMini) root.style.setProperty("--aster-mini", "3.4rem");
    else root.style.removeProperty("--aster-mini");
    return () => {
      root.style.removeProperty("--aster-mini");
    };
  }, [showMini]);

  return (
    <>
      <audio ref={ref} preload="metadata" className="hidden" />

      {/* 迷你播放条：证明播放器是全局的，别的页面也能控制 */}
      {showMini && current && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.9rem+env(safe-area-inset-bottom))] z-30 flex justify-center px-3">
          <div className="glass-nav pointer-events-auto flex w-full max-w-md items-center gap-1 rounded-full border border-line px-3 py-1.5">
            <Link to="/play/listen" className="min-w-0 flex-1 truncate py-1 text-[12px]">
              <span className="text-muted">{playing ? "♪ " : "❚❚ "}</span>
              {current.name}
            </Link>
            <button
              type="button"
              aria-label={playing ? "暂停" : "播放"}
              onClick={() => usePlayer.getState().toggle()}
              className="flex size-8 items-center justify-center rounded-full bg-chip"
            >
              {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </button>
            <button
              type="button"
              aria-label="下一首"
              onClick={() => usePlayer.getState().step(1)}
              className="flex size-8 items-center justify-center rounded-full bg-chip"
            >
              <SkipForward className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(9rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4">
          <p className="rounded-full bg-ink px-4 py-2 text-[13px] text-ink-fg shadow-lg">{toast}</p>
        </div>
      )}
    </>
  );
}
