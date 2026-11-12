import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
await mkdir('screenshots/pet', {recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',recordVideo:{dir:'screenshots/pet/video'}});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const shot=async name=>{await page.screenshot({path:`screenshots/pet/${name}.png`});console.log(`PET_${name.toUpperCase()}_IMAGE=`+(await page.screenshot({type:'jpeg',quality:45})).toString('base64'));};
const previewButton=name=>page.locator('.pet-action-grid').getByRole('button',{name:new RegExp('^'+name)});
const settings=async()=>page.getByRole('tab',{name:'陪伴设置'}).click();
const choice=async(label,value)=>{await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('dialog',{name:label,exact:true}).getByRole('option',{name:value,exact:true}).click();};
try {
 await page.goto('http://127.0.0.1:8080/pet');await page.getByRole('heading',{name:'桌宠',exact:true}).waitFor({timeout:60000});
 const actor=page.locator('.pet-actor'),body=page.locator('.crab-body');await actor.waitFor({state:'visible'});await page.waitForTimeout(1500);
 const position=()=>actor.evaluate(e=>e.style.transform);
 await settings();
 assert.equal(await page.locator('.pet-settings select').count(),0,'no Android native pickers');
 for(const size of ['小 · 36 × 27','中 · 44 × 33','大 · 52 × 39']){
  await choice('大小',size);await page.getByRole('tab',{name:'动作预览'}).click();
  for(const [name,phase] of [['散步','walk'],['跳气泡','jump'],['自由活动','walk']]){
   await previewButton(name).click();await page.waitForFunction(p=>document.querySelector('.pet-actor')?.dataset.phase===p,phase,{timeout:10000});
   const at=await position();await page.waitForTimeout(200);assert.notEqual(await position(),at,`${name}/${size} must actually move`);
  }
  await settings();
 }
 await page.getByRole('button',{name:'大小',exact:true}).click();await page.getByRole('dialog',{name:'大小'}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'大小'}).waitFor({state:'hidden'});
 await page.getByRole('switch',{name:'允许拖动'}).click();assert.equal(await page.getByRole('switch',{name:'允许拖动'}).getAttribute('aria-checked'),'false');await page.getByRole('switch',{name:'允许拖动'}).click();
 await page.getByRole('switch',{name:'短句气泡'}).click();await page.getByRole('switch',{name:'短句气泡'}).click();
 await page.getByRole('tab',{name:'动作预览'}).click();await previewButton('小电脑').click();await page.waitForFunction(()=>document.querySelector('.pet-actor')?.dataset.phase==='work');
 assert.equal(await page.locator('.pet-laptop').evaluate(e=>getComputedStyle(e).opacity),'1');
 const pose=await body.getAttribute('transform');await page.waitForTimeout(150);assert.notEqual(await body.getAttribute('transform'),pose);
 await actor.click({force:true});await page.locator('.pet-speech').waitFor();await page.waitForTimeout(1500);
 const box=await actor.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+90,box.y-50,{steps:10});assert.equal(await actor.getAttribute('data-phase'),'drag');await page.mouse.up();
 const initialEvents=await page.evaluate(async()=>JSON.stringify((await import('/src/lib/store.ts')).useApp.getState().emotionEvents));
 await page.getByRole('tab',{name:'情绪预览'}).click();
 const groups=[['明亮','bright'],['平静','calm'],['低落','low'],['生气','angry'],['不安','uneasy'],['亲近','close'],['心动','flutter'],['吃醋','jealous'],['克制','restrained'],['好奇与表达','curious']];
 for(const [name,id] of groups){
  await page.getByRole('button',{name,exact:true}).click();await page.waitForFunction(g=>document.querySelector('.pet-actor')?.dataset.emotion===g,id);
  await page.waitForTimeout(700);const a=await body.getAttribute('transform');await page.waitForTimeout(160);assert.notEqual(await body.getAttribute('transform'),a,`${name} body reacts`);
  assert.equal(await page.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true');
 }
 assert.equal(await page.evaluate(async()=>JSON.stringify((await import('/src/lib/store.ts')).useApp.getState().emotionEvents)),initialEvents,'preview must not write real emotions');
 await shot('emotions');
 // Render the user's liquid theme too, using only this isolated test profile.
 await page.evaluate(async()=>{(await import('/src/lib/store.ts')).useApp.getState().patchSettings({material:'liquid'});});
 await page.waitForTimeout(500);
 const selected=page.getByRole('button',{name:'好奇与表达',exact:true});assert.equal(await selected.evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)','liquid selection stays transparent');
 await shot('liquid');await settings();await page.getByRole('button',{name:'大小',exact:true}).click();await page.getByRole('dialog',{name:'大小'}).waitFor();await shot('sheet');await page.keyboard.press('Escape');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no horizontal overflow');
 await page.getByRole('tab',{name:'动作预览'}).click();await previewButton('自由活动').click();
 await page.evaluate(async()=>{const {useApp}=await import('/src/lib/store.ts');useApp.setState({emotionEvents:[{id:'pet-ui-test',at:Date.now(),group:'angry',primaryEmotion:'生气',secondaryEmotions:[],intensity:.8,confidence:1,dimensions:{},category:'tension',evidence:[]}]});});
 await page.waitForFunction(()=>document.querySelector('.pet-actor')?.dataset.emotion==='angry',{},{timeout:15000});
 const desktop=await browser.newPage({viewport:{width:1365,height:900}});await desktop.goto('http://127.0.0.1:8080/pet');await desktop.locator('.pet-actor').waitFor({state:'visible'});await desktop.waitForTimeout(1800);await desktop.screenshot({path:'screenshots/pet/desktop.png'});console.log('PET_DESKTOP_IMAGE='+(await desktop.screenshot({type:'jpeg',quality:35})).toString('base64'));await desktop.close();
 assert.deepEqual(errors,[],'browser runtime errors');
 console.log('PASS: all 10 emotions, real event integration, all sizes x 3 movement previews, app choice sheet, transparent liquid selection, drag, speech, desktop');
} catch(e) {console.log('PET_FAILURE_IMAGE='+(await page.screenshot({type:'jpeg',quality:45})).toString('base64'));console.log('PET_VISIBLE_TEXT='+await page.locator('body').innerText());throw e;} finally {await context.close();await browser.close();}
