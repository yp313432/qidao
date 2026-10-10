import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Link2, Square } from "lucide-react";
import { embedHeight } from "@/lib/music-embed";
import { useApp } from "@/lib/store";

/**
 * 外链播放器的全局宿主。
 *
 * iframe 一旦**卸载**声音就断了 —— 所以它必须一直挂在 DOM 上：
 *  · 在播放页时，挪到 `#embed-slot` 插槽的位置上（看起来就像嵌在页面里）；
 *  · 不在播放页时，挪到屏幕外（仍然挂载，所以音乐继续放）。
 *
 * 两个坑都在这里踩过：
 *  1. 不能用 `display: none` —— 浏览器会把里面的播放停掉，所以用 `left: -9999px`。
 *  2. **位置判断必须跟着路由走**：只靠轮询插槽的话，返回上一层时旧的位置会
 *     多留一两秒，看起来像卡在页面上。现在不在播放页就立刻不定位。
 */
export function EmbedHost() {
  const embeds = useApp((s) => s.musicEmbeds);
  const currentEmbedId = useApp((s) => s.currentEmbedId);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const embed = embeds.find((e) => e.id === currentEmbedId) ?? null;
  const height = embed ? embedHeight(embed.service, embed.kind) : 0;

  const onPlayerPage = pathname === "/play/player";
  // 玩乐的子页面是不显示底部导航的，迷你条的位置要跟着让
  const navHidden = pathname.startsWith("/play/") && pathname !== "/play";
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);

  // 不在播放页 → 立刻把它挪走，不等下一轮轮询
  const placed = onPlayerPage ? box : null;

  useEffect(() => {
    if (!embed || !onPlayerPage) {
      setBox(null);
      return;
    }
    let raf = 0;
    const sync = () => {
      const slot = document.getElementById("embed-slot");
      if (!slot) {
        setBox(null);
        return;
      }
      const r = slot.getBoundingClientRect();
      const visible = r.bottom > 0 && r.top < window.innerHeight;
      setBox(visible ? { left: r.left, top: r.top, width: r.width } : null);
    };
    const onMove = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(sync);
    };
    sync();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    const timer = window.setInterval(sync, 250);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
    };
  }, [embed, onPlayerPage]);

  if (!embed) return null;

  return (
    <>
      <div
        style={{
          position: "fixed",
          left: placed ? placed.left : -9999,
          top: placed ? placed.top : 0,
          width: placed ? placed.width : 320,
          height,
          zIndex: placed ? 20 : 1,
          pointerEvents: placed ? "auto" : "none",
        }}
      >
        <iframe
          key={embed.id}
          src={embed.embedUrl}
          title={`${embed.serviceLabel} 播放器`}
          width="100%"
          height={height}
          style={{ border: 0, borderRadius: 14, background: "transparent" }}
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        />
      </div>

      {/* 不在播放页时给它一条自己的迷你条 —— 这样不用进播放页也能停掉它。
          位置从底部搬到**顶部**：用户反馈它挡到输入框了。 */}
      {!onPlayerPage && (
        <div className="pointer-events-none fixed inset-x-0 inset-chip z-30 flex justify-center">
          <div className="glass-menu pointer-events-auto flex items-center gap-2 rounded-full border border-line py-1.5 pr-1.5 pl-4">
            <Link2 className="size-3.5 shrink-0 text-accent" />
            <Link to="/play/player" className="min-w-0 max-w-40 truncate text-[12px]">
              {embed.serviceLabel} 外链播放中
            </Link>
            <button
              type="button"
              aria-label="停止外链播放"
              onClick={() => useApp.getState().setCurrentEmbed(null)}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-chip text-muted"
            >
              <Square className="size-3 fill-current" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
