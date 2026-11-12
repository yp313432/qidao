import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSplashGate,splashDue,splashMotionEnabled,SPLASH_GAP_MS as H} from '../src/lib/splash-gate.ts';
function fixture({last=null,enabled=true,initialPreview=false}={}){
 let now=10*H,at=last,allow=enabled;const plays=[],marks=[];let stops=0;
 const gate=createSplashGate({now:()=>now,lastAt:()=>at,enabled:()=>allow,initialPreview,play:r=>plays.push(r),stop:()=>stops++,mark:t=>{marks.push(t);at=t}});
 return {gate,plays,marks,get stops(){return stops},get at(){return at},time:t=>now=t,advance:dt=>now+=dt,enabled:v=>allow=v};
}
test('one-hour cooldown and a single shared motion decision',()=>{
 assert.equal(splashDue(0,H-1,false),false);assert.equal(splashDue(0,H,false),true);assert.equal(splashDue(H+1,H,false),true);assert.equal(splashDue(null,H,true),false);
 assert.equal(splashMotionEnabled('on',true),true);assert.equal(splashMotionEnabled('off',false),false);assert.equal(splashMotionEnabled('auto',true),false);assert.equal(splashMotionEnabled(undefined,false),true);
});
test('cold startup presents once; duplicate active signals and navigation do not replay',()=>{
 const f=fixture();f.gate.setActive(true);assert.deepEqual(f.plays,['cold']);assert.deepEqual(f.marks,[],'not recorded before visible');
 assert(f.gate.presented());f.gate.presented();assert.equal(f.marks.length,1);f.gate.finish();f.gate.setActive(true);f.advance(2*H);f.gate.setActive(true);assert.equal(f.plays.length,1);
});
test('recent cold start skips; exact hour resumes; short interruptions and duplicate background events do not reset absence',()=>{
 const f=fixture({last:10*H});f.gate.setActive(true);assert.equal(f.plays.length,0);
 f.gate.setActive(false);f.advance(H-1);f.gate.setActive(true);assert.equal(f.plays.length,0);
 f.gate.setActive(false);f.advance(H/2);f.gate.setActive(false);f.advance(H/2);f.gate.setActive(true);assert.deepEqual(f.plays,['resume']);f.gate.presented();assert.equal(f.marks.length,1);
 f.gate.setActive(true);assert.equal(f.plays.length,1);
});
test('startup while hidden defers; interruption before first visible frame does not consume cooldown',()=>{
 const f=fixture();f.gate.setActive(false);assert.equal(f.plays.length,0);f.gate.setActive(true);f.gate.setActive(false);assert.equal(f.gate.presented(),false);assert.equal(f.marks.length,0);assert.equal(f.stops,1);
 f.advance(H);f.gate.setActive(true);assert.deepEqual(f.plays,['cold','resume']);f.gate.presented();assert.equal(f.marks.length,1);
});
test('manual previews ignore cooldown, do not change automatic timestamps and respect animation off',()=>{
 const f=fixture({last:10*H});f.gate.setActive(true);assert(f.gate.preview());assert.equal(f.gate.preview(),false,'no overlapping animations');f.gate.presented();f.gate.finish();assert.equal(f.at,10*H);assert.equal(f.marks.length,0);
 f.enabled(false);assert.equal(f.gate.preview(),false);f.enabled(true);assert(f.gate.preview());f.gate.cancel();assert.equal(f.stops,1);
});
test('legacy preview query also works on deferred native initialization and never consumes automatic quota',()=>{
 const f=fixture({last:10*H,initialPreview:true});f.gate.setActive(false);f.gate.setActive(true);assert.deepEqual(f.plays,['preview']);f.gate.presented();assert.equal(f.marks.length,0);
});
test('skip/finish permits another requested preview; clock rollback cannot create a fake long background absence',()=>{
 const f=fixture();f.gate.setActive(true);f.gate.presented();f.gate.finish();assert(f.gate.preview());f.gate.finish();f.gate.setActive(false);f.advance(-2*H);f.gate.setActive(true);assert.equal(f.plays.length,2);
});
