// Actual OS POS settings and customer-display React components with isolated fixtures.
// Network access is restricted to the local fixture; no production or hardware writes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((all, value, index, values) => {
  if (value.startsWith('--')) all.push([value.slice(2), values[index + 1]]);
  return all;
}, []));
const source = resolve(args.source || process.cwd());
const output = resolve(args.output || 'outputs/pos-display-density-ui');
await mkdir(output, { recursive: true });
const require = createRequire(join(source, 'package.json'));
const { build, stop } = require('esbuild');
const puppeteer = require('puppeteer-core');
let sourceFiles = [
  'app/os/pos/page.tsx', 'app/os/pos/PosDisplayStandbyEditor.tsx',
  'components/pos/PosDisplayStandbyCanvas.tsx', 'components/pos/PosDisplayStandbyCanvas.module.css',
  'app/os/pos/PosDisplayStandbyEditor.module.css', 'app/store/pos/customer-display/CustomerDisplayStandby.module.css',
  'app/store/pos/customer-display/CustomerDisplayWorkspace.tsx', 'lib/pos-display-standby.ts', 'lib/pos-display-standby-i18n.ts', 'app/os/components/OsTranslationProvider.tsx', 'public/locales/os/zh-Hans.json', 'public/locales/os/zh-Hant.json', 'public/locales/os/zh.json', 'app/globals.css', 'scripts/tests/pos-display-traverse-ui.mjs', 'scripts/tests/pos-display-widgets-ui.mjs', 'scripts/tests/pos-display-density-ui.mjs'
];
const chineseDictionary = JSON.parse(await readFile(join(source,'public/locales/os/zh-Hans.json'),'utf8'));
const hashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash('sha256').update(await readFile(join(source, path))).digest('hex')])));
let beforeHashes = await hashes();
const storeA = '11111111-1111-4111-8111-111111111111';
const storeB = '22222222-2222-4222-8222-222222222222';
const debugSession = '33333333-3333-4333-8333-333333333333';
const viewports = [{ width: 896, height: 414 }, { width: 808, height: 320 }, { width: 414, height: 896 }, { width: 1024, height: 768 }, { width: 1366, height: 900 }];
const entry = `
import React from 'react';import{createRoot}from'react-dom/client';
import PosPage from'./app/os/pos/page';
import Display from'./app/store/pos/customer-display/CustomerDisplayWorkspace';
import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
import{defaultPosPrinterSettings}from'./lib/pos-printer';
import{defaultPosDisplayStandbySettings}from'./lib/pos-display-standby';
const storeA=${JSON.stringify(storeA)},storeB=${JSON.stringify(storeB)};
const stores=[{id:storeA,name:'検証店舗 A'},{id:storeB,name:'検証店舗 B'}];
const query=new URLSearchParams(location.search);
const media=()=>({mode:'default',transition:'fade',slideDurationSeconds:8,videoMuted:true,videoLoop:true,backgroundColor:'#fbfbf8',assets:[],standby:defaultPosDisplayStandbySettings()});
const settings=id=>({storeId:id,storeName:stores.find(s=>s.id===id).name,dineInEnabled:true,takeoutEnabled:true,dineInTaxRate:10,takeoutTaxRate:8,externalPaymentTerminalBrand:'PayCAS',priceTaxMode:'tax_included',discountPresets:[],customerDisplayMediaSettings:media(),printerSettings:structuredClone(defaultPosPrinterSettings),posBrandSettings:[],scaleTareSettings:{enabled:false,revision:'',presets:[{id:'small',grams:null},{id:'large',grams:null}]},scaleFilterSettings:{enabled:false,revision:'',toleranceGrams:2,settleMs:2000},fulfillmentWorkspace:{mode:'simple',autoStartPreparing:true,showReadyAction:false,readyAutoHideSeconds:300}});
window.__settings=JSON.parse(localStorage.getItem('traverse-fixture-settings')||'null')||{[storeA]:settings(storeA),[storeB]:settings(storeB)};
if(query.get('legacy')==='1')for(const store of Object.values(window.__settings))for(const blocks of Object.values(store.customerDisplayMediaSettings.standby.layouts))for(const block of blocks)delete block.fontFamily;
const legacyStoreBText=window.__settings[storeB].customerDisplayMediaSettings.standby.layouts.portrait.find(b=>b.type==='text');if(legacyStoreBText)legacyStoreBText.text='B の待機画面';
window.__settings[storeB].customerDisplayMediaSettings.standby.backgroundColor='#f3f3ed';
window.__writes=[];window.__requests=[];window.__denied=[];window.__native=[];window.__subscriptions=[];window.__uploads=[];
window.__holdSave=false;window.__saveFailure=false;window.__holdUpload=false;window.__canManage=query.get('readonly')!=='1';
window.Foundr1Android=new Proxy({}, {get:(_,name)=>(...args)=>{window.__native.push({name,args});throw new Error('Native use is forbidden by this fixture')}});
window.__displaySettings=structuredClone(window.__settings[storeA].customerDisplayMediaSettings);
window.__weatherMode=query.get('weather')||'ready';window.__weatherHolds=new Map();window.__weatherRequests=[];window.__weatherRelease=(id)=>window.__weatherHolds.get(id)?.();
window.__displaySettings.standby.enabled=query.get('disabled')!=='1';

const originalFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input.url,location.origin);if(!url.pathname.startsWith('/api/'))return originalFetch(input,init);
 const method=init?.method||'GET';window.__requests.push({path:url.pathname,query:url.search,method});
 const id=url.searchParams.get('storeId')||storeA;
 if(url.pathname==='/api/store/pos/customer-display/weather'){
  window.__weatherRequests.push({id,started:performance.now()});const mode=window.__weatherMode;
  if(mode==='hold')await new Promise(resolve=>window.__weatherHolds.set(id,resolve));
  const now=new Date().toISOString(),date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());
  const status=mode==='missing'?'not_configured':mode==='unavailable'?'unavailable':'ready';
  if(mode==='forbidden')return Response.json({error:'fixture forbidden'},{status:403});
  if(mode==='error')return Response.json({error:'fixture weather unavailable'},{status:503});
  return Response.json({storeId:id,date,fetchedAt:now,status,data:status==='ready'?{kind:'daily_forecast',date,condition:id===storeA?'晴れ':'くもり',weatherCode:id===storeA?0:3,highC:id===storeA?25:21,lowC:18,sourceName:'気象庁',sourceUrl:'https://www.jma.go.jp/bosai/forecast/',updatedAt:now,fetchedAt:now}:null});
 }
 if(url.pathname==='/api/store/pos')return Response.json({selectedStoreId:id,access:{stores},posSettings:window.__settings[id],todaySummary:{orderCount:0,total:0,average:0,latestOrders:[]}});
 if(url.pathname==='/api/store/pos/reconciliation')return Response.json({businessDate:'2026-10-21',sessions:[],totals:{}});
 if(url.pathname==='/api/os/pos/customer-display-media'){
  window.__uploads.push({type:init.body.get('type'),name:init.body.get('name')});
  if(window.__holdUpload)await new Promise((resolve,reject)=>{window.__releaseUpload=resolve;init.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
  return Response.json({url:'/fixture-logo.png',type:'image',name:'fixture-logo.png'});
 }
 if(url.pathname==='/api/os/pos/settings'){
  if(method==='POST'){
   const body=JSON.parse(init.body);window.__writes.push(structuredClone(body));
   const failure=window.__saveFailure;if(window.__holdSave)await new Promise(resolve=>window.__releaseSave=resolve);
   if(failure)return Response.json({error:'保存に失敗しました。もう一度お試しください。'},{status:409});
   const current=window.__settings[body.storeId];let next=structuredClone(current);
   if(body.section==='customerDisplayStandby'){next.customerDisplayMediaSettings.standby=structuredClone(body.customerDisplayStandby);}
   else if(!body.section||body.section==='all'){next={...next,...body};delete next.section;delete next.customerDisplayStandby;if(body.customerDisplayStandby)next.customerDisplayMediaSettings.standby=structuredClone(body.customerDisplayStandby);}
   else if(body.section==='filter')next.scaleFilterSettings=structuredClone(body.scaleFilterSettings);
   else if(body.section==='tare')next.scaleTareSettings=structuredClone(body.scaleTareSettings);
   else if(body.section==='discount')next.discountPresets=structuredClone(body.discountPresets);
   else if(body.section==='receipt')next.printerSettings=structuredClone(body.printerSettings);
   window.__settings[body.storeId]=next;localStorage.setItem('traverse-fixture-settings',JSON.stringify(window.__settings));return Response.json({ok:true,settings:next});
  }
  return Response.json({access:{canManagePosSettings:window.__canManage},settings:window.__settings[id]});
 }
 if(url.pathname==='/api/store/pos/customer-display')return Response.json({selectedStoreId:id,access:{stores},state:{status:'idle',items:[]},customerDisplayMediaSettings:id===storeA?window.__displaySettings:window.__settings[id].customerDisplayMediaSettings,...(url.searchParams.get('debug')==='1'?{debugMode:true}:{})});
 if(url.pathname==='/api/store/realtime-config')return Response.json({key:'fixture',cluster:'fixture',channels:['private-store-'+id]});
 if(url.pathname==='/api/store/pos/customer-display/member-scan')return Response.json({scanCommand:null});
 if(url.pathname==='/api/store/pos/debug-display'){window.__writes.push({path:url.pathname,...JSON.parse(init.body)});return Response.json({ok:true});}
 window.__denied.push({path:url.pathname,method});return Response.json({error:'fixture denied'},{status:403});
};
createRoot(document.getElementById('root')).render(<OsTranslationProvider>{location.pathname==='/os/pos'?<PosPage/>:<Display debugMode={location.pathname.endsWith('/debug')}/>}</OsTranslationProvider>);
`;
const pusher = `export function acquireSharedPusher(){const channels=[];window.__emit=(event,payload)=>{for(const channel of channels)for(const fn of channel.listeners.get(event)||[])fn(payload)};return{connection:{bind(){},unbind(){}},subscribe(name){window.__subscriptions.push(name);const listeners=new Map();const channel={name,listeners,bind(event,fn){listeners.set(event,[...(listeners.get(event)||[]),fn]);if(event==='pusher:subscription_succeeded')queueMicrotask(fn)},unbind(event,fn){listeners.set(event,(listeners.get(event)||[]).filter(item=>item!==fn))}};channels.push(channel);return channel},unsubscribe(){},disconnect(){channels.length=0}}}`;
const bundle = await build({ stdin: { contents: entry, resolveDir: source, loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', metafile: true, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'local-standby-adapters', setup(builder) {
  builder.onResolve({ filter: /(?:\/|^)components\/(?:UserBadge|OsNavList|MobileNavMenu)$/ }, args => ({ path: args.path, namespace: 'fixture-shell' }));
  builder.onLoad({ filter: /.*/, namespace: 'fixture-shell' }, () => ({ contents: 'export function UserBadge(){return null}export function OsNavList(){return null}export function MobileNavMenu(){return null}', loader: 'js' }));
  builder.onResolve({ filter: /\/shared-pusher-client$/ }, () => ({ path: 'pusher', namespace: 'fixture-pusher' }));
  builder.onLoad({ filter: /.*/, namespace: 'fixture-pusher' }, () => ({ contents: pusher, loader: 'js' }));
} }] });
sourceFiles=[...new Set([...sourceFiles,...Object.keys(bundle.metafile.inputs).filter(path=>!path.includes('node_modules')&&!path.includes(':')&&path!=='<stdin>')])];
beforeHashes=await hashes();
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = await readFile(join(source, 'app/globals.css'), 'utf8') + '\n' + bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const errors = [], external = [], unexpected = [], checks = [], layoutBounds = [];
// Existing local raster asset; the fixture never uploads it outside this process.
const png = await readFile(join(source,'public/brands/maamaa-logo.png'));
await writeFile(join(output,'fixture-logo.png'),png);
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture');
  if (url.pathname === '/fixture.js') { response.writeHead(200, { 'Content-Type': 'application/javascript' }); response.end(js); return; }
  if (url.pathname === '/fixture-logo.png') { response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(png); return; }
  if(url.pathname==='/locales/os/zh-Hans.json'){response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(chineseDictionary));return;}
  if (url.pathname === '/os/pos' || url.pathname.startsWith('/store/pos/customer-display')) { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html); return; }
  if (url.pathname === '/favicon.ico' || url.pathname.startsWith('/images/') || url.pathname.startsWith('/icons/')) { response.writeHead(204); response.end(); return; }
  unexpected.push({ path: url.pathname, method: request.method }); response.writeHead(403); response.end();
});
await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, pipe: true });
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const section = '#pos-display-standby-settings';
let activePage;
async function newPage(viewport, seed) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage(); activePage = page;
  page.setDefaultTimeout(12000); await page.setViewport(viewport);
  if(seed)await page.evaluateOnNewDocument(seed=>localStorage.setItem('traverse-fixture-settings',JSON.stringify(seed)),seed);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.evaluateOnNewDocument(() => { localStorage.setItem('foundr1-os-language',new URLSearchParams(location.search).get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual'); });
  await page.setRequestInterception(true);
  page.on('request', request => request.url().startsWith(origin + '/') || /^(data|blob):/.test(request.url()) ? request.continue() : (external.push(request.url()), request.abort()));
  return page;
}
async function nativeClick(page, selector) {
  await page.waitForSelector(selector);
  await page.$eval(selector, element => element.scrollIntoView({ block: 'center', inline: 'center' })); await pause(60);
  const point = await page.$eval(selector, element => { const r=element.getBoundingClientRect();for(const [px,py] of [[.5,.5],[.5,.06],[.94,.06],[.06,.06],[.94,.5],[.06,.5],[.5,.94]]){const x=r.left+r.width*px,y=r.top+r.height*py,hit=document.elementFromPoint(x,y);if(element===hit||element.contains(hit))return{x,y,hit:true,disabled:element.disabled};}return{hit:false,disabled:element.disabled}; });
  assert.ok(point.hit && !point.disabled, `not clickable: ${selector} ${JSON.stringify(point)}`); await page.mouse.click(point.x,point.y);
}
async function input(page, name, value) {
  const selector = `${section} [name="${name}"]`;
  await nativeClick(page,selector); await page.$eval(selector,element=>element.select());await page.keyboard.press('Backspace');if(value)await page.type(selector,String(value));
  await page.keyboard.press('Tab');
}
async function range(page,selector,value){await page.$eval(selector,(n,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,String(value));n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));},value);await page.waitForFunction((selector,value)=>Number(document.querySelector(selector)?.value)===value,{},selector,value);await pause(60);}
async function clickText(page, text) {
  const selector = await page.evaluate(text => { const buttons=[...document.querySelectorAll('button')];const button=buttons.find(button=>button.textContent.trim()===text);if(!button)return '';button.dataset.fixtureClick='target';return '[data-fixture-click="target"]'; },text);
  assert.ok(selector, `missing button ${text}`);await nativeClick(page,selector);await page.evaluate(()=>document.querySelector('[data-fixture-click]')?.removeAttribute('data-fixture-click'));
}
const ready = page => page.waitForFunction(() => Boolean(document.querySelector('#pos-display-standby-settings') && !document.querySelector('.store-context-selector select')?.disabled));
const waitSaved = page => page.waitForFunction(() => !document.querySelector('[data-standby-save]')?.disabled && !document.querySelector('.store-context-selector select')?.disabled);
const editorBlocks = page => page.$$eval(`${section} [data-standby-canvas] [data-standby-block]`, nodes=>nodes.map(node=>({id:node.dataset.standbyBlock,type:node.dataset.standbyType,text:node.dataset.standbyType==='clock'?'<live-clock>':node.textContent,left:node.style.left,top:node.style.top})));
async function screenshotEditor(page, prefix) {
  for(const viewport of viewports){
    await page.setViewport(viewport);await page.$eval(section,node=>node.scrollIntoView({block:'start'}));await pause(80);
    const bounds=await page.$eval(section,node=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth};});
    assert.ok(bounds.left>=-1&&bounds.right<=viewport.width+1&&bounds.scrollWidth<=bounds.clientWidth+1,`editor overflow ${JSON.stringify({viewport,bounds})}`);
    layoutBounds.push({kind:'editor',prefix,viewport,...bounds});await page.screenshot({path:join(output,`${prefix}-${viewport.width}.png`)});await(await page.$(section)).screenshot({path:join(output,`${prefix}-section-${viewport.width}.png`)});
  }
}
async function storage(page){return page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage}}));}

