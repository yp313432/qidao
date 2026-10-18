import { useEffect } from "react";
import { useApp } from "@/lib/store";

/**
 * 界面效果层：消费「高亮某处」和「滚动到某处」两个动作。
 *
 * 他说的是一段文字，这里去页面上找到**最小的那个包含它的元素**，
 * 滚到视野中间并套上一圈高亮，几秒后自动褪掉 —— 不常驻、不改结构。
 */

const CANDIDATES = "p,li,button,h1,h2,h3,h4,span,label,pre,code,td,th,[data-anchor]";

/**
 * 先认**显式锚点** `[data-anchor="…"]`，再退回按文字找。
 *
 * 为什么要先认锚点：新一点的页面（棋桌转盘、塔罗）里，真正该滚到的位置比如
 * "翻开的那排牌""解读那一块"，文字可能是 SVG 里的 <text>（上面那串选择器
 * 根本选不到），或者是一句随时会变的提示语 —— 他会"找不到"。
 * 有了 data-anchor，页面里换了什么措辞都不影响定位；
 * `ui.scroll` / `ui.highlight` 直接写锚点名（`tarot-cards`、`tarot-reading`
 * 这种）就行。
 */
function anchorOf(text: string): HTMLElement | null {
  const needle = text.trim();
  if (!needle) return null;
  const exact = document.querySelector<HTMLElement>(`[data-anchor="${needle}"]`);
  if (exact) return exact;
  for (const el of document.querySelectorAll<HTMLElement>("[data-anchor]")) {
    const key = el.dataset.anchor ?? "";
    if (key && (key.includes(needle) || needle.includes(key))) return el;
  }
  return null;
}

function findElement(text: string): HTMLElement | null {
  const needle = text.trim();
  if (!needle || typeof document === "undefined") return null;

  const anchored = anchorOf(needle);
  if (anchored) return anchored;

  let best: HTMLElement | null = null;
  let bestLen = Number.POSITIVE_INFINITY;

  for (const el of document.querySelectorAll<HTMLElement>(CANDIDATES)) {
    if (el.closest(".aster-highlight-skip")) continue;
    // 包着一整片区域的锚点容器不参与"最小元素"竞争（否则会高亮整页）
    if (el.hasAttribute("data-anchor") && el.children.length > 0) continue;
    const own = (el.textContent ?? "").trim();
    if (!own.includes(needle)) continue;
    if (own.length < bestLen) {
      best = el;
      bestLen = own.length;
    }
  }
  return best;
}

export function UiEffects() {
  const effect = useApp((s) => s.uiEffect);

  useEffect(() => {
    if (!effect || !effect.text.trim()) return;
    const el = findElement(effect.text);
    if (!el) return;

    el.scrollIntoView({ block: "center", behavior: "smooth" });
    if (effect.kind !== "highlight") return;

    el.classList.add("aster-highlight");
    const timer = window.setTimeout(() => el.classList.remove("aster-highlight"), 3400);
    return () => {
      window.clearTimeout(timer);
      el.classList.remove("aster-highlight");
    };
  }, [effect]);

  return null;
}
