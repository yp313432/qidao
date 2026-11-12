import { useEffect, useRef, useState, type RefObject } from "react";
import { CrabPixels, groupName, groupOfEvent } from "./drawer-crab";
import { createCrabMotion } from "./crab-motion";
import { chatCrabSize } from "@/lib/chat-crab-settings";
import { useApp } from "@/lib/store";
import { useEmotionStore } from "@/plugins/emotion-lifeform/lib/store";

type Props = {
  scroller: RefObject<HTMLDivElement | null>;
  composer: RefObject<HTMLDivElement | null>;
  paused: boolean;
  busy: boolean;
  working: boolean;
  replay: number;
};

export function ChatCrab({ scroller, composer, paused, busy, working, replay }: Props) {
  const pet = useApp((s) => s.settings.chatCrab);
  const event = useApp((s) => s.emotionEvents[0]);
  const reduced = useEmotionStore((s) => Boolean(s.settings.reducedMotion));
  const host = useRef<HTMLDivElement>(null);
  const actor = useRef<HTMLButtonElement>(null);
  const motion = useRef<ReturnType<typeof createCrabMotion> | null>(null);
  const bubbleTimer = useRef(0);
  const [bubble, setBubble] = useState(false);
  const width = chatCrabSize(pet?.size);
  const enabled = pet?.enabled !== false;
  const options = useRef({ width, quiet: pet?.activity === "quiet", reduced, paused, busy, working });
  useEffect(() => {
    options.current = { width, quiet: pet?.activity === "quiet", reduced, paused, busy, working };
  }, [width, pet?.activity, reduced, paused, busy, working]);

  useEffect(() => {
    if (!enabled || !host.current || !actor.current) return;
    setBubble(false);
    const controller = createCrabMotion(host.current, actor.current, () => options.current);
    motion.current = controller;
    const list = scroller.current;
    const input = composer.current;
    list?.addEventListener("scroll", controller.wake, { passive: true });
    input?.addEventListener("input", controller.wake);
    input?.addEventListener("focusin", controller.wake);
    return () => {
      controller.dispose();
      motion.current = null;
      list?.removeEventListener("scroll", controller.wake);
      input?.removeEventListener("input", controller.wake);
      input?.removeEventListener("focusin", controller.wake);
      window.clearTimeout(bubbleTimer.current);
    };
  }, [enabled, scroller, composer]);

  useEffect(() => {
    if (replay) motion.current?.poke();
  }, [replay]);

  if (!enabled) return null;
  const label = working ? "在忙" : busy ? "在思考" : groupName(groupOfEvent(event)) || "陪着你";
  return (
    <div ref={host} className="chat-crab-layer chat-crab-perch"
      style={{ height: Math.round(width * 0.75) + 42 }}>
      <button ref={actor} className="chat-crab-actor" type="button"
        style={{ width: Math.max(44, width + 12), height: Math.max(44, Math.round(width * 0.75) + 12) }}
        aria-label={`戳一下小螃蟹，${label}`} hidden
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => {
          motion.current?.poke();
          setBubble(true);
          window.clearTimeout(bubbleTimer.current);
          bubbleTimer.current = window.setTimeout(() => setBubble(false), 3000);
        }}>
        <span className="chat-crab-status" aria-hidden="true" />
        {bubble && <span className="crab-bubble chat-crab-bubble" role="status">{label}</span>}
        <CrabPixels group={groupOfEvent(event)} intensity={event?.intensity} size={width} reduced={reduced} articulated />
      </button>
    </div>
  );
}
