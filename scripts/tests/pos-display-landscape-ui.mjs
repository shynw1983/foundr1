// Actual OS POS settings and customer-display React components with isolated fixtures.
// Network access is restricted to the local fixture; no production or hardware writes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((all, value, index, values) => {
  if (value.startsWith('--')) all.push([value.slice(2), values[index + 1]]);
  return all;
}, []));
const source = resolve(args.source || process.cwd());
const output = resolve(args.output || 'outputs/pos-display-landscape-ui');
await mkdir(output, { recursive: true });
const dependencies=resolve(args.deps||process.cwd());
const require = createRequire(join(dependencies, 'package.json'));
const { build, stop } = require('esbuild');
const puppeteer = require('puppeteer-core');
const sourceFiles = ['app/globals.css','app/os/pos/page.tsx','lib/pos-display-standby.ts',...(await Promise.all(['app/os/pos','app/store/pos/customer-display','components/pos'].map(async dir=>(await readdir(join(source,dir))).filter(name=>name.endsWith('.css')||name.includes('Standby')||name==='CustomerDisplayWorkspace.tsx').map(name=>dir+'/'+name)))).flat()];
const chineseDictionary = JSON.parse(await readFile(join(source,'public/locales/os/zh-Hans.json'),'utf8'));
const hashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash('sha256').update(await readFile(join(source, path))).digest('hex')])));
const beforeHashes = await hashes();
const storeA = '11111111-1111-4111-8111-111111111111';
const storeB = '22222222-2222-4222-8222-222222222222';
const debugSession = '33333333-3333-4333-8333-333333333333';
const viewports = [{width:896,height:414},{width:896,height:340},{width:808,height:320},...(args.scope==='phones'?[]:[{width:414,height:896},{width:1024,height:768},{width:1194,height:834},{width:1366,height:900}])];
const captureBefore=args.capture==='before';
const baselineReport=args.before?JSON.parse(await readFile(args.before,'utf8')):null;
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
window.__settings[storeA].customerDisplayMediaSettings.standby.layouts.landscape.forEach(block=>{if(block.type==='text'){block.text='店長が保存した横画面のメッセージ';block.x=12;block.y=42;block.width=76;block.height=25;}if(block.type==='storeName'){block.x=10;block.y=76;block.width=80;block.height=18;}});
window.__originalStandby=structuredClone(window.__settings[storeA].customerDisplayMediaSettings.standby);

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
const bundle = await build({ stdin: { contents: entry, resolveDir: source, loader: 'tsx' }, nodePaths:[join(dependencies,'node_modules')], bundle: true, write: false, outdir: '/virtual', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'local-standby-adapters', setup(builder) {
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
const baseState={status:'editing',storeName:'検証店舗 A',orderType:'eat_in',paymentMethod:'cash',paymentLabel:'現金',preferredLanguage:'ja',subtotal:7640,taxLabel:'内消費税 10%',taxAmount:694,cashTenderedAmount:10000,cashChangeAmount:2360,discountName:'店内割引',discountAmount:880,couponName:'来店クーポン',couponDiscountAmount:200,items:Array.from({length:8},(_,i)=>({name:`${i+1}. 基礎麻辣湯・具材を選べるセット`,optionLabel:'辣度：中辛 ／ 麻度：普通 ／ 面条：春雨 ／ 牛筋 50g ／ 豚軟骨 50g ／ 香菜追加 ／ 仕上げは厨房でお願いします。',weightLabel:i===0?'220g × ¥4/g':'',quantity:i===3?2:1,unitPrice:i===0?880:980,amount:i===0?880:(i===3?1960:980)}))};
const largeState={...baseState,subtotal:12345,taxAmount:1122,cashTenderedAmount:20000,cashChangeAmount:7655,items:baseState.items.map((item,index)=>index===7?{...item,name:'8. 高級食材セット',unitPrice:5685,amount:5685}:item)};
for(const state of [baseState,largeState])assert.equal(state.items.reduce((sum,item)=>sum+item.amount,0)-state.discountAmount-state.couponDiscountAmount,state.subtotal,'Synthetic receipt totals must be coherent');
const observations=[];
function record(name,passed,details={}){checks.push({name,passed:Boolean(passed),...details});}
async function displayMetrics(page){return page.evaluate(()=>{
  const box=node=>{if(!node)return null;const r=node.getBoundingClientRect(),style=getComputedStyle(node);const visible=style.display!=='none'&&style.visibility!=='hidden'&&r.width>0&&r.height>0;const center=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);const range=document.createRange();range.selectNodeContents(node);const tr=range.getBoundingClientRect();let textFits=tr.left>=r.left-1&&tr.right<=r.right+1&&tr.top>=r.top-2&&tr.bottom<=r.bottom+2;let textWithin=tr.left>=-1&&tr.right<=innerWidth+1&&tr.top>=-1&&tr.bottom<=innerHeight+1;let glyphBounds=null,clipBounds=null;if(node.matches('.customer-display-total strong,.customer-display-cash-card strong,.customer-display-cash-card > span')){const ctx=document.createElement('canvas').getContext('2d');ctx.font=style.fontStyle+' '+style.fontWeight+' '+style.fontSize+' '+style.fontFamily;const tm=ctx.measureText(node.textContent),baseline=tr.top+tm.fontBoundingBoxAscent;glyphBounds={left:tr.left-tm.actualBoundingBoxLeft,right:tr.left+tm.actualBoundingBoxRight,top:baseline-tm.actualBoundingBoxAscent,bottom:baseline+tm.actualBoundingBoxDescent};clipBounds={left:0,right:innerWidth,top:0,bottom:innerHeight};for(let ancestor=node;ancestor;ancestor=ancestor.parentElement){const as=getComputedStyle(ancestor),ar=ancestor.getBoundingClientRect();if(as.overflowX!=='visible'){clipBounds.left=Math.max(clipBounds.left,ar.left);clipBounds.right=Math.min(clipBounds.right,ar.right);}if(as.overflowY!=='visible'){clipBounds.top=Math.max(clipBounds.top,ar.top);clipBounds.bottom=Math.min(clipBounds.bottom,ar.bottom);}}textFits=glyphBounds.left>=clipBounds.left-1&&glyphBounds.right<=clipBounds.right+1&&glyphBounds.top>=clipBounds.top-1&&glyphBounds.bottom<=clipBounds.bottom+1;textWithin=glyphBounds.left>=-1&&glyphBounds.right<=innerWidth+1&&glyphBounds.top>=-1&&glyphBounds.bottom<=innerHeight+1;}return{textFits,textWithin,glyphBounds,clipBounds,textBounds:{left:tr.left,right:tr.right,top:tr.top,bottom:tr.bottom,width:tr.width,height:tr.height},text:node.textContent,top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,visible,within:visible&&r.top>=-1&&r.bottom<=innerHeight+1&&r.left>=-1&&r.right<=innerWidth+1,hit:node===center||node.contains(center),scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,overflowY:style.overflowY,fontSize:style.fontSize,lineClamp:style.webkitLineClamp};};
  const list=document.querySelector('.customer-display-item-list');
  const options=[...document.querySelectorAll('.customer-display-item span')].map(box);
  return{viewport:{width:innerWidth,height:innerHeight},page:{scrollY,scrollX,scrollHeight:document.documentElement.scrollHeight,scrollWidth:document.documentElement.scrollWidth},main:box(document.querySelector('.customer-display-page')),clock:box(document.querySelector('.customer-display-topbar .customer-display-clock')),topbar:box(document.querySelector('.customer-display-topbar')),total:box(document.querySelector('.customer-display-total')),totalValue:box(document.querySelector('.customer-display-total strong')),cash:[...document.querySelectorAll('.customer-display-cash-card')].map(box),cashText:[...document.querySelectorAll('.customer-display-cash-card strong,.customer-display-cash-card > span')].map(box),discounts:[...document.querySelectorAll('.customer-display-discount')].map(box),terminal:box(document.querySelector('.customer-display-terminal')),weighing:box(document.querySelector('[data-pos-debug-weighing]')),list:box(list),items:[...document.querySelectorAll('.customer-display-item')].map(box),options,allOptionsUnclipped:options.every(item=>item.scrollHeight<=item.clientHeight+1&&(!item.lineClamp||item.lineClamp==='none')),canvas:box(document.querySelector('[data-standby-canvas]')),menu:box(document.querySelector('.customer-display-menu')),menuClose:box(document.querySelector('[data-customer-display-menu-close]'))};
});}
async function capture(page,label,viewport){const metrics=await displayMetrics(page);observations.push({label,viewport,...metrics});await page.screenshot({path:join(output,`${label}-${viewport.width}x${viewport.height}.png`)});return metrics;}
function validatePayment(label,metrics,viewport,{cash=true,debug=false}={}){
  const short=viewport.width>viewport.height&&viewport.height<=500;
  const relevant=short||!baselineReport;
  const totalGood=metrics.total?.within&&metrics.totalValue?.within&&metrics.totalValue.textWithin&&metrics.totalValue.textFits;
  const moneyGood=cash?metrics.cash.length===2&&metrics.cash.every(card=>card.within)&&metrics.cashText.every(text=>text.within&&text.textWithin&&text.textFits):metrics.terminal?.within&&metrics.terminal.textWithin&&metrics.terminal.textFits;
  if(relevant){record(`${label}: total/payment fit`,totalGood&&moneyGood,{viewport,total:metrics.total,cash:metrics.cash,terminal:metrics.terminal});record(`${label}: no page scrolling`,metrics.page.scrollY===0&&metrics.page.scrollX===0&&metrics.page.scrollHeight<=viewport.height+1&&metrics.page.scrollWidth<=viewport.width+1,{viewport,page:metrics.page});}
  else{const before=baselineReport.observations.find(item=>item.label===label&&item.viewport.width===viewport.width&&item.viewport.height===viewport.height);if(before){const beforeGood=before.total?.within&&before.totalValue?.within&&before.totalValue.textWithin&&before.totalValue.textFits&&(cash?before.cash.length===2&&before.cash.every(card=>card.within)&&before.cashText.every(text=>text.within&&text.textWithin&&text.textFits):before.terminal?.within&&before.terminal.textWithin&&before.terminal.textFits);const clipping=box=>{const glyph=box?.glyphBounds,clip=box?.clipBounds;if(!glyph||!clip)return 0;return Math.max(0,clip.left-glyph.left)+Math.max(0,glyph.right-clip.right)+Math.max(0,clip.top-glyph.top)+Math.max(0,glyph.bottom-clip.bottom);};const priorMoney=[before.totalValue,...(cash?before.cashText:[before.terminal])],currentMoney=[metrics.totalValue,...(cash?metrics.cashText:[metrics.terminal])];const noWorse=currentMoney.length===priorMoney.length&&currentMoney.every((box,index)=>box&&priorMoney[index]&&(!priorMoney[index].within||box.within)&&(!priorMoney[index].textWithin||box.textWithin)&&(!priorMoney[index].textFits||box.textFits)&&clipping(box)<=clipping(priorMoney[index])+.1);record(`${label}: payment visibility does not regress`,beforeGood?(totalGood&&moneyGood):noWorse,{viewport,beforeGood,totalGood,moneyGood,noWorse,beforeClipping:priorMoney.map(clipping),afterClipping:currentMoney.map(clipping)});record(`${label}: page height does not regress`,metrics.page.scrollHeight<=before.page.scrollHeight+2,{viewport,beforeHeight:before.page.scrollHeight,afterHeight:metrics.page.scrollHeight});}}
  if(short){record(`${label}: clock removed or compact`,!metrics.clock?.visible||(metrics.clock.height<=32&&parseFloat(metrics.clock.fontSize)<=32),{viewport,clock:metrics.clock});if(debug)record(`${label}: debug banner retained`,metrics.topbar?.within,{viewport,topbar:metrics.topbar});}
}
async function scrollList(page,label,viewport){
  const before=await displayMetrics(page);if(!before.list)return;
  const short=viewport.width>viewport.height&&viewport.height<=500;
  const position=await page.$eval('.customer-display-item-list',node=>{const r=node.getBoundingClientRect();return{x:r.left+r.width/2,y:Math.max(1,Math.min(innerHeight-1,r.top+r.height/2)),scrollHeight:node.scrollHeight,clientHeight:node.clientHeight};});
  await page.mouse.move(position.x,position.y);await page.mouse.wheel({deltaY:12000});await pause(130);
  const after=await page.$eval('.customer-display-item-list',node=>{const r=node.getBoundingClientRect(),last=node.lastElementChild?.getBoundingClientRect();return{scrollTop:node.scrollTop,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,lastVisible:Boolean(last&&last.bottom<=Math.min(r.bottom,innerHeight)+2&&last.top>=Math.max(r.top,0)-2),lastBottom:last?.bottom,listBottom:r.bottom,pageScrollY:scrollY,overflowY:getComputedStyle(node).overflowY};});
  observations.push({label:label+'-scroll',viewport,...after});await page.screenshot({path:join(output,`${label}-bottom-${viewport.width}x${viewport.height}.png`)});
  if(short){record(`${label}: all eight items remain present`,before.items.length===8,{viewport,count:before.items.length});record(`${label}: internally scrollable and final item reachable`,['auto','scroll'].includes(after.overflowY)&&after.scrollHeight>after.clientHeight&&after.scrollTop>0&&after.lastVisible&&after.pageScrollY===0,{viewport,...after});record(`${label}: full option text remains readable`,before.allOptionsUnclipped&&before.items.every((item,index)=>item.textBounds.bottom<=item.bottom+2&&item.scrollHeight<=item.clientHeight+2&&(!before.items[index+1]||item.bottom<=before.items[index+1].top+1)),{viewport,options:before.options,items:before.items});}
  await page.$eval('.customer-display-item-list',node=>node.scrollTop=0);
}
try{
  for(const viewport of viewports){
    for(const debug of [false,true]){
      const page=await newPage(viewport);const prefix=debug?'debug':'normal';let sequence=0;
      const emit=async state=>{await page.evaluate(({debug,state,storeId,sessionId,sequence})=>window.__emit(debug?'pos.debug-display':'pos.customer-display.updated',debug?{kind:'state',storeId,sessionId,sequence,state}:{storeId,state}),{debug,state,storeId:storeA,sessionId:debugSession,sequence:++sequence});await pause(80);};
      await page.goto(origin+'/store/pos/customer-display'+(debug?'/debug':'')+'?storeId='+storeA+(debug?'&sessionId='+debugSession:''),{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Boolean(window.__emit)&&document.querySelector('[data-standby-canvas]'));
      if(args.scenario==='shortage'){
        await emit({...largeState,cashTenderedAmount:10000,cashChangeAmount:-2345,...(!debug?{memberDisplayName:'桜並木のお客様',memberMessage:'ご来店ありがとうございます。会員クーポンを適用しました。'}:{})});const shortage=await capture(page,prefix+'-cash-shortage',viewport);validatePayment(prefix+'-cash-shortage',shortage,viewport,{debug});
        const notice=await page.$eval('.customer-display-cash-card.is-short small',node=>{const r=node.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(node);const text=range.getBoundingClientRect();return{text:node.textContent,within:r.top>=0&&r.bottom<=innerHeight&&text.left>=r.left-1&&text.right<=r.right+1&&text.bottom<=innerHeight,top:r.top,bottom:r.bottom,textBottom:text.bottom};});record(prefix+' cash shortage message stays visible',notice.within&&notice.text.includes('2,345'),{viewport,...notice});assert.deepEqual(await page.evaluate(()=>window.__native),[]);assert.deepEqual(await page.evaluate(()=>window.__denied),[]);await page.browserContext().close();continue;
      }
      let metrics=await capture(page,prefix+'-custom-standby',viewport);record(prefix+' custom standby fits',metrics.canvas?.within,{viewport,canvas:metrics.canvas});
      if(!debug){await page.evaluate(()=>window.__displaySettings.standby.enabled=false);await nativeClick(page,'.customer-display-menu-button');await clickText(page,'更新');await page.waitForFunction(()=>!document.querySelector('[data-standby-canvas]'));await nativeClick(page,'[data-customer-display-menu-close]');await page.keyboard.press('Escape');await capture(page,'normal-default-idle',viewport);await emit({status:'advertising',items:[]});await capture(page,'normal-default-advertising',viewport);}
      await emit(baseState);await page.waitForSelector('.customer-display-item-list');metrics=await capture(page,prefix+'-cart-eight',viewport);validatePayment(prefix+'-cart-eight',metrics,viewport,{debug});await scrollList(page,prefix+'-cart-eight',viewport);
      await emit({...baseState,status:'cash_change'});metrics=await capture(page,prefix+'-cash-change',viewport);validatePayment(prefix+'-cash-change',metrics,viewport,{debug});
      await emit({...largeState,...(!debug?{memberDisplayName:'桜並木のお客様',memberMessage:'ご来店ありがとうございます。会員クーポンを適用しました。'}:{})});metrics=await capture(page,prefix+'-large-amount-member',viewport);validatePayment(prefix+'-large-amount-member',metrics,viewport,{debug});
      await emit({...baseState,status:'external_wait',paymentMethod:'external',paymentLabel:'クレジット・電子マネー',externalPaymentTerminalBrand:'PayCAS'});metrics=await capture(page,prefix+'-terminal-payment',viewport);validatePayment(prefix+'-terminal-payment',metrics,viewport,{cash:false,debug});
      if(debug){await emit({...baseState,weighing:{itemName:'基礎麻辣湯・追加前の重量',quantity:220,unit:'g',unitPrice:4,amount:880}});metrics=await capture(page,'debug-weighing',viewport);validatePayment('debug-weighing',metrics,viewport,{debug:true});record('debug weight is visible',metrics.weighing?.within,{viewport,weighing:metrics.weighing});record('debug live weight and cart row show coherent 220g price',metrics.weighing?.text.includes('¥880')&&metrics.items[0]?.text.includes('¥880'),{viewport,weighing:metrics.weighing?.text,firstItem:metrics.items[0]?.text});await scrollList(page,'debug-weighing',viewport);}
      await emit({...baseState,status:'complete',pickupCode:debug?'TEST-001':'P-123'});await capture(page,prefix+'-complete',viewport);assert.equal(await page.$('[data-standby-canvas]'),null);
      if(!debug){await emit(baseState);await nativeClick(page,'.customer-display-menu-button');metrics=await capture(page,'normal-menu',viewport);const short=viewport.width>viewport.height&&viewport.height<=500;if(short)record('menu contained with close reachable',metrics.menu?.within&&metrics.menuClose?.within,{viewport,menu:metrics.menu,close:metrics.menuClose});await nativeClick(page,'[data-customer-display-menu-close]');await page.keyboard.press('Escape');}
      if(!captureBefore&&!debug&&viewport.width===896&&viewport.height===414){
        await emit(baseState);await page.evaluate(()=>{window.__fixtureVisualHeight=340;Object.defineProperty(window.visualViewport,'height',{configurable:true,get:()=>window.__fixtureVisualHeight});window.visualViewport.dispatchEvent(new Event('resize'));});await pause(100);
        metrics=await capture(page,'normal-visual-viewport-reduced',viewport);record('visualViewport resize reserves reduced usable height',metrics.main.bottom<=341&&metrics.totalValue.textWithin&&metrics.cash.every(card=>card.bottom<=341)&&metrics.cashText.every(text=>text.glyphBounds?.bottom<=341),{viewport,main:metrics.main,cash:metrics.cash});
        await page.evaluate(()=>{window.__fixtureVisualHeight=414;window.visualViewport.dispatchEvent(new Event('resize'));});await pause(100);metrics=await displayMetrics(page);record('visualViewport restored height expands display',Math.abs(metrics.main.height-414)<2,{viewport,main:metrics.main});
      }
      const writes=await page.evaluate(()=>window.__writes);assert.ok(writes.every(write=>debug&&write.path==='/api/store/pos/debug-display'&&['hello','ack'].includes(write.kind)));assert.deepEqual(await page.evaluate(()=>window.__native),[]);assert.deepEqual(await page.evaluate(()=>window.__denied),[]);await page.browserContext().close();
    }
    if(args.scenario==='shortage')continue;
    const editor=await newPage(viewport);await editor.goto(origin+'/os/pos',{waitUntil:'domcontentloaded'});await ready(editor);await nativeClick(editor,'[data-standby-orientation="landscape"]');await editor.$eval('[data-standby-canvas]',node=>node.scrollIntoView({block:'center'}));await pause(60);
    const editorMetrics=await editor.$eval(section,node=>{const r=node.getBoundingClientRect(),canvas=node.querySelector('[data-standby-canvas]'),c=canvas.getBoundingClientRect();return{left:r.left,right:r.right,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,canvas:{width:c.width,height:c.height,ratio:c.width/c.height,left:c.left,right:c.right,top:c.top,bottom:c.bottom},controls:[...node.querySelectorAll('input,select,textarea,button')].map(control=>{const b=control.getBoundingClientRect();return{name:control.name||control.dataset.standbyAdd||control.dataset.standbyOrientation||control.textContent,left:b.left,right:b.right,width:b.width,height:b.height};})};});
    observations.push({label:'editor-landscape',viewport,...editorMetrics});await editor.screenshot({path:join(output,`editor-landscape-${viewport.width}x${viewport.height}.png`)});await(await editor.$(section)).screenshot({path:join(output,`editor-landscape-section-${viewport.width}x${viewport.height}.png`)});
    record('editor controls have no horizontal overflow',editorMetrics.left>=-1&&editorMetrics.right<=viewport.width+1&&editorMetrics.scrollWidth<=editorMetrics.clientWidth+1&&editorMetrics.controls.every(control=>control.left>=-1&&control.right<=viewport.width+1),{viewport,...editorMetrics});
    // For a phone preview, geometry should match the saved target orientation rather than the editor viewport.
    if(viewport.width>viewport.height&&viewport.height<=500)record('editor landscape preview represents a phone or declared aspect ratio',editorMetrics.canvas.ratio>=2&&editorMetrics.canvas.ratio<=2.5,{viewport,ratio:editorMetrics.canvas.ratio});
    if(await editor.$('[data-standby-preview-target]')){
      for(const[target,ratio]of[['phone',896/414],['compact',808/320],['tablet',4/3],['wide',16/9]]){
        await editor.select('[data-standby-preview-target]',target);await editor.$eval('[data-standby-canvas]',node=>node.scrollIntoView({block:'center'}));await pause(40);
        const frame=await editor.$eval('[data-standby-canvas]',node=>{const r=node.getBoundingClientRect();return{ratio:r.width/r.height,width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom};});
        record('editor '+target+' preview has truthful aspect ratio',Math.abs(frame.ratio-ratio)<.025,{viewport,expectedRatio:ratio,...frame});
        if(viewport.width>viewport.height&&viewport.height<=500)record('editor '+target+' preview fits short landscape',frame.height<=viewport.height-20&&frame.left>=-1&&frame.right<=viewport.width+1,{viewport,...frame});
      }
      await editor.select('[data-standby-preview-target]','phone');
    }
    if(viewport.width>viewport.height&&viewport.height<=500&&await editor.$('[data-standby-inspector]')){
      await editor.select('[data-standby-select]','welcome');await editor.$eval('[data-standby-inspector]',node=>node.scrollIntoView({block:'center'}));const rect=await editor.$eval('[data-standby-inspector]',node=>{const r=node.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};});await editor.mouse.move(rect.x,rect.y);await editor.mouse.wheel({deltaY:12000});await pause(80);
      const inspector=await editor.$eval('[data-standby-inspector]',node=>{const r=node.getBoundingClientRect(),control=node.querySelector('[data-standby-delete]'),b=control.getBoundingClientRect(),hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return{scrollTop:node.scrollTop,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,overflowY:getComputedStyle(node).overflowY,deleteVisible:b.top>=Math.max(0,r.top)-1&&b.bottom<=Math.min(innerHeight,r.bottom)+1,deleteHit:control===hit||control.contains(hit)};});
      record('editor inspector scroll exposes lower actions',inspector.scrollTop>0&&inspector.deleteVisible&&inspector.deleteHit,{viewport,...inspector});
    }
    await editor.select('[data-standby-select]','welcome');await nativeClick(editor,'[name="standby-text"]');await nativeClick(editor,'[name="standby-x"]');await nativeClick(editor,'[data-standby-save]');await waitSaved(editor);assert.deepEqual(await editor.evaluate(()=>window.__writes.at(-1).customerDisplayStandby),await editor.evaluate(()=>window.__originalStandby));record('changing preview and saving preserves authored layout',true,{viewport});
    assert.deepEqual(await editor.evaluate(()=>window.__native),[]);assert.deepEqual(await editor.evaluate(()=>window.__denied),[]);await editor.browserContext().close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(unexpected,[]);const afterHashes=await hashes();assert.deepEqual(afterHashes,beforeHashes,'source changed during test');
  const failures=checks.filter(check=>!check.passed);const report={capture:captureBefore?'before':'after',source,passed:failures.length===0,checks:checks.length,failures,observations,sourceHashes:afterHashes,noSourceDrift:true,errors,external,unexpected,browser:'isolated desktop Chromium with CSS viewports; not physical Safari',network:'local synthetic fixtures only',businessWrites:false};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({capture:report.capture,checks:checks.length,failures:failures.length,report:join(output,'report.json')}));if(!captureBefore)assert.equal(failures.length,0,JSON.stringify(failures.map(item=>({name:item.name,viewport:item.viewport})).slice(0,15)));
}catch(error){if(activePage&&!activePage.isClosed())await activePage.screenshot({path:join(output,'failure.png'),fullPage:true}).catch(()=>{});await writeFile(join(output,'fatal.json'),JSON.stringify({error:error.stack,errors,external,unexpected,observations},null,2));throw error;}
finally{await browser.close();server.closeAllConnections();await new Promise(ok=>server.close(ok));stop();}
process.exit(0);
