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
const output = resolve(args.output || 'outputs/pos-display-fonts-ui');
await mkdir(output, { recursive: true });
const require = createRequire(join(source, 'package.json'));
const { build, stop } = require('esbuild');
const puppeteer = require('puppeteer-core');
let sourceFiles = [
  'app/os/pos/page.tsx', 'app/os/pos/PosDisplayStandbyEditor.tsx',
  'components/pos/PosDisplayStandbyCanvas.tsx', 'components/pos/PosDisplayStandbyCanvas.module.css',
  'app/os/pos/PosDisplayStandbyEditor.module.css', 'app/store/pos/customer-display/CustomerDisplayStandby.module.css',
  'app/store/pos/customer-display/CustomerDisplayWorkspace.tsx', 'lib/pos-display-standby.ts', 'lib/pos-display-standby-i18n.ts', 'app/os/components/OsTranslationProvider.tsx', 'public/locales/os/zh-Hans.json', 'public/locales/os/zh-Hant.json', 'public/locales/os/zh.json', 'app/globals.css', 'scripts/tests/pos-display-fonts-ui.mjs'
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
window.__settings=JSON.parse(localStorage.getItem('font-fixture-settings')||'null')||{[storeA]:settings(storeA),[storeB]:settings(storeB)};
if(query.get('legacy')==='1')for(const store of Object.values(window.__settings))for(const blocks of Object.values(store.customerDisplayMediaSettings.standby.layouts))for(const block of blocks)delete block.fontFamily;
window.__settings[storeB].customerDisplayMediaSettings.standby.layouts.portrait.find(b=>b.type==='text').text='B の待機画面';
window.__settings[storeB].customerDisplayMediaSettings.standby.backgroundColor='#f3f3ed';
window.__writes=[];window.__requests=[];window.__denied=[];window.__native=[];window.__subscriptions=[];window.__uploads=[];
window.__holdSave=false;window.__saveFailure=false;window.__holdUpload=false;window.__canManage=query.get('readonly')!=='1';
window.Foundr1Android=new Proxy({}, {get:(_,name)=>(...args)=>{window.__native.push({name,args});throw new Error('Native use is forbidden by this fixture')}});
window.__displaySettings=structuredClone(window.__settings[storeA].customerDisplayMediaSettings);
window.__displaySettings.standby.enabled=query.get('disabled')!=='1';

const originalFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input.url,location.origin);if(!url.pathname.startsWith('/api/'))return originalFetch(input,init);
 const method=init?.method||'GET';window.__requests.push({path:url.pathname,query:url.search,method});
 const id=url.searchParams.get('storeId')||storeA;
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
   window.__settings[body.storeId]=next;localStorage.setItem('font-fixture-settings',JSON.stringify(window.__settings));return Response.json({ok:true,settings:next});
  }
  return Response.json({access:{canManagePosSettings:window.__canManage},settings:window.__settings[id]});
 }
 if(url.pathname==='/api/store/pos/customer-display')return Response.json({selectedStoreId:id,access:{stores},state:{status:'idle',items:[]},customerDisplayMediaSettings:window.__displaySettings,...(url.searchParams.get('debug')==='1'?{debugMode:true}:{})});
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
  if(seed)await page.evaluateOnNewDocument(seed=>localStorage.setItem('font-fixture-settings',JSON.stringify(seed)),seed);
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

