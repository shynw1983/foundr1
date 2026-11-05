// Actual POS page with local reconciliation fixtures. No production, database,
// Bluetooth, printers, external payment, or customer checkout is accessed.
import { build, stop } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const output = resolve(process.env.POS_CASH_UI_OUTPUT || 'outputs/pos-cash-zero-20261019/ui');
await mkdir(output, { recursive: true });
const baseline = Boolean(process.env.POS_CASH_UI_BASELINE);
const dictionaries = Object.fromEntries(await Promise.all(['zh-Hans', 'zh-Hant'].map(async language => [language, JSON.parse(await readFile(`public/locales/os/${language}.json`, 'utf8'))])));
const stores = [{ id: 'fixture-sakura', name: '桜並木店' }, { id: 'fixture-other', name: '別店舗' }];
const manager = { id: 'fixture-manager', name: 'Fixture 責任者', role: 'manager', punchedAt: '', attendanceStatus: 'manager', scheduledStart: '', scheduledEnd: '' };
const denominations = [10000, 5000, 2000, 1000, 500, 100, 50, 10, 5, 1];
const zeroBreakdown = Object.fromEntries(denominations.map(value => [String(value), 0]));
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import Pos from './app/store/pos/page';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';import{StoreThemeProvider}from'./app/store/components/StoreThemeProvider';
localStorage.setItem('foundr1-os-language',new URLSearchParams(location.search).get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');
createRoot(document.getElementById('root')).render(<OsTranslationProvider><StoreThemeProvider employeeId="fixture-employee"><Pos/></StoreThemeProvider></OsTranslationProvider>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', charset: 'utf8', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'cash-fixture', setup(b) {
  if (process.env.POS_CASH_UI_BASELINE_SOURCE) b.onLoad({ filter: /app\/store\/pos\/page\.tsx$/ }, async () => ({ contents: await readFile(resolve(process.env.POS_CASH_UI_BASELINE_SOURCE), 'utf8'), loader: 'tsx', resolveDir: resolve('app/store/pos') }));
  b.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: 'fixture-navigation' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture-navigation' }, args => ({ contents: args.path === 'next/link' ? `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}` : `export const usePathname=()=>location.pathname;export const useRouter=()=>({push:url=>location.assign(url)});`, loader: 'js', resolveDir: process.cwd() }));
  b.onResolve({ filter: /shared-pusher-client$/ }, args => ({ path: args.path, namespace: 'fixture-pusher' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture-pusher' }, () => ({ contents: `const handlers=new Map();window.__cashFixtureEmit=(event,payload)=>{for(const fn of handlers.get(event)||[])fn(payload)};export function acquireSharedPusher(){return{connection:{bind(){}},subscribe(){return{name:'private-cash-fixture',bind(event,fn){if(!handlers.has(event))handlers.set(event,new Set());handlers.get(event).add(fn);if(event==='pusher:subscription_succeeded')queueMicrotask(fn)},unbind(event){handlers.delete(event)}}},unsubscribe(){},disconnect(){}}}`, loader: 'js' }));
} }] });
const css = (await readFile('app/globals.css', 'utf8')) + '\n' + (await readFile('app/store/store-responsive.css', 'utf8')) + '\n' + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text || '');
const digest = contents => createHash('sha256').update(contents).digest('hex');
await writeFile(`${output}/${baseline ? 'baseline-' : ''}source-hashes.json`, JSON.stringify({ cwd: process.cwd(), bundleSha256: digest(bundle.outputFiles.find(file => file.path.endsWith('.js')).text), renderedCssSha256: digest(css), sources: Object.fromEntries(await Promise.all(['app/store/pos/page.tsx', 'app/globals.css', 'app/store/store-responsive.css', 'public/locales/os/zh-Hans.json', 'public/locales/os/zh-Hant.json', 'scripts/tests/pos-cash-zero-ui.mjs'].map(async path => [path, digest(await readFile(path))]))) }, null, 2) + '\n');
if (process.env.POS_CASH_UI_SOURCE_ONLY) { stop(); process.exit(0); }
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
function createReconciliation({ expected = 0, responsible = true, sessionId = 'fixture-session-yesterday' } = {}) {
  return {
    businessDate: '2026-10-19',
    businessState: { businessDate: '2026-10-19', status: 'before_open', statusLabel: '開店準備', detailLabel: '開店準備時間です。開始金額を確認してから POS 会計を開始してください。', openLabel: '11:00', closeLabel: '22:00', tone: 'off' },
    activeSession: { id: sessionId, businessDate: '2026-10-18', registerName: 'レジ A', status: 'open', openingAmount: 0, openingCashBreakdown: zeroBreakdown, expectedCashAmount: expected, countedCashAmount: null, countedCashBreakdown: {}, differenceAmount: null, cashSales: expected, cashIn: 0, cashOut: 0, openedByName: 'Fixture', openedAt: '2026-10-18T00:00:00.000Z', closedAt: '' },
    previousClosedSession: null, sessions: [], movements: [], activeCashResponsibleEmployees: responsible ? [manager] : []
  };
}
let reconciliationByStore, posts, checkoutWrites, rejectClose, reads;
function reset(options = {}) {
  reconciliationByStore = Object.fromEntries(stores.map(store => [store.id, createReconciliation(options)]));
  posts = []; reads = []; checkoutWrites = 0; rejectClose = false;
}
reset();
const send = (res, body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/fixture.js') { res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); return res.end(bundle.outputFiles.find(file => file.path.endsWith('.js')).text); }
    if (url.pathname.startsWith('/locales/os/')) return send(res, dictionaries[url.pathname.includes('Hant') ? 'zh-Hant' : 'zh-Hans']);
    if (url.pathname === '/api/auth/me') return send(res, { employee: { id: 'fixture-employee', name: 'Fixture', role: 'owner' } });
    if (url.pathname === '/api/store/context') return send(res, { selectedStoreId: url.searchParams.get('storeId') || stores[0].id, access: { role: 'owner', canUseAllStoreView: true, stores } });
    if (url.pathname === '/api/store/realtime-config') return send(res, { key: 'local-fixture', cluster: 'local-fixture', channels: ['private-cash-fixture'] });
    if (url.pathname === '/api/store/pos/customer-display') return send(res, { state: { status: 'advertising', weighingRevision: 0 }, customerDisplayMediaSettings: { weighing: { enabled: false } } });
    if (url.pathname === '/api/store/pos/reconciliation') {
      if (req.method !== 'POST') { const storeId = url.searchParams.get('storeId') || stores[0].id; reads.push(storeId); return send(res, reconciliationByStore[storeId]); }
      let raw = ''; for await (const part of req) raw += part;
      const body = JSON.parse(raw); posts.push(body);
      assert.equal(body.action, 'close', 'Only reconciliation closure is permitted');
      if (rejectClose) return send(res, { error: 'Fixture: 締め保存に失敗しました。' }, 503);
      const next = { ...reconciliationByStore[body.storeId], activeSession: null };
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
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const modal = '.store-pos-cash-dialog', closeForm = '.store-pos-cash-close', confirm = `${closeForm} input[type="checkbox"]`, submit = `${closeForm} > button.primary-button`;
let currentPage;
async function newPage({ width = 768, height = 1024, language = 'ja' } = {}) {
  const context = await browser.createBrowserContext(), page = await context.newPage(); currentPage = page;
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width, height });
  await page.setRequestInterception(true); page.on('request', request => request.url().startsWith(base + '/') ? request.continue() : request.abort());
  await page.goto(`${base}/store/pos?lang=${language}`); await page.waitForSelector('.store-pos-cash-strip .primary-button');
  await page.waitForFunction(() => typeof window.__cashFixtureEmit === 'function');
  if (language !== 'ja') await page.waitForFunction(lang => document.documentElement.lang === lang, {}, language);
  return { page, context, errors };
}
async function openClose(page) {
  if (await page.$(closeForm)) return;
  await page.click('.store-pos-cash-strip .primary-button'); await page.waitForSelector(closeForm); await pause(150);
}
async function enabled(page, value) { await page.waitForFunction((selector, expected) => document.querySelector(selector)?.disabled === !expected, {}, submit, value); }
async function confirmZero(page) { await page.waitForSelector(confirm); await page.click(confirm); await page.waitForFunction(selector => document.querySelector(selector)?.checked === true, {}, confirm); }
async function updateReconciliation(page, options) {
  reconciliationByStore[stores[0].id] = createReconciliation(options);
  const old = reads.length; await page.evaluate(() => window.__cashFixtureEmit('pos.reconciliation.updated', { storeId: 'fixture-sakura' }));
  const deadline = Date.now() + 10000;
  while (reads.length === old && Date.now() < deadline) await pause(30);
  assert.ok(reads.length > old, 'Realtime fixture event did not refresh reconciliation'); await pause(150);
}
function assertZeroPayload(body) {
  assert.equal(body.action, 'close'); assert.equal(body.storeId, stores[0].id); assert.equal(body.closingResponsibleEmployeeId, manager.id);
  assert.deepEqual(Object.keys(body.countedBreakdown).sort(), denominations.map(String).sort());
  for (const count of Object.values(body.countedBreakdown)) { assert.notEqual(count, '', 'Zero confirmation must submit explicit zero counts'); assert.equal(Number(count), 0); }
}
async function layout(page) {
  const geometry = await page.evaluate(() => {
    const dialog = document.querySelector('.store-pos-cash-dialog'), head = dialog.querySelector('.store-pos-cash-dialog-head'), close = head.querySelector('button'), button = close.getBoundingClientRect(), box = dialog.getBoundingClientRect();
    const text = document.createRange(); text.selectNodeContents(close); const textBox = text.getBoundingClientRect();
    return { documentWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, dialog: { x: box.x, width: box.width, right: box.right, scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth }, denominationSelectWidths: [...dialog.querySelectorAll('.store-pos-denomination-grid select')].map(select => select.getBoundingClientRect().width), close: { width: button.width, height: button.height, textHeight: textBox.height, lineHeight: Number.parseFloat(getComputedStyle(close).lineHeight), whiteSpace: getComputedStyle(close).whiteSpace }, text: dialog.innerText };
  });
  assert.ok(geometry.scrollWidth <= geometry.documentWidth + 1, `Document overflow: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.dialog.x >= -1 && geometry.dialog.right <= geometry.documentWidth + 1, 'Dialog exceeds viewport width');
  assert.ok(geometry.dialog.scrollWidth <= geometry.dialog.clientWidth + 1, 'Cash dialog has horizontal overflow');
  assert.ok(geometry.close.textHeight <= geometry.close.lineHeight + 2, 'Close text wraps across lines');
  assert.ok(geometry.denominationSelectWidths.every(width => width >= 55), 'Denomination count is squeezed behind its native select arrow');
  return geometry;
}
try {
  if (baseline) {
    reset(); const { page, context, errors } = await newPage({ width: 390, height: 844 }); await openClose(page);
    const observed = await page.evaluate(() => ({ disabled: document.querySelector('.store-pos-cash-close > button').disabled, visibleCounts: [...document.querySelectorAll('.store-pos-denomination-grid select')].map(select => ({ value: select.value, label: select.selectedOptions[0]?.textContent })), body: document.querySelector('.store-pos-cash-dialog').innerText, hasZeroConfirmation: Boolean(document.querySelector('.store-pos-cash-close input[type=checkbox]')) }));
    assert.equal(observed.disabled, true); assert.ok(observed.visibleCounts.every(select => select.value === '' && select.label === '0')); assert.equal(observed.hasZeroConfirmation, false); assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/baseline-zero-disabled.png`, fullPage: true }); await writeFile(`${output}/baseline.json`, JSON.stringify(observed, null, 2) + '\n'); await context.close(); console.log('Baseline reproduced: ten visible zeros are empty strings and zero cash cannot be confirmed.');
  } else {
    for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
      reset(); const { page, context, errors } = await newPage(viewport); await openClose(page); await enabled(page, false);
      const info = await page.$eval(closeForm, element => ({ text: element.innerText, responsible: element.querySelector('select:not(.store-pos-denomination-grid select)')?.value }));
      assert.equal(info.responsible, manager.id); assert.match(info.text, /現金が0円であることを確認しました/);
      assert.match(await page.$eval(`${closeForm} .store-pos-cash-blocked-reason`, element => element.textContent), /現金の枚数を入力するか、現金0円を確認してください/);
      const geometry = await layout(page), disabledBackground = await page.$eval(submit, element => getComputedStyle(element).backgroundColor); await page.screenshot({ path: `${output}/ja-${viewport.width}x${viewport.height}-unconfirmed.png`, fullPage: true });
      await confirmZero(page); await enabled(page, true); assert.notEqual(await page.$eval(submit, element => getComputedStyle(element).backgroundColor), disabledBackground, 'Disabled submission needs a visually distinct background'); await page.screenshot({ path: `${output}/ja-${viewport.width}x${viewport.height}-confirmed.png`, fullPage: true });
      await page.click(submit); await page.waitForSelector(modal, { hidden: true }); assert.equal(posts.length, 1); assertZeroPayload(posts[0]); assert.equal(checkoutWrites, 0); assert.deepEqual(errors, []);
      results.push({ name: `zero-close-${viewport.width}x${viewport.height}`, passed: true, viewport, geometry, request: posts[0] }); await context.close();
    }
    reset(); {
      const { page, context, errors } = await newPage(); await openClose(page); await confirmZero(page); await enabled(page, true);
      rejectClose = true; await page.click(submit); await page.waitForSelector('.store-pos-notice'); await enabled(page, true);
      assert.match(await page.$eval('.store-pos-notice', element => element.textContent), /Fixture/); assert.equal(await page.$eval(confirm, input => input.checked), true); assertZeroPayload(posts[0]);
      await page.click(`${modal} .store-pos-cash-dialog-head button`); await page.waitForSelector(modal, { hidden: true }); await openClose(page); await enabled(page, false); assert.equal(await page.$eval(confirm, input => input.checked), false);
      await confirmZero(page); await updateReconciliation(page, { sessionId: 'fixture-new-session' }); await openClose(page); await enabled(page, false); assert.equal(await page.$eval(confirm, input => input.checked), false);
      assert.deepEqual(errors, []); results.push({ name: 'failed-post-keeps-confirmation-dialog-session-reset', passed: true, failedRequests: posts }); await page.screenshot({ path: `${output}/session-change-reset.png`, fullPage: true }); await context.close();
    }
    reset(); {
      const { page, context, errors } = await newPage({ width: 1440, height: 900 }); await openClose(page); await confirmZero(page);
      await page.click(`${modal} .store-pos-cash-dialog-head button`); await page.waitForSelector(modal, { hidden: true });
      await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.select('.store-nav-store-switch select', stores[1].id)]);
      await page.waitForSelector('.store-pos-cash-strip .primary-button'); await openClose(page); await enabled(page, false); assert.equal(await page.$eval(confirm, input => input.checked), false); assert.deepEqual(errors, []);
      results.push({ name: 'store-change-requires-new-zero-confirmation', passed: true }); await context.close();
    }
    reset({ expected: 1000 }); {
      const { page, context, errors } = await newPage(); await openClose(page); await page.select(`${closeForm} .store-pos-denomination-grid label:nth-child(4) select`, '1'); await enabled(page, true);
      rejectClose = true; await page.click(submit); await page.waitForSelector('.store-pos-notice'); await enabled(page, true); assert.equal(await page.$eval(`${closeForm} .store-pos-denomination-grid label:nth-child(4) select`, select => select.value), '1'); assert.equal(Number(posts[0].countedBreakdown['1000']), 1);
      await page.select(`${closeForm} .store-pos-denomination-grid label:nth-child(4) select`, ''); await confirmZero(page); await enabled(page, false);
      await page.type(`${closeForm} input:not([type=checkbox])`, 'Fixture 現金回収済み'); await enabled(page, true);
      rejectClose = false; await page.click(submit); await page.waitForSelector(modal, { hidden: true }); assert.match(posts.at(-1).note, /現金回収/); assertZeroPayload(posts.at(-1)); assert.equal(checkoutWrites, 0); assert.deepEqual(errors, []);
      results.push({ name: 'positive-count-matches-and-discrepancy-requires-reason', passed: true, requests: posts }); await context.close();
    }
    reset({ responsible: false }); {
      const { page, context, errors } = await newPage(); await openClose(page); await confirmZero(page); await enabled(page, false); assert.equal(posts.length, 0); assert.match(await page.$eval(closeForm, element => element.innerText), /責任者/); assert.deepEqual(errors, []); results.push({ name: 'missing-responsible-cannot-close', passed: true }); await page.screenshot({ path: `${output}/missing-responsible.png`, fullPage: true }); await context.close();
    }
    for (const language of ['zh-Hans', 'zh-Hant']) {
      reset(); const { page, context, errors } = await newPage({ language, width: 390, height: 844 }); await openClose(page); await page.waitForFunction((selector, label) => document.querySelector(selector)?.parentElement?.textContent.includes(label), {}, confirm, dictionaries[language]['現金が0円であることを確認しました']);
      const text = await page.$eval(modal, element => element.innerText);
      for (const source of ['現金が0円であることを確認しました', '現金の枚数を入力するか、現金0円を確認してください。']) {
        assert.ok(dictionaries[language][source]); assert.ok(text.includes(dictionaries[language][source])); assert.ok(!text.includes(source));
      }
      assert.ok(text.includes(dictionaries[language]['営業日 {date} のレジ締めです。実際の現金を確認してください。'].replace('{date}', '2026-10-18')), 'Closure header must use the active prior business date and translated UI copy');
      const geometry = await layout(page); await confirmZero(page); await enabled(page, true); assert.deepEqual(errors, []); await page.screenshot({ path: `${output}/${language}-zero-cash.png`, fullPage: true }); results.push({ name: `translated-${language}`, passed: true, geometry }); await context.close();
    }
    await writeFile(`${output}/results.json`, JSON.stringify({ passed: results.length, checkoutWrites, productionAccess: false, cases: results }, null, 2) + '\n'); console.log(JSON.stringify({ passed: results.length, checkoutWrites, output }));
  }
} catch (error) {
  await writeFile(`${output}/driver-failure.json`, JSON.stringify({ message: error.message, text: await currentPage?.evaluate(() => document.body.innerText).catch(() => null), posts, reads, checkoutWrites }, null, 2) + '\n');
  await currentPage?.screenshot({ path: `${output}/driver-failure.png`, fullPage: true }).catch(() => undefined); throw error;
} finally { stop(); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