const record=(name,detail)=>{checks.push({name,...(detail?{detail}:{})});console.log(JSON.stringify({check:name,...(detail?.viewport?{viewport:detail.viewport}:{} )}));};
const words=['Welcome','いらっしゃいませ','欢迎光临','歡迎光臨','어서 오세요','Xin chào','स्वागत छ'];
const settings=page=>page.evaluate(()=>window.__settings);
async function selectBlock(page,id){await page.select('[data-standby-select]',id);await pause(30);}
async function replaceText(page,value){const selector=section+' [name="standby-text"]';await nativeClick(page,selector);await page.$eval(selector,n=>n.select());await page.keyboard.sendCharacter(value);await page.keyboard.press('Tab');}
async function save(page){await nativeClick(page,'[data-standby-save]');await waitSaved(page);}
async function safe(page){const value=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,writes:window.__writes,denied:window.__denied,native:window.__native}));assert.ok(value.scroll<=value.width+1,`page overflow ${JSON.stringify(value)}`);assert.deepEqual(value.denied,[]);assert.deepEqual(value.native,[]);return value;}
function demonstration(stores,base=12,{mode,motion='gentle',overrides}={}){const seed=structuredClone(stores);for(const store of Object.values(seed)){
 const standby=store.customerDisplayMediaSettings.standby;standby.enabled=true;
 for(const orientation of ['portrait','landscape']){const vertical=orientation==='portrait';const make=(id,type,patch)=>({id,type,x:4,y:4,width:92,height:12,fontSize:5,fontFamily:'georgia',color:'#20332e',align:'center',text:'',imageUrl:'',showDate:false,...patch});standby.layouts[orientation]=[
 make('date','date',vertical?{y:3,height:6,showYear:true}:{x:4,y:4,width:46,height:12,showYear:true}),
 make('clock','clock',vertical?{y:11,height:8,fontSize:7}:{x:54,y:4,width:42,height:12,fontSize:8}),
 make('cloud','wordCloud',{x:0,y:26,width:100,height:48,fontSize:base,text:words.join('\n'),animationSeconds:24,motion,...(mode?{wordSizeMode:mode}:{}),...(overrides?{wordFontSizes:overrides}:{})}),
 make('store','storeName',{y:82,height:12,fontSize:5})
 ];}
}return seed;}
async function runtime(page,seed,{reduced=false}={}){if(reduced)await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await page.goto(origin+'/store/pos/customer-display?storeId='+storeA,{waitUntil:'domcontentloaded'});await page.waitForSelector('[data-standby-canvas]');}
async function readyFlow(page){await page.waitForFunction(()=>document.querySelector('[data-standby-flow-ready="true"]'),{timeout:20000});}
async function boxes(page){return page.$$eval('[data-standby-word]',nodes=>{const clip=nodes[0]?.closest('[data-standby-type="wordCloud"]')?.getBoundingClientRect();return nodes.map((n,index)=>{const r=n.getBoundingClientRect(),style=getComputedStyle(n),font=parseFloat(style.fontSize),left=Math.max(r.left,clip.left),right=Math.min(r.right,clip.right),top=Math.max(r.top,clip.top),bottom=Math.min(r.bottom,clip.bottom),visibleWidth=Math.max(0,right-left),visibleHeight=Math.max(0,bottom-top);return{index,phrase:Number(n.dataset.standbyPhraseIndex),text:n.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,font,requested:Number(n.dataset.standbyRequestedFontSize),visible:visibleWidth>.5&&visibleHeight>.5,meaningful:visibleWidth>=Math.min(r.width*.25,font*2)&&visibleHeight>=r.height*.8,fullyVisible:left===r.left&&right===r.right&&top===r.top&&bottom===r.bottom,clipped:{left,right,top,bottom},clip:{left:clip.left,right:clip.right,top:clip.top,bottom:clip.bottom}};});});}
async function setPhase(page,phase){return page.evaluate(phase=>{const first=document.querySelector('[data-standby-word]');if(!first)throw new Error('No phrase');let node=first,animation;while(node&&!animation){animation=node.getAnimations({subtree:false}).find(a=>a.effect.getTiming().iterations===Infinity);node=node.parentElement;}if(!animation)throw new Error('No real scrolling-plane animation');animation.pause();const timing=animation.effect.getTiming(),duration=Number(timing.duration);animation.currentTime=Number(timing.delay||0)+duration*(2+phase);return{duration,delay:timing.delay,direction:timing.direction,easing:timing.easing,progress:animation.effect.getComputedTiming().progress};},phase);}
function overlaps(items){const visible=items.filter(b=>b.visible),hits=[];for(let i=0;i<visible.length;i++)for(let j=i+1;j<visible.length;j++){const a=visible[i],b=visible[j],w=Math.min(a.clipped.right,b.clipped.right)-Math.max(a.clipped.left,b.clipped.left),h=Math.min(a.clipped.bottom,b.clipped.bottom)-Math.max(a.clipped.top,b.clipped.top);if(w>1&&h>1)hits.push({a:{text:a.text,index:a.index,rect:a.clipped},b:{text:b.text,index:b.index,rect:b.clipped},w,h});}return hits;}
function uniquePhrases(items){const seen=new Map();for(const word of items)if(!seen.has(word.text))seen.set(word.text,word);return[...seen.values()];}
async function densityProof(page){await readyFlow(page);const samples=[];for(let i=0;i<24;i++){const phase=i/24,timing=await setPhase(page,phase),items=await boxes(page),hits=overlaps(items);assert.deepEqual(hits,[],`visible phrases overlap ${JSON.stringify({phase,hits})}`);samples.push({phase,timing,any:items.filter(w=>w.visible).length,meaningful:items.filter(w=>w.meaningful).length,fully:items.filter(w=>w.fullyVisible).length,items});}
 const average=samples.reduce((sum,s)=>sum+s.meaningful,0)/samples.length,majority=samples.filter(s=>s.meaningful>=5).length;assert.ok(average>=6,`density average too low ${JSON.stringify({average,counts:samples.map(s=>s.meaningful)})}`);assert.ok(majority>samples.length/2,`most frames have fewer than five phrases ${JSON.stringify(samples.map(s=>s.meaningful))}`);
 const unique=uniquePhrases(samples[0].items);assert.equal(unique.length,words.length);const fonts=[...new Set(unique.map(w=>Math.round(w.font*100)/100))].sort((a,b)=>a-b);assert.ok(fonts.length>=4,`fewer than four font tiers ${JSON.stringify(fonts)}`);assert.ok(fonts.at(-1)/fonts[0]>=1.4,`font variation too subtle ${JSON.stringify(fonts)}`);const centers=[...new Set(unique.map(w=>Math.round((w.top+w.bottom)/2)))].sort((a,b)=>a-b),gaps=centers.slice(1).map((v,i)=>v-centers[i]);assert.ok(centers.length>=5,`too few vertical positions ${JSON.stringify(centers)}`);assert.ok(new Set(gaps).size>=3&&Math.max(...gaps)/Math.max(1,Math.min(...gaps))>=1.25,`vertical spacing still regular ${JSON.stringify({centers,gaps})}`);
 const first=samples[2].items,last=samples[20].items;assert.equal(first.length,last.length);const dx=last[0].left-first[0].left;assert.ok(dx>0);for(let i=0;i<first.length;i++)assert.ok(Math.abs((last[i].left-first[i].left)-dx)<.25,`plane phrases move independently/reverse ${JSON.stringify({i,first:first[i],last:last[i],dx})}`);for(const sample of samples)assert.equal(sample.timing.direction,'normal');
 await setPhase(page,.999999);const before=(await boxes(page)).filter(w=>w.meaningful).sort((a,b)=>a.text.localeCompare(b.text)||a.left-b.left);await setPhase(page,1.000001);const after=(await boxes(page)).filter(w=>w.meaningful).sort((a,b)=>a.text.localeCompare(b.text)||a.left-b.left);assert.equal(before.length,after.length,'loop boundary changes visible density');for(let i=0;i<before.length;i++){assert.equal(before[i].text,after[i].text);assert.ok(Math.abs(before[i].left-after[i].left)<.5&&Math.abs(before[i].top-after[i].top)<.5,`visible seam jumps ${JSON.stringify({before:before[i],after:after[i]})}`);}
 await setPhase(page,.15);return{average,majority,total:samples.length,counts:samples.map(s=>({phase:s.phase,any:s.any,meaningful:s.meaningful,fully:s.fully})),fonts,centers,gaps,samples};}
