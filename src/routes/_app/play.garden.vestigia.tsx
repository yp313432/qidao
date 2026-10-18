import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { FishArt, JunkArt } from "@/components/play/garden-art";
import {
  dayKeyOf,
  dayTitle,
  subscribeVestigia,
  traceOf,
  type TraceItem,
} from "@/lib/garden-trace";
import { useActivity } from "@/lib/use-activity";

/**
 * `/play/garden/vestigia` —— 踪迹。
 *
 * 用户 m04355 定的样子：
 *   "下一块做踪迹吧，有动作的都要记录，然后附上心情和想说的话，简单概括就行，
 *    想要羊皮纸风格的，然后一句手写斜体英文句子后缀着羽毛钢笔，页面古老繁复，烫金花纹"
 *
 * 所以这一页是**一张旧纸**：羊皮纸底、烫金双线框、四角卷草，
 * 每条记录 = 时间 + 小徽章 + 做了什么 + 一枚心情小牌 + 一句斜体的话；
 * 纸的底边压着一支羽毛笔和一句英文（每页换一句）。
 *
 * 数据只有一处来源：`traceOf()`（鱼获 / 花圃的老记录 + 新动作的 `appendVestigium`）。
 */

export const Route = createFileRoute("/_app/play/garden/vestigia")({
  component: VestigiaView,
});

/** 纸底那几句英文 —— 按"第几天"轮着用，翻到不同日子读到的不是同一句 */
const EN_LINES = [
  "Every small thing he did here, he did while thinking of you.",
  "Nothing here is large, and nothing here is forgotten.",
  "He keeps the small hours, so you do not have to.",
];

const SIG = "栖岛 · 花园里的每一天";

