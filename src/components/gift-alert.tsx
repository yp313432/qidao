/**
 * 收花提醒 —— 跟 `LetterAlert` 一个待遇。
 *
 * 用户 m03954："他送给我花然后我收到要有动画，自己采摘有没有都行，是我一进去app就有，
 * 不是进花园里才有，跟信等级一样"。
 *
 * 所以这里是 **app 级 overlay**：挂在 `AppShell` 上，
 *   · 刚进 app 有一枝没拆的花 → 进来自动弹；
 *   · 你在别的页面时他送了也立刻弹；
 *   · 同一枝不会反复弹（关掉才算收下，中途退出不算）。
 *
 * 流程：纸包落在石阶上 → 拆开 → 花 + 他写的那句话 → 「收下」→ 收进背包。
 */

import { useEffect, useRef, useState } from "react";
import {
  acceptGift,
  findFlower,
  pendingGift,
  subscribeFlowers,
  type FlowerGift,
} from "@/lib/garden-flowers";

type Stage = "wrap" | "open" | "done";

export function GiftAlert() {
  const [gift, setGift] = useState<FlowerGift | null>(null);
  const [stage, setStage] = useState<Stage>("wrap");
  /** 这一场已经弹过的那一枝（按 id 记；只在真的弹出来时才写） */
  const lastShown = useRef<string | null>(null);

  useEffect(() => {
    const check = () => {
      const g = pendingGift();
      if (!g || lastShown.current === g.id) return;
      lastShown.current = g.id;
      setStage("wrap");
      setGift(g);
    };
    check();
    return subscribeFlowers(check);
  }, []);

  /** 拆开：停顿一下再展开，跟信的节奏一致 */
  useEffect(() => {
    if (!gift || stage !== "wrap") return;
    const t = window.setTimeout(() => setStage("open"), 1100);
    return () => window.clearTimeout(t);
  }, [gift, stage]);

  if (!gift) return null;
  const flower = findFlower(gift.species);

  const close = () => {
    acceptGift(gift.id);
    setGift(null);
    setStage("done");
  };

  return (
    <div className="gift-layer" data-anchor="gift-flower" onClick={stage === "open" ? close : undefined}>
      <div className={`gift-scene ${stage}`} onClick={(e) => e.stopPropagation()}>
        {stage === "wrap" ? (
          <>
            <div className="gift-wrap" aria-hidden="true">
              <svg viewBox="0 0 120 84" width="150" height="105" fill="none">
                <rect x="8" y="16" width="104" height="62" rx="8" fill="#f6ecd6" stroke="#c9ab74" strokeWidth="1.1" />
                <path d="M8 24l52 30 52-30" stroke="#c9ab74" strokeWidth="1.1" />
                <circle cx="60" cy="52" r="11" fill="#c9a05e" opacity=".22" />
                <path d="M60 44v16M53 50h14" stroke="#b0893c" strokeWidth="1.1" strokeLinecap="round" />
              </svg>
            </div>
            <p className="gift-cap">石阶上放着一个纸包</p>
          </>
        ) : (
          <>
            <div className="gift-flower" aria-hidden="true">
              <img src={`/garden/flowers/${gift.species}.jpg`} alt="" />
            </div>
            <p className="gift-name">
              {flower?.zh ?? "花"}
              <i>{flower?.it ?? ""}</i>
            </p>
            <p className="gift-note">「{gift.note}」</p>
            <button type="button" className="gift-accept" onClick={close}>
              收下
            </button>
          </>
        )}
      </div>
    </div>
  );
}
