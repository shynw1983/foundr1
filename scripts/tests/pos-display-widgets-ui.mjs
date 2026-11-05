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
const output = resolve(args.output || 'outputs/pos-display-widgets-ui');
await mkdir(output, { recursive: true });
const require = createRequire(join(source, 'package.json'));
const { build, stop } = require('esbuild');
const puppeteer = require('puppeteer-core');
let sourceFiles = [
  'app/os/pos/page.tsx', 'app/os/pos/PosDisplayStandbyEditor.tsx',
  'components/pos/PosDisplayStandbyCanvas.tsx', 'components/pos/PosDisplayStandbyCanvas.module.css',
  'app/os/pos/PosDisplayStandbyEditor.module.css', 'app/store/pos/customer-display/CustomerDisplayStandby.module.css',
  'app/store/pos/customer-display/CustomerDisplayWorkspace.tsx', 'lib/pos-display-standby.ts', 'lib/pos-display-standby-i18n.ts', 'app/os/components/OsTranslationProvider.tsx', 'public/locales/os/zh-Hans.json', 'public/locales/os/zh-Hant.json', 'public/locales/os/zh.json', 'app/globals.css', 'scripts/tests/pos-display-widgets-ui.mjs', 'scripts/tests/pos-display-traverse-ui.mjs', 'scripts/tests/pos-display-density-ui.mjs'
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
window.__settings=JSON.parse(localStorage.getItem('widgets-fixture-settings')||'null')||{[storeA]:settings(storeA),[storeB]:settings(storeB)};
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
  const status=mode==='missing'?'not_configured':mode==='unavailable'?'unavailable':mode==='stale'?'stale':'ready';
  const code=mode==='unknown'?null:mode.startsWith('code_')?Number(mode.slice(5)):id===storeA?0:3;
  const condition=mode==='unknown'?'予報情報':code===3?'くもり':code===61?'雨':code===71?'雪':'晴れ';
  if(mode==='forbidden')return Response.json({error:'fixture forbidden'},{status:403});
  if(mode==='error')return Response.json({error:'fixture weather unavailable'},{status:503});
  return Response.json({storeId:id,date,fetchedAt:now,status,data:status==='ready'||status==='stale'?{kind:'daily_forecast',date,condition,weatherCode:code,highC:id===storeA?25:21,lowC:18,sourceName:mode==='openmeteo'?'Open-Meteo':'気象庁',sourceUrl:mode==='openmeteo'?'https://open-meteo.com/':'https://www.jma.go.jp/bosai/forecast/',updatedAt:now,fetchedAt:now}:null});
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
   window.__settings[body.storeId]=next;localStorage.setItem('widgets-fixture-settings',JSON.stringify(window.__settings));return Response.json({ok:true,settings:next});
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
  if(seed)await page.evaluateOnNewDocument(seed=>localStorage.setItem('widgets-fixture-settings',JSON.stringify(seed)),seed);
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
  if(await page.$eval(selector,n=>n.type==='range')){await page.$eval(selector,(n,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,String(value));n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));},value);await pause(60);return;}
  await nativeClick(page,selector); await page.$eval(selector,element=>element.select());await page.keyboard.press('Backspace');if(value)await page.type(selector,String(value));
  await page.keyboard.press('Tab');
}
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

