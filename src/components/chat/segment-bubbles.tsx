import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import { Markdown } from "@/components/shared/markdown";
import { cn } from "@/lib/utils";
import { useApp } from "@/lib/store";
import { BubbleDelivery, typingDelay } from "@/lib/segment";

type Props = {
  parts: string[]; liveTail?: boolean; delay?: number; fresh: boolean; deliveryKey?: string;
  cleanPart: (raw: string) => string; cleanTail: (raw: string) => string;
  press?: (raw: string) => Record<string, unknown>;
  hideIfEmpty?: (el: HTMLDivElement | null) => void;
};
const seen = new Set<string>();
export function SegmentBubbles({ parts, liveTail = false, delay, fresh, deliveryKey, cleanPart, press, hideIfEmpty }: Props) {
  const smart = useApp((s) => s.settings.segmentSmartDelay !== false);
  const charDelayMs = useApp((s) => s.settings.segmentCharDelayMs ?? 60);
  const pace = useRef({ smart, charDelayMs, delayMs: delay });
  pace.current = { smart, charDelayMs, delayMs: delay };
  const animate = useRef(fresh && (!deliveryKey || !seen.has(deliveryKey)));
  const model = useRef(new BubbleDelivery((text) => typingDelay(text, pace.current)));
  const [shown, setShown] = useState<string[]>(animate.current ? [] : parts);
  const clean = parts.map(cleanPart).filter((s) => s.trim().length > 0);
  const signature = JSON.stringify(clean);
  const unfinished = liveTail && !/[。！？!?….][”’"'」』）)\]}]*$|```\s*$|~~~\s*$/.test(clean.at(-1) ?? "");
  useEffect(() => {
    if (deliveryKey) seen.add(deliveryKey);
    if (!animate.current) { setShown(JSON.parse(signature)); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const queue = model.current;
    queue.update(JSON.parse(signature), unfinished, Date.now());
    const tick = () => {
      queue.tick(Date.now());
      setShown([...queue.visible]);
      if (queue.dueAt) timer = setTimeout(tick, Math.max(1, queue.dueAt - Date.now()));
    };
    tick();
    return () => clearTimeout(timer);
  }, [signature, unfinished, deliveryKey, smart, charDelayMs, delay]);
  const pending = animate.current && (shown.length < clean.length || unfinished);
  return <div className="space-y-1.5">
    {shown.map((part, index) => <div key={index} ref={hideIfEmpty}
      {...(!press ? {} : press(part) as HTMLAttributes<HTMLDivElement>)} data-role="ai"
      className={cn("k-bubble w-max min-w-0 max-w-full select-none [-webkit-touch-callout:none] [touch-action:manipulation]", animate.current && "bubble-in")}>
      <Markdown text={part} />
    </div>)}
    {pending && <p className="k-bubble k-bubble--ghost text-subtle" role="status">正在输入…</p>}
  </div>;
}