const fontSelector = '[name="standby-fontFamily"]';
const record = (name, detail) => checks.push({name, ...(detail ? {detail} : {})});
const fonts = page => page.$$eval('[data-standby-canvas] [data-standby-block]', nodes => Object.fromEntries(nodes.filter(n=>n.dataset.standbyType!=='image').map(node=>[node.dataset.standbyBlock,{fontFamily:getComputedStyle(node.querySelector('span')||node).fontFamily,inline:(node.querySelector('span')||node).style.fontFamily,fontWeight:getComputedStyle(node.querySelector('span')||node).fontWeight,dateFont:node.querySelector('small')?getComputedStyle(node.querySelector('small')).fontFamily:null,type:node.dataset.standbyType}])));
const layout = async (page, orientation) => page.evaluate(({storeA,orientation})=>window.__settings[storeA].customerDisplayMediaSettings.standby.layouts[orientation],{storeA,orientation});
const stateLayout = page => page.$$eval('[data-standby-block]', nodes=>nodes.map(n=>({id:n.dataset.standbyBlock,style:[n.style.left,n.style.top,n.style.width,n.style.height,n.style.fontSize,n.style.color,n.style.textAlign],text:n.dataset.standbyType==='clock'?'<live-clock>':n.textContent})));
const withSettings = (settings, change) => {const next=structuredClone(settings);change(next[storeA].customerDisplayMediaSettings.standby);return next;};
async function selectBlock(page,id){await page.select('[data-standby-select]',id);await pause(30);}
async function selectFont(page,family){await page.select(fontSelector,family);await page.waitForFunction(({fontSelector,family})=>document.querySelector(fontSelector)?.value===family,{}, {fontSelector,family});}
async function assertPageSafe(page){
  const detail=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,denied:window.__denied,native:window.__native,writes:window.__writes}));
  assert.ok(detail.scroll<=detail.width+1,`page overflow ${JSON.stringify(detail)}`);assert.deepEqual(detail.denied,[]);assert.deepEqual(detail.native,[]);return detail;
}
async function assertFitted(page){
  const details=await page.$$eval('[data-standby-canvas] [data-standby-block]',nodes=>nodes.filter(n=>n.dataset.standbyType!=='image').map(n=>{
    const block=n.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(n);const boxes=[...range.getClientRects()].filter(r=>r.width&&r.height);return{id:n.dataset.standbyBlock,block:{left:block.left,top:block.top,right:block.right,bottom:block.bottom},boxes:boxes.map(r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom})),fits:boxes.every(r=>r.left>=block.left-1&&r.right<=block.right+1&&r.top>=block.top-1&&r.bottom<=block.bottom+1)};
  }));
  assert.ok(details.every(x=>x.fits),`text clipped ${JSON.stringify(details)}`);return details;
}
let editor, saved;
try {
  editor=await newPage({width:1024,height:768});await editor.goto(origin+'/os/pos',{waitUntil:'domcontentloaded'});await ready(editor);
  await selectBlock(editor,'clock');
  assert.equal(await editor.$eval(fontSelector,n=>n.closest('label').textContent.includes('フォント')),true);
  assert.deepEqual(await editor.$$eval(`${fontSelector} option`,nodes=>nodes.map(n=>({value:n.value,text:n.textContent}))),[{value:'standard',text:'シンプル（標準）'},{value:'georgia',text:'クラシック（Georgia）'}]);
  assert.equal(await editor.$eval(fontSelector,n=>n.value),'standard');
  const originalPortrait=await stateLayout(editor), originalFonts=await fonts(editor);
  await editor.$eval('[name="standby-height"]',n=>n.scrollIntoView({block:'center'}));await editor.focus('[name="standby-height"]');await editor.keyboard.press('Tab');assert.equal(await editor.$eval(fontSelector,n=>document.activeElement===n),true);await selectFont(editor,'georgia');
  await editor.waitForFunction(selector=>document.querySelector(selector)?.value==='georgia',{},fontSelector);
  let current=await fonts(editor);assert.match(current.clock.fontFamily,/^Georgia(?:,|$)/);assert.equal(current.welcome.fontFamily,originalFonts.welcome.fontFamily);assert.equal(current.store.fontFamily,originalFonts.store.fontFamily);assert.equal(current.clock.fontWeight,'400');assert.equal(current.clock.dateFont,originalFonts.clock.dateFont);
  assert.deepEqual(await stateLayout(editor),originalPortrait);
  record('Font select has a label and is keyboard reachable; clock changes to original Georgia weight while Japanese date, other blocks, text and geometry remain unchanged');
  await selectBlock(editor,'welcome');await selectFont(editor,'georgia');assert.match((await fonts(editor)).welcome.fontFamily,/^Georgia(?:,|$)/);assert.match((await fonts(editor)).clock.fontFamily,/^Georgia(?:,|$)/);
  await selectFont(editor,'standard');assert.equal((await fonts(editor)).welcome.fontFamily,originalFonts.welcome.fontFamily);assert.match((await fonts(editor)).clock.fontFamily,/^Georgia(?:,|$)/);
  record('Text and clock choose fonts independently; Standard restores prior inherited appearance');
  await nativeClick(editor,'[data-standby-orientation="landscape"]');await selectBlock(editor,'welcome');
  assert.equal(await editor.$eval(fontSelector,n=>n.value),'standard');await selectFont(editor,'georgia');await input(editor,'standby-text','Welcome');
  await selectBlock(editor,'clock');assert.equal(await editor.$eval(fontSelector,n=>n.value),'standard');
  await selectBlock(editor,'store');await selectFont(editor,'georgia');assert.match((await fonts(editor)).store.fontFamily,/^Georgia(?:,|$)/);await selectFont(editor,'standard');
  await selectBlock(editor,'image');assert.equal(await editor.$(fontSelector),null);
  record('Portrait and landscape fonts remain separate; store name supports font choice and image has no font control');
  await selectBlock(editor,'welcome');await nativeClick(editor,'[data-standby-enable]');await nativeClick(editor,'[data-standby-save]');await editor.waitForFunction(()=>window.__writes.length===1);await waitSaved(editor);
  const payload=await editor.evaluate(()=>window.__writes.at(-1));assert.equal(payload.section,'customerDisplayStandby');assert.equal(payload.storeId,storeA);
  const p=payload.customerDisplayStandby.layouts.portrait,l=payload.customerDisplayStandby.layouts.landscape;
  assert.equal(p.find(x=>x.id==='clock').fontFamily,'georgia');assert.equal(p.find(x=>x.id==='welcome').fontFamily,'standard');assert.equal(l.find(x=>x.id==='clock').fontFamily,'standard');assert.equal(l.find(x=>x.id==='welcome').fontFamily,'georgia');assert.equal(l.find(x=>x.id==='store').fontFamily,'standard');
  saved=await editor.evaluate(()=>window.__settings);assert.deepEqual(saved[storeA].customerDisplayMediaSettings.standby,payload.customerDisplayStandby);
  record('Actual OS dedicated save sends persisted per-block fonts in both orientations');
  await editor.reload({waitUntil:'domcontentloaded'});await ready(editor);await selectBlock(editor,'clock');assert.equal(await editor.$eval(fontSelector,n=>n.value),'georgia');
  await nativeClick(editor,'[data-standby-orientation="landscape"]');await selectBlock(editor,'welcome');assert.equal(await editor.$eval(fontSelector,n=>n.value),'georgia');await selectBlock(editor,'clock');assert.equal(await editor.$eval(fontSelector,n=>n.value),'standard');
  record('Reload reads saved font choices through actual OS normalization and inspector');
  const editorFonts={landscape:await fonts(editor)};await nativeClick(editor,'[data-standby-orientation="portrait"]');editorFonts.portrait=await fonts(editor);await nativeClick(editor,'[data-standby-orientation="landscape"]');await selectBlock(editor,'welcome');
  for(const viewport of viewports){
    await editor.setViewport(viewport);if(viewport.width===808)await editor.select('[data-standby-preview-target]','compact');else await editor.select('[data-standby-preview-target]','phone');
    await editor.$eval(fontSelector,n=>n.scrollIntoView({block:'center'}));await pause(40);
    const controls=await editor.$$eval(`${section} input,${section} select,${section} textarea,${section} button`,nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{left:r.left,right:r.right};}));
    assert.ok(controls.every(r=>r.left>=-1&&r.right<=viewport.width+1),`editor controls overflow ${JSON.stringify({viewport,controls})}`);await assertPageSafe(editor);
    await editor.screenshot({path:join(output,`editor-fonts-${viewport.width}x${viewport.height}.png`)});record('Font inspector fits responsive viewport',viewport);
    const display=await newPage(viewport,saved);await display.goto(origin+'/store/pos/customer-display?storeId='+storeA,{waitUntil:'domcontentloaded'});await display.waitForSelector('[data-standby-canvas]');
    const orientation=viewport.width>viewport.height?'landscape':'portrait';assert.equal(await display.$eval('[data-standby-canvas]',n=>n.dataset.standbyLayout),orientation);
    const runtimeFonts=await fonts(display);for(const id of Object.keys(runtimeFonts))assert.equal(runtimeFonts[id].fontFamily,editorFonts[orientation][id].fontFamily);
    assert.equal(await display.$('[data-standby-guide]'),null);assert.equal(await display.$('[data-standby-canvas] button'),null);await assertFitted(display);const safe=await assertPageSafe(display);assert.deepEqual(safe.writes,[]);
    layoutBounds.push({kind:'runtime',viewport,orientation,fonts:runtimeFonts});await display.screenshot({path:join(output,`runtime-fonts-${viewport.width}x${viewport.height}.png`)});await display.browserContext().close();record('Runtime uses identical per-block fonts and fitted content without business/native writes',viewport);
  }
  const readonly=await newPage({width:896,height:414},saved);await readonly.goto(origin+'/os/pos?readonly=1',{waitUntil:'domcontentloaded'});await ready(readonly);await selectBlock(readonly,'clock');
  assert.equal(await readonly.$eval(fontSelector,n=>n.matches(':disabled')),true);assert.equal(await readonly.$eval('[data-standby-save]',n=>n.matches(':disabled')),true);const previous=await fonts(readonly);
  await readonly.focus(fontSelector);await readonly.keyboard.press('End');await readonly.keyboard.press('Tab');assert.deepEqual(await fonts(readonly),previous);assert.deepEqual(await readonly.evaluate(()=>window.__writes),[]);await readonly.browserContext().close();record('Read-only font selector cannot be changed through keyboard and cannot save');
  const plain=withSettings(saved,setting=>{for(const blocks of Object.values(setting.layouts))for(const b of blocks)b.fontFamily='standard';});
  const explicit=await newPage({width:896,height:414},plain);await explicit.goto(origin+'/store/pos/customer-display?storeId='+storeA,{waitUntil:'domcontentloaded'});await explicit.waitForSelector('[data-standby-canvas]');const explicitFonts=await fonts(explicit),explicitLayout=await stateLayout(explicit);
  const legacy=await newPage({width:896,height:414},plain);await legacy.goto(origin+'/store/pos/customer-display?storeId='+storeA+'&legacy=1',{waitUntil:'domcontentloaded'});await legacy.waitForSelector('[data-standby-canvas]');assert.deepEqual(await fonts(legacy),explicitFonts);assert.deepEqual(await stateLayout(legacy),explicitLayout);await assertPageSafe(legacy);
  await legacy.screenshot({path:join(output,'legacy-standard-runtime-896x414.png')});await explicit.browserContext().close();await legacy.browserContext().close();record('Legacy saved blocks without fontFamily render exactly the same computed font stack and layout as Standard');
  const chinese=await newPage({width:414,height:896},saved);await chinese.goto(origin+'/os/pos?lang=zh-Hans',{waitUntil:'domcontentloaded'});await ready(chinese);await chinese.waitForFunction(text=>document.querySelector('#standby-heading')?.textContent===text,{},chineseDictionary['客席表示の待機画面']);await selectBlock(chinese,'clock');
  for(const key of ['フォント','シンプル（標準）','クラシック（Georgia）'])assert.ok(chineseDictionary[key],`missing dictionary ${key}`);
  assert.deepEqual(await chinese.$$eval(`${fontSelector} option`,nodes=>nodes.map(n=>n.textContent)),['シンプル（標準）','クラシック（Georgia）'].map(x=>chineseDictionary[x]));await assertPageSafe(chinese);await chinese.browserContext().close();record('Font labels translate in Chinese while author-controlled customer text is unchanged');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(await hashes(),beforeHashes);
  await writeFile(join(output,'verification-summary.json'),JSON.stringify({passed:true,checks,layoutBounds,errors,external,unexpected,sourceHashes:beforeHashes},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,output}));
} catch(error){
  if(activePage&&!activePage.isClosed())await activePage.screenshot({path:join(output,'failure.png'),fullPage:true}).catch(()=>{});
  await writeFile(join(output,'verification-summary.json'),JSON.stringify({passed:false,checks,layoutBounds,error:error.stack,errors,external,unexpected,sourceHashes:beforeHashes},null,2));throw error;
} finally {await browser.close();await new Promise(ok=>server.close(ok));stop();}