const record = (name, detail) => checks.push({name,...(detail?{detail}:{})});
const words = ['Welcome','いらっしゃいませ','欢迎光临','歡迎光臨','환영합니다','Xin chào','स्वागतम्'];
const messages = ['どうぞごゆっくり','今日も素敵な一日を','お好きな一杯を楽しんで'];
const getSettings = page => page.evaluate(()=>window.__settings);
async function selectBlock(page,id){await page.select('[data-standby-select]',id);await pause(30);}
async function addBlock(page,type){await nativeClick(page,`[data-standby-add="${type}"]`);return page.$eval('[data-standby-select]',n=>n.value);}
async function save(page){await nativeClick(page,'[data-standby-save]');await waitSaved(page);}
async function runtime(page,seed,{weather='ready',reduced=false,date='2026-10-22T03:00:00.000Z'}={}){
  if(reduced)await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.emulateTimezone('America/Los_Angeles');
  await page.evaluateOnNewDocument(({weather,date})=>{
    if(date){window.__fixtureDate=date;const NativeDate=Date;class FixtureDate extends NativeDate{constructor(...args){super(...(args.length?args:[window.__fixtureDate]));}static now(){return new NativeDate(window.__fixtureDate).getTime();}}window.Date=FixtureDate;}
    addEventListener('DOMContentLoaded',()=>{window.__weatherMode=weather;});
  },{weather,date});
  await page.goto(origin+'/store/pos/customer-display?storeId='+storeA+'&weather='+weather,{waitUntil:'domcontentloaded'});await page.waitForSelector('[data-standby-canvas]');
}
function widgetBlock(id,type,geometry,values={}){return{id,type,x:4,y:4,width:92,height:12,fontSize:6,fontFamily:'standard',color:'#20332e',align:'center',text:'',imageUrl:'',showDate:false,...geometry,...values};}
function demonstration(settings){const result=structuredClone(settings);for(const store of Object.values(result)){
  const standby=store.customerDisplayMediaSettings.standby;standby.enabled=true;
  standby.layouts.landscape=[
    widgetBlock('date','date',{x:4,y:4,width:46,height:12,fontSize:6},{showYear:true,fontFamily:'georgia'}),
    widgetBlock('clock','clock',{x:54,y:4,width:42,height:12,fontSize:8},{fontFamily:'georgia'}),
    widgetBlock('cloud','wordCloud',{x:4,y:23,width:92,height:38,fontSize:10},{text:words.join('\n'),wordFontSizes:[9,6,8,7,5,8,6],fontFamily:'georgia',animationSeconds:24,motion:'gentle'}),
    widgetBlock('messages','messages',{x:4,y:62,width:92,height:10,fontSize:5},{text:messages.join('\n'),animationSeconds:8,motion:'gentle'}),
    widgetBlock('weather','weather',{x:4,y:76,width:92,height:20,fontSize:5})
  ];
  standby.layouts.portrait=[
    widgetBlock('date','date',{x:4,y:4,width:92,height:6,fontSize:6},{showYear:true,fontFamily:'georgia'}),
    widgetBlock('clock','clock',{x:4,y:12,width:92,height:7,fontSize:8},{fontFamily:'georgia'}),
    widgetBlock('cloud','wordCloud',{x:4,y:27,width:92,height:30,fontSize:10},{text:words.join('\n'),wordFontSizes:[9,6,8,7,5,8,6],fontFamily:'georgia',animationSeconds:24,motion:'gentle'}),
    widgetBlock('messages','messages',{x:4,y:66,width:92,height:9,fontSize:5},{text:messages.join('\n'),animationSeconds:8,motion:'gentle'}),
    widgetBlock('weather','weather',{x:4,y:83,width:92,height:12,fontSize:4})
  ];
}return result;}
async function assertSafe(page){const value=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,writes:window.__writes,denied:window.__denied,native:window.__native}));assert.ok(value.scroll<=value.width+1,`page overflow ${JSON.stringify(value)}`);assert.deepEqual(value.denied,[]);assert.deepEqual(value.native,[]);return value;}
async function settleFlowingWords(page){await page.waitForFunction(()=>document.querySelector('[data-standby-flow-ready="true"]'));}
async function fittedWords(page){return page.$$eval('[data-standby-word]',nodes=>nodes.map(n=>{const host=n.closest('[data-standby-block]').getBoundingClientRect(),r=n.getBoundingClientRect();return{text:n.textContent,font:getComputedStyle(n).fontSize,left:r.left,top:r.top,right:r.right,bottom:r.bottom,visible:r.right>host.left&&r.left<host.right,fits:r.top>=host.top-1&&r.bottom<=host.bottom+1};}).filter(word=>word.visible));}
async function fittedText(page){return page.$$eval('[data-standby-block]',nodes=>nodes.filter(n=>!['wordCloud','image'].includes(n.dataset.standbyType)).map(n=>{const host=n.getBoundingClientRect(),walker=document.createTreeWalker(n,NodeFilter.SHOW_TEXT),boxes=[];let item;while(item=walker.nextNode()){if(!item.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(item);for(const r of range.getClientRects())boxes.push({left:r.left,top:r.top,right:r.right,bottom:r.bottom,text:item.textContent});}return{type:n.dataset.standbyType,host:{left:host.left,top:host.top,right:host.right,bottom:host.bottom},boxes,fits:boxes.every(r=>r.left>=host.left-1&&r.right<=host.right+1&&r.top>=host.top-1&&r.bottom<=host.bottom+1)};}));}
async function assertWeatherDialog(page,viewport,{stale=false,unavailable=false,provider='jma'}={}){
  const trigger='[data-standby-weather-trigger]';
  assert.equal(await page.$$eval('[data-standby-type="weather"] button button',nodes=>nodes.length),0);
  assert.equal(await page.$eval('[data-standby-weather-details]',n=>n.open),false);
  const label=await page.$eval(trigger,n=>n.getAttribute('aria-label'));assert.ok(label&&/天気|予報/.test(label),`weather trigger label ${label}`);
  await nativeClick(page,trigger);await page.waitForSelector('[data-standby-weather-details]',{visible:true});
  const details=await page.$eval('[data-standby-weather-details]',n=>{const r=n.getBoundingClientRect();return{text:n.innerText,role:n.getAttribute('role')||(n.tagName==='DIALOG'?'dialog':null),modal:n.getAttribute('aria-modal')||(n.tagName==='DIALOG'&&n.open?'true':null),labelled:n.getAttribute('aria-labelledby'),focused:n.contains(document.activeElement),left:r.left,right:r.right,top:r.top,bottom:r.bottom,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth};});
  assert.equal(details.role,'dialog');assert.equal(details.modal,'true');assert.ok(details.labelled);assert.ok(details.focused,'dialog receives focus');
  assert.ok(details.left>=-1&&details.right<=viewport.width+1&&details.top>=-1&&details.bottom<=viewport.height+1&&details.scrollWidth<=details.clientWidth+1,`weather dialog overflow ${JSON.stringify({viewport,details})}`);
  if(unavailable){assert.match(details.text,/準備中|取得|利用|ありません/);assert.ok(!details.text.includes('25'));}
  else {assert.match(details.text,/25|21/);assert.match(details.text,/18/);assert.match(details.text,provider==='jma'?/気象庁/:/Open-Meteo/);const link=provider==='jma'?'[data-standby-weather-details] a[href^="https://www.jma.go.jp/"]':'[data-standby-weather-details] a[href="https://open-meteo.com/"]';assert.ok(await page.$eval(link,n=>n.rel.includes('noopener')));assert.match(details.text,/出典|情報源|データ/);if(provider!=='jma'){assert.match(details.text,/CC BY 4.0/);assert.ok(await page.$('[data-standby-weather-details] a[href="https://creativecommons.org/licenses/by/4.0/"]'));}}
  if(stale)assert.match(details.text,/更新待ち|更新を待|以前/);
  const mode=await page.$eval('[data-standby-weather]',n=>n.dataset.weatherDisplay);await page.screenshot({path:join(output,`runtime-weather-dialog-${mode}-${viewport.width}x${viewport.height}${stale?'-stale':''}-${provider}.png`)});
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[data-standby-weather-details]')?.open);assert.equal(await page.$eval(trigger,n=>n===document.activeElement),true,'dialog Escape returns focus to weather icon');
  return details;
}
function iconSeed(seed){const result=structuredClone(seed);for(const blocks of Object.values(result[storeA].customerDisplayMediaSettings.standby.layouts))for(const block of blocks)if(block.type==='weather')block.weatherDisplay='icon';return result;}
async function setVisibility(page,hidden){await page.evaluate(hidden=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});document.dispatchEvent(new Event('visibilitychange'));},hidden);}
let editor,saved,demo;
try{
  editor=await newPage({width:1024,height:768});await editor.goto(origin+'/os/pos',{waitUntil:'domcontentloaded'});await ready(editor);
  const legacy=await getSettings(editor),originalPortrait=structuredClone(legacy[storeA].customerDisplayMediaSettings.standby.layouts.portrait);
  for(const type of ['date','weather','wordCloud','messages'])assert.ok(await editor.$(`[data-standby-add="${type}"]`),`missing add ${type}`);
  const ids={};for(const type of ['date','weather','wordCloud','messages'])ids[type]=await addBlock(editor,type);
  record('Actual OS editor exposes independent date, forecast, multilingual cloud and rotating message blocks');
  await selectBlock(editor,ids.wordCloud);await input(editor,'standby-text',words.join('\n'));await editor.select('[name="standby-fontFamily"]','georgia');await editor.select('[name="standby-motion"]','gentle');await input(editor,'standby-animationSeconds','24');
  await selectBlock(editor,ids.messages);await input(editor,'standby-text',messages.join('\n'));await input(editor,'standby-animationSeconds','8');
  await nativeClick(editor,'[data-standby-delete]');assert.equal(await editor.$(`[data-standby-block="${ids.messages}"]`),null);ids.messages=await addBlock(editor,'messages');await input(editor,'standby-text',messages.join('\n'));
  await selectBlock(editor,ids.weather);assert.equal(await editor.$eval('[data-standby-weather-display]',n=>n.value),'details');await editor.select('[data-standby-weather-display]','icon');assert.equal(await editor.$$eval('[data-standby-canvas] button button',nodes=>nodes.length),0);assert.equal(await editor.$('[data-standby-canvas] [data-standby-weather-trigger]'),null);
  await selectBlock(editor,ids.date);assert.ok(await editor.$('[name="standby-showYear"]'));await nativeClick(editor,'[name="standby-showYear"]');assert.equal(await editor.$eval('[name="standby-showYear"]',n=>n.checked),false);await editor.select('[name="standby-fontFamily"]','georgia');
  await nativeClick(editor,'[data-standby-enable]');await save(editor);
  let payload=await editor.evaluate(()=>window.__writes.at(-1));assert.equal(payload.section,'customerDisplayStandby');assert.deepEqual(payload.customerDisplayStandby.layouts.landscape,legacy[storeA].customerDisplayMediaSettings.standby.layouts.landscape);
  assert.deepEqual(payload.customerDisplayStandby.layouts.portrait.slice(0,4),originalPortrait);
  assert.equal(payload.customerDisplayStandby.layouts.portrait.find(b=>b.id===ids.wordCloud).text,words.join('\n'));assert.equal(payload.customerDisplayStandby.layouts.portrait.find(b=>b.id===ids.wordCloud).fontFamily,'georgia');
  assert.equal(payload.customerDisplayStandby.layouts.portrait.find(b=>b.id===ids.date).showYear,false);assert.equal(payload.customerDisplayStandby.layouts.portrait.find(b=>b.id===ids.weather).weatherDisplay,'icon');record('New blocks add, edit and delete; date can hide year; saving preserves legacy blocks and independent untouched landscape');
  await editor.reload({waitUntil:'domcontentloaded'});await ready(editor);await selectBlock(editor,ids.wordCloud);assert.equal(await editor.$eval('[name="standby-text"]',n=>n.value),words.join('\n'));assert.equal(await editor.$eval('[name="standby-fontFamily"]',n=>n.value),'georgia');
  await selectBlock(editor,ids.weather);assert.equal(await editor.$eval('[data-standby-weather-display]',n=>n.value),'icon');await nativeClick(editor,'[data-standby-orientation="landscape"]');const landscapeWeather=await addBlock(editor,'weather');assert.equal(await editor.$eval('[data-standby-weather-display]',n=>n.value),'details');await editor.select('[data-standby-weather-display]','details');const landscapeMessage=await addBlock(editor,'messages');await input(editor,'standby-text','Landscape welcome\nどうぞごゆっくり');await save(editor);saved=await getSettings(editor);
  assert.equal(saved[storeA].customerDisplayMediaSettings.standby.layouts.portrait.find(b=>b.id===ids.messages).text,messages.join('\n'));assert.equal(saved[storeA].customerDisplayMediaSettings.standby.layouts.landscape.find(b=>b.id===landscapeMessage).text,'Landscape welcome\nどうぞごゆっくり');
  assert.equal(saved[storeA].customerDisplayMediaSettings.standby.layouts.portrait.find(b=>b.id===ids.weather).weatherDisplay,'icon');assert.equal(saved[storeA].customerDisplayMediaSettings.standby.layouts.landscape.find(b=>b.id===landscapeWeather).weatherDisplay,'details');await editor.reload({waitUntil:'domcontentloaded'});await ready(editor);await selectBlock(editor,ids.weather);assert.equal(await editor.$eval('[data-standby-weather-display]',n=>n.value),'icon');await nativeClick(editor,'[data-standby-orientation="landscape"]');await selectBlock(editor,landscapeWeather);assert.equal(await editor.$eval('[data-standby-weather-display]',n=>n.value),'details');
  record('Reload retains exact authored languages Georgia and independent portrait icon/landscape detail weather choices');
  for(const viewport of viewports){await editor.setViewport(viewport);await editor.$eval('[data-standby-inspector]',n=>n.scrollIntoView({block:'center'}));await pause(60);const controls=await editor.$$eval(`${section} input,${section} select,${section} textarea,${section} button`,nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{left:r.left,right:r.right};}));assert.ok(controls.every(r=>r.left>=-1&&r.right<=viewport.width+1),`editor overflow ${JSON.stringify({viewport,controls})}`);await assertSafe(editor);await editor.screenshot({path:join(output,`editor-widgets-${viewport.width}x${viewport.height}.png`)});record('New widget inspector fits responsive viewport',viewport);}
  const readonly=await newPage({width:896,height:414},saved);await readonly.goto(origin+'/os/pos?readonly=1',{waitUntil:'domcontentloaded'});await ready(readonly);for(const type of ['date','weather','wordCloud','messages'])assert.equal(await readonly.$eval(`[data-standby-add="${type}"]`,n=>n.disabled),true);await selectBlock(readonly,ids.wordCloud);for(const name of ['standby-text','standby-motion','standby-animationSeconds'])assert.equal(await readonly.$eval(`[name="${name}"]`,n=>n.matches(':disabled')),true);await selectBlock(readonly,ids.weather);assert.equal(await readonly.$eval('[data-standby-weather-display]',n=>n.matches(':disabled')),true);assert.deepEqual(await readonly.evaluate(()=>window.__writes),[]);await readonly.browserContext().close();record('Read-only users cannot add, edit or save new widgets');
  const chinese=await newPage({width:414,height:896},saved);await chinese.goto(origin+'/os/pos?lang=zh-Hans',{waitUntil:'domcontentloaded'});await ready(chinese);await chinese.waitForFunction(text=>document.querySelector('#standby-heading')?.textContent===text,{},chineseDictionary['客席表示の待機画面']);for(const [type,key]of [['date','日付'],['weather','天気'],['wordCloud','ことばの雲']])assert.equal(await chinese.$eval(`[data-standby-add="${type}"]`,n=>n.textContent.trim()),chineseDictionary[key]);await selectBlock(chinese,ids.wordCloud);assert.equal(await chinese.$eval('[name="standby-text"]',n=>n.value),words.join('\n'));await selectBlock(chinese,ids.weather);assert.deepEqual(await chinese.$$eval('[data-standby-weather-display] option',nodes=>nodes.map(n=>n.textContent)),[chineseDictionary['詳しく表示'],chineseDictionary['アイコンのみ']]);await assertSafe(chinese);await chinese.browserContext().close();record('New widget controls translate in Chinese while store-authored multilingual content remains exact');
  demo=demonstration(saved);
  const fixedDate='2026-10-21T15:05:00.000Z';
  for(const viewport of viewports){const page=await newPage(viewport,demo);await runtime(page,demo,{date:fixedDate});await page.waitForFunction(()=>document.querySelector('[data-standby-type="weather"]')?.textContent.includes('25'));await pause(900);
    const dateText=await page.$eval('[data-standby-type="date"]',n=>n.textContent);assert.match(dateText,/2026/);assert.ok(dateText.includes('22'),`date does not use JST ${dateText}`);const clockText=await page.$eval('[data-standby-type="clock"]',n=>n.textContent);assert.match(clockText,/0?:05|00:05/);assert.ok(!clockText.includes('2026'));
    await settleFlowingWords(page);const actualWords=await page.$$eval('[data-standby-word]',nodes=>[...new Set(nodes.map(n=>n.textContent))]);assert.deepEqual([...actualWords].sort(),[...words].sort());const bounds=await fittedWords(page);assert.ok(bounds.every(w=>w.fits),`cloud clipping ${JSON.stringify({viewport,bounds})}`);assert.ok(new Set(bounds.map(w=>w.font)).size>=3,`cloud lost size variation ${JSON.stringify({viewport,bounds})}`);assert.ok(new Set(bounds.map(w=>Math.round(w.top))).size>=2);const weatherText=await page.$eval('[data-standby-type="weather"]',n=>n.textContent);assert.match(weatherText,/25/);assert.match(weatherText,/18/);assert.ok(!weatherText.includes('気象庁'));assert.match(weatherText,/予報/);assert.equal(await page.$('[data-standby-type="weather"] a'),null);
    const textBounds=await fittedText(page);assert.ok(textBounds.every(b=>b.fits),`widget text clipped ${JSON.stringify({viewport,textBounds})}`);await assertWeatherDialog(page,viewport); assert.equal((await assertSafe(page)).writes.length,0);layoutBounds.push({viewport,words:bounds,textBounds,dateText,clockText,weatherText});await page.screenshot({path:join(output,`runtime-widgets-${viewport.width}x${viewport.height}.png`)});record('Actual customer display preserves explicit phrase sizes in the natural shared-plane layout, independent JST date/clock and labelled daily high/low forecast',viewport);await page.browserContext().close();}
  const icons=iconSeed(demo);
  for(const [index,viewport]of viewports.entries()){const aligned=structuredClone(icons),align=['left','center','right','left','right'][index];for(const blocks of Object.values(aligned[storeA].customerDisplayMediaSettings.standby.layouts))for(const block of blocks)if(block.type==='weather')block.align=align;const page=await newPage(viewport,aligned);await runtime(page,aligned);await page.waitForSelector('[data-standby-weather="ready"]');
    const geometry=await page.$eval('[data-standby-type="weather"]',n=>{const rect=x=>{const r=x.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};return{host:rect(n),trigger:rect(n.querySelector('[data-standby-weather-trigger]')),svg:rect(n.querySelector('[data-standby-weather-icon] svg'))};});const expectedSide=Math.min(geometry.host.width,geometry.host.height);for(const rect of [geometry.trigger,geometry.svg]){assert.ok(Math.abs(rect.width-expectedSide)<=1&&Math.abs(rect.height-expectedSide)<=1,`icon should fill square inside asymmetric box ${JSON.stringify({viewport,align,geometry})}`);assert.ok(rect.left>=geometry.host.left-1&&rect.right<=geometry.host.right+1&&rect.top>=geometry.host.top-1&&rect.bottom<=geometry.host.bottom+1);}const expectedLeft=align==='left'?geometry.host.left:align==='right'?geometry.host.right-expectedSide:geometry.host.left+(geometry.host.width-expectedSide)/2;assert.ok(Math.abs(geometry.trigger.left-expectedLeft)<=1,`icon alignment ${JSON.stringify({align,expectedLeft,geometry})}`);layoutBounds.push({kind:'weather-icon',viewport,align,...geometry});
    const atRest=await page.$eval('[data-standby-type="weather"]',n=>({text:n.innerText.trim(),label:n.querySelector('[data-standby-weather-trigger]')?.getAttribute('aria-label'),icons:n.querySelectorAll('[data-standby-weather-icon]').length,links:n.querySelectorAll('a').length}));
    assert.equal(atRest.text,'',`icon-only has visible detail ${JSON.stringify(atRest)}`);assert.equal(atRest.icons,1);assert.equal(atRest.links,0);assert.match(atRest.label,/晴れ/);
    await assertWeatherDialog(page,viewport);assert.equal((await assertSafe(page)).writes.length,0);assert.equal(await page.evaluate(()=>window.__weatherRequests.length),1);
    await page.screenshot({path:join(output,`runtime-weather-icon-${viewport.width}x${viewport.height}.png`)});record('Icon-only weather has no visible detail or footer and opens accessible forecast details within viewport',viewport);await page.browserContext().close();}
  for(const [mode,expected]of [['ready','sun'],['code_3','cloud'],['code_61','rain'],['code_71','snow'],['unknown','unknown']]){const page=await newPage({width:896,height:414},icons);await runtime(page,icons,{weather:mode});await page.waitForSelector('[data-standby-weather="ready"]');assert.equal(await page.$eval('[data-standby-weather-icon]',n=>n.dataset.weatherIcon),expected);assert.equal(await page.$eval('[data-standby-type="weather"]',n=>n.innerText.trim()),'');record('Weather icon follows forecast code with a neutral unknown fallback',{mode,expected});await page.browserContext().close();}
  for(const mode of ['missing','unavailable','error']){const page=await newPage({width:896,height:414},icons);await runtime(page,icons,{weather:mode});await page.waitForFunction(()=>{const n=document.querySelector('[data-standby-weather]');return n&&['not_configured','unavailable'].includes(n.dataset.standbyWeather);});assert.equal(await page.$eval('[data-standby-weather-icon]',n=>n.dataset.weatherIcon),'unknown');assert.equal(await page.$eval('[data-standby-type="weather"]',n=>n.innerText.trim()),'');assert.match(await page.$eval('[data-standby-weather]',n=>n.getAttribute('aria-label')),/準備中|取得|利用|ありません/);assert.equal(await page.$('[data-standby-weather-trigger]'),null);record('Unavailable icon mode stays neutral with accessible status and no fabricated temperatures',mode);await page.browserContext().close();}
  const openMeteo=await newPage({width:896,height:414},icons);await runtime(openMeteo,icons,{weather:'openmeteo'});await openMeteo.waitForSelector('[data-standby-weather="ready"]');assert.equal(await openMeteo.$eval('[data-standby-type="weather"]',n=>n.innerText.trim()),'');await assertWeatherDialog(openMeteo,{width:896,height:414},{provider:'openmeteo'});await nativeClick(openMeteo,'[data-standby-weather-trigger]');await openMeteo.waitForSelector('[data-standby-weather-details]',{visible:true});await nativeClick(openMeteo,'[data-standby-weather-details] header button');await openMeteo.waitForFunction(()=>!document.querySelector('[data-standby-weather-details]')?.open);assert.equal(await openMeteo.$eval('[data-standby-weather-trigger]',n=>n===document.activeElement),true);record('Provider metadata and Open-Meteo license remain in accessible details only; close button restores icon focus');await openMeteo.browserContext().close();
  for(const [mode,seed]of [['details',demo],['icon',icons]]){const page=await newPage({width:808,height:320},seed);await runtime(page,seed,{weather:'stale'});await page.waitForSelector('[data-standby-weather="stale"]');const text=await page.$eval('[data-standby-type="weather"]',n=>n.innerText.trim());assert.ok(!text.includes('気象庁'));if(mode==='icon')assert.equal(text,'');else assert.match(text,/更新待ち|更新を待|以前/);await assertWeatherDialog(page,{width:808,height:320},{stale:true});record('Stale forecast is explicitly labelled in details while icon-only stays clean and exposes freshness on tap',mode);await page.browserContext().close();}
  const midnight=await newPage({width:896,height:414},icons);await runtime(midnight,icons,{date:'2026-10-21T14:59:30.000Z'});await midnight.waitForSelector('[data-standby-weather="ready"]');await midnight.evaluate(()=>{window.__fixtureDate='2026-10-21T15:00:05.000Z';});await midnight.waitForFunction(()=>document.querySelector('[data-standby-weather]')?.dataset.standbyWeather!=='ready');assert.equal(await midnight.$eval('[data-standby-weather-icon]',n=>n.dataset.weatherIcon),'unknown');assert.ok(!(await midnight.$eval('[data-standby-weather]',n=>n.getAttribute('aria-label'))).includes('25'));await midnight.evaluate(()=>window.dispatchEvent(new Event('online')));await midnight.waitForSelector('[data-standby-weather="ready"]');assert.equal(await midnight.evaluate(()=>window.__weatherRequests.length),2);record('Crossing JST midnight removes yesterday forecast immediately and refreshes today without fake sunny fallback');await midnight.browserContext().close();
  const moving=await newPage({width:896,height:414},demo);await runtime(moving,demo);await settleFlowingWords(moving);
  const transforms=()=>moving.$$eval('[data-standby-word]',nodes=>nodes.map(n=>n.getBoundingClientRect().left));const initial=await transforms();await pause(850);const later=await transforms();assert.notDeepEqual(later,initial);await assertSafe(moving);
  const messagesInitial=await moving.$$eval('[data-standby-message]',n=>n.map(x=>x.textContent));assert.equal(messagesInitial.length,1);await moving.waitForFunction(initial=>document.querySelector('[data-standby-message]')?.textContent!==initial,{timeout:12000},messagesInitial[0]);assert.equal(await moving.$$eval('[data-standby-message]',nodes=>nodes.length),1);
  const requests=await moving.evaluate(()=>window.__weatherRequests);assert.equal(requests.length,1);await setVisibility(moving,true);await moving.waitForFunction(()=>[...document.querySelectorAll('[data-standby-ambient]')].every(n=>n.dataset.standbyPaused==='true'));await moving.waitForFunction(()=>[...document.querySelectorAll('[data-standby-flow-plane]')].every(n=>getComputedStyle(n).animationPlayState==='paused'));await pause(100);const hidden=await transforms();await pause(300);assert.deepEqual(await transforms(),hidden);await setVisibility(moving,false);await moving.waitForFunction(()=>[...document.querySelectorAll('[data-standby-ambient]')].every(n=>n.dataset.standbyPaused==='false'));assert.equal(await moving.evaluate(()=>window.__weatherRequests.length),1);
  record('Cloud traverses without page overflow; message rotates one at a time; hidden page pauses and repeated clock ticks/visibility do not duplicate forecast requests');await moving.browserContext().close();
  const reduced=await newPage({width:896,height:414},demo);await runtime(reduced,demo,{reduced:true});await reduced.waitForSelector('[data-standby-word]');assert.equal(await reduced.$$eval('[data-standby-ambient]',nodes=>nodes.every(n=>n.dataset.standbyPaused==='true')),true);const a=await reduced.$$eval('[data-standby-word]',nodes=>nodes.map(n=>({transform:getComputedStyle(n).transform,animation:getComputedStyle(n).animationName})));await pause(350);assert.deepEqual(await reduced.$$eval('[data-standby-word]',nodes=>nodes.map(n=>({transform:getComputedStyle(n).transform,animation:getComputedStyle(n).animationName}))),a);assert.ok(a.every(x=>x.animation==='none'));await reduced.browserContext().close();record('Reduced motion presents a still multilingual cloud');
  const stillSeed=structuredClone(demo);for(const blocks of Object.values(stillSeed[storeA].customerDisplayMediaSettings.standby.layouts))for(const b of blocks)if(b.type==='wordCloud'||b.type==='messages')b.motion='still';const still=await newPage({width:896,height:414},stillSeed);await runtime(still,stillSeed);await still.waitForSelector('[data-standby-word]');assert.ok((await still.$$eval('[data-standby-word]',nodes=>nodes.map(n=>getComputedStyle(n).animationName))).every(n=>n==='none'));await still.browserContext().close();record('Saved still setting disables cloud motion');
  for(const mode of ['missing','unavailable','error']){const page=await newPage({width:896,height:414},demo);await runtime(page,demo,{weather:mode});await page.waitForFunction(()=>document.querySelector('[data-standby-type="weather"]')?.textContent.includes('準備中'));const text=await page.$eval('[data-standby-type="weather"]',n=>n.textContent);assert.ok(!text.includes('25'));assert.equal(await page.evaluate(()=>window.__weatherRequests.length),1);assert.equal((await assertSafe(page)).writes.length,0);record('Weather unavailable state stays quiet and never invents temperature',mode);await page.browserContext().close();}
  const noWeather=structuredClone(demo);for(const blocks of Object.values(noWeather[storeA].customerDisplayMediaSettings.standby.layouts))for(let i=blocks.length-1;i>=0;i--)if(blocks[i].type==='weather')blocks.splice(i,1);const without=await newPage({width:896,height:414},noWeather);await runtime(without,noWeather);await pause(1200);assert.equal(await without.evaluate(()=>window.__weatherRequests.length),0);await without.browserContext().close();record('No forecast request is made when the active standby layout has no weather block');
  const duplicates=structuredClone(demo);duplicates[storeA].customerDisplayMediaSettings.standby.layouts.landscape.push({...duplicates[storeA].customerDisplayMediaSettings.standby.layouts.landscape.find(b=>b.type==='weather'),id:'weather-duplicate'});const duplicate=await newPage({width:896,height:414},duplicates);await runtime(duplicate,duplicates);await duplicate.waitForFunction(()=>document.querySelectorAll('[data-standby-weather="ready"]').length===2);assert.equal(await duplicate.evaluate(()=>window.__weatherRequests.length),1);await duplicate.browserContext().close();record('Two forecast blocks share one in-flight request and cache entry');
  const race=await newPage({width:896,height:414},demo);await runtime(race,demo,{weather:'hold'});await race.waitForFunction(()=>window.__weatherHolds.has('11111111-1111-4111-8111-111111111111'));await race.evaluate(()=>{window.__weatherMode='ready';delete window.Foundr1Android;});await nativeClick(race,'button[aria-label="メニュー"]');await race.select('.customer-display-menu select',storeB);await race.waitForFunction(()=>document.querySelector('[data-standby-type="weather"]')?.textContent.includes('21'));await race.evaluate(storeA=>window.__weatherRelease(storeA),storeA);await pause(120);const raceText=await race.$eval('[data-standby-type="weather"]',n=>n.textContent);assert.ok(raceText.includes('21')&&!raceText.includes('25'));assert.deepEqual((await race.evaluate(()=>window.__weatherRequests)).map(r=>r.id),[storeA,storeB]);assert.deepEqual((await assertSafe(race)).writes,[]);await race.browserContext().close();record('Switching stores aborts/ignores delayed old-store forecast and displays only the new store');
  const denied=await newPage({width:896,height:414},demo);await runtime(denied,demo);await denied.waitForFunction(()=>document.querySelector('[data-standby-weather="ready"]'));await denied.evaluate(()=>{window.__weatherMode='forbidden';const originalNow=Date.now;Date.now=()=>originalNow()+31*60*1000;window.dispatchEvent(new Event('online'));});await denied.waitForFunction(()=>document.querySelector('[data-standby-type="weather"]')?.textContent.includes('準備中'));assert.ok(!(await denied.$eval('[data-standby-type="weather"]',n=>n.textContent)).includes('25'));assert.equal(await denied.evaluate(()=>window.__weatherRequests.length),2);await denied.browserContext().close();record('Access-denied refresh clears previously cached forecast instead of leaving unauthorized temperatures');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(await hashes(),beforeHashes);
  await writeFile(join(output,'verification-summary.json'),JSON.stringify({passed:true,checks,layoutBounds,errors,external,unexpected,sourceHashes:beforeHashes},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,output}));
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
