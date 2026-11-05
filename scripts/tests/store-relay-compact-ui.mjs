// Actual cashier relay panel + translation provider, with local in-memory state.
// This fixture never sends orders, prints, refunds, or requests a real service.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, stop } from 'esbuild';
import puppeteer from 'puppeteer-core';

const output = resolve(process.env.STORE_RELAY_COMPACT_OUTPUT || 'outputs/store-relay-compact-20261019/ui');
await mkdir(output, { recursive: true });
const dictionaries = Object.fromEntries(await Promise.all(['zh-Hans', 'zh-Hant'].map(async language => [language, JSON.parse(await readFile(`public/locales/os/${language}.json`, 'utf8'))])));
const entry = `import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{StoreRelayPanel}from'./app/store/components/StoreRelayPanel';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
const params=new URLSearchParams(location.search);localStorage.setItem('foundr1-os-language',params.get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');
window.__calls=[];window.__prompts=[];window.__confirm=true;window.__hold=false;window.__failure='';window.__clock=Date.now();window.confirm=message=>{window.__prompts.push(message);return window.__confirm};
const stationA={id:'station-a',name:'レジ A',enabled:true,print_enabled:true,scale_enabled:true,epoch:1,owner_until:new Date(window.__clock+60000).toISOString(),device_online:true,device_paired:true,device_status:{scale:'connected',printer:'connected'},scale_session:null,scale_sequence:-1,scale_reading:null,scale_received_at:null};
const stationB={...stationA,id:'station-b',name:'レジ B'};
const owner={stationId:stationA.id,token:'fixture-owner',epoch:1};
const normalJobs=[{id:'pending-a',station_id:stationA.id,kind:'receipt',state:'pending',pickup_code:'201',sequence:1,error:'',reprintEligible:true},{id:'sending-a',station_id:stationA.id,kind:'kitchen',state:'sending',pickup_code:'202',sequence:2,error:'',reprintEligible:true}];
const refundJobs=[{id:'kitchen-a',station_id:stationA.id,kind:'kitchen',documentRole:'kitchen',state:'sent',pickup_code:'101',sequence:1,error:'',reprintEligible:true,voidEligible:false},{id:'finishing-a',station_id:stationA.id,kind:'kitchen',documentRole:'finishing',state:'sent',pickup_code:'101',sequence:2,error:'',reprintEligible:true,voidEligible:false},{id:'receipt-a',station_id:stationA.id,kind:'receipt',documentRole:'receipt',state:'sent',pickup_code:'D101',sequence:4,error:'',reprintEligible:true,voidEligible:false,receiptHasRefund:true},{id:'refunded-a',station_id:stationA.id,kind:'pickup',documentRole:'pickup',state:'uncertain',pickup_code:'102',sequence:3,error:'',reprintEligible:false,voidEligible:true}];
window.__fixtures={stationA,stationB,owner,normalJobs,refundJobs};
function App(){const[state,setState]=useState({storeId:'fixture-store-a',stations:[stationA],jobs:normalJobs,owner:params.get('owner')==='0'?null:owner,recoveringStationId:null,error:''});
window.__patch=patch=>setState(current=>({...current,...patch}));window.__resetCalls=()=>{window.__calls=[];window.__prompts=[]};
const relay={...state,station:state.stations.find(station=>station.id===state.owner?.stationId),required:state.stations.some(station=>station.enabled),now:()=>window.__clock,refresh:async()=>state.stations,action:async(action,extra)=>{window.__calls.push({action,extra});if(window.__hold)await new Promise(resolve=>{window.__release=resolve});if(window.__failure){setState(current=>({...current,error:window.__failure}));throw Error(window.__failure)}if(action==='claim'||action==='takeover')setState(current=>({...current,owner:{stationId:extra.stationId,token:'fixture-owner-next',epoch:extra.epoch+1},stations:current.stations.map(station=>station.id===extra.stationId?{...station,epoch:extra.epoch+1,owner_until:new Date(window.__clock+60000).toISOString()}:station)}));return{ok:true}}};
return <OsTranslationProvider><main className="store-workbench-shell store-pos-page" style={{maxWidth:1100,margin:'0 auto'}}><StoreRelayPanel relay={relay} storeId={state.storeId}/><section className="panel" data-pos-checkout><h2>店頭会計</h2><button type="button" className="primary-button">商品を追加</button><p>称重・商品選択・会計エリア</p></section></main></OsTranslationProvider>};createRoot(document.getElementById('root')).render(<App/>);`;

