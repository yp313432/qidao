import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LEXICON} from '../src/plugins/emotion-lifeform/lib/emotion/lexicon.ts';
import {emotionPose,GESTURE_HINTS} from '../src/components/pet/pet-emotion.ts';
import {measureScene,previewRoute,pathClear} from '../src/components/pet/pet-scene.ts';
import {petLine} from '../src/components/pet/pet-lines.ts';
test('all lexicon groups have distinct body sequences, intensity and matching short phrases',()=>{
 assert.equal(LEXICON.length,10);
 assert.deepEqual(Object.keys(GESTURE_HINTS).sort(),LEXICON.map(g=>g.id).sort());
 const samples=[];
 for(const g of LEXICON){
  const pose=emotionPose(g.id,950,65),end=emotionPose(g.id,3800,65);
  assert(Object.values(pose).some(v=>Math.abs(v)>.01),g.id+' must move');
  assert(Object.values(end).every(v=>Math.abs(v)<1e-10),g.id+' must settle');
  const weak=emotionPose(g.id,950,10),strong=emotionPose(g.id,950,90);
  assert(Object.values(strong).reduce((a,v)=>a+Math.abs(v),0)>Object.values(weak).reduce((a,v)=>a+Math.abs(v),0));
  samples.push(JSON.stringify(pose));assert(petLine('emotion','小雨',g.id).length<30);
 }
 assert.equal(new Set(samples).size,10);
});
test('walk and jump previews have valid reversible routes at every size and phone width',()=>{
 const old=globalThis.window;globalThis.window={innerHeight:900};
 const r=(x,y,w,h)=>({left:x,top:y,right:x+w,bottom:y+h,width:w,height:h});
 try{for(const width of [300,320,360,390,400])for(const size of [36,44,52]){
  const w=Math.max(44,size+12),h=Math.max(44,size*.75+12);
  const bubbles=[r(14,96,width*.55,44),r(width-14-width*.55,206,width*.55,44),r(14,316,width*.55,44)].map(rect=>({getBoundingClientRect:()=>rect}));
  const layer={getBoundingClientRect:()=>r(0,0,width,380)};
  const scene=measureScene(layer,{getBoundingClientRect:()=>r(0,0,width,380),querySelectorAll:()=>bubbles},null,w,h);
  for(const mode of ['walk','jump']){
   const route=previewRoute(scene,w,h,layer.getBoundingClientRect(),mode);
   assert(route,`${mode} route missing at ${width}/${size}`);
   assert.equal(route.jump,mode==='jump');
   assert(pathClear(route.from,route.to,scene,w,h,layer.getBoundingClientRect(),route.jump));
   assert(pathClear(route.to,route.from,scene,w,h,layer.getBoundingClientRect(),route.jump));
  }
 }}finally{globalThis.window=old;}
});
