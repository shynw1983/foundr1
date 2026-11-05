// Actual React pages with synthetic HTTP/native printing. No live API or database access.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const output=resolve(process.env.SCALE_TARE_UI_OUTPUT || 'outputs/store-scale-tare-20261018/pos-ui'); await mkdir(output,{recursive:true});
const dictionaries=Object.fromEntries(await Promise.all(['zh-Hans','zh-Hant'].map(async l=>[l,JSON.parse(await readFile(`public/locales/os/${l}.json`,'utf8'))])));
const settings={enabled:true,revision:'11111111-1111-4111-8111-111111111111',presets:[{id:'small',grams:100},{id:'large',grams:200}]};
const store={id:'fixture-store',name:'桜並木店',brandIds:['fixture-brand']},brand={id:'fixture-brand',name:'まぁ麻'};
const printer={deviceType:'escpos_network',connectionType:'lan',host:'192.168.0.33',port:9100,identifier:'192.168.0.33',paperWidth:'80mm',cutPaper:true,openCashDrawer:true};
const posData={selectedStoreId:store.id,access:{stores:[store]},brands:[brand],categories:[],optionGroups:[],todaySummary:{orderCount:0,total:0,average:0,latestOrders:[]},
  items:['自選マーラータン','別の計量商品'].map((name,index)=>({id:index?'fixture-menu-other':'fixture-menu',brandId:brand.id,brandName:brand.name,name,itemKind:'buildable_product',category:'マーラータン',priceOverride:null,basePrice:0,posPricingMode:'weight',posWeightUnit:'g',posWeightUnitPrice:4,isAvailable:true,variableSchema:{},imageUrl:''})),
  posSettings:{scaleTareSettings:settings,dineInEnabled:true,takeoutEnabled:true,priceTaxMode:'tax_included',printerSettings:{enabled:true,receiptEnabled:true,kitchenEnabled:false,receiptPrinter:printer,kitchenPrinter:{...printer,identifier:'remote-kitchen'},customerDisplay:{enabled:false}}}};
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import Pos from './app/store/pos/page';import{DeviceRelaySettings}from'./app/os/stores/devices/DeviceRelaySettings';import Relay from './app/store/device-relay/page';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
localStorage.setItem('foundr1-os-language',new URLSearchParams(location.search).get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');
createRoot(document.getElementById('root')).render(<OsTranslationProvider>{location.pathname==='/admin'?<DeviceRelaySettings storeId="fixture-store"/>:location.pathname==='/relay'?<Relay/>:<Pos/>}</OsTranslationProvider>);`;
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'/virtual',charset:'utf8',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'fixture-navigation',setup(b){
  b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='next/link'?`import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`:`export const usePathname=()=>location.pathname;export const useRouter=()=>({push:url=>location.assign(url)});`,loader:'js',resolveDir:process.cwd()}));
}}]});
const css=(await readFile('app/globals.css','utf8'))+'\n'+(await readFile('app/store/store-responsive.css','utf8'))+'\n'+(bundle.outputFiles.find(file=>file.path.endsWith('.css'))?.text||'');
const html=`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
let station={id:'station-a',name:'レジ A',enabled:true,print_enabled:true,scale_enabled:true,epoch:0,owner_until:null,device_online:true,device_paired:true,scale_session:null,scale_sequence:-1,scale_reading:null,scale_received_at:null,scale_tare_settings:structuredClone(settings),scale_tare_context:{},device_status:{scale:'connected',scaleTareVersion:1}};
let contextCounter=0,heldAdopt=null,holdNextAdopt=false;
let posts=[],checkoutPosts=[],scaleGrams=600,scaleStable=true,scaleOverload=false,autoReadEnabled=true;
const captures=new Map(),closedSessions=new Set();
const sample=()=>{if(station.scale_session&&autoReadEnabled&&station.device_status.scale==='connected'){
 const context=station.scale_tare_context;const tare=context.mode==='preset'?context.tareGrams:0;
 station={...station,scale_sequence:station.scale_sequence+1,scale_reading:{grams:Math.round((scaleGrams-tare)*1000)/1000,stable:scaleStable,overload:scaleOverload,...(context.mode==='preset'?{mode:'preset',grossGrams:scaleGrams,tareGrams:tare,tarePresetId:context.presetId,settingsRevision:context.settingsRevision}:{})},scale_received_at:new Date().toISOString()};
}};
const send=(res,body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://fixture');
 if(url.pathname==='/fixture.js'){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'});return res.end(bundle.outputFiles.find(file=>file.path.endsWith('.js')).text);}
 if(url.pathname.startsWith('/locales/os/'))return send(res,dictionaries[url.pathname.includes('Hant')?'zh-Hant':'zh-Hans']);
 if(url.pathname==='/api/auth/me')return send(res,{employee:{id:'fixture-employee',name:'Fixture',role:'owner'}});
 if(url.pathname==='/api/store/context')return send(res,{selectedStoreId:store.id,access:{role:'owner',stores:[store]}});
 if(url.pathname==='/api/store/pos/reconciliation')return send(res,{businessDate:'2026-10-16',activeSession:{id:'fixture-register',expectedCashAmount:10000},sessions:[],movements:[],activeCashResponsibleEmployees:[]});
 if(url.pathname.includes('device-relay')){
   if(req.method==='POST'){
     let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);posts.push(b);
     if(b.action==='claim'||b.action==='takeover'){station={...station,epoch:station.epoch+1,owner_until:new Date(Date.now()+45000).toISOString(),scale_session:null,scale_sequence:-1,scale_reading:null,scale_received_at:null};return send(res,{ok:true,owner:{stationId:station.id,epoch:station.epoch,token:'fixture-owner'}});}
     if(b.action==='save'){station={...station,enabled:b.enabled,print_enabled:b.printEnabled,scale_enabled:b.scaleEnabled,name:b.name};return send(res,{ok:true,stationId:station.id});}
     if(b.action==='scaleStart'){
       if(!b.scaleSession||closedSessions.has(b.scaleSession)||captures.has(b.scaleSession)
         ||(station.scale_session!==b.scaleSession&&station.scale_session!==(b.expectedScaleSession??null)))return send(res,{error:'計量セッションが変わりました。'},409);
       if(station.scale_tare_settings.enabled&&(!['small','large'].includes(b.tarePresetId)||station.device_status.scaleTareVersion!==1))return send(res,{error:'ボウルを選択してください。'},409);
       if(station.scale_session!==b.scaleSession){const preset=station.scale_tare_settings.presets.find(p=>p.id===b.tarePresetId);station={...station,scale_session:b.scaleSession,scale_sequence:-1,scale_reading:null,scale_received_at:null,scale_tare_context:station.scale_tare_settings.enabled?{mode:'preset',token:'00000000-0000-4000-8000-'+String(++contextCounter).padStart(12,'0'),presetId:preset.id,tareGrams:preset.grams,settingsRevision:station.scale_tare_settings.revision}:{}};}
       return send(res,{ok:true,scaleSession:b.scaleSession,scaleTareContext:station.scale_tare_context});
     }
     if(b.action==='scaleAdopt'){
       const previous=captures.get(b.scaleSession);
       if(previous){if(previous.scaleSequence!==b.scaleSequence)return send(res,{error:'計量データを確認してください。'},409);return send(res,previous);}
       if(station.scale_session!==b.scaleSession||station.scale_sequence!==b.scaleSequence||!station.scale_reading?.stable)return send(res,{error:'安定した最新の重量を確認してください。'},409);
       const reading=station.scale_reading;
       if(reading.grams<=0)return send(res,{error:'正味重量を確認してください。'},409);
       const weightMeasurement=reading.mode==='preset'?{mode:'preset',grossGrams:reading.grossGrams,tareGrams:reading.tareGrams,netGrams:reading.grams,tarePresetId:reading.tarePresetId,settingsRevision:reading.settingsRevision}:{mode:'device_net'};
       const captured={ok:true,scaleSession:b.scaleSession,scaleSequence:b.scaleSequence,capture:{id:`capture-${captures.size+1}`,grams:reading.grams,weightMeasurement}};
       captures.set(b.scaleSession,captured);station={...station,scale_session:null,scale_reading:null,scale_received_at:null,scale_tare_context:{}};
       if(holdNextAdopt){holdNextAdopt=false;await new Promise(resolve=>heldAdopt=()=>{heldAdopt=null;resolve();});}return send(res,captured);
     }
     if(b.action==='scaleEnd'){
       if(!b.scaleSession)return send(res,{error:'計量セッションを確認してください。'},400);
       closedSessions.add(b.scaleSession);const ended=station.scale_session===b.scaleSession;
       if(ended)station={...station,scale_session:null,scale_reading:null,scale_received_at:null,scale_tare_context:{}};return send(res,{ok:true,scaleSession:b.scaleSession,ended});
     }
     if(b.action==='heartbeat'){station.owner_until=new Date(Date.now()+45000).toISOString();return send(res,{ok:true});}
     return send(res,{ok:true});
   }
   sample();return send(res,{serverNow:new Date().toISOString(),serverElapsedMs:0,stations:[station],jobs:[{id:'job1',station_id:station.id,kind:'receipt',state:'uncertain',pickup_code:'001',sequence:1,error:''}],canManage:true});
 }
 if(url.pathname==='/api/store/pos'){
   if(req.method==='POST'){
     let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);checkoutPosts.push(body);
     const amount=body.items.reduce((sum,item)=>sum+item.measuredQuantity*item.quantity*4,0);
     return send(res,{ok:true,relayPrinting:true,orderId:`fixture-order-${checkoutPosts.length}`,pickupCode:'DTEST',amount,subtotalAmount:amount,discountAmount:0,couponDiscountAmount:0,taxAmount:Math.round(amount/11),cashChangeAmount:body.cashTenderedAmount-amount,todaySummary:{orderCount:checkoutPosts.length,total:amount,average:amount,latestOrders:[]}});
   }
   return send(res,posData);
 }
 if(url.pathname.startsWith('/api/'))return send(res,{});
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);
}catch(e){res.writeHead(500);res.end(e.stack);}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const errors=[],externalRequests=[],checks=[];
try{
 const page=await browser.newPage();page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))externalRequests.push(r.url());});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 async function click(text,target=page){const buttons=await target.$$('button');for(const b of buttons){if(await b.evaluate((e,text)=>e.textContent.trim()===text&&e.getClientRects().length>0,text)){await b.click();return;}}throw new Error(`Button missing: ${text}`);}
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function openItem(index=0){const items=await page.$$('.store-pos-item-button');await items[index].click();await page.waitForSelector('.store-pos-option-overlay');}
 async function waitWeight(value){try{await page.waitForFunction(value=>document.querySelector('.store-pos-weight-entry input')?.value===value,{timeout:12000},String(value));}catch(error){await writeFile(`${output}/failure.json`,JSON.stringify({expected:value,actual:await page.$eval('.store-pos-weight-entry input',e=>e.value).catch(()=>null),text:await page.$eval('.store-pos-option-overlay',e=>e.textContent).catch(()=>null),station,posts:posts.slice(-12)},null,2));await page.screenshot({path:`${output}/failure.png`,fullPage:true});throw error;}}
 async function setWeight(value){await page.$eval('.store-pos-weight-entry input',input=>{input.focus();input.select();});await page.keyboard.type(value);}
 async function refreshScale(){await page.evaluate(()=>window.dispatchEvent(new Event('focus')));}
 async function waitAdd(enabled){await page.waitForFunction(enabled=>document.querySelector('.store-pos-option-add')?.disabled===!enabled,{timeout:12000},enabled);}
 async function closeItem(){await page.click('.store-pos-option-head button');await page.waitForSelector('.store-pos-option-overlay',{hidden:true});await pause(150);}

 const actions=name=>posts.filter(p=>p.action===name);
 async function selectPlate(id){await page.$eval(`.store-relay-tare-presets button:nth-of-type(${id==='small'?1:2})`,e=>e.click());}
 async function screen(prefix){for(const[width,height]of[[390,844],[768,1024],[1024,768],[1440,900]]){await page.setViewport({width,height});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${prefix} overflow ${width}`);await page.screenshot({path:`${output}/${prefix}-${width}.png`,fullPage:true});}}
 await page.setViewport({width:1440,height:900});await page.goto(base+'/pos');await page.waitForFunction(()=>document.body.textContent.includes('この端末で会計する'));await click('この端末で会計を始める');
 await openItem();await pause(800);await waitAdd(false);assert.equal(actions('scaleStart').length,0);assert.equal(await page.$eval('.store-pos-weight-entry input',e=>e.value),'');await screen('choose-plate');
 checks.push('every bowl requires an explicit plate choice; opening does not reuse the prior plate or start ambiguous weighing');
 scaleGrams=50;await selectPlate('small');await pause(1000);await waitAdd(false);assert.equal(captures.size,0);scaleGrams=100;await refreshScale();await pause(700);await waitAdd(false);assert.equal(captures.size,0);
 checks.push('total weight below/equal plate tare never creates an accepted positive net weight');
 scaleGrams=600;await refreshScale();await waitWeight(500);await waitAdd(true);assert.match(await page.$eval('.store-pos-weight-entry',e=>e.textContent),/2,000/);assert.match(await page.$eval('.store-relay-tare-summary',e=>e.textContent),/600 g.*100 g.*500 g/);await screen('small-plate');
 const smallCapture=[...captures.values()].at(-1).capture;assert.equal(smallCapture.weightMeasurement.tarePresetId,'small');
 scaleGrams=0;await refreshScale();await pause(500);await waitAdd(true);scaleGrams=100;await refreshScale();await waitAdd(false);scaleGrams=0;await refreshScale();await pause(500);await waitAdd(false);scaleGrams=600;await refreshScale();await waitWeight(500);await waitAdd(true);
 checks.push('taking the confirmed bowl off preserves it, but an empty/underweight plate invalidates it and returning to zero cannot unlock it');
 await click('この内容で追加');await page.waitForSelector('.store-pos-option-overlay',{hidden:true});
 await openItem();await pause(700);await waitAdd(false);assert.equal(await page.$eval('.store-pos-weight-entry input',e=>e.value),'');await selectPlate('large');await waitWeight(400);await waitAdd(true);assert.match(await page.$eval('.store-pos-weight-entry',e=>e.textContent),/1,600/);const largeCapture=[...captures.values()].at(-1).capture;assert.equal(largeCapture.weightMeasurement.tareGrams,200);
 checks.push('same 600g gross yields small-plate 500g/2000 yen and large-plate 400g/1600 yen, with separate immutable captures');
 await selectPlate('small');await waitWeight(500);await waitAdd(true);const startsBefore=actions('scaleStart').length;
 station.scale_tare_settings={...station.scale_tare_settings,revision:'22222222-2222-4222-8222-222222222222',presets:[{id:'small',grams:120},{id:'large',grams:200}]};await refreshScale();await page.waitForFunction(()=>document.querySelector('.store-relay-tare-presets')?.textContent.includes('120'));await page.waitForFunction(()=>document.querySelector('.store-pos-option-add')?.disabled===true);await waitWeight(480);await waitAdd(true);assert.ok(actions('scaleStart').length>startsBefore);assert.equal([...captures.values()].at(-1).capture.weightMeasurement.tareGrams,120);
 checks.push('changing plate or server settings revision invalidates the old confirmation and recomputes under a fresh scoped session');
 await click('この内容で追加');await page.waitForSelector('.store-pos-option-overlay',{hidden:true});
 // An accepted but delayed old capture must not populate the newly selected plate.
 await openItem();holdNextAdopt=true;await selectPlate('small');for(let i=0;i<100&&!heldAdopt;i++)await pause(50);assert.ok(heldAdopt);await selectPlate('large');heldAdopt();await waitWeight(400);await waitAdd(true);assert.equal(await page.$eval('.store-relay-tare-presets button[aria-pressed=true]',e=>e.textContent.startsWith('大')),true);await closeItem();
 checks.push('a delayed adoption for the previous plate cannot populate the new plate');
 station.device_status.scaleTareVersion=0;await refreshScale();await openItem();const beforeOld=actions('scaleStart').length;await selectPlate('small');await pause(800);await waitAdd(false);assert.equal(actions('scaleStart').length,beforeOld);assert.match(await page.$eval('.store-relay-scale',e=>e.textContent),/Store App.*更新/);
 await click('手入力に切り替える');await setWeight('275');await waitWeight(275);await waitAdd(true);assert.match(await page.$eval('.store-relay-scale',e=>e.textContent),/正味重量を手入力/);await screen('manual-net');await click('この内容で追加');await page.waitForSelector('.store-pos-option-overlay',{hidden:true});
 checks.push('an older Android client is blocked from preset automatic weighing, while explicit already-tared manual net entry is preserved without a second deduction');
 station.device_status.scaleTareVersion=1;await refreshScale();
 assert.equal(await page.$$eval('.store-pos-cart-row',rows=>rows.length),3);await page.setViewport({width:1440,height:900});await page.type('.store-pos-cash-payment input','10000');await page.waitForFunction(()=>!document.querySelector('.store-pos-checkout')?.disabled);await click('会計を確定');await page.waitForFunction(()=>document.body.textContent.includes('会計を保存しました。'));
 assert.equal(checkoutPosts.length,1);const lines=checkoutPosts[0].items;
 assert.deepEqual(lines.map(l=>l.measuredQuantity),[500,480,275]);assert.equal(lines[0].scaleCaptureId,smallCapture.id);assert.equal(lines[0].weightMeasurement.tareGrams,100,'cart keeps the original tare snapshot after a configuration change');assert.equal(lines[1].weightMeasurement.tareGrams,120);assert.equal(lines[2].scaleCaptureId,undefined);assert.deepEqual(lines[2].weightMeasurement,{mode:'manual_net'});
 checks.push('actual checkout payload keeps net quantities, selected plate/snapshot and unchanged old cart snapshots; manual net has no invented tare/capture');
 for(const lang of ['zh-Hans','zh-Hant']){await page.goto(base+`/pos?lang=${lang}`);await page.waitForSelector('.store-pos-item-button');await openItem();await page.waitForFunction(()=>document.querySelector('.store-relay-tare-presets')?.textContent.includes('小盘')||document.querySelector('.store-relay-tare-presets')?.textContent.includes('小盤'));await selectPlate('large');await waitWeight(400);await waitAdd(true);await screen(lang);await closeItem();}
 checks.push('Japanese, Simplified and Traditional Chinese actual POS states fit 390/768/1024/1440 widths');
 assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);await writeFile(`${output}/verification.json`,JSON.stringify({passed:true,checks,checkoutItems:lines,errors,externalRequests},null,2));console.log(`PASS tare actual POS: ${checks.length} groups`);
}catch(error){console.error(error);throw error;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