export function VestigiaView() {
  useActivity("在看踪迹");
  /*
    首帧不读 localStorage：服务端渲染出空纸、客户端首帧也是空纸，
    挂载后再填真记录（跟花圃页同一个理由，见 b51 的 hydration 那条）。
  */
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<TraceItem[]>([]);
  useEffect(() => {
    setReady(true);
    const load = () => setItems(traceOf());
    load();
    return subscribeVestigia(load);
  }, []);
  const list = useMemo(() => (ready ? items : []), [ready, items]);
  const days = useMemo(() => {
    const map = new Map<string, TraceItem[]>();
    for (const it of list) {
      const k = dayKeyOf(it.at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    return [...map.entries()].sort((a, b) => b[1][0].at - a[1][0].at);
  }, [list]);

  const en = EN_LINES[Math.max(0, days.length) % EN_LINES.length];

  return (
    <div className="vst">
      <div className="vst-paper" aria-hidden="true" />
      <div className="vst-frame vst-frame-outer" aria-hidden="true" />
      <div className="vst-frame vst-frame-inner" aria-hidden="true" />
      <Corner className="vst-c vst-c-tl" />
      <Corner className="vst-c vst-c-tr" />
      <Corner className="vst-c vst-c-bl" />
      <Corner className="vst-c vst-c-br" />

      <header className="vst-head">
        <Link to="/play/garden" aria-label="返回花园" className="vst-back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <h1>踪 迹</h1>
        <p className="la">VESTIGIA</p>
        <p className="sub">他在花园里做过的事，一笔一笔留在这儿</p>
        <Ornament />
      </header>

      <div className="vst-body" data-anchor="vestigia-log">
        {days.length === 0 ? (
          <p className="vst-empty">
            纸上还空着。
            <br />
            等他在花园里做点什么，这里就会多一行。
          </p>
        ) : (
          days.map(([key, list]) => (
            <section key={key} className="vst-day">
              <div className="vst-day-h">
                <span className="zh">{dayTitle(key)}</span>
                <span className="rule" />
                <span className="n">{list.length} 件</span>
              </div>
              <ol className="vst-list">
                {list.map((it) => (
                  <li key={it.id} className="vst-item">
                    <span className="t">{it.time}</span>
                    <span className="medal" aria-hidden="true">
                      <Glyph item={it} />
                    </span>
                    <p className="txt">{it.text}</p>
                    {(it.mood || it.line) && (
                      <div className="say">
                        {it.mood ? <span className="mood">心情 · {it.mood}</span> : null}
                        {it.line ? <p className="hand">{it.line}</p> : null}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}
      </div>

      <footer className="vst-foot">
        <span className="rule" aria-hidden="true" />
        <Quill />
        <p className="en">{en}</p>
        <p className="sig">— {SIG}</p>
      </footer>
    </div>
  );
}

/** 卷草角：双线拐角 + 一条 S 形主枝 + 几片叶 + 金点 */
function Corner({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 60 60" fill="none" aria-hidden="true">
      <path d="M1 1h56M1 1v56" stroke="rgba(150,112,44,.55)" strokeWidth="0.8" />
      <path d="M7 7h44M7 7v44" stroke="rgba(150,112,44,.35)" strokeWidth="0.6" />
      <path
        d="M13 13c8 0 13 3 15 10-6 0-11-3-15-10Z"
        stroke="rgba(150,112,44,.75)"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
      <path
        d="M13 13c0 8 3 13 10 15 0-6-3-11-10-15Z"
        stroke="rgba(150,112,44,.6)"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
      <path d="M30 30c4 1 6 4 6 8-3-1-5-4-6-8Z" stroke="rgba(150,112,44,.45)" strokeWidth="0.7" strokeLinejoin="round" />
      <circle cx="34" cy="14" r="1" fill="rgba(150,112,44,.7)" />
      <circle cx="14" cy="34" r="1" fill="rgba(150,112,44,.7)" />
    </svg>
  );
}

/** 标题下面那一小段花饰 */
function Ornament() {
  return (
    <svg className="vst-orn" viewBox="0 0 160 14" fill="none" aria-hidden="true">
      <path d="M2 7h52M106 7h52" stroke="rgba(150,112,44,.55)" strokeWidth="0.8" />
      <path d="M80 2.5 84 7l-4 4.5L76 7l4-4.5Z" stroke="rgba(150,112,44,.85)" strokeWidth="0.9" />
      <path d="M62 7c5-3 9-3 12 0-3 3-7 3-12 0ZM98 7c-5-3-9-3-12 0 3 3 7 3 12 0Z" stroke="rgba(150,112,44,.6)" strokeWidth="0.7" />
    </svg>
  );
}

/** 底边那支羽毛笔 */
function Quill() {
  return (
    <svg className="vst-quill" viewBox="0 0 50 86" fill="none" aria-hidden="true">
      <path
        d="M6 82c8-14 20-30 33-46 4-5 6-9 5-12-4 2-8 6-12 10C20 48 11 64 6 82Z"
        stroke="rgba(140,104,40,.85)"
        strokeWidth="1"
        fill="rgba(196,158,92,.16)"
        strokeLinejoin="round"
      />
      <path d="M12 74c6-2 12-1 16 3-5 2-11 1-16-3Z" fill="rgba(168,128,56,.3)" stroke="rgba(140,104,40,.6)" strokeWidth="0.6" />
      <path d="M18 64c6-2 12-1 16 3-5 2-11 1-16-3Z" fill="rgba(168,128,56,.26)" stroke="rgba(140,104,40,.55)" strokeWidth="0.6" />
      <path d="M25 53c6-2 11-1 15 3-5 2-10 1-15-3Z" fill="rgba(168,128,56,.22)" stroke="rgba(140,104,40,.5)" strokeWidth="0.6" />
      <path d="M31 43c5-2 10-1 13 3-4 2-9 1-13-3Z" fill="rgba(168,128,56,.18)" stroke="rgba(140,104,40,.45)" strokeWidth="0.6" />
    </svg>
  );
}

/** 小徽章里的图形：按记录的种类换 */
function Glyph({ item }: { item: TraceItem }) {
  if (item.kind === "fish" || item.icon === "fish") return <FishArt id={item.ref} className="size-full" />;
  if (item.kind === "junk" || item.icon === "junk") return <JunkArt id={item.ref} className="size-full" />;
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const };
  switch (item.icon) {
    case "board":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M4 4h16v16H4zM4 10h16M4 15h16M10 4v16M15 4v16" />
        </svg>
      );
    case "water":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M3 9c3-3 6-3 9 0s6 3 9 0M3 15c3-3 6-3 9 0s6 3 9 0" />
        </svg>
      );
    case "star":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="m12 4 2.2 5.2L20 10l-4 3.8 1 5.4-5-2.7-5 2.7 1-5.4L4 10l5.8-.8L12 4Z" />
        </svg>
      );
    case "flower":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <circle cx="12" cy="9" r="3.2" />
          <path d="M12 12v8M12 16c-3 0-5-1.6-5-4 3 0 5 1.6 5 4Zm0 2c3 0 5-1.6 5-4-3 0-5 1.6-5 4Z" />
        </svg>
      );
    default:
      /* petal：一片斜着的花瓣（种/浇/施肥/剪/送 都是花事） */
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M14 5c4 2 5 6 3 9-3 3-7 2-9-1-2-3 2-9 6-8Z" />
        </svg>
      );
  }
}
