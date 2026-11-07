import { cn } from "@/lib/utils";

/**
 * 底部导航 —— `.k-navbar`（固定在最下面，含安全区）。
 *
 * 页面内容末尾记得加 `.k-nav-space`，否则最后一屏会被导航压住。
 *
 * 纯色模式下这条是"墨线 + 纸底，不透明"（因为 `--k-backdrop: none`），
 * 磨砂/液态下是半透明毛玻璃。差别全在变量里，这里不判断模式。
 */
export type KNavItem = {
  key: string;
  label: string;
  active?: boolean;
  onSelect?: () => void;
};

export function KNavbar({ items, className }: { items: KNavItem[]; className?: string }) {
  return (
    <nav className={cn("k-navbar", className)}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={item.onSelect}
          data-active={item.active ? "true" : undefined}
          className="k-navbar__item"
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
