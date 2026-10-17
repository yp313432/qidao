import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useMemo } from "react";
import { FishArt, JunkArt } from "@/components/play/garden-art";
import { GARDEN_BASE } from "@/lib/garden";
import { dayKeyOf, dayTitle, traceOf, type TraceItem } from "@/lib/garden-trace";
import { useActivity } from "@/lib/use-activity";

/**
 * `/play/garden/vestigia` —— 踪迹。
 *
 * 用户说的话：
 *   · "可以写进踪迹里"（钓到的东西要留一条）
 *   · "我进聊天界面里问他在花园里干了什么，说了什么他都是知道的"
 *
 * 所以踪迹不是装饰的时间线，是**他这一天在花园里做过的事**的原始记录；
 * 聊天里能答上来的东西，就是从这儿读的（感知层 `lib/awareness`）。
 * 一条一行：几点 · 做了什么 · 结果。不做卡片、不做插画、不做"回忆"。
 */

export const Route = createFileRoute("/_app/play/garden/vestigia")({
  component: VestigiaView,
});

function VestigiaView() {
  useActivity("在看踪迹");
  const items = useMemo(() => traceOf(), []);
  const days = useMemo(() => {
    const map = new Map<string, TraceItem[]>();
    for (const it of items) {
      const k = dayKeyOf(it.at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    return [...map.entries()].sort((a, b) => b[1][0].at - a[1][0].at);
  }, [items]);

  return (
    <div className="vestigia">
      <div className="vestigia-band" style={{ backgroundImage: `url(${GARDEN_BASE})` }} aria-hidden="true" />
      <header className="cesta-header">
        <Link to="/play/garden" aria-label="返回花园" className="cesta-back">
          <ChevronLeft className="size-6" strokeWidth={1.4} />
        </Link>
        <div className="text-center">
          <p className="garden-plaque ink">踪 迹</p>
          <p className="garden-plaque-la ink">VESTIGIA</p>
        </div>
      </header>

      <div className="vestigia-body">
        {days.length === 0 ? (
          <p className="cesta-empty">今天他还没在花园里留下什么。</p>
        ) : (
          days.map(([key, list]) => (
            <section key={key} className="vestigia-day">
              <div className="vestigia-day-h">
                <span className="zh">{dayTitle(key)}</span>
                <span className="rule" />
                <span className="n">{list.length} 件</span>
              </div>
              <ol className="vestigia-list">
                {list.map((it) => (
                  <li key={it.id} className="vestigia-item">
                    <span className="t">{it.time}</span>
                    <span className="dot" aria-hidden="true" />
                    <span className="ico" aria-hidden="true">
                      {it.kind === "fish" || it.kind === "junk" ? (
                        it.kind === "fish" ? (
                          <FishArt id={it.ref} className="size-full" />
                        ) : (
                          <JunkArt id={it.ref} className="size-full" />
                        )
                      ) : null}
                    </span>
                    <span className="txt">{it.text}</span>
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}
        <p className="cesta-foot dim">他做过的事都记在这儿 —— 在聊天里问他，他能说出来</p>
      </div>
    </div>
  );
}
