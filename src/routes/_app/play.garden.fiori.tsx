import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useReducer, useState } from "react";
import {
  bedOf,
  findFlower,
  FLOWER_SPOTS,
  FLOWER_SPECIES,
  flowerStats,
  readBasket,
  readGifts,
  readSeeds,
  subscribeFlowers,
} from "@/lib/garden-flowers";
import { useActivity } from "@/lib/use-activity";

export const Route = createFileRoute("/_app/play/garden/fiori")({
  component: FioriPage,
});

/**
 * 花圃（Fiori）—— 一片真的花园，你只负责看。
 *
 * 用户 m03971："带吧，简单点就行，先就做盛开一种状态吧，名字风格参考花园主页的那几个ui"
 * 用户 m04033："只有采摘的花放在背包里，还有种子"
 * 用户 m04036："动作你要有知道吧，就是 ai 真的能种，能浇水施肥"
 *
 * 所以这一页**只负责看**：
 *   · 底图是一片真的花园，六种花长在各自的位置上；
 *   · 花名照花园主页那套题字（白字深描边 + 意大利语斜体 + 一句状态），融在画里；
 *   · 点一朵才浮出介绍卡（花语 / 来历 / 他种了几天 / 收到几枝）；
 *   · 右下角背包只有两种东西：种子 + 采摘下来的花（每枝带他剪时说的那句话）。
 * 种 / 浇 / 施肥 / 剪 / 送 都是他在聊天里**真做**的动作（`garden.flower.*`），
 * 结果落在这页、背包、以及踪跡上。
 */
