// Actual POS page/provider with independent 1 Hz native samples and isolated HTTP.
// No production, checkout, printer, Bluetooth or database access.
import { build, stop } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const output=resolve(process.env.SCALE_CLOCK_UI_OUTPUT||'outputs/scale-stability-followup-20261018/pos-clock-ui'); await mkdir(output,{recursive:true});
const dictionaries=Object.fromEntries(await Promise.all(['zh-Hans','zh-Hant'].map(async l=>[l,JSON.parse(await readFile(`public/locales/os/${l}.json`,'utf8'))])));
const settings={enabled:false,revision:'11111111-1111-4111-8111-111111111111',presets:[{id:'small',grams:100},{id:'large',grams:200}]};
const store={id:'fixture-store',name:'桜並木店',brandIds:['fixture-brand']},brand={id:'fixture-brand',name:'まぁ麻'};
const printer={deviceType:'escpos_network',connectionType:'lan',host:'192.168.0.33',port:9100,identifier:'192.168.0.33',paperWidth:'80mm',cutPaper:true,openCashDrawer:true};
const posData={selectedStoreId:store.id,access:{stores:[store]},brands:[brand],categories:[],optionGroups:[],todaySummary:{orderCount:0,total:0,average:0,latestOrders:[]},
  items:['自選マーラータン','別の計量商品'].map((name,index)=>({id:index?'fixture-menu-other':'fixture-menu',brandId:brand.id,brandName:brand.name,name,itemKind:'buildable_product',category:'マーラータン',priceOverride:null,basePrice:0,posPricingMode:'weight',posWeightUnit:'g',posWeightUnitPrice:4,isAvailable:true,variableSchema:{},imageUrl:''})),
  posSettings:{customerDisplayMediaSettings:{weighing:{enabled:false,showUnitPrice:true,showTare:true}},scaleTareSettings:settings,dineInEnabled:true,takeoutEnabled:true,priceTaxMode:'tax_included',printerSettings:{enabled:true,receiptEnabled:true,kitchenEnabled:false,receiptPrinter:printer,kitchenPrinter:{...printer,identifier:'remote-kitchen'},customerDisplay:{enabled:false}}}};
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import Pos from './app/store/pos/page';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
import{StoreThemeProvider}from'./app/store/components/StoreThemeProvider';
localStorage.removeItem('store-relay-owner:fixture-store');sessionStorage.removeItem('store-relay-owner:fixture-store');
localStorage.setItem('foundr1-os-language',new URLSearchParams(location.search).get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');
createRoot(document.getElementById('root')).render(<OsTranslationProvider><StoreThemeProvider employeeId="fixture-employee"><Pos/></StoreThemeProvider></OsTranslationProvider>);`;
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'/virtual',charset:'utf8',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'fixture-navigation',setup(b){
  if(Boolean(process.env.SCALE_CLOCK_BASELINE_DIR)){
    b.onLoad({filter:/app\/store\/components\/(useStoreRelay\.ts|StoreRelayScale\.tsx)$/},async args=>({contents:(await readFile(`${resolve(process.env.SCALE_CLOCK_BASELINE_DIR)}/${args.path.endsWith('useStoreRelay.ts')?'useStoreRelay-before.ts':'StoreRelayScale-before.tsx'}`,'utf8')).replace('return {stations,jobs,owner,station,error,action,required:', 'return {now:()=>Date.now(),stations,jobs,owner,station,error,action,required:'),loader:args.path.endsWith('.tsx')?'tsx':'ts',resolveDir:resolve('app/store/components')}));
    b.onLoad({filter:/app\/store\/pos\/page\.tsx$/},async args=>({contents:(await readFile(args.path,'utf8')).replaceAll('relay.now()','Date.now()'),loader:'tsx',resolveDir:resolve('app/store/pos')}));
  }
  b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'fixture'}));
  b.onResolve({filter:/shared-pusher-client$/},args=>({path:args.path,namespace:'fixture-pusher'}));
  b.onLoad({filter:/.*/,namespace:'fixture-pusher'},()=>({contents:`const handlers=new Map();window.__displayReconnect=()=>{for(const fn of handlers.get('pusher:subscription_succeeded')||[])fn()};window.__displayEvent=payload=>{for(const fn of handlers.get('pos.customer-display.updated')||[])fn(payload)};export function acquireSharedPusher(){return{connection:{bind(){}},subscribe(){return{bind(event,fn){if(!handlers.has(event))handlers.set(event,new Set());handlers.get(event).add(fn);if(event==='pusher:subscription_succeeded')queueMicrotask(fn)},unbind(event){handlers.delete(event)}}},unsubscribe(){},disconnect(){}}}`,loader:'js'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='next/link'?`import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`:`export const usePathname=()=>location.pathname;export const useRouter=()=>({push:url=>location.assign(url)});`,loader:'js',resolveDir:process.cwd()}));
}}]});
const css=(await readFile('app/globals.css','utf8'))+'\n'+(await readFile('app/store/store-responsive.css','utf8'))+'\n'+(bundle.outputFiles.find(file=>file.path.endsWith('.css'))?.text||'');
const html=`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const filterBundle=await build({entryPoints:['lib/pos-scale-filter.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {evaluatePosScaleFilter}=await import(`data:text/javascript;base64,${Buffer.from(filterBundle.outputFiles[0].text).toString('base64')}`);
const filter={enabled:true,revision:'648a7444-edac-4a87-b85d-29c56e0264a2',settleMs:2000,toleranceGrams:2};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let station,filterState,posts,gets,captures,replayed,scenario,checkoutWrites;
function reset(next){scenario=next;filterState={};posts=[];gets=[];captures=[];replayed=false;checkoutWrites=0;station={id:'station-a',name:'レジ A',enabled:true,print_enabled:true,scale_enabled:true,epoch:0,owner_until:null,device_online:true,device_paired:true,scale_session:null,scale_sequence:'-1',scale_reading:null,scale_received_at:null,scale_tare_settings:{},scale_tare_context:{},scale_filter_settings:next.filterEnabled===false?{...filter,enabled:false}:filter,device_status:{scale:'connected',scaleTareVersion:1}};}
reset({name:'initial',getDelay:0,postDelay:0});
const nativeTimer=setInterval(()=>{
 if(!station.scale_session)return;
 const measuredAt=Date.now()-1100;
 const result=evaluatePosScaleFilter({settings:station.scale_filter_settings,state:filterState,contextKey:station.scale_session,reading:{grams:204,stable:true,overload:false},measuredAt,newWindowId:randomUUID()});
 filterState=result.state;station={...station,scale_sequence:String(Number(station.scale_sequence)+1),scale_reading:result.reading,scale_received_at:new Date(measuredAt).toISOString()};
},1000);
const send=(res,body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://fixture');
 if(url.pathname==='/fixture.js'){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'});return res.end(bundle.outputFiles.find(file=>file.path.endsWith('.js')).text);}
 if(url.pathname.startsWith('/locales/os/'))return send(res,dictionaries[url.pathname.includes('Hant')?'zh-Hant':'zh-Hans']);
 if(url.pathname==='/api/auth/me')return send(res,{employee:{id:'fixture-employee',name:'Fixture',role:'owner'}});
 if(url.pathname==='/api/store/context')return send(res,{selectedStoreId:store.id,access:{role:'owner',stores:[store]}});
 if(url.pathname==='/api/store/pos/reconciliation')return send(res,{businessDate:'2026-10-18',activeSession:{id:'fixture-register',expectedCashAmount:10000},sessions:[],movements:[],activeCashResponsibleEmployees:[]});
 if(url.pathname==='/api/store/realtime-config')return send(res,{key:'local-fixture',cluster:'local-fixture',channels:['private-fixture']});
 if(url.pathname==='/api/store/pos/customer-display')return send(res,{state:{weighingRevision:0},customerDisplayMediaSettings:posData.posSettings.customerDisplayMediaSettings});
 if(url.pathname==='/api/store/pos'){if(req.method==='POST'){checkoutWrites++;return send(res,{error:'Checkout is forbidden in this fixture'},403);}return send(res,posData);}
 if(url.pathname.includes('device-relay')){
  if(req.method!=='POST'){
   let snapshot=structuredClone(station);
   const replay=scenario.staleAccepted&&captures.length&&!replayed&&snapshot.scale_reading?.stable;
   if(replay){snapshot.scale_received_at=new Date(Date.now()-11000).toISOString();replayed=true;}
   const entry={startedAt:Date.now(),session:snapshot.scale_session,sequence:snapshot.scale_sequence,accepted:snapshot.scale_reading?.stable,window:snapshot.scale_reading?.filter?.windowId,replay:Boolean(replay)};gets.push(entry);
   await pause(scenario.recovered?scenario.recoveryGetDelay:scenario.getDelay);entry.deliveredAt=Date.now();return send(res,{stations:[snapshot],jobs:[],canManage:true,serverNow:new Date().toISOString(),serverElapsedMs:Date.now()-entry.startedAt});
  }
  let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);posts.push({...b,at:Date.now()});
  if(b.action==='claim'||b.action==='takeover'){
   station={...station,epoch:station.epoch+1,owner_until:new Date(Date.now()+45000).toISOString(),scale_session:null,scale_sequence:'-1',scale_reading:null,scale_received_at:null};
   return send(res,{ok:true,owner:{stationId:station.id,epoch:station.epoch,token:'fixture-owner'}});
  }
  if(b.action==='heartbeat'||b.action==='resume'){
   if(!station.enabled||b.owner?.stationId!==station.id||b.owner?.epoch!==station.epoch||b.owner?.token!=='fixture-owner')return send(res,{error:'操作権が失効しました。'},409);
   const resumed=!(Date.parse(station.owner_until||'')>Date.now());
   if(resumed){filterState={};station={...station,scale_session:null,scale_tare_context:{},scale_filter_state:{},scale_sequence:'-1',scale_reading:null,scale_received_at:null};}
   station.owner_until=new Date(Date.now()+45000).toISOString();await pause(200);return send(res,{ok:true,resumed,ownerUntil:station.owner_until});
  }
  if(b.action==='scaleStart'){
   if(station.scale_session!==b.scaleSession&&station.scale_session!==(b.expectedScaleSession??null))return send(res,{error:'計量セッションが変わりました。'},409);
   if(station.scale_session!==b.scaleSession){filterState={};station={...station,scale_session:b.scaleSession,scale_sequence:'-1',scale_reading:null,scale_received_at:null};}
   await pause(scenario.postDelay);return send(res,{ok:true,scaleSession:b.scaleSession});
  }
  if(b.action==='scaleEnd'){if(station.scale_session===b.scaleSession){filterState={};station={...station,scale_session:null,scale_sequence:'-1',scale_reading:null,scale_received_at:null};}await pause(100);return send(res,{ok:true});}
  if(b.action==='scaleAdopt'){
   const r=station.scale_reading;
   const proof=r?.filter?.windowId?r.filter.windowId===b.scaleWindowId&&r.grams===b.scaleGrams&&Number(station.scale_sequence)>=b.scaleSequence:Number(station.scale_sequence)===b.scaleSequence;
   if(station.scale_session!==b.scaleSession||!r?.stable||!proof)return send(res,{error:'安定した重量が更新されました。'},409);
   const capture={id:randomUUID(),grams:r.grams,weightMeasurement:{mode:'device_net',...(r.filter?{filter:r.filter,hardwareStable:r.hardwareStable,rawGrams:r.filter.rawGrams}:{})}};
   const monitoring=Boolean(r.filter&&b.keepMonitoring);
   const result={ok:true,capture,scaleSession:b.scaleSession,scaleSequence:Number(station.scale_sequence),monitoring};captures.push({...result,at:Date.now()});
   if(!monitoring){filterState={};station={...station,scale_session:null,scale_sequence:'-1',scale_reading:null,scale_received_at:null};}
   await pause(scenario.postDelay);return send(res,result);
  }
  return send(res,{ok:true});
 }
 if(url.pathname.startsWith('/api/'))return send(res,{});
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);
}catch(e){res.writeHead(500);res.end(e.stack);}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const results=[];
try{
 for(const next of [
  {name:'browser-clock-ahead',getDelay:800,postDelay:1800,clockOffset:2500},
  {name:'browser-clock-behind',getDelay:800,postDelay:1800,clockOffset:-2500},
  {name:'hardware-off-delayed',getDelay:50,postDelay:300,clockOffset:2500,filterEnabled:false},
  {name:'delayed-real-parent',getDelay:1800,postDelay:1900,clockOffset:0,recoverAfterMs:9000,recoveryGetDelay:300},
  {name:'stale-accepted-snapshot',getDelay:300,postDelay:1800,clockOffset:0,staleAccepted:true}
 ].filter(item=>!process.env.SCALE_CLOCK_CASE||item.name===process.env.SCALE_CLOCK_CASE)){
  reset(next);const page=await browser.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR '+e.message);});
  page.on('console',message=>{if(message.type()==='error')console.log('CONSOLEERROR '+message.text());});
  await page.setRequestInterception(true);page.on('request',request=>request.url().startsWith(base+'/')?request.continue():request.abort());
  await page.evaluateOnNewDocument(offset=>{const original=Date.now;Date.now=()=>original()+offset;},next.clockOffset);
  await page.setViewport({width:768,height:1024});await page.goto(base+'/pos');await page.waitForSelector('.store-pos-item-button');
  const relayPanel='section[aria-label="会計端末"]';
  await page.waitForSelector(`${relayPanel} button[aria-expanded="false"]`);
  await page.click(`${relayPanel} button[aria-expanded="false"]`);
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='この端末で会計を始める'));
  const startHandle=await page.evaluateHandle(()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='この端末で会計を始める'));
  await startHandle.asElement().click();await startHandle.dispose();
  await page.waitForSelector(`${relayPanel} button[aria-expanded="false"]`);
  const compactPanel=await page.$eval(relayPanel,element=>({height:element.getBoundingClientRect().height,expanded:element.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')}));
  assert.ok(compactPanel.height<=90,`Cashier setup displaced POS: ${compactPanel.height}px`);
  await page.screenshot({path:`${output}/${next.name}-compact-pos.png`,fullPage:true});
  await pause(next.getDelay+500);await page.click('.store-pos-item-button');await page.waitForSelector('.store-pos-option-overlay');
  if(next.recoverAfterMs)setTimeout(()=>{scenario.recovered=true;},next.recoverAfterMs);
  await page.evaluate(()=>{window.__parentTimeline=[];window.__parentTimer=setInterval(()=>{const button=document.querySelector('.store-pos-option-add'),scale=document.querySelector('.store-relay-scale');window.__parentTimeline.push({at:Date.now(),disabled:button?.disabled,weight:document.querySelector('.store-pos-weight-entry input')?.value,price:document.querySelector('.store-pos-weight-entry >div:last-child strong')?.textContent,text:scale?.innerText});},100);});
  await pause(Number(process.env.SCALE_CLOCK_DURATION_MS)||18000);const timeline=await page.evaluate(()=>{clearInterval(window.__parentTimer);return window.__parentTimeline;});
  await page.screenshot({path:`${output}/${next.name}.png`,fullPage:true});
  const result={scenario:next,posts,gets,captures,errors,timeline,checkoutWrites,compactPanel,starts:posts.filter(p=>p.action==='scaleStart').length,enabledSamples:timeline.filter(p=>p.disabled===false).length};results.push(result);
  await writeFile(`${output}/${next.name}-details.json`,JSON.stringify(result,null,2)+'\n');
  assert.deepEqual(errors,[]);
  if(!process.env.SCALE_CLOCK_BASELINE_DIR){
   assert.equal(captures.length,1,`${next.name}: immutable capture was repeated`);assert.equal(result.starts,next.filterEnabled===false?2:1,`${next.name}: monitoring session rotated`);
   const tail=timeline.slice(-30);assert.equal(tail.length,30);assert.ok(tail.every(sample=>sample.disabled===false),`${next.name}: addition did not stay enabled after recovery`);
   assert.ok(tail.every(sample=>sample.weight==='204'&&sample.price==='¥816'),`${next.name}:204g at4yen/g was not816yen`);
   assert.equal(checkoutWrites,0);
   if(next.name==='browser-clock-ahead'){
    await page.click('.store-pos-option-add');await page.waitForSelector('.store-pos-option-overlay',{hidden:true});
    await page.waitForSelector('.store-pos-cart-list .store-pos-cart-row');
    const cart=await page.$eval('.store-pos-cart-list .store-pos-cart-row',element=>element.textContent);
    assert.match(cart,/204\s*g/);assert.match(cart,/¥816/);assert.equal(await page.$$eval('.store-pos-cart-list .store-pos-cart-row',elements=>elements.length),1);
    result.cartAfterAddition={rows:1,text:cart};assert.equal(checkoutWrites,0);
   }
  }
  await writeFile(`${output}/${next.name}-${Boolean(process.env.SCALE_CLOCK_BASELINE_DIR)?'before':'after'}.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({scenario:next.name,starts:result.starts,captures:captures.length,enabledSamples:result.enabledSamples,errors}));await page.close();await pause(300);
 }
 await writeFile(`${output}/results.json`,JSON.stringify(results.map(({scenario,starts,captures,enabledSamples,errors})=>({scenario,starts,captures:captures.length,enabledSamples,errors})),null,2)+'\n');
}catch(error){const page=(await browser.pages()).at(-1);await writeFile(`${output}/driver-failure.json`,JSON.stringify({message:error.message,text:await page.evaluate(()=>document.body.innerText).catch(()=>null),posts,gets,station},null,2));if(page)await page.screenshot({path:`${output}/driver-failure.png`,fullPage:true});throw error;
}finally{stop();clearInterval(nativeTimer);await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
