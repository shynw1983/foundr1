// Actual React pages with synthetic HTTP/native printing. No live API or database access.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const output=resolve('outputs/store-pos-reliability-20261017/full-pos'); await mkdir(output,{recursive:true});
const dictionaries=Object.fromEntries(await Promise.all(['zh-Hans','zh-Hant'].map(async l=>[l,JSON.parse(await readFile(`public/locales/os/${l}.json`,'utf8'))])));
const store={id:'fixture-store',name:'桜並木店',brandIds:['fixture-brand']},brand={id:'fixture-brand',name:'まぁ麻'};
const printer={deviceType:'escpos_network',connectionType:'lan',host:'192.168.0.33',port:9100,identifier:'192.168.0.33',paperWidth:'80mm',cutPaper:true,openCashDrawer:true};
const posData={selectedStoreId:store.id,access:{stores:[store]},brands:[brand],categories:[],optionGroups:[],todaySummary:{orderCount:0,total:0,average:0,latestOrders:[]},
  items:['自選マーラータン','別の計量商品'].map((name,index)=>({id:index?'fixture-menu-other':'fixture-menu',brandId:brand.id,brandName:brand.name,name,itemKind:'buildable_product',category:'マーラータン',priceOverride:null,basePrice:0,posPricingMode:'weight',posWeightUnit:'g',posWeightUnitPrice:4,isAvailable:true,variableSchema:{},imageUrl:''})),
  posSettings:{dineInEnabled:true,takeoutEnabled:true,priceTaxMode:'tax_included',printerSettings:{enabled:true,receiptEnabled:true,kitchenEnabled:false,receiptPrinter:printer,kitchenPrinter:{...printer,identifier:'remote-kitchen'},customerDisplay:{enabled:false}}}};
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import Pos from './app/store/pos/page';import{DeviceRelaySettings}from'./app/os/stores/devices/DeviceRelaySettings';import Relay from './app/store/device-relay/page';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
localStorage.setItem('foundr1-os-language',new URLSearchParams(location.search).get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');
createRoot(document.getElementById('root')).render(<OsTranslationProvider>{location.pathname==='/admin'?<DeviceRelaySettings storeId="fixture-store"/>:location.pathname==='/relay'?<Relay/>:<Pos/>}</OsTranslationProvider>);`;
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'/virtual',charset:'utf8',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'fixture-navigation',setup(b){
  b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='next/link'?`import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`:`export const usePathname=()=>location.pathname;export const useRouter=()=>({push:url=>location.assign(url)});`,loader:'js',resolveDir:process.cwd()}));
}}]});
const css=(await readFile('app/globals.css','utf8'))+'\n'+(await readFile('app/store/store-responsive.css','utf8'))+'\n'+(bundle.outputFiles.find(file=>file.path.endsWith('.css'))?.text||'');
const html=`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
let station={id:'station-a',name:'レジ A',enabled:true,print_enabled:true,scale_enabled:true,epoch:0,owner_until:null,device_online:true,device_paired:true,scale_session:null,scale_sequence:-1,scale_reading:null,scale_received_at:null,device_status:{scale:'connected'}};
let posts=[],checkoutPosts=[],scaleGrams=300,scaleStable=true,scaleOverload=false,autoReadEnabled=true;
const captures=new Map(),closedSessions=new Set();
const sample=()=>{if(station.scale_session&&autoReadEnabled&&station.device_status.scale==='connected')station={...station,scale_sequence:station.scale_sequence+1,scale_reading:{grams:scaleGrams,stable:scaleStable,overload:scaleOverload},scale_received_at:new Date().toISOString()};};
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
       if(station.scale_session!==b.scaleSession)station={...station,scale_session:b.scaleSession,scale_sequence:-1,scale_reading:null,scale_received_at:null};
       return send(res,{ok:true,scaleSession:b.scaleSession});
     }
     if(b.action==='scaleAdopt'){
       const previous=captures.get(b.scaleSession);
       if(previous){if(previous.scaleSequence!==b.scaleSequence)return send(res,{error:'計量データを確認してください。'},409);return send(res,previous);}
       if(station.scale_session!==b.scaleSession||station.scale_sequence!==b.scaleSequence||!station.scale_reading?.stable)return send(res,{error:'安定した最新の重量を確認してください。'},409);
       const captured={ok:true,scaleSession:b.scaleSession,scaleSequence:b.scaleSequence,capture:{id:`capture-${captures.size+1}`,grams:station.scale_reading.grams}};
       captures.set(b.scaleSession,captured);station={...station,scale_session:null,scale_reading:null,scale_received_at:null};return send(res,captured);
     }
     if(b.action==='scaleEnd'){
       if(!b.scaleSession)return send(res,{error:'計量セッションを確認してください。'},400);
       closedSessions.add(b.scaleSession);const ended=station.scale_session===b.scaleSession;
       if(ended)station={...station,scale_session:null,scale_reading:null,scale_received_at:null};return send(res,{ok:true,scaleSession:b.scaleSession,ended});
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
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const errors=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 async function click(text,target=page){const buttons=await target.$$('button');for(const b of buttons){if(await b.evaluate((e,text)=>e.textContent.trim()===text&&e.getClientRects().length>0,text)){await b.click();return;}}throw new Error(`Button missing: ${text}`);}
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function openItem(index=0){const items=await page.$$('.store-pos-item-button');await items[index].click();await page.waitForSelector('.store-pos-option-overlay');}
 async function waitWeight(value){try{await page.waitForFunction(value=>document.querySelector('.store-pos-weight-entry input')?.value===value,{timeout:12000},String(value));}catch(error){await writeFile(`${output}/failure.json`,JSON.stringify({expected:value,actual:await page.$eval('.store-pos-weight-entry input',e=>e.value).catch(()=>null),text:await page.$eval('.store-pos-option-overlay',e=>e.textContent).catch(()=>null),station,posts:posts.slice(-12)},null,2));await page.screenshot({path:`${output}/failure.png`,fullPage:true});throw error;}}
 async function setWeight(value){await page.$eval('.store-pos-weight-entry input',input=>{input.focus();input.select();});await page.keyboard.type(value);}
 async function refreshScale(){await page.evaluate(()=>window.dispatchEvent(new Event('focus')));}
 async function waitAdd(enabled){await page.waitForFunction(enabled=>document.querySelector('.store-pos-option-add')?.disabled===!enabled,{timeout:12000},enabled);}
 async function closeItem(){await page.click('.store-pos-option-head button');await page.waitForSelector('.store-pos-option-overlay',{hidden:true});await pause(150);}
 if(process.env.POS_SCALE_DISABLED_VISUAL_ONLY==='1'){
   await page.setViewport({width:390,height:844});await page.goto(base+'/pos');await page.waitForFunction(()=>document.body.textContent.includes('この端末で会計する'));
   await click('この端末で会計を始める');await openItem();await waitWeight(300);await waitAdd(true);
   const styles=[];
   for(const disabled of [true,false]){
     scaleStable=!disabled;scaleGrams=disabled?360:300;await refreshScale();await waitAdd(!disabled);
     for(const [width,height] of [[390,844],[768,1024]]){
       await page.setViewport({width,height});await page.mouse.move(0,0);
       const before=await page.$eval('.store-pos-option-add',button=>{const style=getComputedStyle(button);return{disabled:button.disabled,opacity:style.opacity,cursor:style.cursor,boxShadow:style.boxShadow,transform:style.transform,background:style.backgroundColor};});
       assert.equal(before.disabled,disabled);assert.equal(Number(before.opacity),disabled ? 0.5 : 1);
       if(disabled){assert.equal(before.cursor,'not-allowed');assert.equal(before.boxShadow,'none');assert.equal(before.transform,'none');await page.hover('.store-pos-option-add');assert.equal(await page.$eval('.store-pos-option-add',button=>getComputedStyle(button).backgroundColor),before.background);await page.mouse.move(0,0);}
       assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
       await page.screenshot({path:`${output}/scale-add-${disabled?'disabled':'enabled'}-${width}.png`,fullPage:true});styles.push({width,...before});
     }
   }
   assert.deepEqual(errors,[]);await writeFile(`${output}/disabled-visual-verification.json`,JSON.stringify({passed:true,styles,errors},null,2));console.log('PASS Add button visual states: disabled opacity/cursor and no hover effect; enabled green restores; actual POS at 390/768px.');
 }else{
 for(const [width,height] of [[390,844],[768,1024],[1024,768],[1440,900]]){
   await page.setViewport({width,height});await page.goto(base+'/admin');await page.waitForFunction(()=>document.body.textContent.includes('スマホで印刷・計量')&&Array.from(document.querySelectorAll('input[type=checkbox]')).some(input=>!input.disabled));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`admin overflow ${width}`);
   await page.screenshot({path:`${output}/admin-${width}.png`,fullPage:true});
 }
 // Separate print/scale switches are independently persisted.
 await page.$$eval('input[type=checkbox]',inputs=>{inputs[2].click();});await click('設定を保存');await page.waitForFunction(()=>document.body.textContent.includes('設定を保存しました。'));
 assert.equal(posts.at(-1).printEnabled,true);assert.equal(posts.at(-1).scaleEnabled,false);
 station.scale_enabled=true;
 for(const [width,height] of [[390,844],[768,1024],[1024,768],[1440,900]]){
   await page.setViewport({width,height});await page.goto(base+'/pos');await page.waitForFunction(()=>document.body.textContent.includes('この端末で会計する'));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`POS overflow ${width}`);
   await page.screenshot({path:`${output}/pos-${width}.png`,fullPage:true});
 }
 await click('この端末で会計を始める');await page.waitForFunction(()=>document.body.textContent.includes('この端末で会計中'));
 assert.equal(posts.at(-1).action,'claim');
 assert.equal(await page.evaluate(()=>localStorage.getItem('store-relay-capabilities:v1:fixture-store')),'true');
 const summaries=await page.$$('summary');let details;for(const candidate of summaries){if(await candidate.evaluate(e=>e.textContent.trim()==='中継印刷状況'))details=candidate;}assert.ok(details);await details.click();
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('details')).some(d=>d.open&&d.querySelector('summary')?.textContent==='中継印刷状況'));
 await page.waitForFunction(()=>document.body.textContent.includes('結果確認が必要'));
 await page.screenshot({path:`${output}/print-status.png`,fullPage:true});
 await click('再印刷');await new Promise(r=>setTimeout(r,800));assert.ok(posts.some(p=>p.action==='reprint'&&p.owner?.token==='fixture-owner'),JSON.stringify({posts,errors,buttons:await page.$$eval('button',bs=>bs.filter(b=>b.textContent==='再印刷').map(b=>({disabled:b.disabled,html:b.outerHTML,rect:b.getBoundingClientRect().toJSON()})))}));
 // Full POS flow: opening a weighted product starts reading and fills the existing price calculation.
 for(const [index,[width,height]] of [[390,844],[768,1024],[1024,768],[1440,900]].entries()){
   await page.setViewport({width,height});await openItem();await waitWeight(300);
   assert.match(await page.$eval('.store-pos-weight-entry',e=>e.textContent),/1,200/);
   assert.equal(await page.$$eval('.store-pos-option-overlay button',buttons=>buttons.some(b=>['計量を開始','重量を採用'].includes(b.textContent.trim()))),false,'No start/adopt click is needed.');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`automatic scale modal overflow ${width}`);
   await page.screenshot({path:`${output}/scale-auto-${width}.png`,fullPage:true});
   if(index<3)await closeItem();
 }
 const firstCartCapture=[...captures.values()].at(-1).capture.id;
 const capturedBeforeRepeat=captures.size;await pause(1700);
 assert.equal(captures.size,capturedBeforeRepeat,'The same stable weight does not create repeated captures while its modal remains open.');
 await waitAdd(true);
 scaleGrams=360;scaleStable=false;await refreshScale();await waitAdd(false);await waitWeight(300);
 await page.screenshot({path:`${output}/scale-changed-blocked.png`,fullPage:true});
 await page.$eval('.store-pos-option-add',button=>button.click());assert.equal(await page.$$eval('.store-pos-cart-row',rows=>rows.length),0);
 scaleGrams=0;scaleStable=true;await refreshScale();await pause(700);await waitAdd(false);
 scaleGrams=300;await refreshScale();await waitAdd(true);assert.equal(captures.size,capturedBeforeRepeat);
 for(const grams of [0,-25]){scaleGrams=grams;await refreshScale();await pause(500);await waitAdd(true);await waitWeight(300);}
 station.device_online=false;await refreshScale();await waitAdd(false);
 station.device_online=true;scaleGrams=0;await refreshScale();await pause(700);await waitAdd(false);
 scaleGrams=300;await refreshScale();await waitAdd(true);assert.equal(captures.size,capturedBeforeRepeat);
 await click('この内容で追加');await page.waitForSelector('.store-pos-option-overlay',{hidden:true});
 // A different weighted product cannot inherit the previous item's capture.
 autoReadEnabled=false;await openItem(1);await setWeight('250');await waitWeight(250);
 assert.match(await page.$eval('.store-relay-scale',e=>e.textContent),/自動読取を一時停止/);
 await click('この内容で追加');await page.waitForSelector('.store-pos-option-overlay',{hidden:true});
 // An explicit manual edit clears its automatic capture and remains authoritative when scale readings change.
 autoReadEnabled=true;scaleGrams=300;await openItem();await waitWeight(300);
 const editedCapture=[...captures.values()].at(-1).capture.id;assert.notEqual(editedCapture,firstCartCapture);
 await setWeight('２７５');await waitWeight(275);
 scaleGrams=340;const capturesAtManual=captures.size;await pause(1600);
 assert.equal(await page.$eval('.store-pos-weight-entry input',e=>e.value),'275');
 assert.equal(captures.size,capturesAtManual,'Manual mode prevents a later stable reading from replacing the entered weight.');
 assert.match(await page.$eval('.store-pos-weight-entry',e=>e.textContent),/1,100/);
 await page.screenshot({path:`${output}/scale-manual.png`,fullPage:true});
 await click('この内容で追加');await page.waitForSelector('.store-pos-option-overlay',{hidden:true});
 assert.equal(await page.$$eval('.store-pos-cart-row',rows=>rows.length),3);
 await page.type('.store-pos-cash-payment input','5000');await click('会計を確定');
 await page.waitForFunction(()=>document.body.textContent.includes('会計を保存しました。'));
 assert.equal(checkoutPosts.length,1);
 assert.deepEqual(checkoutPosts[0].items.map(item=>({id:item.menuCatalogItemId,grams:item.measuredQuantity,capture:item.scaleCaptureId})),[
   {id:'fixture-menu',grams:300,capture:firstCartCapture},
   {id:'fixture-menu-other',grams:250,capture:undefined},
   {id:'fixture-menu',grams:275,capture:undefined}
 ],'The real checkout payload preserves only the unedited capture for its original item.');
 assert.ok(posts.some(p=>p.action==='scaleAdopt'&&Number.isSafeInteger(p.scaleSequence)&&/^[0-9a-f-]{36}$/.test(p.scaleSession)));
 await page.screenshot({path:`${output}/checkout-saved.png`,fullPage:true});
 const peer=await browser.newPage();peer.on('dialog',d=>d.accept());await peer.goto(base+'/pos');await peer.waitForFunction(()=>document.body.textContent.includes('この端末に会計を引き継ぐ'));
 await click('この端末に会計を引き継ぐ',peer);await peer.waitForFunction(()=>document.body.textContent.includes('この端末で会計中'));
 assert.ok(posts.some(p=>p.action==='takeover'));await page.bringToFront();await page.waitForFunction(()=>!document.body.textContent.includes('この端末で会計中'),{timeout:10000});await peer.close();
 await page.goto(base+'/relay');await page.waitForFunction(()=>document.body.textContent.includes('Android Store App で開いてください'));
 assert.equal(await page.$$eval('button',buttons=>buttons.some(button=>button.textContent.includes('このスマホで中継を開始')&&!button.disabled)),false);
 // Chinese UI translations through the actual provider.
 await page.goto(base+'/admin?lang=zh-Hans');await page.waitForFunction(()=>document.body.textContent.includes('用安卓手机打印与称重'));
 await page.screenshot({path:`${output}/admin-zh-Hans.png`,fullPage:true});
 assert.deepEqual(errors,[]);
 await writeFile(`${output}/verification.json`,JSON.stringify({checkedAt:new Date().toISOString(),viewports:[390,768,1024,1440],automaticWeightGrams:300,automaticPriceYen:1200,changedPositiveUsBlocksAddition:true,removedConfirmedBowlRemainsUsable:true,zeroAfterUsOrDisconnectCannotUnlock:true,manualWeightGrams:275,manualPriceYen:1100,captures:captures.size,checkoutItems:checkoutPosts[0].items,errors},null,2));
 console.log('PASS full POS relay UI: automatic stable 300g / 1200 yen with no start/adopt; positive US/disconnection block old-weight addition; zero cannot unlock an invalidated weight; normal bowl removal preserves confirmation; repeated-weight deduplication; manual edit holds and clears capture; cross-item capture isolation in actual checkout payload; claim/takeover/reprint/browser-required; mobile/iPad portrait/landscape/desktop no overflow; Chinese translation.');
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
