// Isolated actual component and synthetic API. All browser requests are local;
// no database, merchant platform, or native notification is contacted.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';

const output = resolve(process.env.FOUNDR1_SYNC_UI_OUTPUT || '/Users/wushengyin/Desktop/foundr1/outputs/inventory-sync-business-day-scope-20261018/ui');
await mkdir(output, { recursive: true });
const now = new Date().toISOString();
const command = (id, status = 'failed', extra = {}) => ({ commandId: id, platform: 'rocket_now', status, error: status === 'failed' ? 'login required' : '', updatedAt: now, needsAttention: status === 'failed', overdue: false, attentionKey: status === 'failed' ? `${id}:failure` : '', canRetry: status === 'failed', targetLabels: ['配達メニュー', '持ち帰りメニュー'], ...extra });
const run = (id, platforms = [command(id)], isAvailable = false) => ({ id, storeId: 'a', itemLabel: `商品 ${id}`, isAvailable, source: 'store', createdAt: now, platforms });
const initialRuns = Array.from({ length: 6 }, (_, i) => run(`failed-${i + 1}`));
initialRuns.push(run('waiting', [command('waiting', 'queued', { needsAttention: true, overdue: true, attentionKey: 'waiting:overdue', canRetry: false })], true));
initialRuns.push(run('pending', [command('pending', 'processing')], true));
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import {StoreInventorySyncStatus} from './app/store/components/StoreInventorySyncStatus';
import StoreMenuPage from './app/store/menu/page';
import {StoreNavTabs} from './app/store/components/StoreNavTabs';
import {NotificationMenu} from './app/os/components/NotificationMenu';
const params=new URLSearchParams(location.search);const native=params.get('native')==='1';const mode=params.get('mode')||'';
if(!localStorage.getItem('foundr1:store:selectedStoreId'))localStorage.setItem('foundr1:store:selectedStoreId','a');
window.__fixture={runs:{a:${JSON.stringify(initialRuns)},b:[${JSON.stringify({ ...run('store-b'), storeId: 'b' })}]},posts:[],reads:[],chimes:0,contexts:0,held:[],holdNext:false,holdPost:false,failRead:false,consumerReads:[],holdOldRun:params.get('lateOldRun')==='1',inFlight:{},maxConcurrent:0,overlaps:0};
window.__fixture.notifications={notifications:[{id:'old-notice',title:'以前の営業日の通知',message:'cached old operation',href:'/store/menu',readAt:null}],unreadCount:1};window.__fixture.notificationReads=0;
if(mode==='bell')window.__fixture.runs={a:[],b:[]};
if(native)window.Foundr1Printer={};
window.AudioContext=class{state='running';currentTime=0;destination={};constructor(){window.__fixture.contexts++;}resume(){return Promise.resolve();}close(){return Promise.resolve();}createGain(){return{gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}createOscillator(){return{frequency:{value:0},connect(){},start(){window.__fixture.chimes++;},stop(){}};}};
const intervals=new Map();let timerId=100000;const nativeClearInterval=window.clearInterval.bind(window);window.setInterval=(fn)=>{const id=++timerId;intervals.set(id,fn);return id;};window.clearInterval=id=>{intervals.delete(id);nativeClearInterval(id);};const pollTimeouts=new Map();const nativeTimeout=window.setTimeout.bind(window),nativeClearTimeout=window.clearTimeout.bind(window);
window.__pollDelays=[];window.setTimeout=(fn,delay,...args)=>{if(delay!==10000&&delay!==60000)return nativeTimeout(fn,delay,...args);const id=++timerId;window.__pollDelays.push(delay);pollTimeouts.set(id,()=>fn(...args));return id;};
window.clearTimeout=id=>{pollTimeouts.delete(id);nativeClearTimeout(id);};
window.__poll=()=>{for(const fn of intervals.values())fn();for(const[id,fn]of[...pollTimeouts]){pollTimeouts.delete(id);fn();}};
window.__setStore=id=>{localStorage.setItem('foundr1:store:selectedStoreId',id);window.dispatchEvent(new CustomEvent('foundr1-store-selection-change',{detail:{storeId:id}}));};
window.__refresh=()=>window.dispatchEvent(new Event('focus'));
window.fetch=async(input,init={})=>{const url=new URL(String(input),location.href),state=window.__fixture;
if(url.pathname==='/api/store/context'){const selected=url.searchParams.get('storeId')||'a';state.consumerReads.push({kind:'context',store:selected,explicit:url.searchParams.has('storeId')});return Response.json({selectedStoreId:selected,access:{role:'owner',canUseAllStoreView:true,stores:(params.get('scope')==='a'?[{id:'a',name:'店舗A'}]:[{id:'a',name:'店舗A'},{id:'b',name:'店舗B'}])}});}
if(url.pathname==='/api/store/menu-settings'){const store=url.searchParams.get('storeId')||'a';state.consumerReads.push({kind:'menu',store});return Response.json({selectedStoreId:store,access:{stores:[{id:'a',name:'店舗A'},{id:'b',name:'店舗B'}]},brands:[{id:'brand',name:'テスト'}],categories:[{id:'category',brandId:'brand',name:'料理',sortOrder:1}],options:[],items:Array.from({length:30},(_,i)=>({id:store+'-'+i,brandId:'brand',brandName:'テスト',name:'店舗'+store.toUpperCase()+' 商品'+i,displayNames:{},promotionPrefix:'',promotionPrefixDisplayNames:{},category:'料理',websitePresentation:{},imageUrl:'',basePrice:500,websiteEnabled:true,posEnabled:true,deliveryEnabled:true,isAvailable:true,stockStatus:'available',platformAvailability:{},priceOverride:null,statusNote:''})),settings:{availability:{targets:{items:true,options:true},optionDisplayMode:'hidden',allowStorePriceEdit:false,allowChannelToggle:false}}});}
if(url.pathname==='/api/auth/me')return Response.json({employee:{id:'fixture-owner',role:'owner'}});
if(url.pathname==='/api/settings')return Response.json({});
if(url.pathname==='/api/sns')return Response.json({stores:[]});
if(url.pathname==='/api/notifications'){if(init.method&&init.method!=='GET')throw Error('Bell fixture forbids writes');state.notificationReads++;return Response.json(structuredClone(state.notifications));}
if(url.pathname==='/api/notifications/realtime-config')return Response.json({});
if(url.pathname==='/api/store/realtime-config')return Response.json({});
if(url.pathname==='/api/store/menu-sync-runs/retry'){
 const body=JSON.parse(init.body);state.posts.push(body);state.inFlight[body.storeId]=(state.inFlight[body.storeId]||0)+1;state.maxConcurrent=Math.max(state.maxConcurrent,state.inFlight[body.storeId]);
 if(state.inFlight[body.storeId]>1){state.overlaps++;state.inFlight[body.storeId]--;return Response.json({error:'inventory operation in progress'},{status:409});}
 try{const item=state.runs[body.storeId].flatMap(r=>r.platforms).find(p=>p.commandId===body.commandId);
 if(!item?.canRetry||!['failed','timed_out'].includes(item.status))return Response.json({error:'wrong command'},{status:409});
 if(state.holdPost)await new Promise(resolve=>state.held.push(resolve));
 await new Promise(resolve=>window.setTimeout(resolve,20));
 item.status='queued';item.canRetry=false;item.overdue=false;return Response.json({ok:true});}finally{state.inFlight[body.storeId]--;}}
if(url.pathname==='/api/store/menu-sync-runs'){
 const store=url.searchParams.get('storeId'),snapshot=structuredClone(state.runs[store]||[]);state.reads.push(store);if(state.holdOldRun&&store==='a'){state.holdOldRun=false;await new Promise(resolve=>state.held.push(resolve));}
 if(state.holdNext){state.holdNext=false;await new Promise(resolve=>state.held.push(resolve));}
 return state.failRead?Response.json({error:'offline'},{status:503}):Response.json({runs:snapshot});}
throw Error('Fixture forbids outbound request: '+String(input));};
const work=mode==='bell'?<main style={{padding:24}}><NotificationMenu/></main>:mode==='menu'?<StoreMenuPage/>:mode==='orders'?<main className='store-workbench-shell store-orders-page'><header className='store-workbench-topbar'><h1>注文</h1><StoreNavTabs active='orders'/></header><div className='store-orders-layout'><section className='panel'>注文一覧</section><section className='panel'>注文詳細</section></div></main>:location.pathname==='/store/display/kitchen'?<main className='store-kitchen-display store-kitchen-page'><h1>キッチン</h1><div style={{height:700}}>調理中の注文</div></main>:<main style={{padding:24}}><h1>店舗作業</h1><input id='work-input' placeholder='作業中の入力'/><p>商品や調理の操作を続けられます。</p></main>;
createRoot(document.getElementById('root')).render(<React.StrictMode><StoreInventorySyncStatus/>{work}</React.StrictMode>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outfile: '/tmp/inventory-sync-attention-fixture.js', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'fixture-context', setup(build) {
  build.onResolve({ filter: /OsTranslationProvider|PlatformConnectionRecovery|shared-pusher-client|next\/navigation|WholeStoreAvailabilitySync|ReplenishmentPanel|UserBadge/ }, args => ({ path: args.path, namespace: 'fixture' }));
  build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.includes('OsTranslationProvider') ? `export const useOsTranslation=()=>({language:new URLSearchParams(location.search).get('language')||'ja',t:(key)=>key});` : args.path.includes('PlatformConnectionRecovery') ? `export const PlatformConnectionRecovery=()=>null;` : args.path.includes('next/navigation') ? `export const usePathname=()=>location.pathname;` : args.path.includes('WholeStoreAvailabilitySync') ? `export const WholeStoreAvailabilitySync=()=>null;` : args.path.includes('ReplenishmentPanel') ? `export const ReplenishmentPanel=()=>null;` : args.path.includes('UserBadge') ? `import React from 'react';export const UserBadge=()=>React.createElement('div',{className:'user-panel'},React.createElement('label',{className:'os-language-picker'},React.createElement('select',{'aria-label':'Language'},React.createElement('option',null,'日本語'))));` : `export const acquireSharedPusher=()=>{throw Error('No live connection in fixture')};`, loader: 'js', resolveDir: process.cwd() }));
} }] });
const css = await readFile('app/globals.css', 'utf8') + '\n' + await readFile('app/store/store-responsive.css', 'utf8') + '\n' + bundle.outputFiles.find(f => f.path.endsWith('.css')).text;
const html = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><title>Inventory sync attention fixture</title></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
await writeFile(resolve(output, 'fixture.html'), html);
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/fixture.js' ? 'text/javascript' : req.url === '/fixture.css' ? 'text/css' : 'text/html; charset=utf-8');
  res.end(req.url === '/fixture.js' ? bundle.outputFiles.find(f => f.path.endsWith('.js')).text : req.url === '/fixture.css' ? css : html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const checks = [];
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => request.url().startsWith(origin) ? request.continue() : request.abort());
  const open = async (language = 'ja', extra = '') => {
    await page.goto(`${origin}/?language=${language}${extra}`, { waitUntil: 'load' });
    await page.waitForSelector('[data-inventory-sync-attention]');
    if(await page.$eval('.store-menu-sync-dock-head',node=>node.getAttribute('aria-expanded')==='false'))await page.click('.store-menu-sync-dock-head');
    await page.waitForSelector('[data-sync-run-id]');
  };
  const waitRead = async () => { await new Promise(resolve => setTimeout(resolve, 40)); };
  for (const width of [1440, 768, 360]) {
    await page.setViewport({ width, height: 960 });
    await open();
    assert.equal(await page.$$eval('[data-sync-run-id]', nodes => nodes.length), 8, 'all runs remain visible beyond four');
    assert.match(await page.$eval('[data-inventory-sync-attention]', node => node.textContent), /7商品・7件/);
    assert.match(await page.$eval('#store-inventory-sync-details > div p',node=>node.textContent),/現在の営業日.*以前の操作.*同期履歴/,'detail explains current business-day operations and historical access');
    assert.match(await page.$eval('#store-inventory-sync-details > div p',node=>node.textContent),/24時間営業.*直近24時間/,'24-hour scope is explicit');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no horizontal overflow at ${width}`);
    assert.equal(await page.$('[data-sync-command-id="waiting"] button'), null, 'overdue executing commands have no retry');
    assert.match(await page.$eval('[data-sync-command-id="waiting"]', node => node.textContent), /未確認/);
    await page.screenshot({ path: resolve(output, `attention-ja-${width}.png`), fullPage: true });
  }
  checks.push('360 / 768 / 1440 widths; seven persistent failures; all eight runs; overdue pending cannot retry');
  for (const language of ['zh-Hans', 'zh-Hant']) {
    await open(language);
    const copy = await page.$eval('[data-inventory-sync-attention]', node => node.textContent);
    assert.match(copy, language === 'zh-Hans' ? /7 个商品.*下架尚未确认/ : /7 個商品.*下架尚未確認/);
    assert.equal(/[ぁ-んァ-ヶ]/.test(copy), false, 'attention copy is translated');
    assert.match(await page.$eval('#store-inventory-sync-details > div p',node=>node.textContent),language==='zh-Hans'?/当前营业日.*以前的操作.*同步履历/:/目前營業日.*先前的操作.*同步履歷/,'business-day scope copy is translated');
    assert.match(await page.$eval('#store-inventory-sync-details > div p',node=>node.textContent),language==='zh-Hans'?/24 小时营业日.*最近 24 小时/:/24 小時營業日.*最近 24 小時/);
    await page.screenshot({ path: resolve(output, `attention-${language}-360.png`), fullPage: true });
  }
  checks.push('Japanese, Simplified Chinese, and Traditional Chinese warning and controls');
  await open();
  assert.equal(await page.evaluate(() => window.__fixture.chimes), 0, 'ordinary browser does not autoplay');
  await page.click('[data-inventory-sync-attention] button[aria-pressed]');
  await page.waitForFunction(() => window.__fixture.chimes === 2);
  await page.evaluate(() => window.__refresh()); await waitRead();
  assert.equal(await page.evaluate(() => window.__fixture.chimes), 2, 'one short chime for incident set');
  await page.reload({ waitUntil: 'load' }); await page.waitForSelector('[data-inventory-sync-attention]');
  await page.click('[data-inventory-sync-attention] button[aria-pressed]'); await waitRead();
  assert.equal(await page.evaluate(() => window.__fixture.chimes), 0, 'sound acknowledgement persists after refresh');
  await page.click('[data-inventory-sync-attention] button:not([aria-expanded]):not([aria-pressed])');
  assert.ok(await page.$('[data-inventory-sync-attention]'), 'read acknowledgement never hides warning');
  checks.push('explicit browser sound enable; one chime per key; reload keeps acknowledgement; read never clears warning');
  await open();
  await page.evaluate(() => { window.__fixture.runs.a = window.__fixture.runs.a.filter(r => r.id === 'pending'); window.__refresh(); });
  await page.waitForFunction(() => !document.querySelector('[data-inventory-sync-attention]'));
  await page.click('.store-menu-sync-dock-head');
  await page.focus('#work-input');
  await page.evaluate(() => { const p = window.__fixture.runs.a[0].platforms[0]; Object.assign(p, { status: 'failed', needsAttention: true, attentionKey: 'late:failure', canRetry: true, error: 'login required' }); window.__poll(); });
  await page.waitForSelector('[data-inventory-sync-attention]');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'work-input', 'late failure never steals focus');
  assert.equal(await page.$('#store-inventory-sync-details'), null, 'late failure keeps work visible with collapsed details');
  await page.click('[data-inventory-sync-attention] button[aria-expanded]'); await page.waitForSelector('#store-inventory-sync-details');
  checks.push('delayed polling failure appears without stealing focus or opening details; tap opens details');
  await page.evaluate(() => { window.__fixture.failRead = true; window.__refresh(); }); await waitRead();
  assert.ok(await page.$('[data-inventory-sync-attention]'), 'read failure preserves last known unresolved state');
  assert.match(await page.$eval('[data-inventory-sync-attention]', node => node.textContent), /更新に失敗/);
  await page.evaluate(() => { window.__fixture.failRead = false; window.__refresh(); }); await waitRead();
  checks.push('polling outage keeps unresolved warning and explicitly reports stale status');
  await page.evaluate(() => { window.__fixture.holdNext = true; window.__refresh(); }); await waitRead();
  await page.evaluate(() => { window.__fixture.runs.a = [{ id: 'new-operation', itemLabel: '新しい操作', storeId: 'a', isAvailable: true, createdAt: new Date().toISOString(), platforms: [{ commandId: 'new-operation', platform: 'rocket_now', status: 'queued', canRetry: false, needsAttention: false }] }]; window.dispatchEvent(new CustomEvent('foundr1-store-inventory-sync', { detail: { run: { id: 'new-operation', storeId: 'a' } } })); });
  await page.waitForFunction(() => document.querySelector('[data-sync-run-id="new-operation"]'));
  await page.evaluate(() => window.__fixture.held.splice(0).forEach(resolve => resolve())); await waitRead();
  assert.equal(await page.$('[data-inventory-sync-attention]'), null, 'new superseding operation removes obsolete attention');
  assert.equal(await page.$('[data-sync-run-id="pending"]'), null, 'in-flight response before new operation cannot resurrect obsolete failure');
  checks.push('new operation invalidates in-flight read and superseded failure cannot reappear');
  await page.evaluate(() => { window.__fixture.runs.a = []; window.__refresh(); });
  await page.waitForFunction(() => !document.querySelector('[data-inventory-sync-attention]'));
  await page.evaluate(runs => { window.__fixture.runs.a = runs; window.__refresh(); }, initialRuns);
  await page.waitForSelector('[data-inventory-sync-attention]');
  await page.click('[data-sync-command-id="failed-1"] .store-menu-sync-retry');
  await page.waitForFunction(() => window.__fixture.posts.length === 1);
  await page.waitForFunction(() => !document.querySelector('[data-sync-command-id="failed-1"] .store-menu-sync-retry'));
  assert.ok(await page.$('[data-inventory-sync-attention]'), 'accepted retry retains unresolved warning');
  await page.evaluate(() => {window.__fixture.holdPost=true;const button=document.querySelector('#store-inventory-sync-details > div button');button.click();button.click();});
  await page.waitForFunction(() => window.__fixture.posts.length === 2);
  assert.equal(await page.$eval('#store-inventory-sync-details > div button',node=>node.disabled),true,'active batch disables duplicate batch clicks');
  assert.equal(await page.$$eval('[data-sync-command-id] .store-menu-sync-retry',nodes=>nodes.every(node=>node.disabled)),true,'single retries cannot overlap an active batch');
  await page.evaluate(() => {window.__fixture.holdPost=false;window.__fixture.held.splice(0).forEach(resolve=>resolve());});
  await page.waitForFunction(() => window.__fixture.posts.length === 6 && window.__fixture.runs.a.slice(0,6).every(run=>run.platforms.every(platform=>platform.status==='queued')) && !window.__fixture.inFlight.a);
  assert.equal(await page.evaluate(()=>window.__fixture.maxConcurrent),1,'per-store API lock sees exactly one concurrent retry');
  assert.equal(await page.evaluate(()=>window.__fixture.overlaps),0,'sequential batch never receives overlap conflict');
  assert.deepEqual((await page.evaluate(() => window.__fixture.posts.map(p => p.commandId))).sort(), initialRuns.slice(0, 6).map(r => r.id).sort(), 'batch retries only retryable failed commands');
  checks.push('single and batch retry submit only failed platform IDs; accepted queued retry retains warning');
  checks.push('batch retries are sequential under a per-store one-operation lock; double clicks and single-item overlap are blocked and every eligible platform queues');
  await open();
  await page.evaluate(() => {window.__fixture.holdPost=true;document.querySelector('#store-inventory-sync-details > div button').click();});
  await page.waitForFunction(()=>window.__fixture.posts.length===1);
  await page.evaluate(()=>window.__setStore('b'));
  await page.waitForFunction(()=>document.querySelector('[data-inventory-sync-attention]')?.dataset.storeId==='b');
  await page.evaluate(()=>{window.__fixture.holdPost=false;window.__fixture.held.splice(0).forEach(resolve=>resolve());});await waitRead();
  assert.equal(await page.evaluate(()=>window.__fixture.posts.length),1,'switching stores cancels the remaining captured batch queue');
  assert.equal(await page.evaluate(()=>window.__fixture.runs.a.slice(0,6).filter(run=>run.platforms[0].status==='queued').length),1,'only the already submitted retry completes after store switch');
  checks.push('switching stores during a held batch prevents all remaining retries from being submitted');
  await page.evaluate(()=>window.__setStore('a'));
  await page.waitForFunction(()=>document.querySelector('[data-inventory-sync-attention]')?.dataset.storeId==='a');
  await page.evaluate(() => { window.__fixture.runs.a = [window.__fixture.runs.a[0]]; window.__fixture.runs.a[0].platforms[0].status = 'succeeded'; window.__fixture.runs.a[0].platforms[0].needsAttention = false; window.__refresh(); });
  await page.waitForFunction(() => !document.querySelector('[data-inventory-sync-attention]'));
  checks.push('warning clears only after authoritative succeeded / superseded projection');
  await open();
  await page.evaluate(() => { window.__fixture.holdNext = true; window.__refresh(); }); await waitRead();
  await page.evaluate(() => window.__setStore('b'));
  await page.waitForFunction(() => document.querySelector('[data-inventory-sync-attention]')?.dataset.storeId === 'b');
  await page.click('[data-inventory-sync-attention] button[aria-expanded]');
  await page.evaluate(() => window.__fixture.held.splice(0).forEach(resolve => resolve())); await waitRead();
  assert.deepEqual(await page.$$eval('[data-sync-run-id]', nodes => nodes.map(n => n.dataset.syncRunId)), ['store-b'], 'stale store A response cannot overwrite B');
  await page.evaluate(() => { window.__fixture.holdPost = true; document.querySelector('[data-sync-command-id="store-b"] .store-menu-sync-retry').click(); }); await waitRead();
  await page.evaluate(() => window.__setStore('a')); await page.waitForFunction(() => document.querySelector('[data-inventory-sync-attention]')?.dataset.storeId === 'a');
  await page.evaluate(() => window.__fixture.held.splice(0).forEach(resolve => resolve())); await waitRead();
  assert.equal(await page.$('[data-sync-run-id="store-b"]'), null, 'stale retry response cannot mutate new store');
  checks.push('store switch ignores stale reads and stale retry completion');
  await open('ja', '&syncAttention=1&storeId=b');
  await page.waitForFunction(() => document.querySelector('[data-inventory-sync-attention]')?.dataset.storeId === 'b');
  assert.ok(await page.$('#store-inventory-sync-details'), 'notification opens scoped target store details');
  await page.evaluate(() => window.__setStore('a'));
  await open('ja', '&syncAttention=1&storeId=forbidden');
  await waitRead();
  assert.equal(await page.$eval('[data-inventory-sync-attention]', node => node.dataset.storeId), 'a', 'unscoped notification URL cannot change selection');
  assert.equal(await page.evaluate(() => window.__fixture.posts.length), 0, 'notification URL performs no writes');
  checks.push('notification selects allowed target store after context validation; forbidden URL causes no switch or writes');
  await page.evaluate(() => localStorage.clear());
  await open('ja', '&native=1');
  await page.waitForFunction(() => window.__fixture.chimes === 2);
  await page.reload({ waitUntil: 'load' }); await page.waitForSelector('[data-inventory-sync-attention]'); await waitRead();
  assert.equal(await page.evaluate(() => window.__fixture.chimes), 0, 'native reload does not repeat acknowledged chime');
  assert.equal(errors.length, 0, errors.join('\n'));
  checks.push('native WebAudio initializes without a sound-enable tap and does not repeat on reload');
  for(const language of ['ja','zh-Hans','zh-Hant']) {
    await open(language);
    await page.evaluate(() => { window.__fixture.runs.a=[{id:'blocked',storeId:'a',itemLabel:'対象確認待ち',isAvailable:false,createdAt:new Date().toISOString(),platforms:['identity_unverified','mapping_unverified','operation_in_progress','stale_demae_release'].map(reason=>({commandId:reason,platform:'rocket_now',status:'failed',error:'login required',needsAttention:true,attentionKey:reason,canRetry:false,retryBlockedReason:reason,targetLabels:[]}))}];window.__refresh(); });
    await page.waitForSelector('[data-sync-command-id="identity_unverified"]');
    assert.equal(await page.$('.store-menu-sync-retry'),null,'blocked identity / mapping / active operation / stale data never offer retry');
    for(const reason of ['identity_unverified','mapping_unverified','operation_in_progress','stale_demae_release']) {
      const text=await page.$eval('[data-sync-command-id="'+reason+'"]',node=>node.textContent);
      assert.ok(text.length>35,'blocked action includes repair guidance in '+language+' / '+reason);
      if(language!=='ja')assert.equal(/[ぁ-んァ-ヶ]/.test(text),false,'repair guidance is translated');
    }
  }
  checks.push('four blocked-retry reasons show explicit repair guidance in all three languages and offer no unsafe retry');
  await open('zh-Hans');
  await page.evaluate(() => { window.__fixture.runs.a=[{id:'mixed-direction',storeId:'a',itemLabel:'恢复销售操作',isAvailable:true,createdAt:new Date().toISOString(),platforms:[{commandId:'linked-stop',platform:'rocket_now',status:'failed',error:'login required',needsAttention:true,attentionKey:'linked-stop',canRetry:false,desiredAvailable:false},{commandId:'available-ok',platform:'uber_eats',status:'succeeded',needsAttention:false,canRetry:false,desiredAvailable:true},{commandId:'available-failed',platform:'demae_can',status:'failed',error:'login required',needsAttention:true,attentionKey:'available-failed',canRetry:true,desiredAvailable:true}]}];window.__refresh(); });
  await page.waitForSelector('[data-sync-command-id="linked-stop"]');
  assert.match(await page.$eval('[data-inventory-sync-attention]',node=>node.textContent),/下架尚未确认/,'command-specific stop target wins over run heading and other available commands');
  assert.match(await page.$eval('[data-sync-command-id="linked-stop"]',node=>node.textContent),/目标：下架/);
  assert.match(await page.$eval('[data-sync-command-id="available-failed"]',node=>node.textContent),/目标：上架/);
  assert.equal(await page.$eval('[data-inventory-sync-attention]',node=>getComputedStyle(node).color),'rgb(155, 53, 42)','mixed-direction stop risk retains red warning');
  await page.screenshot({path:resolve(output,'mixed-command-direction-360.png'),fullPage:false});
  checks.push('per-command desired stop retains red stop-risk warning within an available run; each failed platform displays its own target direction');
  if(process.env.FOUNDR1_SYNC_FOCUSED!=='1'){
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${origin}/store/menu?mode=menu&syncAttention=1&storeId=b&lateOldRun=1`, {waitUntil:'load'});
  await page.waitForFunction(() => document.querySelector('[data-inventory-sync-attention]')?.dataset.storeId === 'b' && document.querySelector('.store-menu-item-main')?.textContent.includes('店舗B'));
  await page.evaluate(() => window.__fixture.held.splice(0).forEach(resolve => resolve())); await waitRead();
  assert.equal(await page.evaluate(() => localStorage.getItem('foundr1:store:selectedStoreId')), 'b', 'real Menu/Nav retain verified B selection after old A run response');
  const initialConsumers = await page.evaluate(() => window.__fixture.consumerReads);
  assert.equal(initialConsumers.some(read => read.kind === 'menu' && read.store === 'a'), false, 'notification avoids starting old-store Menu read');
  assert.equal(initialConsumers.some(read => read.kind === 'context' && read.explicit && read.store === 'a'), false, 'notification avoids starting old-store Nav context read');
  assert.equal(await page.$eval('[aria-label="店舗切替"]', node => node.value), 'b', 'actual navigation selector shows B');
  assert.equal(await page.evaluate(() => window.__fixture.posts.length), 0, 'real notification page performs no platform writes');
  checks.push('actual Menu + StoreNavTabs await shared scoped notification target; late old-store response cannot restore A');
  for (const width of [360, 768, 1440]) {
    await page.setViewport({width,height:960});
    await page.goto(`${origin}/store/menu?mode=menu`,{waitUntil:'load'});
    await page.waitForSelector('.store-menu-item-row'); await page.waitForSelector('[data-inventory-sync-attention]');
    assert.equal(await page.$eval('.store-menu-sync-dock-head',node=>node.getAttribute('aria-expanded')),'false','ordinary page never automatically opens details');
    if(width===360)await page.screenshot({path:resolve(output,'real-menu-collapsed-360.png'),fullPage:false});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'real menu has no horizontal overflow');
    await page.evaluate(() => window.scrollTo(0, 500)); await waitRead();
    const bounds = await page.evaluate(() => ({banner:document.querySelector('[data-inventory-sync-attention]').getBoundingClientRect().toJSON(),topbar:document.querySelector('.store-workbench-topbar').getBoundingClientRect().toJSON(),sticky:getComputedStyle(document.querySelector('.store-workbench-topbar')).position,headerBottom:document.querySelector('.store-workbench-topbar').getBoundingClientRect().bottom,contentTop:document.querySelector('.store-menu-page').getBoundingClientRect().top}));
    if (bounds.sticky === 'sticky') assert.ok(bounds.topbar.top >= bounds.banner.bottom - 1, 'sticky topbar and language controls do not hide under banner');
    else assert.ok(bounds.headerBottom <= bounds.contentTop + 1, 'relative header remains in flow and does not overlap operation controls');
    await page.screenshot({path:resolve(output,`real-menu-${width}.png`),fullPage:false});
  }
  checks.push('real menu/navigation at 360 / 768 / 1440; sticky header and language selector remain below measured warning');
  for (const width of [768,1440]) {
    await page.setViewport({width,height:960}); await page.goto(`${origin}/store/orders?mode=orders`,{waitUntil:'load'});
    await page.waitForSelector('[data-inventory-sync-attention]'); await waitRead();
    const bottom=await page.$eval('.store-orders-page',node=>node.getBoundingClientRect().bottom);
    assert.ok(bottom<=962, 'fixed-height order surface fits remaining viewport below banner');
  }
  checks.push('order-surface production markup at 768 / 1440 fits viewport after measured banner height');
  }
  await page.setViewport({width:360,height:960}); await page.goto(`${origin}/store/display/kitchen?native=1`,{waitUntil:'load'});
  await page.waitForSelector('[data-inventory-sync-attention]');
  assert.ok(await page.$eval('[data-inventory-sync-attention]',node=>node.getBoundingClientRect().height<55),'kitchen warning remains one compact row');
  assert.equal(await page.$eval('.store-menu-sync-feedback',node=>getComputedStyle(node).display),'none','kitchen does not automatically cover production with dock');
  await page.click('[data-inventory-sync-attention] button[aria-expanded]'); await page.waitForSelector('#store-inventory-sync-details');
  await page.screenshot({path:resolve(output,'kitchen-compact-360.png'),fullPage:false});
  for(const surface of ['/store/display/pickup','/store/display/courier','/store/pos/customer-display']) {
    await page.goto(`${origin}${surface}?native=1`,{waitUntil:'load'}); await waitRead();
    assert.equal(await page.$('[data-inventory-sync-attention]'),null,'public display has no internal warning');
    assert.equal(await page.evaluate(()=>window.__fixture.chimes),0,'public display never plays inventory chime');
    assert.equal(await page.evaluate(()=>window.__fixture.reads.length),0,'public display starts no inventory polling');
  }
  checks.push('kitchen compact warning opens only on tap; pickup/courier/POS customer displays show no internal alert, chime or inventory polling');
  assert.equal(errors.length, 0, errors.join('\n'));
  await page.goto(`${origin}/?mode=bell`,{waitUntil:'load'});
  await page.waitForFunction(()=>window.__fixture.notificationReads>=1&&document.querySelector('.notification-menu > summary > span')?.textContent==='1');
  await waitRead();
  const initialBellReads=await page.evaluate(()=>window.__fixture.notificationReads);
  await page.evaluate(()=>{window.__fixture.notifications={notifications:[],unreadCount:0};});
  await page.click('.notification-menu > summary');
  await page.waitForFunction(reads=>window.__fixture.notificationReads===reads+1&&document.querySelector('.notification-menu[open] .notification-empty'),{},initialBellReads);
  assert.equal(await page.$('.notification-menu > summary > span'),null,'opening refreshes the old unread count after the business-day scope changes');
  assert.equal(await page.$('.notification-menu[open] .notification-item'),null,'opening removes a cached old-business-day notice');
  await page.click('.notification-menu > summary');await waitRead();
  assert.equal(await page.evaluate(()=>window.__fixture.notificationReads),initialBellReads+1,'closing the bell starts no additional read');
  await page.evaluate(()=>{window.__fixture.notifications={notifications:[{id:'current-notice',title:'現在の営業日の通知',message:'current operation',href:'/store/menu',readAt:null}],unreadCount:1};});
  await page.click('.notification-menu > summary');
  await page.waitForFunction(reads=>window.__fixture.notificationReads===reads+2&&document.querySelector('.notification-menu[open] .notification-item')?.textContent.includes('現在の営業日'),{},initialBellReads);
  assert.equal(await page.$eval('.notification-menu > summary > span',node=>node.textContent),'1');
  await page.screenshot({path:resolve(output,'bell-refreshed-360.png'),fullPage:false});
  checks.push('actual notification bell refreshes on each opening, removes cached old-day notices/counts, shows fresh current-day notices and adds no read on close');
  assert.equal(errors.length,0,errors.join('\n'));
  await open();
  await page.evaluate(()=>{window.__fixture.runs.a=[];window.__refresh();});await waitRead();
  assert.ok(await page.evaluate(()=>window.__pollDelays.includes(60000)),'idle state schedules minute polling');
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
  const hiddenReads=await page.evaluate(()=>window.__fixture.reads.length);
  await page.evaluate(()=>window.__poll());await waitRead();
  assert.equal(await page.evaluate(()=>window.__fixture.reads.length),hiddenReads,'hidden inventory status does not poll');
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});await waitRead();
  assert.ok(await page.evaluate(reads=>window.__fixture.reads.length>reads,hiddenReads),'foreground wake refreshes immediately');
  checks.push('idle inventory sync polls once per minute, hidden status does not poll, foreground refresh remains immediate');

  await writeFile(resolve(output, 'result.json'), JSON.stringify({ passed: checks.length, checks, browserErrors: errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks, output }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
