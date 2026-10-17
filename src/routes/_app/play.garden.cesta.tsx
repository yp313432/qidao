import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { FishArt, JunkArt } from "@/components/play/garden-art";
import { GARDEN_BASE } from "@/lib/garden";
import {
  basketFooter,
  basketGroups,
  findSpecies,
  JUNK_ITEMS,
  junkCounts,
  TIER_TITLE,
  type CatchRecord,
} from "@/lib/garden-catch";
import { useActivity } from "@/lib/use-activity";

/**
 * `/play/garden/cesta` —— 竹篮（背包）。
 *
 * 用户 m01367 定的内容：点开一条要能看见
 *   "他啥时候钓上来的，当时的心情，是不是新品种，有没有破纪录"。
 * 所以列表只按种类归组（一行一条：重量｜体长｜时间），点开弹一张详情。
 *
 * **不做**收集率、不做图鉴进度条、不做稀有度标签 —— 用户明确不要数值感；
 * 「稀奇」只体现在介绍的长短（`lib/garden-catch` 的 tier）。
 */

export const Route = createFileRoute("/_app/play/garden/cesta")({
  component: CestaView,
});

function dayLabel(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (sameDay) return `今天 ${time}`;
  if (d.toDateString() === yest.toDateString()) return `昨天 ${time}`;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${time}`;
}

function CestaView() {
  useActivity("在看竹篮");
  const groups = useMemo(() => basketGroups(), []);
  const junk = useMemo(() => junkCounts(), []);
  const footer = useMemo(() => basketFooter(), []);
  const totalFish = groups.reduce((n, g) => n + g.rows.length, 0);
  const totalJunk = junk.reduce((n, j) => n + j.count, 0);
  const [open, setOpen] = useState<CatchRecord | null>(null);

  return (
    <div className="cesta">
      <div className="cesta-band" style={{ backgroundImage: `url(${GARDEN_BASE})` }} aria-hidden="true" />
      <header className="cesta-header">
        <Link to="/play/garden/stagno" aria-label="返回池塘" className="cesta-back">
          <ChevronLeft className="size-6" strokeWidth={1.4} />
        </Link>
        <div className="text-center">
          <p className="garden-plaque ink">竹 篮</p>
          <p className="garden-plaque-la ink">LA CESTA</p>
        </div>
      </header>

      <div className="cesta-body">
        <div className="cesta-sec">
          <span className="zh">池塘里带回来的</span>
          <span className="n">
            鱼 {totalFish} 条 · 别的东西 {totalJunk} 件
          </span>
        </div>
        <div className="cesta-rule" />

        {groups.length === 0 && totalJunk === 0 ? (
          <p className="cesta-empty">竹篮还是空的 —— 去池塘边看他钓一会儿</p>
        ) : null}

        {groups.map((g) => (
          <div key={g.species.id} className="cesta-sp">
            <span className="cesta-fig">
              <FishArt id={g.species.id} className="size-full" />
            </span>
            <div className="cesta-meta">
              <div className="cesta-name">
                <b>{g.species.zh}</b>
                <i>{g.species.la}</i>
                {g.rows.some((r) => r.firstTime) ? <span className="cesta-new">新</span> : null}
                <span className="cnt">{g.rows.length} 条</span>
              </div>
              <div className="cesta-rows">
                {g.rows.map((r) => (
                  <button key={r.id} type="button" className="cesta-row" onClick={() => setOpen(r)}>
                    <span>{r.weight} g</span>
                    <span className="dot" />
                    <span>{r.length} cm</span>
                    <span className="t">
                      {r.record ? <span className="rec">破纪录 </span> : null}
                      {dayLabel(r.at)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}

        {totalJunk > 0 ? (
          <>
            <div className="cesta-sec" style={{ marginTop: 12 }}>
              <span className="zh">别的东西</span>
              <span className="n">{totalJunk} 件</span>
            </div>
            <div className="cesta-rule" />
            <div className="cesta-junk">
              {junk
                .filter((j) => j.count > 0)
                .map(({ item, count }) => (
                  <div key={item.id} className="cesta-junk-it">
                    <span className="cesta-fig">
                      <JunkArt id={item.id} className="size-full" />
                    </span>
                    <span className="nm">{item.zh}</span>
                    <span className="sub">{count > 1 ? `${item.sub} · ${count}` : item.sub}</span>
                  </div>
                ))}
            </div>
          </>
        ) : null}

        {totalFish + totalJunk > 0 ? <p className="cesta-foot">{footer}</p> : null}
        {groups.length > 0 ? (
          <p className="cesta-foot dim">点一条，看他那天钓上来时是什么时候、什么心情</p>
        ) : null}
      </div>

      {open ? <CatchSheet rec={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function CatchSheet({ rec, onClose }: { rec: CatchRecord; onClose: () => void }) {
  const species = findSpecies(rec.ref);
  const junkItem = JUNK_ITEMS.find((j) => j.id === rec.ref);
  const name = species?.zh ?? junkItem?.zh ?? "？";
  const la = species?.la ?? junkItem?.la ?? "";
  const tierTitle = species ? TIER_TITLE[species.tier] : null;

  return (
    <div className="cesta-sheet-layer" role="dialog" aria-modal="true" aria-label={`${name}的详情`}>
      <button type="button" className="cesta-sheet-veil" aria-label="关闭" onClick={onClose} />
      <div className="cesta-sheet">
        <span className="grab" aria-hidden="true" />
        <div className="hero">
          <span className="big">{rec.kind === "fish" ? <FishArt id={rec.ref} className="size-full" /> : <JunkArt id={rec.ref} className="size-full" />}</span>
          <span className="min-w-0">
            <span className="h3">{name}</span>
            <span className="la4">{la}</span>
            <span className="sub">
              {rec.kind === "fish" ? `${rec.weight} g ｜ ${rec.length} cm ｜ ` : ""}
              {dayLabel(rec.at)}
            </span>
          </span>
        </div>
        <div className="chips">
          {species && tierTitle ? <span className="chip plain">{tierTitle}</span> : <span className="chip plain">别的东西</span>}
          {rec.firstTime ? <span className="chip">新品种</span> : null}
          {rec.record ? (
            <span className="chip">刷新纪录{rec.prevBest ? ` +${Math.max(0, (rec.weight ?? 0) - rec.prevBest)} g` : ""}</span>
          ) : null}
          {rec.mood ? <span className="chip plain">那天他心情：{rec.mood}</span> : null}
        </div>
        <div className="hr" />
        <p className="k">他的介绍</p>
        <p className="desc">{species?.desc ?? junkItem?.sub ?? ""}</p>
        <div className="acts">
          <Link to="/play/garden/vestigia" className="link" onClick={onClose}>
            看那天的事 ›
          </Link>
          <button type="button" className="link" onClick={onClose}>
            放回竹篮
          </button>
        </div>
      </div>
    </div>
  );
}
