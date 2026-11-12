import { useEffect, useRef, useState, type RefObject } from 'react';
import { CrabPixels, groupOfEvent } from './drawer-crab';
import { createPetLife, type LifeOptions, type PetAction } from '@/components/pet/pet-life';
import { motionReduced } from '@/components/pet/pet-scene';
import { petLine } from '@/components/pet/pet-lines';
import { chatCrabSize } from '@/lib/chat-crab-settings';
import { useApp } from '@/lib/store';

type Props = {
  scroller: RefObject<HTMLDivElement | null>; composer: RefObject<HTMLDivElement | null>;
  paused: boolean; busy: boolean; working: boolean; replay: number;
  preview?: PetAction; previewKey?: number; emotionPreview?: string; emotionIntensity?: number;
};
export function ChatCrab({ scroller, composer, paused, busy, working, replay, preview, previewKey = 0, emotionPreview, emotionIntensity = 65 }: Props) {
  const settings = useApp(s => s.settings);
  const event = useApp(s => s.emotionEvents[0]);
  const pet = settings.chatCrab;
  const mood = emotionPreview ?? groupOfEvent(event);
  const intensity = emotionPreview ? emotionIntensity : (event?.intensity ?? .6) * 100;
  const size = chatCrabSize(pet?.size), enabled = preview !== undefined || pet?.enabled !== false;
  const layer = useRef<HTMLDivElement>(null), actor = useRef<HTMLButtonElement>(null);
  const controller = useRef<ReturnType<typeof createPetLife> | null>(null);
  const latest = useRef({ settings, pet, event, mood });
  const options = useRef<LifeOptions>({ size, quiet: false, reduced: false, paused, busy, working, draggable: true, preview: preview ?? 'auto' });
  const [line, setLine] = useState('');
  const timer = useRef(0), previousLine = useRef(''), lastSaid = useRef(0);
  useEffect(() => {
    latest.current = { settings, pet, event, mood };
    options.current = { size, quiet: pet?.activity === 'quiet',
      reduced: motionReduced(settings.motion, pet?.motion ?? 'on', window.matchMedia('(prefers-reduced-motion: reduce)').matches),
      paused, busy, working, draggable: pet?.draggable !== false,
      preview: preview ?? 'auto', previewKey, anchor: pet?.anchor, demo: preview !== undefined, mood, intensity, emotionKey: emotionPreview ? `${emotionPreview}:${previewKey}` : `${event?.id ?? ''}:${mood ?? ''}:${intensity}` };
  }, [settings, pet, event, size, paused, busy, working, preview, previewKey, mood, intensity, emotionPreview]);
  useEffect(() => {
    if (!enabled || !layer.current || !actor.current || !scroller.current) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const life = createPetLife(layer.current, actor.current, scroller.current, preview === undefined ? composer.current : null, () => ({ ...options.current, reduced: motionReduced(latest.current.settings.motion, latest.current.pet?.motion ?? 'on', media.matches) }), {
      line(kind) {
        const s = latest.current;
        if (s.pet?.speech === false || (performance.now() - lastSaid.current < 1600 && kind !== 'poke')) return;
        const text = petLine(kind, s.settings.displayName, s.mood, previousLine.current);
        previousLine.current = text; lastSaid.current = performance.now(); setLine(text);
        window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setLine(''), 3200);
      },
      drop(anchor) {
        if (preview !== undefined) return;
        const current = useApp.getState().settings.chatCrab;
        useApp.getState().patchSettings({ chatCrab: { enabled: true, size: 44, activity: 'lively', ...current, anchor } });
      },
    });
    controller.current = life;
    return () => { life.dispose(); controller.current = null; window.clearTimeout(timer.current); };
  }, [enabled, scroller, composer, preview !== undefined]);
  useEffect(() => { if (replay) controller.current?.poke(); }, [replay]);
  // Switching the requested preview restarts its sequence without remounting the actor.
  useEffect(() => { if (previewKey && preview === 'poke') controller.current?.poke(); }, [previewKey, preview]);
  if (!enabled) return null;
  return <div ref={layer} className="pet-layer">
    <button ref={actor} className="pet-actor" type="button" hidden aria-label="摸摸或拖动小螃蟹"
      style={{ width: Math.max(44, size + 12), height: Math.max(44, size * .75 + 12), touchAction: pet?.draggable === false ? 'pan-y' : 'none' }}>
      <span className="pet-status" aria-hidden="true" />
      {line && <span className="pet-speech" role="status">{line}</span>}
      <CrabPixels size={size} group={mood} intensity={intensity} reduced articulated />
      <svg className="pet-laptop" viewBox="0 0 28 20" width={Math.round(size * .85)} height={Math.round(size * .6)} aria-hidden="true" shapeRendering="crispEdges">
        <rect x="3" y="2" width="22" height="13" rx="1" fill="var(--aster-fg)" />
        <rect x="5" y="4" width="18" height="9" fill="var(--aster-bg)" />
        <path d="M7 7h6M7 10h11" stroke="var(--aster-accent)" strokeWidth="1" />
        <path d="M3 15h22l3 4H0Z" fill="var(--aster-fg)" />
        <path d="M6 17h16" stroke="var(--aster-bg)" />
      </svg>
    </button>
  </div>;
}
