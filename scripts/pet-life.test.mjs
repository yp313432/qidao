import assert from 'node:assert/strict';
import { test } from 'node:test';
import { motionReduced, arc, pathClear } from '../src/components/pet/pet-scene.ts';
import { petLine } from '../src/components/pet/pet-lines.ts';
import { createPetLife } from '../src/components/pet/pet-life.ts';
test('explicit pet motion follows app override before system preference', () => {
  assert.equal(motionReduced('on', 'auto', true), false);
  assert.equal(motionReduced('auto', 'on', true), false);
  assert.equal(motionReduced('off', 'on', false), true);
  assert.equal(motionReduced('auto', 'auto', true), true);
  assert.equal(motionReduced('on', 'off', false), true);
});
test('jumps have continuous endpoints and rise; text uses nickname without repeating', () => {
  const a={x:0,y:80},b={x:120,y:40};
  assert.deepEqual(arc(a,b,0),a);
  assert(Math.abs(arc(a,b,1).y-b.y)<.001);
  assert(arc(a,b,.5).y<40);
  assert.equal(petLine('work','小雨',undefined,'开工。'),'我查一下。');
  assert(petLine('poke','小雨',undefined,'嗯？').length>0);
});
test('real life controller changes position, animates body, drags and resumes work', () => {
  let now=0, queued;const globals={};const listeners=new Map();
  for(const key of ['window','document','requestAnimationFrame','cancelAnimationFrame']) globals[key]=Object.getOwnPropertyDescriptor(globalThis,key);
  const clock=Object.getOwnPropertyDescriptor(performance,'now');Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
  globalThis.window={innerHeight:700};globalThis.document={hidden:false,addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
  globalThis.requestAnimationFrame=f=>{queued=f;return 1};globalThis.cancelAnimationFrame=()=>queued=undefined;
  const rect=(x,y,w,h)=>({left:x,top:y,right:x+w,bottom:y+h,width:w,height:h});
  const nodes=Array.from({length:7},()=>({attrs:{},setAttribute(n,v){this.attrs[n]=v}}));
  const handlers=new Map();const actor={dataset:{},style:{},hidden:true,querySelector:s=>s==='.crab-body'?nodes[0]:s==='.crab-claw-left'?nodes[1]:s==='.crab-claw-right'?nodes[2]:null,querySelectorAll:()=>nodes.slice(3),addEventListener:(n,f)=>handlers.set(n,f),removeEventListener:n=>handlers.delete(n),setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture(){}};
  const layer={dataset:{},getBoundingClientRect:()=>rect(0,0,390,650)};
  const bubble={isConnected:true,getBoundingClientRect:()=>rect(80,250,220,50)};
  const list={getBoundingClientRect:()=>rect(0,0,390,650),querySelectorAll:()=>[bubble]};
  const o={size:44,quiet:false,reduced:false,paused:false,busy:false,working:false,draggable:true,preview:'auto'};
  const lines=[];let dropped;
  const life=createPetLife(layer,actor,list,null,()=>o,{line:k=>lines.push(k),drop:p=>dropped=p});
  const advance=ms=>{const end=now+ms;while(now<end){now=Math.min(end,now+16);const fn=queued;queued=undefined;fn?.(now)}};
  try {
    advance(32);const first=actor.style.transform;advance(6000);assert.notEqual(actor.style.transform,first);assert.equal(actor.hidden,false);
    life.poke();advance(300);assert.equal(actor.dataset.phase,'poke');assert.notEqual(nodes[0].attrs.transform,'translate(0 0.00) rotate(0.00 12 14)');
    o.working=true;advance(800);assert.equal(actor.dataset.phase,'work');
    life.poke();advance(1500);assert.equal(actor.dataset.phase,'work');
    const e={pointerId:1,clientX:150,clientY:200,preventDefault(){}};
    handlers.get('pointerdown')(e);handlers.get('pointermove')({...e,clientX:210,clientY:120});advance(16);assert.equal(actor.dataset.phase,'drag');
    handlers.get('pointerup')({...e,clientX:210,clientY:120});assert(dropped);advance(2000);assert.equal(actor.dataset.phase,'work');
    o.working=false;advance(32);assert.equal(actor.dataset.phase,'pack');advance(700);assert.equal(actor.dataset.phase,'cheer');
    o.reduced=true;advance(2000);const at=actor.style.transform;advance(3000);assert.equal(actor.style.transform,at);
    assert(lines.includes('drag'));assert(lines.includes('drop'));
    life.dispose();assert.equal(handlers.size,0);assert.equal(listeners.size,0);
  } finally {life.dispose();for(const [k,d] of Object.entries(globals)){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k]};if(clock)Object.defineProperty(performance,'now',clock);else delete performance.now;}
});
