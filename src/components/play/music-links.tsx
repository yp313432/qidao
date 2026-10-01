import { useState } from "react";
import { Link2, Trash2 } from "lucide-react";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * 外链歌单：贴一条链接，页面里嵌**官方**的外链播放器。
 *
 * 人不用离开 App，也不用下载任何文件 —— 但播放器是对方控制的，
 * 所以把已知的限制明明白白写在界面上，免得你以为坏了。
 */
export function MusicLinks({ compact = false }: { compact?: boolean }) {
  const embeds = useApp((s) => s.musicEmbeds);
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState("");
  const [bad, setBad] = useState(false);

  function add() {
    const r = useApp.getState().addMusicEmbed(url);
    const isBad = !r.startsWith("已加入") && !r.includes("已经在列表里");
    setBad(isBad);
    setMsg(r);
    if (!isBad) setUrl("");
  }

  return (
    <div className="space-y-3">
      <div className="rounded-3xl border border-line bg-surface px-4 py-4">
        <p className="text-[13px] font-medium">贴一条分享链接</p>
        <p className="mt-1 text-[11px] leading-4 text-muted">
          支持网易云音乐、QQ音乐、Spotify。用的是
          <span className="text-fg">它们官方给网站用的外链播放器</span>
          —— 不抓音频、不下载，人也不用离开这个 App。
        </p>

        <div className="mt-3 flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            aria-label="音乐分享链接"
            placeholder="粘贴歌曲 / 歌单链接…"
            className="min-w-0 flex-1 rounded-2xl bg-chip px-3.5 py-2.5 text-[13px] outline-none placeholder:text-subtle"
          />
          <button
            type="button"
            onClick={add}
            className="shrink-0 rounded-2xl bg-ink px-4 py-2.5 text-[13px] font-medium text-ink-fg"
          >
            加入
          </button>
        </div>

        {msg && (
          <p
            className={cn(
              "mt-2.5 rounded-2xl px-3 py-2 text-[11px] leading-4",
              bad ? "bg-warn/10 text-warn" : "bg-ok/10 text-ok",
            )}
          >
            {msg}
          </p>
        )}

        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] text-subtle">怎么拿到链接？点了有说明</summary>
          <ul className="mt-2 space-y-1.5 text-[11px] leading-4 text-muted">
            <li>
              <span className="text-fg">QQ音乐</span>：PC 网页版打开歌曲 → 更多 → 分享 → 复制链接，
              里面 <span className="font-mono">songid=</span> 后面那串数字就是它要的。手机端拿不到 ID。
            </li>
            <li>
              <span className="text-fg">网易云</span>：网页版打开单曲/歌单 → 分享 → 复制链接。
            </li>
            <li>
              <span className="text-fg">Spotify</span>：分享 → 复制歌曲/歌单链接。
            </li>
          </ul>
        </details>
      </div>

      <div className="rounded-3xl border border-line bg-surface px-4 py-3">
        <p className="text-[11px] leading-4 text-muted">
          <span className="text-fg">三个已知限制</span>（不是坏了，是对方的规矩）：
        </p>
        <ul className="mt-1.5 space-y-1 text-[11px] leading-4 text-muted">
          <li>
            · 会员/付费歌在官方播放器里<span className="text-fg">只能试听约 1 分钟</span>
          </li>
          <li>
            · 网易云的外链播放器久未维护，<span className="text-fg">手机上可能显示不出来</span> → 优先用
            QQ音乐
          </li>
          <li>· 手机上对方页面可能自己弹「打开 App」，那不是我们能控制的</li>
        </ul>
      </div>

      {embeds.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line px-6 py-10 text-center">
          <Link2 className="mx-auto size-6 text-muted" strokeWidth={1.5} />
          <p className="mt-3 text-[13px] text-muted">还没有外链。贴一条试试。</p>
        </div>
      ) : (
        embeds.map((e) => (
          <div key={e.id} className="overflow-hidden rounded-3xl border border-line bg-surface">
            <div className="flex items-center justify-between gap-2 px-4 py-2.5">
              <span className="min-w-0">
                <span className="block text-[12px] font-medium">
                  {e.serviceLabel} · {e.kind === "song" ? "单曲" : e.kind === "playlist" ? "歌单" : e.kind === "album" ? "专辑" : e.kind === "radio" ? "电台" : "歌手"}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[10px] text-subtle">
                  {e.sourceId}
                </span>
              </span>
              <button
                type="button"
                aria-label="移除这条外链"
                onClick={() => useApp.getState().removeMusicEmbed(e.id)}
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-chip text-muted"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            {!compact && (
              <div className="flex justify-center pb-3">
                <iframe
                  src={e.embedUrl}
                  title={`${e.serviceLabel} 播放器`}
                  width={e.service === "qq" ? 320 : "100%"}
                  height={e.height}
                  style={{ border: 0, borderRadius: 14, maxWidth: "100%" }}
                  allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                  loading="lazy"
                />
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
