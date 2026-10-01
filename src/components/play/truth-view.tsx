import { useEffect, useState } from "react";
import { useApp } from "@/lib/store";
import { useActivity } from "@/lib/use-activity";
import { PlayHeader } from "@/components/play-header";
import { drawCard, type DareKind, type DeckCard } from "@/lib/truth-deck";
import { cn } from "@/lib/utils";

export function TruthView() {
  useActivity("在玩真心话");
  const [kind, setKind] = useState<DareKind | undefined>(undefined);
  const [level, setLevel] = useState<1 | 2 | 3>(2);
  const [card, setCard] = useState<DeckCard | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [log, setLog] = useState<DeckCard[]>([]);

  function draw(k?: DareKind) {
    const next = drawCard(k ?? kind, level);
    setCard(next);
    setFlipped(true);
    setLog((xs) => [next, ...xs].slice(0, 12));
  }

  // 他请求「替你抽一个」时，落到这一页
  const openPanel = useApp((s) => s.openPanel);
  useEffect(() => {
    if (openPanel?.id !== "truth_card") return;
    useApp.getState().setPanel(null);
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPanel]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PlayHeader title="真心话大冒险" />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-above-nav">
        <div className="flex gap-2">
          {(
            [
              [undefined, "随机"],
              ["truth", "真心话"],
              ["dare", "大冒险"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "rounded-full px-3.5 py-2 text-[13px] font-medium",
                kind === k ? "bg-ink text-ink-fg" : "bg-chip text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3 text-sm text-muted">
          烈度
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setLevel(n as 1 | 2 | 3)}
              className={cn(
                "size-8 rounded-full text-[13px]",
                level === n ? "bg-accent text-accent-fg" : "bg-chip",
              )}
            >
              {n}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => (flipped ? setFlipped(false) : draw())}
          className="mt-6 flex min-h-52 w-full flex-col items-center justify-center rounded-3xl border border-line bg-surface px-6 py-10 text-center"
        >
          {card && flipped ? (
            <>
              <p className="text-[11px] tracking-[0.2em] text-muted uppercase">
                {card.kind === "truth" ? "TRUTH" : "DARE"} · {card.intensity}
              </p>
              <p className="mt-4 font-serif text-xl leading-8">{card.text}</p>
            </>
          ) : (
            <p className="text-muted">点按抽一张</p>
          )}
        </button>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="rounded-full bg-chip py-3 text-sm font-medium"
            onClick={() => draw("truth")}
          >
            真心话
          </button>
          <button
            type="button"
            className="rounded-full bg-chip py-3 text-sm font-medium"
            onClick={() => draw("dare")}
          >
            大冒险
          </button>
        </div>

        {log.length > 0 && (
          <ul className="mt-6 space-y-2">
            {log.map((c, i) => (
              <li key={`${c.text}-${i}`} className="text-[13px] text-muted">
                <span className="mr-2 text-subtle">{c.kind === "truth" ? "真" : "冒"}</span>
                {c.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
