// Actual POS page with local reconciliation fixtures. No production, database,
// Bluetooth, printers, external payment, or customer checkout is accessed.
import { build, stop } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const output = resolve(process.env.POS_CASH_OPEN_UI_OUTPUT || 'outputs/pos-cash-open-dropdown-20261019/ui');
await mkdir(output, { recursive: true });
const baseline = Boolean(process.env.POS_CASH_OPEN_UI_BASELINE);
const layoutOnly = Boolean(process.env.POS_CASH_OPEN_UI_LAYOUT_ONLY);
const dictionaries = Object.fromEntries(await Promise.all(['zh-Hans', 'zh-Hant'].map(async language => [language, JSON.parse(await readFile(`public/locales/os/${language}.json`, 'utf8'))])));
const stores = [{ id: 'fixture-sakura', name: '桜並木店' }, { id: 'fixture-other', name: '別店舗' }];
const manager = { id: 'fixture-manager', name: 'Fixture 責任者', role: 'manager', punchedAt: '', attendanceStatus: 'manager', scheduledStart: '', scheduledEnd: '' };
const denominations = [10000, 5000, 2000, 1000, 500, 100, 50, 10, 5, 1];
const zeroBreakdown = Object.fromEntries(denominations.map(value => [String(value), 0]));
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import Pos from './app/store/pos/page';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';import{StoreThemeProvider}from'./app/store/components/StoreThemeProvider';
localStorage.setItem('foundr1-os-language',new URLSearchParams(location.search).get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');
createRoot(document.getElementById('root')).render(<OsTranslationProvider><StoreThemeProvider employeeId="fixture-employee"><Pos/></StoreThemeProvider></OsTranslationProvider>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', charset: 'utf8', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'cash-fixture', setup(b) {
  if (process.env.POS_CASH_OPEN_UI_BASELINE_SOURCE) b.onLoad({ filter: /app\/store\/pos\/page\.tsx$/ }, async () => ({ contents: await readFile(resolve(process.env.POS_CASH_OPEN_UI_BASELINE_SOURCE), 'utf8'), loader: 'tsx', resolveDir: resolve('app/store/pos') }));
  b.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: 'fixture-navigation' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture-navigation' }, args => ({ contents: args.path === 'next/link' ? `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}` : `export const usePathname=()=>location.pathname;export const useRouter=()=>({push:url=>location.assign(url)});`, loader: 'js', resolveDir: process.cwd() }));
  b.onResolve({ filter: /shared-pusher-client$/ }, args => ({ path: args.path, namespace: 'fixture-pusher' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture-pusher' }, () => ({ contents: `const handlers=new Map();window.__cashFixtureEmit=(event,payload)=>{for(const fn of handlers.get(event)||[])fn(payload)};export function acquireSharedPusher(){return{connection:{bind(){}},subscribe(){return{name:'private-cash-fixture',bind(event,fn){if(!handlers.has(event))handlers.set(event,new Set());handlers.get(event).add(fn);if(event==='pusher:subscription_succeeded')queueMicrotask(fn)},unbind(event){handlers.delete(event)}}},unsubscribe(){},disconnect(){}}}`, loader: 'js' }));
} }] });
const css = (await readFile('app/globals.css', 'utf8')) + '\n' + (await readFile('app/store/store-responsive.css', 'utf8')) + '\n' + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text || '');
const digest = contents => createHash('sha256').update(contents).digest('hex');
await writeFile(`${output}/${baseline ? 'baseline-' : ''}source-hashes.json`, JSON.stringify({ cwd: process.cwd(), baselineSource: process.env.POS_CASH_OPEN_UI_BASELINE_SOURCE || null, bundleSha256: digest(bundle.outputFiles.find(file => file.path.endsWith('.js')).text), renderedCssSha256: digest(css), sources: Object.fromEntries(await Promise.all(['app/store/pos/page.tsx', ...(baseline ? [] : ['app/store/pos/cash-feedback.module.css']), 'app/globals.css', 'app/store/store-responsive.css', 'public/locales/os/zh-Hans.json', 'public/locales/os/zh-Hant.json', 'scripts/tests/pos-cash-open-ui.mjs'].map(async path => [path, digest(await readFile(path === 'app/store/pos/page.tsx' && process.env.POS_CASH_OPEN_UI_BASELINE_SOURCE ? resolve(process.env.POS_CASH_OPEN_UI_BASELINE_SOURCE) : path))]))) }, null, 2) + '\n');
await writeFile(`${output}/executed-pos-cash-open-ui.mjs`, await readFile('scripts/tests/pos-cash-open-ui.mjs'));
if (process.env.POS_CASH_OPEN_UI_SOURCE_ONLY) { stop(); process.exit(0); }
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
function createReconciliation({ previous = 10000 } = {}) {
  return {
    businessDate: '2026-10-19',
    businessState: { businessDate: '2026-10-19', status: 'before_open', statusLabel: '開店準備', detailLabel: '開店準備時間です。開始金額を確認してから POS 会計を開始してください。', openLabel: '11:00', closeLabel: '22:00', tone: 'off' },
    activeSession: null,
    previousClosedSession: previous === null ? null : { id: 'fixture-closed-session', businessDate: '2026-10-19', countedCashAmount: previous, closedAt: '2026-10-19 12:03:31.89422+00', closedByName: 'Fixture 前班担当' },
    sessions: [], movements: [], activeCashResponsibleEmployees: [manager]
  };
}
let reconciliationByStore, posts, checkoutWrites, rejectOpen, reads, responseDelay;
function reset(options = {}) {
  reconciliationByStore = Object.fromEntries(stores.map(store => [store.id, createReconciliation(options)]));
  posts = []; reads = []; checkoutWrites = 0; rejectOpen = false; responseDelay = 0;
}
reset();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const send = (res, body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/fixture.js') { res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); return res.end(bundle.outputFiles.find(file => file.path.endsWith('.js')).text); }
    if (url.pathname.startsWith('/locales/os/')) return send(res, dictionaries[url.pathname.includes('Hant') ? 'zh-Hant' : 'zh-Hans']);
    if (url.pathname === '/api/auth/me') return send(res, { employee: { id: 'fixture-employee', name: 'Fixture', role: 'owner' } });
    if (url.pathname === '/api/store/context') return send(res, { selectedStoreId: url.searchParams.get('storeId') || stores[0].id, access: { role: 'owner', canUseAllStoreView: true, stores } });
    if (url.pathname === '/api/store/realtime-config') return send(res, { key: 'local-fixture', cluster: 'local-fixture', channels: ['private-cash-fixture'] });
    if (url.pathname === '/api/store/pos/operator') return send(res, { enabled: false, settings: { enabled: false, idleMinutes: 10 }, operator: null, employees: [], serverNow: new Date().toISOString() });
    if (url.pathname === '/api/store/pos/customer-display') return send(res, { state: { status: 'advertising', weighingRevision: 0 }, customerDisplayMediaSettings: { weighing: { enabled: false } } });
    if (url.pathname === '/api/store/pos/reconciliation') {
      if (req.method !== 'POST') { const storeId = url.searchParams.get('storeId') || stores[0].id; reads.push(storeId); return send(res, reconciliationByStore[storeId]); }
      let raw = ''; for await (const part of req) raw += part;
      const body = JSON.parse(raw); posts.push(body);
      assert.equal(body.action, 'open', 'Only fixture cash-opening requests are permitted');
      if (responseDelay) await pause(responseDelay);
      if (rejectOpen) return send(res, { error: 'Fixture: 開店確認を保存できませんでした。' }, 503);
      const openingAmount = Object.entries(body.openingBreakdown).reduce((sum, [value, count]) => sum + Number(value) * Number(count || 0), 0);
      const previous = reconciliationByStore[body.storeId].previousClosedSession;
      if (previous && previous.countedCashAmount !== openingAmount && !body.note?.trim()) return send(res, { error: '前回レジ締め金額と開始金額が違うため理由を入力してください。' }, 400);
      const next = { ...reconciliationByStore[body.storeId], activeSession: { id: 'fixture-open-session', businessDate: '2026-10-19', status: 'open', openingAmount, expectedCashAmount: openingAmount, openedAt: '2026-10-19T02:00:00.000Z', openedByName: 'Fixture', cashSales: 0, cashIn: 0, cashOut: 0 } };
      reconciliationByStore[body.storeId] = next; return send(res, next);
    }
    if (url.pathname === '/api/store/pos') {
      if (req.method === 'POST') { checkoutWrites++; return send(res, { error: 'Customer checkout is forbidden in this fixture' }, 403); }
      return send(res, { selectedStoreId: url.searchParams.get('storeId') || stores[0].id, access: { role: 'owner', stores }, brands: [{ id: 'fixture-brand', name: 'まぁ麻' }], categories: [], items: [], optionGroups: [], todaySummary: { orderCount: 0, total: 0, average: 0, latestOrders: [] }, posSettings: { dineInEnabled: true, takeoutEnabled: true, printerSettings: { enabled: false, customerDisplay: { enabled: false } }, customerDisplayMediaSettings: { weighing: { enabled: false } } } });
    }
    if (url.pathname.includes('/device-relay')) return send(res, { stations: [], jobs: [], canManage: true, serverNow: new Date().toISOString() });
    if (url.pathname.startsWith('/api/')) return send(res, {});
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
  } catch (error) { res.writeHead(500); res.end(error.stack); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [], pageErrors = [], externalRequests = [];
const modal = '.store-pos-cash-dialog', form = '.store-pos-cash-start';
const reasonSelect = `${form} .store-pos-handover-note select`;
const submit = `${form} > button.primary-button`, note = `${form} .store-pos-handover-note input`, firstCount = `${form} .store-pos-denomination-grid label:first-child select`;
const blocked = '#store-pos-open-blocked-reason';
let currentPage;
async function newPage({ width = 768, height = 1024, language = 'ja' } = {}) {
  const context = await browser.createBrowserContext(), page = await context.newPage(); currentPage = page;
  const errors = []; page.on('pageerror', error => { errors.push(error.message); pageErrors.push(error.message); });
  await page.setViewport({ width, height });
  await page.emulateTimezone(width===768?'UTC':'America/Los_Angeles');
  await page.setRequestInterception(true); page.on('request', request => { if (request.url().startsWith(base + '/')) return request.continue(); externalRequests.push(request.url()); return request.abort(); });
  await page.goto(`${base}/store/pos?lang=${language}`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.waitForSelector('.store-pos-cash-strip .primary-button');
  if (language !== 'ja') await page.waitForFunction(lang => document.documentElement.lang === lang, {}, language);
  if(reconciliationByStore[stores[0].id].previousClosedSession){
    await page.waitForSelector('[data-pos-last-close]');const text=await page.$eval('[data-pos-last-close]',el=>el.textContent);assert(text.includes('10/19 21:03'),text);assert(!text.includes('17:17'),text);assert(!text.includes('閉店'),text);results.push({name:'latest-close-JST-'+width+'-'+language,passed:true});
  }else assert.equal(await page.$('[data-pos-last-close]'),null);
  await page.click('.store-pos-cash-strip .primary-button'); await page.waitForSelector(form); await pause(80);
  return { page, context, errors };
}
async function enabled(page, value) { await page.waitForFunction((selector, expected) => document.querySelector(selector)?.disabled === !expected, {}, submit, value); }
async function setAmount(page, count) { await page.select(firstCount, String(count)); }
async function fillReason(page, value) { await page.$eval(note, (input, value) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }, value); }
const presetReasons = ['釣銭準備金を補充', '前日売上を回収', '両替のため現金を調整'];
async function chooseReason(page, label) {
  const value = await page.$eval(reasonSelect, (select, label) => {
    const option = [...select.options].find(option => option.textContent.trim() === label);
    if (!option) throw new Error(`Missing Japanese reason option: ${label}`);
    return option.value;
  }, label);
  await page.select(reasonSelect, value);
}
async function assertJapaneseReasons(page) {
  const options = await page.$eval(reasonSelect, select => [...select.options].map(option => ({ value: option.value, label: option.textContent.trim() })));
  assert.equal(options[0].value, '', 'Reason placeholder must be empty, never auto-select a financial reason');
  assert.match(options[0].label, /選択/);
  assert.deepEqual(options.slice(1).map(option => option.label), [...presetReasons, 'その他']);
  return options;
}
async function layout(page) {
  const info = await page.evaluate(({ modal, form }) => {
    const d = document.querySelector(modal), f = document.querySelector(form), r = d.getBoundingClientRect();
    const selects = [...f.querySelectorAll('select')].map(el => el.getBoundingClientRect().width);
    const reasonSelect = f.querySelector('.store-pos-handover-note select');
    const reasonSelectGeometry = reasonSelect ? { width: reasonSelect.getBoundingClientRect().width, height: reasonSelect.getBoundingClientRect().height, fontSize: getComputedStyle(reasonSelect).fontSize } : null;
    const buttons = [...f.querySelectorAll('button')].map(el => ({ text: el.textContent, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
    return { documentWidth: innerWidth, documentScrollWidth: document.documentElement.scrollWidth, dialog: { x: r.x, right: r.right, width: r.width, clientWidth: d.clientWidth, scrollWidth: d.scrollWidth }, selects, reasonSelectGeometry, buttons };
  }, { modal, form });
  assert.ok(info.documentScrollWidth <= info.documentWidth + 1, `Document horizontal overflow: ${JSON.stringify(info)}`);
  assert.ok(info.dialog.x >= -1 && info.dialog.right <= info.documentWidth + 1, 'Dialog must fit viewport');
  assert.ok(info.dialog.scrollWidth <= info.dialog.clientWidth + 1, 'Dialog must not overflow horizontally');
  assert.ok(info.selects.every(width => width >= 55), `Native denomination selector arrow must not cover count: ${JSON.stringify(info)}`);
  if (layoutOnly) { assert.ok(info.reasonSelectGeometry && info.reasonSelectGeometry.height >= 42, `Reason select requires a usable 42px control: ${JSON.stringify(info)}`); }
  return info;
}
async function visibleAlert(page) {
  await page.waitForSelector(`${modal} [role="alert"]`);
  return page.$eval(`${modal} [role="alert"]`, async el => {
    el.scrollIntoView({ block: 'nearest' }); await new Promise(resolve => requestAnimationFrame(resolve));
    const r = el.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { text: el.textContent, visible: r.width > 0 && r.height > 0 && (top === el || el.contains(top)), x: r.x, y: r.y };
  });
}
async function expectOpen(page, expectedAmount, expectedNote = '') {
  await page.click(submit); await page.waitForSelector(modal, { hidden: true });
  assert.equal(posts.length, 1); const body = posts[0]; assert.equal(body.action, 'open'); assert.equal(body.storeId, stores[0].id); assert.equal(body.note, expectedNote);
  assert.equal(Object.entries(body.openingBreakdown).reduce((sum, [value, count]) => sum + Number(value) * Number(count || 0), 0), expectedAmount);
  assert.equal(checkoutWrites, 0);
}
try {
  if (baseline) {
    for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
      reset(); const { page, context, errors } = await newPage(viewport); await setAmount(page, 1); await enabled(page, true); await setAmount(page, 2); await enabled(page, false);
      const state = await page.$eval(form, el => ({ text: el.innerText, hasExplicitReasonHelp: Boolean(el.querySelector('#store-pos-open-blocked-reason')), reason: el.querySelector('.store-pos-handover-note input')?.value }));
      assert.equal(state.hasExplicitReasonHelp, false); assert.equal(state.reason, ''); assert.equal(posts.length, 0);
      await page.screenshot({ path: `${output}/baseline-${viewport.width}-difference-disabled.png`, fullPage: true });
      await page.type(note, '釣銭準備金を補充'); await enabled(page, true); rejectOpen = true; await page.click(submit); await page.waitForSelector('.store-pos-notice'); await enabled(page, true);
      const failure = await page.evaluate(({modal}) => { const n = document.querySelector('.store-pos-notice'), r = n.getBoundingClientRect(), top = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return { noticeZ: getComputedStyle(n).zIndex, overlayZ: getComputedStyle(document.querySelector('.store-pos-cash-overlay')).zIndex, covered: top !== n && !n.contains(top), modalContainsFailure: document.querySelector(modal).innerText.includes('Fixture:') }; }, {modal});
      assert.equal(failure.covered, true); assert.equal(failure.modalContainsFailure, false); assert.deepEqual(errors, []);
      results.push({ name: `baseline-${viewport.width}`, viewport, state, failure, passed: true }); await context.close();
    }
  } else {
    for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
      reset(); const { page, context, errors } = await newPage(viewport);
      await setAmount(page, 2); await enabled(page, false);
      const options = await assertJapaneseReasons(page);
      assert.equal(await page.$eval(reasonSelect, el => el.value), '', 'No reason may be preselected');
      assert.equal(await page.$(note), null, 'Custom text must only appear after Other is chosen');
      const explanation = await page.$eval(blocked, el => ({ text: el.textContent, hidden: el.hidden })); assert.match(explanation.text, /理由/); assert.equal(explanation.hidden, false);
      const disabledBackground = await page.$eval(submit, el => getComputedStyle(el).backgroundColor);
      assert.equal(posts.length, 0); const geometry = await layout(page);
      await page.screenshot({ path: `${output}/ja-${viewport.width}-dropdown-required.png`, fullPage: true });
      if (!layoutOnly) { await setAmount(page, 1); await enabled(page, true); assert.notEqual(await page.$eval(submit, el => getComputedStyle(el).backgroundColor), disabledBackground, 'Disabled opening must have a distinct background'); await expectOpen(page, 10000); } else assert.equal(posts.length, 0); assert.deepEqual(errors, []);
      results.push({ name: `same-amount-and-required-dropdown-${viewport.width}`, passed: true, viewport, geometry, options }); await context.close();
    }
    if (!layoutOnly) {
    for (const reason of presetReasons) {
      reset(); const { page, context, errors } = await newPage(); await setAmount(page, 2); await enabled(page, false);
      await chooseReason(page, reason); await enabled(page, true); assert.equal(await page.$(note), null);
      assert.equal(posts.length, 0, 'Selecting a reason must not submit opening'); await expectOpen(page, 20000, reason);
      assert.deepEqual(errors, []); results.push({ name: `selected-Japanese-reason-${reason}`, passed: true }); await context.close();
    }
    reset(); {
      const { page, context, errors } = await newPage({width:390,height:844}); await setAmount(page, 2); await chooseReason(page, 'その他'); await page.waitForSelector(note); await enabled(page, false);
      await fillReason(page, '   '); await enabled(page, false); assert.equal(posts.length, 0);
      await fillReason(page, '店長が釣銭を追加'); await enabled(page, true);
      await chooseReason(page, presetReasons[0]); await enabled(page, true); assert.equal(await page.$(note), null);
      await chooseReason(page, 'その他'); await page.waitForSelector(note); await enabled(page, false); assert.equal(await page.$eval(note, el => el.value), '', 'Returning to Other must discard the prior custom text');
      await page.select(reasonSelect, ''); await enabled(page, false); assert.equal(await page.$(note), null);
      await chooseReason(page, 'その他'); await page.waitForSelector(note); assert.equal(await page.$eval(note, el => el.value), ''); await fillReason(page, '本部から釣銭を追加'); await enabled(page, true);
      await page.screenshot({ path: `${output}/ja-390-other-custom-reason.png`, fullPage: true }); await expectOpen(page,20000,'本部から釣銭を追加'); assert.deepEqual(errors,[]);
      results.push({name:'other-requires-non-whitespace-and-switch-clears-custom',passed:true}); await context.close();
    }
    reset(); {
      const { page, context, errors } = await newPage({width:390,height:844}); await setAmount(page, 2); await chooseReason(page,'その他'); await page.waitForSelector(note); await fillReason(page, '店長が釣銭を追加'); await enabled(page,true);
      rejectOpen = true; responseDelay = 350; await page.click(submit); await enabled(page,false);
      assert.equal(await page.$eval(reasonSelect, el => el.disabled),true); assert.equal(await page.$eval(note, el => el.disabled),true); assert.equal(await page.$eval(firstCount, el => el.disabled),true); await page.click(submit);
      const alert=await visibleAlert(page); assert.equal(alert.visible,true); assert.match(alert.text,/Fixture:/); await enabled(page,true);
      assert.equal(posts.length,1,'Pending save must not duplicate requests'); assert.equal(await page.$eval(firstCount,el=>el.value),'2'); assert.equal(await page.$eval(reasonSelect,el=>el.selectedOptions[0].textContent),'その他'); assert.equal(await page.$eval(note,el=>el.value),'店長が釣銭を追加'); assert.equal(posts[0].note,'店長が釣銭を追加');
      await page.screenshot({path:`${output}/ja-390-failure-visible-selection-kept.png`,fullPage:true});
      rejectOpen=false; responseDelay=0; await page.click(submit); await page.waitForSelector(modal,{hidden:true}); assert.equal(posts.length,2); assert.equal(posts[1].note,'店長が釣銭を追加'); assert.equal(checkoutWrites,0); assert.deepEqual(errors,[]);
      results.push({name:'modal-error-keeps-dropdown-and-custom-text-no-duplicate-save',passed:true,alert,failedAndRetryRequests:posts}); await context.close();
    }
    reset({previous:null}); {
      const { page, context, errors }=await newPage(); await setAmount(page,2); await enabled(page,true); assert.equal(await page.$(reasonSelect),null); assert.equal(await page.$(note),null); await expectOpen(page,20000); assert.deepEqual(errors,[]);
      results.push({name:'first-opening-needs-no-difference-reason',passed:true}); await context.close();
    }
    }
    for (const language of ['zh-Hans','zh-Hant']) {
      reset(); const { page, context, errors }=await newPage({language,width:390,height:844}); await setAmount(page,2); await enabled(page,false); await pause(250);
      const options=await assertJapaneseReasons(page);
      const reasonLabel=await page.$eval(`${form} .store-pos-handover-note`,el=>el.innerText); assert.match(reasonLabel,/引継ぎ差額理由/);
      for(const option of presetReasons) assert.ok(!options.some(item=>item.label===dictionaries[language][option]),'Reason choices must remain Japanese under global Chinese language');
      const summary=await page.$eval(`${form} .store-pos-handover-summary`,el=>el.innerText);
      assert.ok(summary.includes(dictionaries[language]['前回レジ締め {date}'].replace('{date}','10/19 21:03'))); assert.ok(summary.includes(dictionaries[language]['引継ぎ差額 {amount}'].replace('{amount}','¥10,000')));
      await chooseReason(page,'その他'); await page.waitForSelector(note); await enabled(page,false);
      const custom=await page.$eval(note,el=>({placeholder:el.placeholder,describedBy:el.getAttribute('aria-describedby')})); assert.ok(!/[请請]/.test(custom.placeholder),'Custom reason field must stay Japanese');
      await chooseReason(page,presetReasons[0]); await enabled(page,true); const geometry=await layout(page);
      await page.screenshot({path:`${output}/${language}-Japanese-reason-dropdown.png`,fullPage:true}); if (!layoutOnly) await expectOpen(page,20000,presetReasons[0]); else assert.equal(posts.length,0); assert.deepEqual(errors,[]);
      results.push({name:`Japanese-reasons-under-${language}`,passed:true,options,summary,geometry}); await context.close();
    }
  }
  assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, [], 'Fixture must not attempt any non-local requests');
  await writeFile(`${output}/${baseline?'baseline':'results'}.json`,JSON.stringify({passed:results.length,layoutOnly,productionAccess:false,checkoutWrites,pageErrors,externalRequests,cases:results},null,2)+'\n');
  console.log(JSON.stringify({passed:results.length,baseline,layoutOnly,output}));
} catch (error) {
  await writeFile(`${output}/driver-failure.json`,JSON.stringify({message:error.message,text:await currentPage?.evaluate(()=>document.body.innerText).catch(()=>null),posts,reads,checkoutWrites},null,2)+'\n');
  await currentPage?.screenshot({path:`${output}/driver-failure.png`,fullPage:true}).catch(()=>undefined); throw error;
} finally {
  stop();
  let closeTimer; const child=browser.process();
  await Promise.race([browser.close().catch(()=>undefined),new Promise(resolve=>{closeTimer=setTimeout(()=>{if(child?.exitCode===null)child.kill('SIGTERM');resolve();},10000);})]);
  clearTimeout(closeTimer); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
}