async function visibility(page,hidden){await page.evaluate(hidden=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});document.dispatchEvent(new Event('visibilitychange'));},hidden);}
let editor,baseline;
try{
 editor=await newPage({width:1024,height:768});await editor.goto(origin+'/os/pos',{waitUntil:'domcontentloaded'});await ready(editor);baseline=await settings(editor);await nativeClick(editor,'[data-standby-add="wordCloud"]');const id=await editor.$eval('[data-standby-select]',n=>n.value);await replaceText(editor,words.join('\n'));assert.equal(await editor.$eval('[data-standby-word-size-contrast]',n=>Number(n.value)),50);let inspectorSizes=await editor.$$eval('input[data-standby-word-font-size]',nodes=>nodes.map(n=>Number(n.value)));assert.ok(new Set(inspectorSizes).size>=4);await range(editor,'[data-standby-word-size-contrast]',0);assert.equal(await editor.$eval('[data-standby-word-size-contrast]',n=>Number(n.value)),0);inspectorSizes=await editor.$$eval('input[data-standby-word-font-size]',nodes=>nodes.map(n=>Number(n.value)));assert.ok(new Set(inspectorSizes).size===1);await range(editor,'[data-standby-word-size-contrast]',50);await input(editor,'standby-wordFontSize-0','16');assert.equal(await editor.$eval('input[data-standby-word-font-size="0"]',n=>Number(n.value)),16);await save(editor);const payload=await editor.evaluate(()=>window.__writes.at(-1));assert.equal(payload.customerDisplayStandby.layouts.portrait.find(b=>b.id===id).wordSizeMode,'varied');assert.equal(payload.customerDisplayStandby.layouts.portrait.find(b=>b.id===id).wordFontSizes[0],16);assert.deepEqual(payload.customerDisplayStandby.layouts.landscape,baseline[storeA].customerDisplayMediaSettings.standby.layouts.landscape);record('Default varied sizes, explicit uniform toggle and per-phrase override save independently from landscape');
 await editor.reload({waitUntil:'domcontentloaded'});await ready(editor);await selectBlock(editor,id);assert.equal(await editor.$eval('[data-standby-word-size-contrast]',n=>Number(n.value)),50);assert.equal(await editor.$eval('input[data-standby-word-font-size="0"]',n=>Number(n.value)),16);await nativeClick(editor,'[data-standby-word-sizes-reset]');assert.equal(await editor.$eval('[data-standby-word-size-contrast]',n=>Number(n.value)),0);await save(editor);const reset=await editor.evaluate(()=>window.__writes.at(-1).customerDisplayStandby.layouts.portrait.find(b=>b.id===document.querySelector('[data-standby-select]').value));assert.equal(reset.wordSizeMode,'uniform');assert.deepEqual(reset.wordFontSizes,[]);record('Reload retains variation and explicit override; reset clears overrides and deliberately selects uniform');
 for(const base of [12,7])for(const viewport of viewports){const seed=demonstration(baseline,base),page=await newPage(viewport,seed);await runtime(page,seed);const proof=await densityProof(page);assert.deepEqual((await safe(page)).writes,[]);layoutBounds.push({base,viewport,...proof});await page.screenshot({path:join(output,`density-base${base}-${viewport.width}x${viewport.height}.png`)});await page.browserContext().close();record('Natural non-grid scrolling plane has dense simultaneous phrases, varied sizes, no visible collisions and seamless rightward repeat',{base,viewport,average:proof.average,minimum:Math.min(...proof.counts.map(s=>s.meaningful))});}
 for(const [name,mode,overrides]of [['uniform','uniform',undefined],['explicit-varied','varied',[12,5,8,6,9,7,4]]]){const seed=demonstration(baseline,12,{mode,overrides}),page=await newPage({width:896,height:414},seed);await runtime(page,seed);await readyFlow(page);const items=uniquePhrases(await boxes(page)),basePx=await page.$eval('[data-standby-type="wordCloud"]',n=>parseFloat(getComputedStyle(n).fontSize));for(let i=0;i<items.length;i++){const expected=basePx*(overrides?.[words.indexOf(items[i].text)]??12)/12;assert.ok(Math.abs(items[i].font-expected)<.1,`manual font override lost ${JSON.stringify({name,i,item:items[i],expected})}`);}if(!overrides)assert.equal(new Set(items.map(w=>w.font)).size,1);await safe(page);await page.browserContext().close();record('Uniform sizing stays equal and every explicit phrase size wins over varied defaults',name);}
 for(const reduced of [false,true]){const seed=demonstration(baseline,12,{motion:reduced?'gentle':'still'}),page=await newPage({width:896,height:414},seed);await runtime(page,seed,{reduced});await page.waitForFunction(()=>document.querySelector('[data-standby-ambient="wordCloud"]')?.dataset.standbyWordOverview==='true');const items=await boxes(page);assert.equal(uniquePhrases(items).length,7);assert.ok(items.every(w=>w.fullyVisible),`static overview clips phrases ${JSON.stringify(items)}`);await page.browserContext().close();record('Static and reduced motion retain a readable complete overview',{reduced});}
 const seed=demonstration(baseline,12),live=await newPage({width:896,height:414},seed);await runtime(live,seed);await readyFlow(live);const before=await boxes(live);await pause(400);const after=await boxes(live);assert.ok(after.every((w,i)=>w.left>before[i].left),'live plane does not move entirely rightwards');await visibility(live,true);await live.waitForFunction(()=>document.querySelector('[data-standby-ambient="wordCloud"]')?.dataset.standbyPaused==='true');await pause(100);const hidden=await boxes(live);await pause(300);assert.deepEqual(await boxes(live),hidden);assert.deepEqual((await safe(live)).writes,[]);await live.browserContext().close();record('Live plane moves rightwards together and hidden display pauses without replacing its layout');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(await hashes(),beforeHashes);await writeFile(join(output,'verification-summary.json'),JSON.stringify({passed:true,checks,layoutBounds,errors,external,unexpected,sourceHashes:beforeHashes},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,output}));
}catch(error){if(activePage&&!activePage.isClosed())await activePage.screenshot({path:join(output,'failure.png'),fullPage:true}).catch(()=>{});await writeFile(join(output,'verification-summary.json'),JSON.stringify({passed:false,checks,layoutBounds,error:error.stack,errors,external,unexpected,sourceHashes:beforeHashes},null,2));throw error;}
finally {
  const cleanup = { completed: false, stages: [], recovered: [], errors: [] };
  const ownedBrowser = browser.process();
  async function stage(name, action, timeoutMs = 8000) {
    const started = Date.now(); let timer;
    console.log(JSON.stringify({ cleanup: name, state: "start" }));
    try {
      await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} cleanup exceeded ${timeoutMs}ms`)), timeoutMs);
      })]);
      cleanup.stages.push({ name, completed: true, elapsedMs: Date.now() - started });
      console.log(JSON.stringify({ cleanup: name, state: "complete", elapsedMs: Date.now() - started }));
    } catch (error) {
      cleanup.stages.push({ name, completed: false, elapsedMs: Date.now() - started, error: error.message });
      console.log(JSON.stringify({ cleanup: name, state: "timeout-or-error", error: error.message }));
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function waitForOwnedBrowserExit() {
    if (!ownedBrowser || ownedBrowser.exitCode !== null || ownedBrowser.signalCode !== null) return;
    await new Promise(resolve => ownedBrowser.once("exit", resolve));
  }
  try {
    try { await stage("browser.close", () => browser.close()); }
    catch (error) {
      // Only the browser launched by this fixture may be terminated. Disconnect
      // also releases a pending protocol-close promise if Chrome already exited.
      cleanup.recovered.push({ name: "browser.close", reason: error.message });
      await stage("browser.disconnect", () => browser.disconnect(), 3000);
      if (ownedBrowser && ownedBrowser.exitCode === null && ownedBrowser.signalCode === null) {
        ownedBrowser.kill("SIGTERM");
        try { await stage("owned-browser-SIGTERM", waitForOwnedBrowserExit, 3000); }
        catch { ownedBrowser.kill("SIGKILL"); await stage("owned-browser-SIGKILL", waitForOwnedBrowserExit, 3000); }
      }
    }
  } catch (error) { cleanup.errors.push(error.message); }
  try {
    cleanup.ownedBrowserStdio = (ownedBrowser?.stdio ?? []).map((stream, index) => ({
      index, present: Boolean(stream), destroyed: stream?.destroyed, closed: stream?.closed
    }));
    // Chrome's pipe transport removes its subscriptions on disconnect, but a
    // detached reader/writer can still keep this Node fixture alive afterward.
    // Destroy only streams belonging to the browser launched by this test.
    await stage("owned-browser-stdio", () => Promise.all((ownedBrowser?.stdio ?? []).filter(Boolean).map(stream => {
      if (stream.closed) return Promise.resolve();
      return new Promise(resolve => { stream.once("close", resolve); stream.destroy(); });
    })), 3000);
  } catch (error) { cleanup.errors.push(error.message); }
  try {
    await stage("server.close", () => new Promise((resolve, reject) => {
      server.closeAllConnections();
      server.close(error => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
      server.closeAllConnections();
    }), 5000);
  } catch (error) { cleanup.errors.push(error.message); }
  try { await stage("esbuild.stop", () => stop(), 5000); }
  catch (error) { cleanup.errors.push(error.message); }
  cleanup.completed = cleanup.errors.length === 0;
  cleanup.activeResources = process.getActiveResourcesInfo();
  await writeFile(join(output, "cleanup-result.json"), JSON.stringify(cleanup, null, 2));
  if (!cleanup.completed) throw new Error(`Fixture cleanup failed: ${cleanup.errors.join("; ")}`);
}
