import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useDismissable } from "@/lib/dismiss-stack";
import { useApp } from "@/lib/store";
import { summaryBlockRefs, verifiedSummaryQuote } from "@/lib/summary-blocks";

const CARDS_PER_PAGE = 4;

type SourceCard = {
  id: string;
  label: string;
  text?: string;
  quote?: string;
};

function SourceCards({ cards }: { cards: SourceCard[] }) {
  const [order, setOrder] = useState(() => cards.map((card) => card.id));
  const [incoming, setIncoming] = useState<string | null>(null);

  function finishSwitch() {
    if (!incoming) return;
    setOrder(([front, ...rest]) => [incoming, ...rest.filter((id) => id !== incoming), front!]);
    setIncoming(null);
  }

  return (
    <div className="k-source-deck__stack" data-count={cards.length}>
      {cards.map((card) => {
        const depth = order.indexOf(card.id);
        const active = depth === 0;
        return (
          <article key={card.id} className="k-source-deck__card" data-depth={depth}
            data-leaving={active && !!incoming} onAnimationEnd={(event) => {
              if (event.target === event.currentTarget && active && incoming) finishSwitch();
            }}>
            <button type="button" className="k-source-deck__label" aria-pressed={active}
              aria-label={card.label} onClick={() => { if (!active && !incoming) setIncoming(card.id); }}>
              {Array.from(card.label).slice(0, 4).join("")}
            </button>
            {active && (
              <div className="k-source-deck__excerpt" aria-live="polite" tabIndex={0}>
                <p>{card.text ?? "这条来源的相关片段已不可用。"}</p>
                {card.quote && card.quote !== card.text && <blockquote>「{card.quote}」</blockquote>}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

export function SummarySourceDeck({ ids, trigger, onClose }: {
  ids: string[];
  trigger: HTMLButtonElement;
  onClose: () => void;
}) {
  const conversations = useApp((state) => state.conversations);
  const memories = useApp((state) => state.memories);
  const [page, setPage] = useState(0);
  useDismissable(true, onClose);

  const cards = useMemo(() => {
    const refs = new Map(summaryBlockRefs(conversations).map((ref) => [ref.id, ref]));
    return ids.map((id): SourceCard => {
      const ref = refs.get(id);
      if (!ref) {
        const memory = memories.find((item) => item.id === id && item.status === "active");
        return { id, label: memory?.tags?.[0] || "旧聊", text: memory?.content.trim().slice(0, 180) };
      }
      const source = conversations.find((item) => item.id === ref.conversationId);
      return {
        id, label: ref.tags[0] || ref.conversationTitle || "旧聊",
        text: ref.text, quote: verifiedSummaryQuote(ref, source)?.quote,
      };
    });
  }, [conversations, ids, memories]);

  const pages = Math.ceil(cards.length / CARDS_PER_PAGE);
  const currentCards = cards.slice(page * CARDS_PER_PAGE, (page + 1) * CARDS_PER_PAGE);
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="k-source-deck-scrim" />
        <Dialog.Content className="k-source-deck" onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (trigger.isConnected) trigger.focus({ preventScroll: true });
        }}>
          <Dialog.Title className="sr-only">摘要来源</Dialog.Title>
          <Dialog.Description className="sr-only">选择卡片查看相关摘要片段</Dialog.Description>
          <Dialog.Close className="k-source-deck__close k-btn k-btn--icon" aria-label="关闭摘要来源"><X /></Dialog.Close>
          <SourceCards key={page} cards={currentCards} />
          {pages > 1 && <div className="k-source-deck__pages">
            <button type="button" className="k-btn k-btn--icon" aria-label="上一组来源" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft /></button>
            <span>{page + 1} / {pages}</span>
            <button type="button" className="k-btn k-btn--icon" aria-label="下一组来源" disabled={page === pages - 1} onClick={() => setPage(page + 1)}><ChevronRight /></button>
          </div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