function FioriPage() {
  useActivity("在花圃");
  const [, bump] = useReducer((x: number) => x + 1, 0);
  /* 花圃的数据在 localStorage 里，**不能**在首帧就读：
     服务端渲染出来是"野生的"，客户端一上来读到"开着"就会 hydration 不匹配。
     所以先渲染空园子，挂载后再把真数据填进来（一帧的事，看不出来）。 */
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
    return subscribeFlowers(bump);
  }, []);

  const [card, setCard] = useState<string | null>(null);
  const [bag, setBag] = useState<"seeds" | "flowers" | null>(null);

  const stats = ready ? flowerStats() : { basket: 0 };
  const picked = ready ? readBasket() : [];
  const gifts = ready ? readGifts() : [];
  const seeds = ready ? readSeeds() : {};
  const open = card ? findFlower(card) : null;
  const bed = card && ready ? bedOf(card) : undefined;

  return (
    <div className="fiori">
      <div className="fiori-bg" aria-hidden="true" />
      <div className="fiori-veil" aria-hidden="true" />

      <header className="fiori-head">
        <Link to="/play/garden" aria-label="返回花园" className="fiori-back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fffdf6" strokeWidth="1.5" strokeLinecap="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <div className="fiori-title">
          <h1>花圃</h1>
          <span>Fiori</span>
        </div>
      </header>

      <div className="fiori-spots" data-anchor="fiori-bed">
        {FLOWER_SPECIES.filter((f) => FLOWER_SPOTS[f.id]).map((f) => {
          const spot = FLOWER_SPOTS[f.id];
          const b = ready ? bedOf(f.id) : undefined;
          const state = b ? (b.bloomedAt ? "开着" : "长着，还没开") : "野生的";
          return (
            <button
              key={f.id}
              type="button"
              className={`fiori-spot${b?.bloomedAt ? " bloom" : ""}`}
              style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
              data-anchor={`flower-${f.id}`}
              onClick={() => setCard(f.id)}
            >
              <span className="zh">{f.zh}</span>
              <span className="la">{f.it}</span>
              <span className="st">{state}</span>
            </button>
          );
        })}
      </div>

      <button type="button" className="fiori-bag" aria-label="背包" onClick={() => setBag("seeds")}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8d6b2c" strokeWidth="1.3">
          <path d="M9 8.5c0-2.2 1.4-3.8 3-3.8s3 1.6 3 3.8c0 2.6-3 4.4-3 7.2" />
          <circle cx="12" cy="8" r=".9" fill="#8d6b2c" stroke="none" />
          <path d="M5.5 10.5c2 .4 3.4 1.6 4.2 3.4M18.5 10.5c-2 .4-3.4 1.6-4.2 3.4" />
        </svg>
        <span className="n">{stats.basket}</span>
      </button>

      {open ? (
        <div className="fiori-layer" onClick={() => setCard(null)}>
          <div className="fiori-card" data-anchor="flower-card" onClick={(e) => e.stopPropagation()}>
            <div className="fiori-card-top">
              <div className="fiori-thumb" aria-hidden="true">
                <img src={`/garden/flowers/${open.id}.jpg`} alt="" />
              </div>
              <div>
                <h3>
                  {open.zh}
                  <i>{open.it}</i>
                </h3>
                <div className="fiori-stars" aria-label={`稀有度 ${open.rarity} 星`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span key={n} className={n <= open.rarity ? "on" : ""} />
                  ))}
                </div>
              </div>
            </div>
            <p className="fiori-word">花语 · {open.word}</p>
            {open.lore ? <p className="fiori-lore">{open.lore}</p> : null}
            <p className="fiori-state">
              {bed ? (bed.bloomedAt ? "他种的 · 已经开了" : "他种的 · 还没开") : "不是他种的，自己长在这儿"}
              {picked.some((p) => p.species === open.id)
                ? ` · 背包里 ${picked.filter((p) => p.species === open.id).length} 枝`
                : ""}
              {gifts.some((g) => g.species === open.id)
                ? ` · 他送过 ${gifts.filter((g) => g.species === open.id).length} 枝`
                : ""}
            </p>
            <p className="fiori-tip">想让他剪一枝，在聊天里跟他说一声 —— 剪下来的会进背包</p>
            <button type="button" className="fiori-close" onClick={() => setCard(null)}>
              再看看
            </button>
          </div>
        </div>
      ) : null}

      {bag ? (
        <div className="fiori-layer" onClick={() => setBag(null)}>
          <div className="fiori-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="grab" aria-hidden="true" />
            <div className="h3">
              背包<i>Borsa</i>
            </div>
            <div className="fiori-tabs">
              <button type="button" className={bag === "seeds" ? "on" : ""} onClick={() => setBag("seeds")}>
                种子
              </button>
              <button type="button" className={bag === "flowers" ? "on" : ""} onClick={() => setBag("flowers")}>
                采摘的花
              </button>
            </div>

            {bag === "seeds" ? (
              <ul className="fiori-seedlist">
                {FLOWER_SPECIES.filter((f) => (seeds[f.id] ?? 0) > 0).map((f) => (
                  <li key={f.id}>
                    <img src={`/garden/flowers/${f.id}.jpg`} alt="" />
                    <div>
                      <b>{f.zh}</b>
                      <i>{f.it}</i>
                    </div>
                    <span>×{seeds[f.id]}</span>
                  </li>
                ))}
                {Object.values(seeds).every((n) => n <= 0) ? (
                  <li className="empty">种子用完了 —— 以后能在「寻物」里捡到</li>
                ) : null}
              </ul>
            ) : (
              <ul className="fiori-picked">
                {picked
                  .slice()
                  .reverse()
                  .slice(0, 20)
                  .map((p) => (
                    <li key={p.id}>
                      <img src={`/garden/flowers/${p.species}.jpg`} alt="" />
                      <div>
                        <b>{findFlower(p.species)?.zh ?? "花"}</b>
                        <i>{new Date(p.at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</i>
                        {p.note ? <p>「{p.note}」</p> : null}
                      </div>
                    </li>
                  ))}
                {picked.length === 0 ? (
                  <li className="empty">还空着 —— 他在花圃里剪下来的花会放到这儿</li>
                ) : null}
              </ul>
            )}

            <button type="button" className="fiori-close" onClick={() => setBag(null)}>
              收起来
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
