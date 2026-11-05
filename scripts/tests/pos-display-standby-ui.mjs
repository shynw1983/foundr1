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
const output = resolve(args.output || 'outputs/pos-display-standby-ui');
await mkdir(output, { recursive: true });
const require = createRequire(join(source, 'package.json'));
const { build, stop } = require('esbuild');
const puppeteer = require('puppeteer-core');
const sourceFiles = [
  'app/os/pos/page.tsx', 'app/os/pos/PosDisplayStandbyEditor.tsx',
  'components/pos/PosDisplayStandbyCanvas.tsx', 'components/pos/PosDisplayStandbyCanvas.module.css',
  'app/os/pos/PosDisplayStandbyEditor.module.css', 'app/store/pos/customer-display/CustomerDisplayStandby.module.css',
  'app/store/pos/customer-display/CustomerDisplayWorkspace.tsx', 'lib/pos-display-standby.ts', 'lib/pos-display-standby-i18n.ts'
];
const chineseDictionary = JSON.parse(await readFile(join(source,'public/locales/os/zh-Hans.json'),'utf8'));
const hashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash('sha256').update(await readFile(join(source, path))).digest('hex')])));
const beforeHashes = await hashes();
const storeA = '11111111-1111-4111-8111-111111111111';
const storeB = '22222222-2222-4222-8222-222222222222';
const debugSession = '33333333-3333-4333-8333-333333333333';
const viewports = [{ width: 390, height: 844 }, { width: 414, height: 896 }, { width: 800, height: 1100 }, { width: 1366, height: 900 }];
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
window.__settings={[storeA]:settings(storeA),[storeB]:settings(storeB)};
window.__settings[storeB].customerDisplayMediaSettings.standby.layouts.portrait.find(b=>b.type==='text').text='B の待機画面';
window.__settings[storeB].customerDisplayMediaSettings.standby.backgroundColor='#f3f3ed';
window.__writes=[];window.__requests=[];window.__denied=[];window.__native=[];window.__subscriptions=[];window.__uploads=[];
window.__holdSave=false;window.__saveFailure=false;window.__holdUpload=false;window.__canManage=query.get('readonly')!=='1';
window.Foundr1Android=new Proxy({}, {get:(_,name)=>(...args)=>{window.__native.push({name,args});throw new Error('Native use is forbidden by this fixture')}});
window.__displaySettings=structuredClone(window.__settings[storeA].customerDisplayMediaSettings);
window.__displaySettings.standby.enabled=query.get('disabled')!=='1';
for(const orientation of ['portrait','landscape']){const text=window.__displaySettings.standby.layouts[orientation].find(b=>b.type==='text');text.text=orientation==='portrait'?'縦の歓迎メッセージ':'横の歓迎メッセージ';window.__displaySettings.standby.layouts[orientation].find(b=>b.type==='image').imageUrl='/fixture-logo.png';}
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
   window.__settings[body.storeId]=next;return Response.json({ok:true,settings:next});
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
const bundle = await build({ stdin: { contents: entry, resolveDir: source, loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'local-standby-adapters', setup(builder) {
  builder.onResolve({ filter: /(?:\/|^)components\/(?:UserBadge|OsNavList|MobileNavMenu)$/ }, args => ({ path: args.path, namespace: 'fixture-shell' }));
  builder.onLoad({ filter: /.*/, namespace: 'fixture-shell' }, () => ({ contents: 'export function UserBadge(){return null}export function OsNavList(){return null}export function MobileNavMenu(){return null}', loader: 'js' }));
  builder.onResolve({ filter: /\/shared-pusher-client$/ }, () => ({ path: 'pusher', namespace: 'fixture-pusher' }));
  builder.onLoad({ filter: /.*/, namespace: 'fixture-pusher' }, () => ({ contents: pusher, loader: 'js' }));
} }] });
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
async function newPage(viewport) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage(); activePage = page;
  page.setDefaultTimeout(12000); await page.setViewport(viewport);
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
  if(name==='standby-imageUrl')await page.keyboard.press('Tab');
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
const baseState = { status:'editing',storeName:'検証店舗 A',orderType:'eat_in',paymentMethod:'cash',paymentLabel:'現金',preferredLanguage:'ja',subtotal:1440,taxLabel:'内消費税 10%',taxAmount:131,cashTenderedAmount:2000,cashChangeAmount:560,discountName:'学割20%',discountAmount:360,items:[{name:'基礎麻辣湯',optionLabel:'牛筋 50g',weightLabel:'200g × ¥4/g',quantity:1,unitPrice:800,amount:1450},{name:'自家製レモン水',optionLabel:'',weightLabel:'',quantity:1,unitPrice:350,amount:350}]};
try {
  if(args.mode!=='runtime'){
  const editor=await newPage({width:800,height:1100});await editor.goto(origin+'/os/pos',{waitUntil:'domcontentloaded'});await ready(editor);
  // Editor behavior assertions follow below; this fixture uses the entire settings page.
  assert.equal(await editor.$eval('[data-standby-enable]',node=>node.checked),false);
  assert.equal((await editorBlocks(editor)).length,4);await screenshotEditor(editor,'editor-default');checks.push('existing stores default off; default clock/text/store/image editor fits all four viewports');

  await editor.setViewport({width:800,height:1100});await nativeClick(editor,'[data-standby-enable]');
  await nativeClick(editor,`${section} [data-standby-block="welcome"]`);await input(editor,'standby-text','本日もご来店ありがとうございます');
  await input(editor,'standby-fontSize','9');await input(editor,'standby-width','80');await input(editor,'standby-height','15');await input(editor,'standby-x','8');await input(editor,'standby-y','35');await editor.select('[name="standby-align"]','left');
  const welcomeSelector=`${section} [data-standby-block="welcome"]`;
  await editor.$eval(welcomeSelector,node=>node.scrollIntoView({block:'center'}));await pause(80);
  const dragStart=await editor.$eval(welcomeSelector,node=>{const r=node.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};});
  await editor.mouse.move(dragStart.x,dragStart.y);await editor.mouse.down();await editor.mouse.move(dragStart.x+10,dragStart.y+15,{steps:5});await editor.mouse.up();
  let moved=(await editorBlocks(editor)).find(block=>block.id==='welcome');assert.ok(parseFloat(moved.left)>8&&parseFloat(moved.top)>35,'native drag moves selected text: '+JSON.stringify({moved,fields:await editor.$$eval(`${section} input[name]`,nodes=>nodes.map(node=>({name:node.name,value:node.value})))}));
  const beforeKey=parseFloat(moved.left);await editor.keyboard.press('ArrowLeft');moved=(await editorBlocks(editor)).find(block=>block.id==='welcome');assert.equal(parseFloat(moved.left),beforeKey-1);
  const portrait=await editorBlocks(editor);checks.push('text content, size, geometry and alignment edit through controls; native pointer drag and keyboard movement update the preview');
  await nativeClick(editor,'[data-standby-orientation="landscape"]');assert.match((await editorBlocks(editor)).find(block=>block.id==='welcome').text,/いらっしゃいませ/);
  await nativeClick(editor,`${section} [data-standby-block="welcome"]`);await input(editor,'standby-text','横画面だけの挨拶');
  const added=[];
  for(const type of ['text','clock','image','storeName']){
    const priorIds=(await editorBlocks(editor)).map(block=>block.id);await nativeClick(editor,`[data-standby-add="${type}"]`);
    const block=(await editorBlocks(editor)).find(block=>!priorIds.includes(block.id));assert.ok(block&&block.type===type);added.push(block.id);
    if(type==='text')await input(editor,'standby-text','新しい文字');
    if(type==='clock'){assert.equal(await editor.$eval('[name="standby-showDate"]',node=>node.checked),true);await nativeClick(editor,'[name="standby-showDate"]');assert.equal(await editor.$eval('[name="standby-showDate"]',node=>node.checked),false);}
    if(type==='image'){await input(editor,'standby-imageUrl','/fixture-logo.png');await editor.waitForFunction(id=>document.querySelector(`[data-standby-block="${id}"] img`)?.naturalWidth>0,{},block.id);}
    if(type==='storeName')assert.match((await editorBlocks(editor)).find(item=>item.id===block.id).text,/検証店舗 A/);
  }
  assert.equal((await editorBlocks(editor)).length,8);
  for(const id of added){await editor.select('[data-standby-select]',id);await nativeClick(editor,'[data-standby-delete]');assert.ok(!(await editorBlocks(editor)).some(block=>block.id===id));}
  assert.equal((await editorBlocks(editor)).length,4);
  await nativeClick(editor,'[data-standby-orientation="portrait"]');assert.deepEqual(await editorBlocks(editor),portrait);
  await screenshotEditor(editor,'editor-edited');checks.push('text, clock, raster image and store-name blocks can be added, edited and deleted; landscape changes do not change portrait');

  // Saving this section must not save unrelated operational settings drafts.
  const taxInput='input[inputmode="decimal"]:not([name])';
  await nativeClick(editor,taxInput);await editor.$eval(taxInput,node=>node.select());await editor.keyboard.press('Backspace');await editor.type(taxInput,'9');
  const filterInput='#pos-scale-filter-settings input[name="filter-tolerance"]';await nativeClick(editor,filterInput);await editor.$eval(filterInput,node=>node.select());await editor.keyboard.press('Backspace');await editor.type(filterInput,'3');
  await editor.evaluate(()=>window.__holdSave=true);await nativeClick(editor,'[data-standby-save]');await editor.waitForFunction(()=>window.__writes.length===1);
  assert.equal(await editor.$eval('.store-context-selector select',node=>node.disabled),true);assert.equal(await editor.$eval('[data-standby-save]',node=>node.disabled),true);
  let payload=await editor.evaluate(()=>window.__writes.at(-1));assert.deepEqual(Object.keys(payload).sort(),['customerDisplayStandby','section','storeId']);assert.equal(payload.section,'customerDisplayStandby');assert.equal(payload.storeId,storeA);assert.equal(payload.customerDisplayStandby.enabled,true);
  assert.equal(payload.customerDisplayStandby.layouts.portrait.find(block=>block.id==='welcome').text,'本日もご来店ありがとうございます');assert.equal(payload.customerDisplayStandby.layouts.landscape.find(block=>block.id==='welcome').text,'横画面だけの挨拶');
  await editor.evaluate(()=>{window.__holdSave=false;window.__releaseSave();});await waitSaved(editor);
  assert.equal(await editor.$eval(taxInput,node=>node.value),'9');assert.equal(await editor.$eval(filterInput,node=>node.value),'3');
  assert.equal(await editor.evaluate(id=>window.__settings[id].dineInTaxRate,storeA),10);assert.equal(await editor.evaluate(id=>window.__settings[id].scaleFilterSettings.toleranceGrams,storeA),2);
  checks.push('dedicated save sends only store, section and standby, disables duplicate saves/store switch and preserves unrelated tax/filter drafts');

  await editor.select('[data-standby-select]','welcome');await input(editor,'standby-text','失敗しても消えない下書き');await editor.evaluate(()=>window.__saveFailure=true);
  await nativeClick(editor,'[data-standby-save]');await editor.waitForFunction(()=>window.__writes.length===2);await waitSaved(editor);
  assert.equal(await editor.$eval('[name="standby-text"]',node=>node.value),'失敗しても消えない下書き');assert.equal(await editor.evaluate(id=>window.__settings[id].customerDisplayMediaSettings.standby.layouts.portrait.find(b=>b.id==='welcome').text,storeA),'本日もご来店ありがとうございます');
  assert.match(await editor.$eval('body',node=>node.textContent),/保存に失敗しました/);
  await editor.evaluate(()=>window.__saveFailure=false);await nativeClick(editor,'[data-standby-save]');await editor.waitForFunction(()=>window.__writes.length===3);await waitSaved(editor);checks.push('save failure preserves the edited layout and permits retry without changing the previously saved setting');
  await input(editor,'standby-text','すべて保存の待機画面');await clickText(editor,'POS 設定をすべて保存');await editor.waitForFunction(()=>window.__writes.length===4);await waitSaved(editor);
  payload=await editor.evaluate(()=>window.__writes.at(-1));assert.equal(payload.customerDisplayStandby.layouts.portrait.find(block=>block.id==='welcome').text,'すべて保存の待機画面');assert.equal(payload.dineInTaxRate,'9');checks.push('all settings save explicitly includes the standby draft along with other edited sections');

  await input(editor,'standby-text','破棄される A の下書き');await editor.select('.store-context-selector select',storeB);await editor.waitForSelector('[role="dialog"]');await clickText(editor,'キャンセル');assert.equal(await editor.$eval('[name="standby-text"]',node=>node.value),'破棄される A の下書き');
  await editor.select('.store-context-selector select',storeB);await editor.waitForSelector('[role="dialog"]');await clickText(editor,'保存せず店舗を切替');await ready(editor);await editor.select('[data-standby-select]','welcome');assert.equal(await editor.$eval('[name="standby-text"]',node=>node.value),'B の待機画面');
  await editor.select('.store-context-selector select',storeA);await ready(editor);await editor.select('[data-standby-select]','welcome');assert.equal(await editor.$eval('[name="standby-text"]',node=>node.value),'すべて保存の待機画面');checks.push('store change guard preserves draft on cancel; discard and return load each store saved layout without draft leakage');
  await editor.select('[data-standby-select]','image');await editor.evaluate(()=>window.__holdUpload=true);await(await editor.$('[name="standby-image-file"]')).uploadFile(join(output,'fixture-logo.png'));await editor.waitForFunction(()=>window.__uploads.length===1);
  const globalSaveDisabled=await editor.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='POS 設定をすべて保存')?.disabled);assert.equal(globalSaveDisabled,true,'global save disabled during image upload');
  const writesBeforeUpload=await editor.evaluate(()=>window.__writes.length);await editor.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='POS 設定をすべて保存')?.click());assert.equal(await editor.evaluate(()=>window.__writes.length),writesBeforeUpload);
  await editor.evaluate(()=>{window.__holdUpload=false;window.__releaseUpload();});await editor.waitForFunction(()=>document.querySelector('[name="standby-imageUrl"]')?.value==='/fixture-logo.png');await waitSaved(editor);await clickText(editor,'POS 設定をすべて保存');await editor.waitForFunction(count=>window.__writes.length===count+1,{},writesBeforeUpload);await waitSaved(editor);
  assert.equal(await editor.evaluate(()=>window.__writes.at(-1).customerDisplayStandby.layouts.portrait.find(block=>block.id==='image').imageUrl),'/fixture-logo.png');checks.push('pending image upload blocks global save; uploaded image remains in draft and is included in the next saved configuration');
  assert.deepEqual(await editor.evaluate(()=>window.__native),[]);assert.deepEqual(await editor.evaluate(()=>window.__denied),[]);

  const readonly=await newPage({width:414,height:896});await readonly.goto(origin+'/os/pos?readonly=1',{waitUntil:'domcontentloaded'});await ready(readonly);
  assert.equal(await readonly.$('[data-standby-canvas] button'),null);for(const selector of ['[data-standby-enable]','[data-standby-save]','[data-standby-add="text"]','[name="standby-x"]','[data-standby-delete]'])assert.equal(await readonly.$eval(selector,node=>node.matches(':disabled')),true);
  await readonly.evaluate(()=>document.querySelector('[data-standby-save]').click());assert.deepEqual(await readonly.evaluate(()=>window.__writes),[]);await readonly.browserContext().close();checks.push('read-only settings show the preview but cannot drag, edit, add, delete or save');
  const chinese=await newPage({width:414,height:896});await chinese.goto(origin+'/os/pos?lang=zh-Hans',{waitUntil:'domcontentloaded'});await ready(chinese);await chinese.waitForFunction(text=>document.querySelector('#standby-heading')?.textContent===text,{},chineseDictionary['客席表示の待機画面']);
  assert.equal(await chinese.$eval('[data-standby-block="welcome"]',node=>node.textContent),'いらっしゃいませ');await chinese.$eval(section,node=>node.scrollIntoView({block:'start'}));await chinese.screenshot({path:join(output,'editor-chinese-414.png')});await chinese.browserContext().close();checks.push('Chinese OS labels are translated while the authored Japanese customer message remains unchanged');

  await editor.browserContext().close();
  }
  for(const debug of [false,true])for(const viewport of viewports){
    const page=await newPage(viewport);
    const url=origin+'/store/pos/customer-display'+(debug?'/debug':'')+'?storeId='+storeA+(debug?'&sessionId='+debugSession:'');
    await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Boolean(window.__emit)&&document.querySelector('[data-standby-canvas]'));
    const expectedOrientation=viewport.width>viewport.height?'landscape':'portrait';
    assert.equal(await page.$eval('[data-standby-canvas]',node=>node.dataset.standbyLayout),expectedOrientation);
    assert.match(await page.$eval('[data-standby-canvas]',node=>node.textContent),expectedOrientation==='portrait'?/縦の歓迎メッセージ/:/横の歓迎メッセージ/);
    assert.match(await page.$eval('[data-standby-type="storeName"]',node=>node.textContent),/検証店舗 A/);
    assert.match(await page.$eval('[data-standby-type="clock"]',node=>node.textContent),/\d{2}:\d{2}/);
    assert.equal(await page.$eval('[data-standby-type="image"] img',node=>node.complete&&node.naturalWidth>0),true);
    assert.equal(Boolean(await page.$('[data-pos-debug-display]')),debug);
    if(debug)assert.match(await page.$eval('[data-pos-debug-display-status]',node=>node.textContent),/テスト|待/);
    const initialStorage=await storage(page);
    let sequence=0;
    const emit=async state=>{await page.evaluate(({debug,storeId,sessionId,state,sequence})=>window.__emit(debug?'pos.debug-display':'pos.customer-display.updated',debug?{kind:'state',storeId,sessionId,sequence,state}:{storeId,state}),{debug,storeId:storeA,sessionId:debugSession,state,sequence:++sequence});await pause(90);};
    const canvasBounds=await page.$eval('[data-standby-canvas]',node=>{const r=node.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,overflow:document.documentElement.scrollWidth>innerWidth+1};});
    assert.ok(canvasBounds.width>100&&canvasBounds.height>100&&!canvasBounds.overflow&&canvasBounds.bottom<=viewport.height+1,`canvas does not fit ${JSON.stringify({debug,viewport,canvasBounds})}`);
    layoutBounds.push({kind:'display',debug,viewport,...canvasBounds});await page.screenshot({path:join(output,`${debug?'debug':'normal'}-standby-${viewport.width}.png`)});
    if(!debug&&viewport.width===414){
      await page.evaluate(()=>{window.__displaySettings.standby.layouts.portrait.find(block=>block.id==='welcome').text='更新後の歓迎メッセージ';});await pause(150);assert.match(await page.$eval('[data-standby-canvas]',node=>node.textContent),/縦の歓迎メッセージ/);
      await nativeClick(page,'.customer-display-menu-button');await clickText(page,'更新');await page.waitForFunction(()=>document.querySelector('[data-standby-canvas]')?.textContent.includes('更新後の歓迎メッセージ'));await nativeClick(page,'[data-customer-display-menu-close]');assert.equal(await page.$('.customer-display-menu'),null);await page.keyboard.press('Escape');checks.push('open customer display keeps current layout until menu refresh reloads settings; explicit close action works without hidden edge tapping');
    }
    await emit({status:'advertising',items:[]});assert.ok(await page.$('[data-standby-canvas]'));checks.push(`${debug?'debug':'normal'} idle and advertising render configured ${expectedOrientation} canvas at ${viewport.width}`);
    await emit(baseState);await page.waitForSelector('.customer-display-total strong');assert.equal(await page.$('[data-standby-canvas]'),null);
    assert.equal(await page.$eval('.customer-display-total strong',node=>node.textContent),'¥1,440');assert.match(await page.$eval('.customer-display-item-list',node=>node.textContent),/牛筋 50g/);assert.match(await page.$eval('.customer-display-settlement',node=>node.textContent),/560/);
    if(debug){await emit({...baseState,weighing:{itemName:'基礎麻辣湯',quantity:220,unit:'g',unitPrice:4,amount:880}});await page.waitForSelector('[data-pos-debug-weighing]');assert.match(await page.$eval('[data-pos-debug-weighing]',node=>node.textContent),/220/);assert.equal(await page.$('[data-standby-canvas]'),null);}
    await page.screenshot({path:join(output,`${debug?'debug':'normal'}-cart-${viewport.width}.png`)});
    await emit({...baseState,status:'external_wait',paymentMethod:'external',externalPaymentTerminalBrand:'PayCAS'});assert.equal(await page.$('[data-standby-canvas]'),null);assert.match(await page.$eval('.customer-display-terminal',node=>node.textContent),/PayCAS/);
    await emit({...baseState,status:'complete',pickupCode:debug?'TEST-001':'P-123'});
    if(debug){assert.match(await page.$eval('body',node=>node.textContent),/TEST-001/);assert.equal(await page.$eval('.customer-display-total strong',node=>node.textContent),'¥1,440');}
    else{await page.waitForSelector('.customer-display-advertising.is-thanks');assert.equal(await page.$('.customer-display-total'),null);}
    assert.equal(await page.$('[data-standby-canvas]'),null);
    checks.push(`${debug?'debug':'normal'} cart, price, discount, change, terminal and completion retain existing views at ${viewport.width}${debug?'; live weight remains visible':''}`);
    if(debug){assert.deepEqual(await storage(page),initialStorage);const writes=await page.evaluate(()=>window.__writes);assert.ok(writes.every(write=>write.path==='/api/store/pos/debug-display'&&['hello','ack'].includes(write.kind)));assert.ok((await page.evaluate(()=>window.__requests)).every(request=>!request.path.includes('member-scan')));}
    else assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
    assert.deepEqual(await page.evaluate(()=>window.__native),[]);assert.deepEqual(await page.evaluate(()=>window.__denied),[]);await page.browserContext().close();
  }
  checks.push('debug standby and state transitions never write business records, browser storage, native print, scale, member or saved customer-display state');
  const disabled=await newPage({width:414,height:896});await disabled.goto(origin+'/store/pos/customer-display?storeId='+storeA+'&disabled=1',{waitUntil:'domcontentloaded'});await disabled.waitForSelector('.customer-display-total');assert.equal(await disabled.$('[data-standby-canvas]'),null);assert.equal(await disabled.$eval('.customer-display-total strong',node=>node.textContent),'¥0');checks.push('disabled custom standby preserves existing waiting display');await disabled.browserContext().close();
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(unexpected,[]);
  const afterHashes=await hashes();const noSourceDrift=JSON.stringify(afterHashes)===JSON.stringify(beforeHashes);if(args['allow-source-drift']!=='1')assert.ok(noSourceDrift,'source changed during test');
  await writeFile(join(output,'report.json'),JSON.stringify({passed:checks.length,checks,layoutBounds,sourceHashes:afterHashes,noSourceDrift,actualOsSettingsPage:args.mode!=='runtime',actualDisplayWorkspace:true,adapters:'local in-memory HTTP and realtime; no production or native writes',errors,external,unexpected},null,2));
  console.log(JSON.stringify({passed:checks.length,report:join(output,'report.json')}));
}catch(error){
  if(activePage&&!activePage.isClosed())await activePage.screenshot({path:join(output,'failure.png'),fullPage:true}).catch(()=>{});
  await writeFile(join(output,'failure.json'),JSON.stringify({passed:checks.length,checks,error:error.stack,errors,external,unexpected},null,2));throw error;
}finally{await browser.close();server.closeAllConnections();await new Promise(ok=>server.close(ok));stop();}
process.exit(0);
