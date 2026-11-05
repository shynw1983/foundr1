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
const output = resolve(args.output || 'outputs/pos-display-traverse-ui');
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

const record=(name,detail)=>checks.push({name,...(detail?{detail}:{})});
const words=['Welcome','いらっしゃいませ','欢迎光临','歡迎光臨','환영합니다','Xin chào','स्वागतम्'];
const editorWords=['Welcome','いらっしゃいませ','A very long warm welcome'];
const sizes=[12,null,4];
const getSettings=page=>page.evaluate(()=>window.__settings);
async function selectBlock(page,id){await page.select('[data-standby-select]',id);await pause(30);}
async function addBlock(page,type){await nativeClick(page,`[data-standby-add="${type}"]`);return page.$eval('[data-standby-select]',n=>n.value);}
async function save(page){await nativeClick(page,'[data-standby-save]');await waitSaved(page);}
async function replaceText(page,value){const selector=section+' [name="standby-text"]';await nativeClick(page,selector);await page.$eval(selector,n=>n.select());await page.keyboard.sendCharacter(value);await page.keyboard.press('Tab');}
async function readSizes(page){return page.$$eval('input[data-standby-word-font-size]',nodes=>nodes.map(n=>n.closest('label')?.querySelector('small')?.textContent==='基本サイズ'?null:Number(n.value)));}
async function setSizes(page,values){await nativeClick(page,'[data-standby-word-sizes-reset]');for(let i=0;i<values.length;i++)if(values[i]!=null)await input(page,`standby-wordFontSize-${i}`,values[i]);}
async function assertSafe(page){const value=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,writes:window.__writes,denied:window.__denied,native:window.__native}));assert.ok(value.scroll<=value.width+1,`page overflow ${JSON.stringify(value)}`);assert.deepEqual(value.denied,[]);assert.deepEqual(value.native,[]);return value;}
async function runtime(page,seed,{weather='ready',reduced=false,date}={}){
  if(reduced)await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.emulateTimezone('America/Los_Angeles');
  await page.evaluateOnNewDocument(({weather,date})=>{if(date){const NativeDate=Date;class FixtureDate extends NativeDate{constructor(...args){super(...(args.length?args:[date]));}static now(){return new NativeDate(date).getTime();}}window.Date=FixtureDate;}addEventListener('DOMContentLoaded',()=>{window.__weatherMode=weather;});},{weather,date});
  await page.goto(origin+'/store/pos/customer-display?storeId='+storeA+'&weather='+weather,{waitUntil:'domcontentloaded'});await page.waitForSelector('[data-standby-canvas]');
}
function block(id,type,geometry,values={}){return{id,type,x:4,y:4,width:92,height:12,fontSize:6,fontFamily:'standard',color:'#20332e',align:'center',text:'',imageUrl:'',showDate:false,...geometry,...values};}
function demonstration(settings,{motion='gentle',custom=true}={}){const result=structuredClone(settings);for(const store of Object.values(result)){
 const standby=store.customerDisplayMediaSettings.standby;standby.enabled=true;
 const fontSizes=custom?[8,5,7,6,4,7,null]:undefined;
 standby.layouts.landscape=[block('date','date',{x:4,y:4,width:46,height:12,fontSize:6},{showYear:true,fontFamily:'georgia'}),block('clock','clock',{x:54,y:4,width:42,height:12,fontSize:8},{fontFamily:'georgia'}),block('cloud','wordCloud',{x:0,y:21,width:100,height:41,fontSize:7},{text:words.join('\n'),fontFamily:'georgia',animationSeconds:24,motion,wordSizeMode:'uniform',...(fontSizes?{wordFontSizes:fontSizes}:{})}),block('messages','messages',{x:4,y:66,width:92,height:9,fontSize:5},{text:'どうぞごゆっくり\n今日も素敵な一日を',animationSeconds:8,motion:'gentle'}),block('weather','weather',{x:4,y:77,width:92,height:20,fontSize:5})];
 standby.layouts.portrait=[block('date','date',{x:4,y:3,width:92,height:6,fontSize:5},{showYear:true,fontFamily:'georgia'}),block('clock','clock',{x:4,y:10,width:92,height:7,fontSize:7},{fontFamily:'georgia'}),block('cloud','wordCloud',{x:0,y:22,width:100,height:43,fontSize:7},{text:words.join('\n'),fontFamily:'georgia',animationSeconds:24,motion,wordSizeMode:'uniform',...(fontSizes?{wordFontSizes:fontSizes}:{})}),block('messages','messages',{x:4,y:69,width:92,height:9,fontSize:5},{text:'どうぞごゆっくり\n今日も素敵な一日を',animationSeconds:8,motion:'gentle'}),block('weather','weather',{x:4,y:83,width:92,height:14,fontSize:4})];
}return result;}
async function wordBounds(page){return page.$$eval('[data-standby-word]',nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{text:n.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,font:parseFloat(getComputedStyle(n).fontSize),weight:getComputedStyle(n).fontWeight};}));}
async function fontProof(page,custom=true){await page.waitForFunction(()=>document.querySelector('[data-standby-flow-ready="true"]'));const detail=await page.$eval('[data-standby-type="wordCloud"]',host=>({base:parseFloat(getComputedStyle(host).fontSize),font:getComputedStyle(host).fontFamily}));const actual=[...new Map((await wordBounds(page)).map(word=>[word.text,word])).values()];const values=custom?[8,5,7,6,4,7,null]:words.map(()=>null);assert.deepEqual(actual.map(x=>x.text),words);for(let i=0;i<actual.length;i++){const expected=detail.base*(values[i]??7)/7;assert.ok(Math.abs(actual[i].font-expected)<.08,`word size changed by language/length/randomness ${JSON.stringify({i,actual:actual[i],expected,detail})}`);}assert.match(detail.font,/Georgia/);return{...detail,words:actual};}
async function samplePhase(page,phase){await page.waitForFunction(()=>document.querySelector('[data-standby-flow-ready="true"]'));return page.evaluate(phase=>{const plane=document.querySelector('[data-standby-flow-plane]'),animation=plane?.getAnimations().find(a=>a.effect.getTiming().iterations===Infinity);if(!animation)throw new Error('Missing real shared-plane animation');const timing=animation.effect.getTiming(),duration=Number(timing.duration);animation.pause();animation.currentTime=Number(timing.delay||0)+duration*(2+phase);return[...document.querySelectorAll('[data-standby-word]')].map(n=>{const r=n.getBoundingClientRect();return{text:n.textContent,left:r.left,right:r.right,width:r.width,top:r.top,bottom:r.bottom,duration,delay:timing.delay,direction:timing.direction,easing:timing.easing,progress:animation.effect.getComputedTiming().progress};});},phase);}
async function canvasBounds(page){return page.$eval('[data-standby-canvas]',n=>{const r=n.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};});}
async function assertTraverse(page){const canvas=await canvasBounds(page),phases=[0,.1,.3,.5,.7,.9,.999999],samples=[];for(const phase of phases)samples.push({phase,words:await samplePhase(page,phase)});const first=samples[0].words;for(let i=0;i<first.length;i++){const positions=samples.map(s=>s.words[i]);for(let j=1;j<positions.length;j++)assert.ok(positions[j].left>positions[j-1].left,`shared plane reversed ${JSON.stringify({i,positions})}`);const distance=positions.at(-1).left-positions[0].left;for(let j=1;j<samples.length-1;j++){const expected=positions[0].left+distance*samples[j].phase;assert.ok(Math.abs(positions[j].left-expected)<1,'shared plane is not linear');}for(const position of positions)assert.equal(position.direction,'normal');if(i)assert.ok(Math.abs(distance-(samples.at(-1).words[0].left-first[0].left))<.1,'phrases move independently instead of sharing one scrolling plane');}const afterLoop=await samplePhase(page,1.000001);for(let i=0;i<afterLoop.length;i++)assert.ok(Math.abs(afterLoop[i].left-first[i].left)<1,'shared plane does not repeat at its cycle boundary');await samplePhase(page,.5);return{canvas,samples,afterLoop};}
async function fittedText(page){return page.$$eval('[data-standby-block]',nodes=>nodes.filter(n=>!['wordCloud','image'].includes(n.dataset.standbyType)).map(n=>{const host=n.getBoundingClientRect(),walker=document.createTreeWalker(n,NodeFilter.SHOW_TEXT),boxes=[];let item;while(item=walker.nextNode()){if(!item.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(item);for(const r of range.getClientRects())boxes.push({left:r.left,top:r.top,right:r.right,bottom:r.bottom,text:item.textContent});}return{type:n.dataset.standbyType,host:{left:host.left,top:host.top,right:host.right,bottom:host.bottom},boxes,fits:boxes.every(r=>r.left>=host.left-1&&r.right<=host.right+1&&r.top>=host.top-1&&r.bottom<=host.bottom+1)};}));}
async function setVisibility(page,hidden){await page.evaluate(hidden=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});document.dispatchEvent(new Event('visibilitychange'));},hidden);}
let editor,saved,demo;
try{
 editor=await newPage({width:1024,height:768});await editor.goto(origin+'/os/pos',{waitUntil:'domcontentloaded'});await ready(editor);const legacy=await getSettings(editor);
 const cloud=await addBlock(editor,'wordCloud');await replaceText(editor,editorWords.join('\n'));await input(editor,'standby-fontSize','7');await setSizes(editor,sizes);assert.deepEqual(await readSizes(editor),sizes);record('Every phrase has its own size control and the basic-size label identifies inherited common size');
 await replaceText(editor,['欢迎光临',...editorWords].join('\n'));assert.deepEqual(await readSizes(editor),[null,12,null,4]);await replaceText(editor,[editorWords[2],editorWords[0],'欢迎光临',editorWords[1]].join('\n'));assert.deepEqual(await readSizes(editor),[4,12,null,null]);await replaceText(editor,[editorWords[2],'欢迎光临',editorWords[1]].join('\n'));assert.deepEqual(await readSizes(editor),[4,null,null]);record('A single textarea replacement retains unchanged phrase sizes across insertion/reorder/deletion; new phrases inherit');
 await replaceText(editor,editorWords.join('\n'));await setSizes(editor,sizes);await nativeClick(editor,'[data-standby-word-sizes-reset]');assert.deepEqual(await readSizes(editor),[null,null,null]);await input(editor,'standby-fontSize','8');assert.deepEqual(await readSizes(editor),[null,null,null]);assert.deepEqual(await editor.$$eval('input[data-standby-word-font-size]',nodes=>nodes.map(n=>Number(n.value))),[8,8,8]);await input(editor,'standby-fontSize','7');await setSizes(editor,sizes);record('Reset clears all per-phrase overrides and changing common size updates every inherited control');
 assert.equal(await editor.$eval('[data-standby-animation-preview]',n=>n.getAttribute('aria-pressed')),'true');await nativeClick(editor,'[data-standby-animation-preview]');await editor.waitForFunction(()=>document.querySelector('[data-standby-animation-preview]')?.getAttribute('aria-pressed')==='false');
 assert.equal(await editor.$eval('[data-standby-animation-preview]',n=>n.getAttribute('aria-pressed')),'false');assert.equal(await editor.$eval('[data-standby-ambient="wordCloud"]',n=>n.dataset.standbyPaused),'true');for(const name of ['standby-x','standby-width'])assert.equal(await editor.$eval(`[name="${name}"]`,n=>n.matches(':disabled')),true);
 await nativeClick(editor,'[data-standby-animation-preview]');await editor.waitForFunction(()=>document.querySelector('[data-standby-animation-preview]')?.getAttribute('aria-pressed')==='true');await editor.waitForFunction(()=>document.querySelector('[data-standby-ambient="wordCloud"]')?.dataset.standbyPaused==='false');await selectBlock(editor,'clock');await selectBlock(editor,cloud);assert.equal(await editor.$eval('[data-standby-animation-preview]',n=>n.getAttribute('aria-pressed')),'false');record('Selected cloud stays static for editing; explicit preview runs it and selecting another block resets the preview');
 await nativeClick(editor,'[data-standby-enable]');await save(editor);let payload=await editor.evaluate(()=>window.__writes.at(-1));assert.equal(payload.section,'customerDisplayStandby');assert.deepEqual(payload.customerDisplayStandby.layouts.portrait.find(b=>b.id===cloud).wordFontSizes,sizes);assert.deepEqual(payload.customerDisplayStandby.layouts.landscape,legacy[storeA].customerDisplayMediaSettings.standby.layouts.landscape);
 await editor.reload({waitUntil:'domcontentloaded'});await ready(editor);await selectBlock(editor,cloud);assert.deepEqual(await readSizes(editor),sizes);assert.equal(await editor.$eval('[name="standby-text"]',n=>n.value),editorWords.join('\n'));record('Per-phrase sizes persist through actual OS save and reload; untouched landscape and legacy blocks remain unchanged');
 await nativeClick(editor,'[data-standby-orientation="landscape"]');const landscapeCloud=await addBlock(editor,'wordCloud');await replaceText(editor,'Welcome\n欢迎光临');await setSizes(editor,[6,9]);await save(editor);saved=await getSettings(editor);assert.deepEqual(saved[storeA].customerDisplayMediaSettings.standby.layouts.portrait.find(b=>b.id===cloud).wordFontSizes,sizes);assert.deepEqual(saved[storeA].customerDisplayMediaSettings.standby.layouts.landscape.find(b=>b.id===landscapeCloud).wordFontSizes,[6,9]);record('Portrait and landscape keep independent per-phrase sizes');
 for(const viewport of viewports){await editor.setViewport(viewport);await editor.$eval('[data-standby-inspector]',n=>n.scrollIntoView({block:'center'}));const controls=await editor.$$eval(`${section} input,${section} select,${section} textarea,${section} button`,nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{left:r.left,right:r.right};}));assert.ok(controls.every(r=>r.left>=-1&&r.right<=viewport.width+1),`editor overflow ${JSON.stringify({viewport,controls})}`);await assertSafe(editor);await editor.screenshot({path:join(output,`editor-traverse-${viewport.width}x${viewport.height}.png`)});record('Per-phrase inspector fits viewport',viewport);}
 const readonly=await newPage({width:896,height:414},saved);await readonly.goto(origin+'/os/pos?readonly=1',{waitUntil:'domcontentloaded'});await ready(readonly);await selectBlock(readonly,cloud);assert.equal(await readonly.$eval('input[data-standby-word-font-size]',n=>n.matches(':disabled')),true);assert.equal(await readonly.$eval('[data-standby-word-sizes-reset]',n=>n.matches(':disabled')),true);assert.deepEqual(await readonly.evaluate(()=>window.__writes),[]);await readonly.browserContext().close();record('Read-only users cannot modify individual phrase sizes');
 const chinese=await newPage({width:414,height:896},saved);await chinese.goto(origin+'/os/pos?lang=zh-Hans',{waitUntil:'domcontentloaded'});await ready(chinese);await chinese.waitForFunction(text=>document.querySelector('#standby-heading')?.textContent===text,{},chineseDictionary['客席表示の待機画面']);await selectBlock(chinese,cloud);await replaceText(chinese,'日付\nWelcome');await pause(200);const ownedPhrase=await chinese.$eval('[data-standby-inspector] [title="日付"]',n=>({title:n.title,text:[...n.childNodes].filter(c=>c.nodeType===Node.TEXT_NODE).map(c=>c.textContent).join('')}));assert.deepEqual(ownedPhrase,{title:'日付',text:'日付'});assert.equal(await chinese.$eval('[name="standby-text"]',n=>n.value),'日付\nWelcome');await chinese.browserContext().close();record('Chinese OS translates controls while owner phrase matching a UI dictionary key keeps its original Japanese text and title');
 demo=demonstration(saved);const fixedDate='2026-10-21T15:05:00.000Z';
 for(const viewport of viewports){const page=await newPage(viewport,demo);await runtime(page,demo,{date:fixedDate});await page.waitForFunction(()=>document.querySelector('[data-standby-type="weather"]')?.textContent.includes('25'));const fonts=await fontProof(page);const traverse=await assertTraverse(page);await pause(900);const textBounds=await fittedText(page);assert.ok(textBounds.every(b=>b.fits),`other widgets clipped ${JSON.stringify({viewport,textBounds})}`);const dateText=await page.$eval('[data-standby-type="date"]',n=>n.textContent);assert.match(dateText,/2026/);assert.ok(dateText.includes('22'));assert.match(await page.$eval('[data-standby-type="clock"]',n=>n.textContent),/00:05/);const weatherText=await page.$eval('[data-standby-type="weather"]',n=>n.textContent);for(const value of ['予報','25','18','気象庁'])assert.ok(weatherText.includes(value));assert.deepEqual((await assertSafe(page)).writes,[]);layoutBounds.push({viewport,fonts,traverse,textBounds,dateText,weatherText});await page.screenshot({path:join(output,`runtime-traverse-${viewport.width}x${viewport.height}.png`)});record('Real shared-plane CSS animation moves all phrase copies rightward linearly, repeats seamlessly and preserves each requested font size',viewport);await page.browserContext().close();}
 const defaults=demonstration(saved,{custom:false});const plain=await newPage({width:896,height:414},defaults);await runtime(plain,defaults);const noShrink=await fontProof(plain,false);assert.ok(new Set(noShrink.words.map(w=>w.font)).size===1);await plain.browserContext().close();record('Explicit uniform mode keeps every language at the common size despite different phrase lengths');
 const longSeed=demonstration(saved);const longPhrase='Welcome to our warm restaurant and enjoy a comforting bowl of delicious malatang';for(const layouts of Object.values(longSeed[storeA].customerDisplayMediaSettings.standby.layouts)){const cloud=layouts.find(b=>b.type==='wordCloud');cloud.text=longPhrase;cloud.wordFontSizes=[20];}const longPage=await newPage({width:808,height:320},longSeed);await runtime(longPage,longSeed);await longPage.waitForFunction(()=>document.querySelector('[data-standby-flow-ready="true"]'));const longWord=(await wordBounds(longPage))[0],longBase=await longPage.$eval('[data-standby-type="wordCloud"]',n=>parseFloat(getComputedStyle(n).fontSize));assert.ok(Math.abs(longWord.font-longBase*20/7)<.08);assert.ok(longWord.width>808);const longTraverse=await assertTraverse(longPage);assert.deepEqual((await assertSafe(longPage)).writes,[]);layoutBounds.push({kind:'long-phrase-exact-size',word:longWord,traverse:longTraverse});await longPage.browserContext().close();record('A maximum-size phrase wider than the display keeps its requested size while the shared plane crosses and repeats');
 for(const reduced of [false,true]){const staticSeed=demonstration(saved,{motion:reduced?'gentle':'still'});const page=await newPage({width:896,height:414},staticSeed);await runtime(page,staticSeed,{reduced});await page.waitForFunction(()=>document.querySelector('[data-standby-ambient="wordCloud"]')?.dataset.standbyPaused==='true');const fonts=await page.$$eval('[data-standby-word]',nodes=>nodes.map(n=>({text:n.textContent,size:parseFloat(getComputedStyle(n).fontSize),mode:n.dataset.standbyFontMode,requested:n.dataset.standbyRequestedFontSize})));const canvas=await canvasBounds(page),bounds=await wordBounds(page);assert.ok(bounds.every(w=>w.left>=canvas.left-1&&w.right<=canvas.right+1&&w.top>=canvas.top-1&&w.bottom<=canvas.bottom+1),`static words not readable ${JSON.stringify({reduced,canvas,bounds})}`);const animations=await page.$$eval('[data-standby-word]',nodes=>nodes.flatMap(n=>{const a=[];let target=n;while(target&&!a.length){a.push(...target.getAnimations({subtree:false}));target=target.parentElement;}return a.map(x=>({state:x.playState,name:getComputedStyle(n).animationName}));}));assert.ok(animations.every(a=>a.state==='paused'||a.name==='none'));await page.screenshot({path:join(output,`static-${reduced?'reduced':'saved'}-896x414.png`)});await page.browserContext().close();record('Static and reduced-motion modes show readable stationary phrases in a fitted overview',{reduced,fonts});}
 const live=await newPage({width:896,height:414},demo);await runtime(live,demo);await live.waitForFunction(()=>document.querySelector('[data-standby-flow-ready="true"]'));const start=await wordBounds(live);await pause(350);const next=await wordBounds(live);for(let i=0;i<start.length;i++)assert.ok(next[i].left>=start[i].left-.1,`live movement reversed ${JSON.stringify({i,start:start[i],next:next[i]})}`);assert.ok(next.some((word,i)=>word.left>start[i].left+.1),'no phrase moved rightwards');const message=await live.$eval('[data-standby-message]',n=>n.textContent);await live.waitForFunction(message=>document.querySelector('[data-standby-message]')?.textContent!==message,{timeout:12000},message);assert.equal(await live.$$eval('[data-standby-message]',nodes=>nodes.length),1);await setVisibility(live,true);await live.waitForFunction(()=>document.querySelector('[data-standby-ambient="wordCloud"]')?.dataset.standbyPaused==='true');await pause(100);const hidden=await wordBounds(live);await pause(250);assert.deepEqual(await wordBounds(live),hidden);assert.equal(await live.evaluate(()=>window.__weatherRequests.length),1);await live.browserContext().close();record('Real-time movement is rightward, hidden display pauses, rotating messages and weather cache still work');
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
