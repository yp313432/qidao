import { useEffect, useRef, useState } from "react";
import type { Letter } from "@/lib/types";
import { LetterViewer } from "@/components/play/letter-envelope";
import { useApp } from "@/lib/store";

/**
 * 新信提醒：他写了新信，**不管你当时在哪个界面**都跳出来拆信动画。
 *
 * ⚠️ 2026-10 修：原来这里是"**一次开 App 只跳一封**"（一个 `shownOnce` 布尔量）。
 * 用户实测的毛病："我是想要信可以自己弹出来，不论当时我在哪个界面，他写完就自动跳出来；
 * 如果我是刚进 app，那应该是我刚进去就弹信封。"
 * 布尔量一旦用过就不再跳 → 他**正在用的时候**写的新信永远不弹（只能重启 App 才看到）。
 *
 * 现在改成**按封**记：只要有一封"没拆过"且"这一场没弹过"的信，就弹；
 * 拆过（`seen`）或这一场已经弹过它，就不再弹。所以：
 *   · 刚进 App 有未拆的信 → 进来自动弹 ✅
 *   · 你在别的页面时他写了信 → 立刻弹 ✅
 *   · 同一封不会反复弹 ✅（关掉才算拆过，中途退出不算）
 */
export function LetterAlert() {
  const letters = useApp((s) => s.letters);
  const hydrated = useApp((s) => s.hydrated);
  /** 正弹着的那封（用它渲染；不再从 `shownIds` 推 `unseen`） */
  const [letter, setLetter] = useState<Letter | null>(null);
  /** 这一场已经弹过的信（按 id 记）——**只在真的弹出来时才写** */
  const lastShown = useRef<string | null>(null);

  /** 还没拆过的（新→旧取第一封）；**故意不看 `lastShown`** —— 见下面那段说明 */
  const unseen = letters.find((l) => !l.seen) ?? null;

  /**
   * ⚠️ 2026-10 修（真机/探针实测"信封根本不弹"）：
   * 原实现把 `lastShown` 写进 `unseen` 的计算里（`!shownIds.has(l.id)`），
   * 于是 **React 开发模式把挂载跑两遍**时：第一遍记下 id 并起定时器 → 清理把定时器清掉 →
   * 第二遍算出来 `unseen === null` → 直接 return → **永远不弹**。
   * 现在：`unseen` 只看"没拆过"，"弹过"的标记**等定时器真的触发时才记**。
   * 顺带满足用户的要求（"不论我在哪个界面，他写完就自动跳出来"）——
   * 每一封新的没拆的信都会弹一次，同一封不会重复弹。
   */
  useEffect(() => {
    if (!hydrated || !unseen || lastShown.current === unseen.id) return;
    const t = window.setTimeout(() => {
      lastShown.current = unseen.id;
      setLetter(unseen);
    }, 900);
    return () => window.clearTimeout(t);
  }, [hydrated, unseen]);

  if (!letter) return null;

  return (
    <LetterViewer
      letter={letter}
      auto
      onClose={() => {
        useApp.getState().markLetterSeen(letter.id);
        setLetter(null);
      }}
    />
  );
}
