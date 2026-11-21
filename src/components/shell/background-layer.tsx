import { useEffect } from "react";
import { isSolid } from "@/lib/material";
import { useApp } from "@/lib/store";
import { syncBarIcons } from "@/lib/shell";

export function BackgroundLayer() {
  const solid = useApp((s) => isSolid(s.settings));
  const theme = useApp((s) => s.settings.theme);
  const background = useApp((s) => s.settings.background);
  const image = solid ? "" : background.image;

  /**
   * 背景变了 → 重新决定**状态栏图标用浅色还是深色**（2026-11）。
   *
   * 用户原话："万一我换一个浅色背景图呢，那深色不就暴露了吗？"
   * —— 系统栏透明之后，图标颜色必须跟着背景明暗走：浅背景用深图标，
   * 否则那排时间/电量直接看不见。这里把当前背景告诉 `lib/shell`（它去算亮度）。
   */
  useEffect(() => {
    const w = window as unknown as {
      __qidaoBg?: string;
      __qidaoBgState?: { dim: number; opacity: number };
    };
    w.__qidaoBg = image || "";
    w.__qidaoBgState = { dim: background.dim, opacity: background.opacity };
    void syncBarIcons();
  }, [solid, theme, image, background.dim, background.opacity]);

  if (solid) {
    return <div key="paper" className="paper-canvas pointer-events-none fixed inset-0 z-0" aria-hidden="true" />;
  }

  return (
    <div
      key="liquid"
      className="liquid-canvas pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden="true"
    >
      {image ? (
        <img
          src={image}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            filter: `blur(${background.blur}px) saturate(1.15) brightness(${1 - background.dim})`,
            opacity: background.opacity,
            transform: "scale(1.15)",
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * 单个页面自己的背景图（音乐播放页 / 日记动态）。
 *
 * 用 `-z-10`：AppShell 的根是 `relative z-10`，会形成层叠上下文，
 * 所以这一层落在**全局背景之上、页面内容之下** —— 正好是「这一页换了张底」。
 *
 * 没设图就什么都不渲染，直接露出主页背景。
 */
export function SceneBackdrop({ image }: { image?: string }) {
  const solid = useApp((s) => isSolid(s.settings));
  if (solid || !image) return null;
  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      aria-hidden="true"
    >
      <img
        src={image}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{ filter: "saturate(1.1) brightness(0.92)", transform: "scale(1.06)" }}
      />
    </div>
  );
}