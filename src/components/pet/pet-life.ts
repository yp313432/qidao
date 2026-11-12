import { emotionPose } from './pet-emotion.ts';
import { arc, clamp, measureScene, pathClear, previewRoute, type Point, type Surface } from './pet-scene.ts';
export type PetAction = 'auto' | 'walk' | 'jump' | 'poke' | 'think' | 'work' | 'rest' | 'cheer' | 'emotion';
export type LifeOptions = { size: number; quiet: boolean; reduced: boolean; paused: boolean; busy: boolean; working: boolean; draggable: boolean; preview: PetAction; previewKey?: number; anchor?: Point; demo?: boolean; mood?: string; intensity?: number; emotionKey?: string };
type Hooks = { line: (kind: string) => void; drop?: (point: Point) => void };
export function createPetLife(layer: HTMLElement, actor: HTMLElement, list: HTMLElement, composer: HTMLElement | null, options: () => LifeOptions, hooks: Hooks) {
  let frame = 0, dead = false, last = 0, now = performance.now(), changed = now, next = now + 1000;
  let position: Surface | undefined, from: Point | undefined, target: Surface | undefined;
  let phase = 'idle', jumping = false, drag: { id: number; x: number; y: number; origin: Point; active: boolean } | undefined;
  let carrying = false;
  let emotionKey: string | undefined, pendingMood: string | undefined, activeMood: string | undefined, nextEmotion = now + 12000;
  let demoPair: ReturnType<typeof previewRoute>; 
  let previousWork = false, preview: PetAction = 'auto', previewKey = -1, lastLine = now;
  let sceneCache: ReturnType<typeof measureScene> | undefined, measured = -Infinity, measuredSize = 0;
  const body = actor.querySelector<SVGGElement>('.crab-body');
  const left = actor.querySelector<SVGElement>('.crab-claw-left'), right = actor.querySelector<SVGElement>('.crab-claw-right');
  const legs = Array.from(actor.querySelectorAll<SVGElement>('.crab-leg'));
  const laptop = actor.querySelector<HTMLElement>('.pet-laptop');
  const set = (name: string) => { if (phase !== name) { phase = name; changed = now; actor.dataset.phase = name; } };
  const say = (kind: string) => { hooks.line(kind); lastLine = now; };
  const stop = () => { target = undefined; from = undefined; };
  const pose = (age: number, reduced: boolean) => {
    let y = 0, angle = 0, ly = 0, ry = 0;
    const beat = Math.sin(age * .016);
    if (phase === 'walk') { y = -Math.abs(beat); ly = -beat; ry = beat; }
    if (phase === 'crouch' || phase === 'land') y = 2 * (1 - Math.min(1, age / 230));
    if (phase === 'jump' || phase === 'drag') { ly = ry = -3; angle = phase === 'drag' ? Math.sin(age * .008) * 8 : -5; }
    if (phase === 'think') { angle = Math.sin(age * .003) * 9; ry = -4; }
    if (phase === 'work') { angle = beat * 3; ly = -2 + beat * 2; ry = -2 - beat * 2; }
    if (phase === 'unpack' || phase === 'pack') { angle = -8; ly = -3; }
    if (phase === 'poke' || phase === 'cheer') { y = -Math.abs(Math.sin(Math.min(1, age / 1000) * Math.PI * 2)) * 5; ly = ry = -3 - Math.abs(beat) * 2; }
    if (phase === 'rest') { y = 3; ly = ry = 2; }
    if (phase === 'idle') angle = Math.sin(age * .0015) * 3;
    const mood = phase === 'emotion' ? emotionPose(activeMood, age, options().intensity) : emotionPose(undefined, 0);
    if (phase === 'emotion') { y = mood.y; angle = mood.angle; ly = mood.ly; ry = mood.ry; }
    if (reduced) { y = angle = ly = ry = 0; }
    body?.setAttribute('transform', `translate(${reduced ? 0 : mood.x.toFixed(2)} ${y.toFixed(2)}) rotate(${angle.toFixed(2)} 12 14)`);
    left?.setAttribute('transform', `translate(${reduced ? 0 : mood.lx.toFixed(2)} ${ly.toFixed(2)}) rotate(${reduced ? 0 : mood.la.toFixed(2)} 1.5 9.5)`);
    right?.setAttribute('transform', `translate(${reduced ? 0 : mood.rx.toFixed(2)} ${ry.toFixed(2)}) rotate(${reduced ? 0 : mood.ra.toFixed(2)} 22.5 9.5)`);
    legs.forEach((leg, i) => leg.setAttribute('transform', reduced ? '' : phase === 'emotion' ? `translate(0 ${(mood.step * (i % 2 ? -1 : 1)).toFixed(2)})` : phase === 'walk' ? `translate(${Math.sin(age * .018 + (i % 2) * Math.PI).toFixed(2)} ${(-Math.max(0, Math.sin(age * .018 + (i % 2) * Math.PI)) * 2).toFixed(2)})` : phase === 'jump' || phase === 'drag' || phase === 'rest' ? 'translate(0 -2)' : ''));
    if (laptop) {
      const visible = ['unpack','work','wait','pack'].includes(phase) || (['drag','jump','land'].includes(phase) && carrying);
      const t = reduced ? 1 : Math.min(1, age / 600);
      laptop.style.opacity = visible ? String(phase === 'pack' ? 1 - t : phase === 'unpack' ? t : 1) : '0';
      laptop.style.transform = `translateY(${phase === 'unpack' ? (1 - t) * 14 : phase === 'pack' ? t * 14 : 0}px)`;
    }
  };
  const tick = (time: number) => {
    if (dead || document.hidden) return;
    now = time; const dt = last ? Math.min(40, time - last) : 0; last = time;
    const o = options(), w = Math.max(44, o.size + 12), h = Math.max(44, o.size * .75 + 12);
    layer.dataset.paused = String(o.paused);
    if (o.paused) { frame = requestAnimationFrame(tick); return; }
    if (!sceneCache || measuredSize !== o.size || now - measured > 140) { measuredSize = o.size; sceneCache = measureScene(layer, list, composer, w, h); measured = now; }
    const scene = sceneCache;
    if (o.emotionKey !== emotionKey) { emotionKey = o.emotionKey; pendingMood = o.mood; }
    actor.dataset.mood = o.mood ?? ''; 
    if (!position) {
      const anchor = o.anchor;
      position = anchor ? { x: anchor.x * scene.width, y: anchor.y * scene.height } : { ...scene.surfaces[scene.surfaces.length - 1]! };
    }
    // Stand on the same message while it scrolls. Re-routing never resets visibility.
    if (!target && !drag && position.element?.isConnected) {
      const r = position.element.getBoundingClientRect();
      position.y = r.top - layer.getBoundingClientRect().top - scene.top - h + 4;
    }
    position.x = clamp(position.x, 0, scene.width - w);
    position.y = clamp(position.y, 0, scene.height - h);
    if (o.preview !== preview || (o.previewKey ?? 0) !== previewKey) {
      const packing = preview === 'work' && o.preview !== 'work';
      preview = o.preview; previewKey = o.previewKey ?? 0; stop();
      set(packing ? 'pack' : preview === 'auto' || preview === 'jump' || preview === 'walk' ? 'idle' : preview === 'work' ? 'unpack' : preview); changed = now; next = now;
      demoPair = undefined;
      if (o.demo && ['walk','jump','auto'].includes(preview)) {
        demoPair = previewRoute(scene,w,h,layer.getBoundingClientRect(),preview === 'jump' ? 'jump' : 'walk');
        if (demoPair) { position = { ...demoPair.from }; from = { ...position }; target = { ...demoPair.to }; set(demoPair.jump ? 'crouch' : 'walk'); }
      }
      if (preview === 'emotion') { activeMood = o.mood; actor.dataset.emotion = activeMood ?? ''; say('emotion'); }
    }
    if (!drag && o.preview === 'auto') {
      if (o.working && !previousWork) { stop(); set('unpack'); say('work'); }
      if (!o.working && previousWork) { stop(); set('pack'); }
      if (o.working && previousWork && phase === 'idle') set('work');
      previousWork = o.working;
      if (phase === 'idle' && o.busy && !o.working) { stop(); set('think'); }
      if (phase === 'think' && !o.busy) { set('idle'); next = now + 800; }
    }
    if (o.preview === 'auto' && phase === 'idle' && !o.busy && !o.working && !drag && !o.reduced && (pendingMood || now >= nextEmotion)) {
      activeMood = pendingMood ?? o.mood; pendingMood = undefined;
      if (activeMood) { stop(); set('emotion'); actor.dataset.emotion = activeMood; say('emotion'); }
      nextEmotion = now + (o.quiet ? 24000 : 14000);
    }
    if (o.preview === 'emotion' && phase === 'idle') { activeMood = o.mood; set('emotion'); }
    let age = now - changed;
    if (phase === 'emotion' && age >= 4400) {
      if (o.preview === 'emotion') changed = now;
      else { set('idle'); next = now + 1200; }
    }
    if (o.preview === 'work' && phase === 'idle') set('unpack');
    if (phase === 'unpack' && age > 650) set('work');
    if (phase === 'pack' && age > 650) { set('cheer'); say('done'); }
    if (['poke','cheer','land'].includes(phase) && age > (phase === 'land' ? 250 : 1150)) { set('idle'); next = now + 1200; }
    if (phase === 'idle' && now >= next && !o.busy && !o.working && !drag && !o.reduced && ['auto','walk','jump'].includes(o.preview)) {
      const box = layer.getBoundingClientRect();
      if (o.demo && demoPair) {
        // Reverse a verified route, or choose a jump after walking during free activity.
        if (o.preview === 'auto') {
          const candidates = scene.surfaces.filter(p => Math.hypot(p.x-position!.x,p.y-position!.y)>28 && pathClear(position!,p,scene,w,h,box,Math.abs(p.y-position!.y)>8));
          const pick = candidates[Math.floor(Math.random()*candidates.length)];
          if (pick) demoPair = { from: { ...position }, to: pick, jump: Math.abs(pick.y-position.y)>8 };
        } else demoPair = { from: demoPair.to, to: demoPair.from, jump: demoPair.jump };
        from = { ...position }; target = { ...demoPair.to }; position.element = undefined; set(demoPair.jump ? 'crouch' : 'walk');
      } else {
        const choices = scene.surfaces.filter(p => (o.preview !== 'walk' || Math.abs(p.y-position!.y)<8) && Math.hypot(p.x-position!.x,p.y-position!.y)>25 && Math.hypot(p.x-position!.x,p.y-position!.y)<400 && pathClear(position!,p,scene,w,h,box,Math.abs(p.y-position!.y)>8 || o.preview==='jump'));
        const chosen = choices[Math.floor(Math.random()*choices.length)];
        if (chosen) { from = { ...position }; target = chosen; position.element = undefined; jumping = Math.abs(chosen.y-position.y)>8 || o.preview==='jump'; set(jumping ? 'crouch' : 'walk'); }
      }
      next = now + (o.quiet ? 6500 : 2300) + Math.random() * 1600;
    }
    if (phase === 'crouch' && age > 200) set('jump');
    if (target && from && !drag && !o.reduced && (phase === 'walk' || phase === 'jump')) {
      const duration = phase === 'jump' ? 800 : Math.max(900, Math.abs(target.x - from.x) / .035);
      const t = Math.min(1, (now - changed) / duration);
      position = phase === 'jump' ? arc(from, target, t) : { x: from.x + (target.x - from.x) * t, y: from.y + (target.y - from.y) * t };
      if (t >= 1) { position = { ...target }; stop(); set('land'); }
    }
    if (o.reduced && target) { stop(); set('idle'); }
    if (o.preview === 'auto' && phase === 'idle' && now - lastLine > 40000 + (o.quiet ? 30000 : 0)) { say('idle'); }
    age = now - changed; pose(age, o.reduced);
    position.x = clamp(position.x, 0, scene.width - w);
    position.y = clamp(position.y, 0, scene.height - h);
    actor.style.transform = `translate(${(scene.left + position.x).toFixed(2)}px, ${(scene.top + position.y).toFixed(2)}px)`;
    actor.dataset.edge = position.x < 75 ? 'left' : position.x > scene.width - w - 75 ? 'right' : 'center';
    actor.hidden = false;
    frame = requestAnimationFrame(tick);
  };
  const poke = () => { now = performance.now(); stop(); set('poke'); changed = now; say('poke'); };
  const down = (e: PointerEvent) => {
    if (!options().draggable || !position) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, origin: { ...position }, active: false };
    actor.setPointerCapture(e.pointerId); e.preventDefault();
  };
  const move = (e: PointerEvent) => {
    if (!drag || drag.id !== e.pointerId || !position) return;
    if (!drag.active && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    if (!drag.active) { carrying = ['work','unpack','wait'].includes(phase); drag.active = true; stop(); set('drag'); say('drag'); }
    position = { x: drag.origin.x + e.clientX - drag.x, y: drag.origin.y + e.clientY - drag.y };
  };
  let suppressClick = false;
  const up = (e: PointerEvent) => {
    if (!drag || drag.id !== e.pointerId) return;
    const moved = drag.active; drag = undefined; suppressClick = moved;
    if (actor.hasPointerCapture(e.pointerId)) actor.releasePointerCapture(e.pointerId);
    if (moved && position) {
      const o = options(), scene = measureScene(layer, list, composer, Math.max(44, o.size + 12), Math.max(44, o.size * .75 + 12));
      const landing = [...scene.surfaces].sort((a,b) => Math.hypot(a.x-position!.x,a.y-position!.y)-Math.hypot(b.x-position!.x,b.y-position!.y))[0];
      if (landing) { from = { ...position }; target = landing; set('jump'); }
      else set('land');
      hooks.drop?.({ x: position.x / Math.max(1,scene.width), y: position.y / Math.max(1,scene.height) }); say('drop');
    }
  };
  const click = () => { if (suppressClick) { suppressClick = false; return; } poke(); };
  const resume = () => { cancelAnimationFrame(frame); last = 0; if (!document.hidden) frame = requestAnimationFrame(tick); };
  actor.addEventListener('pointerdown', down); actor.addEventListener('pointermove', move); actor.addEventListener('pointerup', up); actor.addEventListener('pointercancel', up); actor.addEventListener('click', click);
  document.addEventListener('visibilitychange', resume); frame = requestAnimationFrame(tick);
  return { poke, dispose() { dead = true; cancelAnimationFrame(frame); actor.removeEventListener('pointerdown',down); actor.removeEventListener('pointermove',move); actor.removeEventListener('pointerup',up); actor.removeEventListener('pointercancel',up); actor.removeEventListener('click',click); document.removeEventListener('visibilitychange',resume); } };
}
