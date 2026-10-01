import { useApp } from "@/lib/store";

/**
 * 全屏背景层：默认渲染主题对应的「光斑渐变」作为液态玻璃的折射底，
 * 若用户上传了自定义图片，则叠加在渐变之上并按 blur / dim / opacity 处理。
 * 固定在内容之后（z-0），内容通过 relative z-10 盖在其上，玻璃面用
 * backdrop-filter 模糊它，从而形成「漂浮在照片上的透明玻璃空间」。
 */
export function BackgroundLayer() {
  const background = useApp((s) => s.settings.background);
  const image = background.image;

  return (
    <div className="background-canvas pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
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
  if (!image) return null;
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <img
        src={image}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{ filter: "saturate(1.1) brightness(0.92)", transform: "scale(1.06)" }}
      />
    </div>
  );
}