let browser, server, context, page;
const errors = [], external = [], unexpected = [], checks = [], screenshots = [];
const abortTimer = setTimeout(() => { console.error('Relay compact UI exceeded 150 seconds'); process.exitCode = 1; void browser?.close(); server?.closeAllConnections(); server?.close(); stop(); }, 150000);
abortTimer.unref();
try {
  const bundled = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', charset: 'utf8', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
  const js = bundled.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = (await Promise.all(['app/globals.css', 'app/store/store-responsive.css', 'app/store/store-theme.css'].map(file => readFile(file, 'utf8')))).join('\n') + '\n' + (bundled.outputFiles.find(file => file.path.endsWith('.css'))?.text || '');
  server = createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture');
    if (url.pathname === '/fixture.js') { response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); response.end(js); return; }
    if (url.pathname.startsWith('/locales/os/')) { response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(dictionaries[url.pathname.includes('Hant') ? 'zh-Hant' : 'zh-Hans'])); return; }
    if (url.pathname === '/' || url.pathname === '/fixture') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`); return; }
    if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    unexpected.push({ method: request.method, path: url.pathname }); response.writeHead(404); response.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const panel = 'main > section:first-child';
  const toggle = `${panel} button[aria-expanded][aria-controls]`;
  const translated = (source, language = 'ja') => dictionaries[language]?.[source] || source;
  async function open({ width = 768, height = 1024, language = 'ja', owner = true } = {}) {
    if (context) await context.close(); context = await browser.createBrowserContext(); page = await context.newPage();
    page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width <= 1024, hasTouch: width <= 1024 });
    await page.setRequestInterception(true); page.on('request', request => { if (request.url().startsWith(origin + '/') || request.url().startsWith('data:')) request.continue(); else { external.push(request.url()); request.abort(); } });
    await page.goto(`${origin}/fixture?lang=${language}&owner=${owner ? 1 : 0}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector(toggle);
    await page.waitForFunction(language => document.documentElement.lang === language, {}, language);
    if (language !== 'ja') await page.waitForFunction(expected => document.querySelector('main > section:first-child button[aria-expanded]').textContent.includes(expected), {}, translated(owner ? '接続・印刷の詳細' : '接続設定を開く', language));
  }
  async function visibleText() { return page.$eval(panel, element => element.innerText); }
  async function expanded(expected) {
    await page.waitForFunction(({ selector, expected }) => document.querySelector(selector)?.getAttribute('aria-expanded') === String(expected), {}, { selector: toggle, expected });
    const result = await page.$eval(toggle, button => { const id = button.getAttribute('aria-controls'); const content = document.getElementById(id); return { validControl: Boolean(content), hidden: content?.hidden, buttonHeight: button.getBoundingClientRect().height }; });
    assert.equal(result.validControl, true); assert.equal(result.hidden, !expected); assert.ok(result.buttonHeight >= 44, `toggle touch target ${result.buttonHeight}`);
  }
  async function fits(label) {
    const result = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(result.document <= result.width + 1 && result.body <= result.width + 1, `${label}: horizontal overflow ${JSON.stringify(result)}`);
  }
  async function capture(label) { await fits(label); const path = `${output}/${label}.png`; await page.screenshot({ path, fullPage: true }); screenshots.push(path); }
  async function clickText(text) { assert.equal(await page.$eval(panel, (element, text) => { const button = [...element.querySelectorAll('button')].find(button => button.textContent.trim() === text && button.getClientRects().length); if (!button) return false; button.click(); return true; }, text), true, `visible button ${text}`); }
  async function setPatch(patch) { await page.evaluate(patch => window.__patch(patch), patch); }
  async function printDetails() { await page.click(toggle); await expanded(true); await page.$eval(`${panel} details`, element => { element.open = true; }); }

  // The normal compact state must leave the actual checkout below it available.
  for (const language of ['ja', 'zh-Hans', 'zh-Hant']) for (const [width, height] of [[390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
    await open({ width, height, language }); await expanded(false);
    const text = await visibleText(); assert.ok(text.includes(translated('この端末で会計中', language)), `${language}: current owner`);
    assert.ok(text.includes(translated('中継スマホ：オンライン', language)), `${language}: relay phone status`);
    assert.ok(text.includes(translated('はかり：接続済み', language)), `${language}: scale status`);
    assert.ok(text.includes(translated('印刷処理中：{count}件', language).replace('{count}', '2')), `${language}: pending/sending remain a normal processing count`);
    assert.equal(await page.$$eval(`${panel} [role="alert"], ${panel} [role="status"]`, elements => elements.filter(element => element.getClientRects().length).length), 0, `${language}: normal jobs are not warnings`);
    assert.ok(!text.includes('201') && !text.includes('202'), `${language}: print job body is hidden`);
    const bounds = await page.$eval(panel, element => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, height: rect.height }; });
    if (width === 768 || width === 1024) assert.ok(bounds.height <= 90, `${language} ${width}: compact height ${bounds.height}`);
    const checkout = await page.$eval('[data-pos-checkout]', element => element.getBoundingClientRect().top);
    assert.ok(checkout < height / 2, `${language} ${width}: checkout displaced to ${checkout}`);
    await capture(`compact-owner-${language}-${width}`);
    await page.click(toggle); await expanded(true); await capture(`expanded-owner-${language}-${width}`);
    await page.click(toggle); await expanded(false);
    checks.push({ case: 'responsive compact and expanded', language, width, height, compactHeight: bounds.height, checkoutTop: checkout });
  }

  await open(); await page.focus(toggle); await page.keyboard.press('Enter'); await expanded(true); await page.keyboard.press('Space'); await expanded(false);
  await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement?.closest('div[hidden]') !== null), false);
  checks.push({ case: 'keyboard Enter/Space and hidden content are accessible' });

  await open({ owner: false }); await expanded(false);
  assert.equal(await page.$eval(toggle, button => button.textContent.trim()), '接続設定を開く');
  await page.evaluate(() => window.__patch({ stations: [{ ...window.__fixtures.stationA, owner_until: null }] }));
  await page.click(toggle); await expanded(true); await clickText('この端末で会計を始める'); await expanded(false);
  assert.deepEqual(await page.evaluate(() => window.__calls), [{ action: 'claim', extra: { stationId: 'station-a', epoch: 1 } }]);
  checks.push({ case: 'explicit claim succeeds then closes details' });

  await open({ owner: false }); await page.click(toggle); await expanded(true);
  await page.evaluate(() => { window.__confirm = false; }); await clickText('この端末に会計を引き継ぐ');
  assert.deepEqual(await page.evaluate(() => window.__calls), []); await expanded(true);
  assert.equal((await page.evaluate(() => window.__prompts)).length, 1);
  await page.evaluate(() => { window.__confirm = true; }); await clickText('この端末に会計を引き継ぐ'); await expanded(false);
  assert.deepEqual(await page.evaluate(() => window.__calls), [{ action: 'takeover', extra: { stationId: 'station-a', epoch: 1 } }]);
  checks.push({ case: 'takeover cancellation does nothing; confirmation takes over and closes details' });

  await open({ owner: false }); await page.evaluate(() => { window.__failure = 'fixture connection failed'; window.__patch({ stations: [{ ...window.__fixtures.stationA, owner_until: null }] }); });
  await page.click(toggle); await clickText('この端末で会計を始める'); await expanded(true);
  await page.waitForFunction(() => document.querySelector('main > section:first-child').innerText.includes('fixture connection failed'));
  await page.click(toggle); await expanded(false); assert.match(await visibleText(), /fixture connection failed/);
  checks.push({ case: 'failed claim stays expanded and errors remain visible after collapse' });

  await open({ owner: false }); await page.evaluate(() => window.__patch({ recoveringStationId: 'station-a' })); await expanded(false);
  assert.match(await visibleText(), /再接続/); assert.deepEqual(await page.evaluate(() => window.__calls), []);
  await page.click(toggle); await expanded(true);
  assert.equal(await page.$eval(panel, element => [...element.querySelectorAll('button')].some(button => /会計を始める|会計を引き継ぐ/.test(button.textContent) && button.getClientRects().length)), false);
  await page.evaluate(() => window.__patch({ owner: window.__fixtures.owner, recoveringStationId: null })); await expanded(true);
  await page.evaluate(() => window.__patch({ stations: [{ ...window.__fixtures.stationA, scale_sequence: 2 }] })); await expanded(true);
  assert.deepEqual(await page.evaluate(() => window.__calls), []);
  checks.push({ case: 'recovery shows state without claim actions; recovery and ordinary polling preserve manual expansion' });
  await setPatch({ storeId: 'fixture-store-b' }); await expanded(false); checks.push({ case: 'switching stores closes previous store details' });

  await open();
  await page.evaluate(() => window.__patch({ stations: [window.__fixtures.stationA, { ...window.__fixtures.stationB, device_online: false, device_status: { scale: 'disconnected' } }, { ...window.__fixtures.stationA, id: 'disabled-station', name: '旧レジ C', enabled: false }], jobs: [
    ...window.__fixtures.normalJobs,
    { id: 'other-uncertain', station_id: 'station-b', kind: 'receipt', state: 'uncertain', pickup_code: 'B301', sequence: 1, error: '' },
    { id: 'owner-error', station_id: 'station-a', kind: 'receipt', state: 'pending', pickup_code: 'A302', sequence: 3, error: 'fixture printer out of paper' },
    { id: 'other-cancelled', station_id: 'station-b', kind: 'receipt', state: 'cancelled', pickup_code: 'B303', sequence: 2, error: 'cancelled fixture' },
    { id: 'resolved-history', station_id: 'station-a', kind: 'receipt', state: 'sent', pickup_code: 'A305', sequence: 4, error: 'historical failure before confirmation' },
    { id: 'disabled-station', station_id: 'disabled-station', kind: 'receipt', state: 'uncertain', pickup_code: 'D304', sequence: 2, error: '' }
  ] }));
  await page.waitForFunction(() => document.querySelector('main > section:first-child').innerText.includes('印刷結果の確認：3件'));
  await expanded(false); const warningText = await visibleText(); assert.match(warningText, /レジ A/); assert.match(warningText, /印刷結果の確認：3件/);
  assert.ok(!warningText.includes('B303') && !warningText.includes('D304'), 'collapsed summary shows an aggregate without exposing full job rows');
  await capture('compact-multiple-stations-print-issues-768');
  await page.click(toggle); await expanded(true); const expandedText = await visibleText(); assert.match(expandedText, /レジ A/); assert.match(expandedText, /レジ B/); assert.match(expandedText, /旧レジ C/); assert.match(expandedText, /未接続/); assert.match(expandedText, /管理者/);
  assert.equal(await page.$eval(panel, element => [...element.querySelectorAll('button')].filter(button => /会計を始める|会計を引き継ぐ/.test(button.textContent) && button.getClientRects().length).length), 1, 'only the enabled other register has a claim/takeover action');
  await capture('expanded-multiple-stations-print-issues-768');
  checks.push({ case: 'collapsed print issues cover all store jobs including disabled registers; names and connection status remain distinguishable; cancelled and resolved historical errors excluded; disabled-register issue requires a manager', warningText });

  for (const [width, height] of [[390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
    await open({ width, height });
    await page.evaluate(() => window.__patch({ stations: [{ ...window.__fixtures.stationA, name: 'RegisterWithAVeryLongContinuousEnglishName'.repeat(4) }, window.__fixtures.stationB] }));
    await expanded(false); await capture(`compact-long-register-name-ja-${width}`);
    await page.click(toggle); await expanded(true); await capture(`expanded-long-register-name-ja-${width}`);
    checks.push({ case: 'long continuous register names wrap without overflow in compact and expanded views', width });
  }

  // Keep the physical-print confirmation and refund restrictions through nesting.
  for (const language of ['ja', 'zh-Hans', 'zh-Hant']) {
    await open({ language }); await page.evaluate(() => window.__patch({ jobs: window.__fixtures.refundJobs })); await printDetails();
    const text = await visibleText(); assert.ok(text.includes(translated('厨房伝票', language))); assert.ok(text.includes(translated('出品伝票', language)));
    assert.ok(text.includes(translated('返金あり：金額は返金前の元会計です。', language)));
    const reprint = translated('再印刷', language), confirmSent = translated('印刷済みを確認', language), voidRefund = translated('確認して伝票を無効化', language);
    assert.equal(await page.$$eval(`${panel} details button`, (buttons, reprint) => buttons.filter(button => button.textContent.trim() === reprint).length, reprint), 3);
    await page.evaluate(() => { window.__confirm = false; }); await clickText(reprint); await clickText(confirmSent); await clickText(voidRefund);
    assert.deepEqual(await page.evaluate(() => window.__calls), []);
    await page.evaluate(() => { window.__confirm = true; window.__hold = true; }); await clickText(voidRefund); await clickText(voidRefund);
    assert.deepEqual(await page.evaluate(() => window.__calls), [{ action: 'voidRefunded', extra: { jobId: 'refunded-a', confirmed: true } }]);
    assert.equal(await page.$$eval(`${panel} details button`, buttons => buttons.every(button => button.disabled)), true);
    await page.evaluate(() => { window.__hold = false; window.__release(); }); await page.waitForFunction(selector => [...document.querySelectorAll(selector)].every(button => !button.disabled), {}, `${panel} details button`);
    await clickText(reprint); await clickText(confirmSent);
    assert.deepEqual((await page.evaluate(() => window.__calls)).slice(-2), [{ action: 'reprint', extra: { jobId: 'kitchen-a' } }, { action: 'confirmSent', extra: { jobId: 'refunded-a' } }]);
    const prompts = await page.evaluate(() => window.__prompts); assert.ok(prompts.includes(translated('返金・キャンセル済みの伝票を無効にして、次の印刷へ進めます。現物を確認し、印刷済み・遅れて出る伝票を使用しないことを確認しましたか。', language)));
    checks.push({ case: 'print, reprint and refund-void retain confirmation, duplicate suppression and eligibility', language });
  }

  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(unexpected, []);
  await writeFile(`${output}/verification.json`, JSON.stringify({ passed: true, checks, screenshots, pageErrors: errors, externalRequests: external, unexpectedRequests: unexpected, realApiMutations: false, hardwareVerified: false }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, checkGroups: checks.length, screenshots: screenshots.length, report: `${output}/verification.json` }));
} catch (error) {
  if (page) { await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {}); await writeFile(`${output}/failure.txt`, `${error.stack}\n\n${await page.content().catch(() => '')}`).catch(() => {}); }
  throw error;
} finally {
  clearTimeout(abortTimer);
  await browser?.close();
  if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  stop();
}
