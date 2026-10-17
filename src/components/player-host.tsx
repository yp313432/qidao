import { useEffect, useRef } from "react";
import { attachAudioElement, playerOnEnded, usePlayer } from "@/lib/player";

/**
 * 全局播放宿主：整个 App 只此一个 <audio>。
 *
 * 因为它挂在 AppShell 上而不是音乐页里，所以切页面音乐不会断，
 * MediaSession（锁屏 / 通知栏）也始终有效。
 *
 * ⚠️ 迷你条**不在这里画**了（2026-11 用户 m03024 第 5 条）：原来它和
 * `play/embed-host.tsx` 各画一条，两条还是同一个位置，一起响时会叠在一起。
 * 现在统一由 `components/audio-widget.tsx` 那**一个**悬浮窗负责（小球 ↔ 胶囊），
 * 这个文件只管 `<audio>`、事件和 MediaSession。
 */
export function PlayerHost() {
  const ref = useRef<HTMLAudioElement>(null);

  const load = usePlayer((s) => s.load);
  const syncSource = usePlayer((s) => s.syncSource);
  const currentId = usePlayer((s) => s.currentId);
  const urls = usePlayer((s) => s.urls);
  const volume = usePlayer((s) => s.volume);
  const playing = usePlayer((s) => s.playing);
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
    const onError = () => {
      /**
       * ⚠️ 悬浮窗点 ✕ 会 `removeAttribute("src")` + `load()`（见 `player.ts` 的 `close()`）——
       * Chrome / 安卓 WebView 为这个"空 src"**还会再发一次 error**，那不是播放失败。
       * 判据：`close()` 里 `currentId` 已经被清成 null，所以没选中曲目时就闭嘴。
       */
      if (!usePlayer.getState().currentId) return;
      usePlayer.getState().flash("这个文件播不了（浏览器可能不支持该格式）");
    };
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

  return (
    <>
      <audio ref={ref} preload="metadata" className="hidden" />

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(9rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4">
          <p className="rounded-full bg-ink px-4 py-2 text-[13px] text-ink-fg shadow-lg">{toast}</p>
        </div>
      )}
    </>
  );
}
