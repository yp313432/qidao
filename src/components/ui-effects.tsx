import { useEffect } from "react";
import { useApp } from "@/lib/store";

/**
 * 界面效果层：消费「高亮某处」和「滚动到某处」两个动作。
 *
 * 他说的是一段文字，这里去页面上找到**最小的那个包含它的元素**，
 * 滚到视野中间并套上一圈高亮，几秒后自动褪掉 —— 不常驻、不改结构。
 */

const CANDIDATES = "p,li,button,h1,h2,h3,h4,span,label,pre,code,td,th";

function findElement(text: string): HTMLElement | null {
  const needle = text.trim();
  if (!needle || typeof document === "undefined") return null;

  let best: HTMLElement | null = null;
  let bestLen = Number.POSITIVE_INFINITY;

  for (const el of document.querySelectorAll<HTMLElement>(CANDIDATES)) {
    if (el.closest(".aster-highlight-skip")) continue;
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
