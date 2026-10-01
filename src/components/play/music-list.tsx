import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Disc3, Headphones, Link2, Plus, Trash2 } from "lucide-react";
import { PlayHeader } from "@/components/play-header";
import { kindLabel } from "@/lib/music-embed";
import { usePlayer } from "@/lib/player";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * 第 2 层：音乐列表。
 *
 * 本地的和外链的**排在一起**，点谁就放谁，然后进播放页。
 * 加歌收进右上角的「＋」后面的单独一页，列表本身只负责「选」。
 */
export function MusicListView() {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const tracks = usePlayer((s) => s.tracks);
  const currentId = usePlayer((s) => s.currentId);
  const playing = usePlayer((s) => s.playing);
  const embeds = useApp((s) => s.musicEmbeds);
  const currentEmbedId = useApp((s) => s.currentEmbedId);
  const navigate = useNavigate();

  function openLocal(id: string) {
    useApp.getState().setCurrentEmbed(null);
    usePlayer.getState().play(id);
    void navigate({ to: "/play/player" });
  }

  function openEmbed(id: string) {
    usePlayer.getState().pause();
    useApp.getState().setCurrentEmbed(id);
    void navigate({ to: "/play/player" });
  }

  const empty = tracks.length === 0 && embeds.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PlayHeader
        title="音乐"
        extra={
          <Link
            to="/play/add"
            aria-label="添加音乐"
            className="flex size-11 items-center justify-center text-accent"
          >
            <Plus className="size-6" strokeWidth={2} />
          </Link>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-above-nav">
        {empty && (
          <div className="mt-6 rounded-3xl border border-line bg-surface px-6 py-12 text-center">
            <Headphones className="mx-auto size-8 text-muted" strokeWidth={1.5} />
            <p className="mt-4 text-[15px] font-medium">还没有音乐</p>
            <p className="mt-2 text-[13px] leading-6 text-muted">
              点右上角的 <span className="text-accent">＋</span>
              <br />
              导入本地文件，或者粘贴网易云 / QQ音乐 / Spotify 的链接
            </p>
          </div>
        )}

        {tracks.length > 0 && (
          <>
            <p className="mb-2 px-1 text-[12px] tracking-wide text-muted">
              本地 · {tracks.length} 首
            </p>
            <ul className="space-y-2">
              {tracks.map((t) => {
                const active = t.id === currentId && !currentEmbedId;
                return (
                  <li key={t.id}>
                    <div
                      className={cn(
                        "flex items-center gap-1 overflow-hidden rounded-3xl border border-line pr-1 transition-colors",
                        active ? "glass-active" : "bg-surface",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => openLocal(t.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
                      >
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-chip text-accent">
                          <Disc3 className={cn("size-4", active && playing && "aster-spin")} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium">{t.name}</span>
                          <span className="mt-0.5 block text-[11px] text-muted">
                            {t.lyrics ? (/\[|\d{2}:/.test(t.lyrics) ? "同步歌词" : "有歌词") : "无歌词"}
                            {active && playing ? " · 正在播放" : ""}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`删除 ${t.name}`}
                        onClick={() => setConfirmId(confirmId === t.id ? null : t.id)}
                        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    {confirmId === t.id && (
                      <div className="mt-1.5 flex items-center gap-2 rounded-2xl bg-warn/10 px-3 py-2">
                        <span className="min-w-0 flex-1 text-[11px] leading-4 text-warn">
                          删掉这首？文件会从这台设备移走，恢复不了。
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            void usePlayer.getState().remove(t.id);
                            setConfirmId(null);
                          }}
                          className="shrink-0 rounded-full bg-warn px-3 py-1.5 text-[11px] font-medium text-white"
                        >
                          删除
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          className="shrink-0 rounded-full bg-chip px-3 py-1.5 text-[11px]"
                        >
                          取消
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {embeds.length > 0 && (
          <>
            <p className="mt-5 mb-2 px-1 text-[12px] tracking-wide text-muted">
              外链 · {embeds.length} 条
            </p>
            <ul className="space-y-2">
              {embeds.map((e) => {
                const active = e.id === currentEmbedId;
                return (
                  <li key={e.id}>
                    <div
                      className={cn(
                        "flex items-center gap-1 overflow-hidden rounded-3xl border border-line pr-1 transition-colors",
                        active ? "glass-active" : "bg-surface",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => openEmbed(e.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
                      >
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-chip text-accent">
                          <Link2 className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium">
                            {e.serviceLabel} · {kindLabel(e.kind)}
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-[11px] text-muted">
                            {e.sourceId}
                          </span>
                        </span>
                        {active && <span className="shrink-0 text-[11px] text-accent">播放中</span>}
                      </button>
                      <button
                        type="button"
                        aria-label={`移除 ${e.serviceLabel} 外链`}
                        onClick={() => useApp.getState().removeMusicEmbed(e.id)}
                        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 px-1 text-[11px] leading-4 text-subtle">
              外链放的是对方官方播放器 —— 样式、能不能放（会员歌只能试听）都由对方决定。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
