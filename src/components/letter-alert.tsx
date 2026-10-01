import { useEffect, useRef, useState } from "react";
import { LetterViewer } from "@/components/play/letter-envelope";
import { useApp } from "@/lib/store";

/**
 * 新信提醒：他写了新信，你一进前端就跳出拆信动画。
 *
 * 只跳**一封**（每次打开 App 最多一封），而且等首屏渲染完再跳 ——
 * 不然会和页面初始化抢，动画开头会卡一下。
 * 关掉的时候才标记「拆过」，所以中途退出不会算你看过了。
 */
export function LetterAlert() {
  const letters = useApp((s) => s.letters);
  const hydrated = useApp((s) => s.hydrated);
  const [show, setShow] = useState(false);
  const shownOnce = useRef(false);

  const unseen = letters.find((l) => !l.seen) ?? null;

  useEffect(() => {
    if (!hydrated || !unseen || shownOnce.current) return;
    shownOnce.current = true;
    const t = window.setTimeout(() => setShow(true), 900);
    return () => window.clearTimeout(t);
  }, [hydrated, unseen]);

  if (!show || !unseen) return null;

  return (
    <LetterViewer
      letter={unseen}
      auto
      onClose={() => {
        useApp.getState().markLetterSeen(unseen.id);
        setShow(false);
      }}
    />
  );
}
