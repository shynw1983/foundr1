// Actual relay page and translations, isolated HTTP/native fixtures only.
// No production API, physical phone, Android settings, Bluetooth or printer is accessed.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const output = resolve(process.env.RELAY_BACKGROUND_UI_OUTPUT || 'outputs/store-relay-background-20261017');
await mkdir(output, { recursive: true });
const built = await build({ stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import Page from'./app/store/device-relay/page';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';createRoot(document.getElementById('root')).render(<OsTranslationProvider><Page/></OsTranslationProvider>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const js = built.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = (await readFile('app/globals.css', 'utf8')) + '\n' + built.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const dictionaries = Object.fromEntries(await Promise.all(['zh', 'zh-Hans', 'zh-Hant'].map(async language => [language, JSON.parse(await readFile(`public/locales/os/${language}.json`, 'utf8'))])));
const station = { id: 'station-a', name: 'レジ A', enabled: true, print_enabled: true, scale_enabled: false, epoch: 7, owner_until: null, device_online: true, device_paired: true, scale_session: null, scale_sequence: -1, scale_reading: null, scale_received_at: null, device_status: { scale: 'not_selected' } };
const unexpectedRequests = [], mutations = [], externalRequests = [], errors = [], checks = [], traces = [];
const json = (res, body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture');
  if (url.pathname === '/fixture.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); res.end(js); return; }
  if (url.pathname.startsWith('/locales/os/')) { json(res, dictionaries[url.pathname.split('/').at(-1).replace('.json', '')] || {}); return; }
  if (url.pathname === '/api/store/context' && req.method === 'GET') { json(res, { access: { stores: [{ id: 'store-a', name: '桜並木店' }] } }); return; }
  if (url.pathname === '/api/os/stores/device-relay' && req.method === 'GET') { json(res, { stations: [station], canManage: false, jobs: [] }); return; }
  if (url.pathname === '/api/store/device-relay' && req.method === 'POST') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); mutations.push(body);
    if (body.action === 'pair' && body.code === '012345' && body.storeId === 'store-a' && body.stationId === 'station-a') { json(res, { ok: true, token: 'T'.repeat(43), stationId: station.id }); return; }
    unexpectedRequests.push({ path: url.pathname, body }); json(res, { error: 'Unexpected fixture mutation' }, 400); return;
  }
  if (url.pathname.startsWith('/api/')) { unexpectedRequests.push({ path: url.pathname, method: req.method }); json(res, {}, 403); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let page, language = 'ja';
const translated = key => language === 'ja' ? key : dictionaries[language][key] || key;
const waitText = key => page.waitForFunction(text => document.body.textContent.includes(text), {}, translated(key));
const calls = () => page.evaluate(() => window.__relayActions);
async function click(key, twice = false) {
  const text = translated(key);
  await page.waitForFunction(text => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === text && !button.disabled), {}, text);
  await page.evaluate(({ text, twice }) => { const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text); button.click(); if (twice) button.click(); }, { text, twice });
}
async function open({ mode = 'modern', running = true, background = {}, lang = 'ja', settingsError = '' } = {}) {
  if (page) { traces.push(await calls()); await page.close(); }
  language = lang; page = await browser.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => { if (request.url().startsWith(origin + '/') || /^(data:|blob:)/.test(request.url())) request.continue(); else { externalRequests.push(request.url()); request.abort(); } });
  await page.evaluateOnNewDocument(({ mode, running, background, lang, settingsError }) => {
    localStorage.setItem('foundr1-os-language', lang); localStorage.setItem('foundr1-os-language-preference', 'manual');
    window.__relayActions = []; window.__relayReads = 0; window.__relayBackgroundReads = 0;
    window.__relayRunning = running; window.__relayDialogs = []; window.confirm = text => { window.__relayDialogs.push(text); return true; };
    window.__relayBackground = { automaticResumeEnabled: true, hasSavedConnection: true, batteryOptimizationExempt: false, backgroundRestricted: false, manufacturer: 'OPPO', model: 'Fixture phone', sdkInt: 35, ...background };
    if (mode === 'browser') return;
    const bridge = {
      start(token) { window.__relayActions.push('start'); window.__relayRunning = true; window.__relayBackground.automaticResumeEnabled = true; window.__relayBackground.hasSavedConnection = true; return JSON.stringify({ ok: token === 'T'.repeat(43) }); },
      resume() { window.__relayActions.push('resume'); window.__relayRunning = true; window.__relayBackground.automaticResumeEnabled = true; return '{"ok":true}'; },
      stop() { window.__relayActions.push('stop'); window.__relayRunning = false; window.__relayBackground.automaticResumeEnabled = false; return '{"ok":true}'; },
      status() { window.__relayReads++; return JSON.stringify({ running: window.__relayRunning, message: '' }); },
      backgroundStatus() { window.__relayBackgroundReads++; return mode === 'malformed' ? '{}' : mode === 'invalid-json' ? '{' : JSON.stringify(window.__relayBackground); },
      openBackgroundSettings() { window.__relayActions.push('settings'); return JSON.stringify(settingsError ? { ok: false, error: settingsError } : { ok: true }); }
    };
    if (mode === 'legacy') { delete bridge.backgroundStatus; delete bridge.openBackgroundSettings; }
    if (mode === 'partial') delete bridge.openBackgroundSettings;
    window.Foundr1DeviceRelay = bridge;
  }, { mode, running, background, lang, settingsError });
  await page.goto(`${origin}/store/device-relay?storeId=store-a&stationId=station-a`, { waitUntil: 'networkidle0' });
  await waitText(mode === 'browser' ? 'Android Store App で開いてください' : 'このスマホのサービス');
}
async function refresh(patch = {}) { await page.evaluate(patch => { Object.assign(window.__relayBackground, patch); window.dispatchEvent(new Event('focus')); }, patch); }
async function screenshot(prefix) {
  for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) {
    await page.setViewport({ width, height }); await page.evaluate(() => scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${prefix}: no overflow at ${width}px`);
    await page.screenshot({ path: `${output}/${prefix}-${width}.png`, fullPage: true });
  }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hasButton = key => page.$$eval('button', (buttons, text) => buttons.some(button => button.textContent.trim() === text), translated(key));
try {
  await open({ mode: 'browser' }); assert.equal(await hasButton('バックグラウンドでの実行を許可'), false); assert.deepEqual(await calls(), []);
  assert.equal(await page.evaluate(() => document.body.textContent.includes('画面を閉じた後の中継')), false);
  checks.push('ordinary browser exposes no native background-setting or recovery control');

  for (const mode of ['legacy', 'partial']) {
    await open({ mode }); await waitText('自動復帰に対応した Store App へ更新してください。現在の中継操作は引き続き利用できます。');
    assert.ok(await page.$('a[href="/downloads/foundr1-store-latest.apk"]')); assert.equal(await hasButton('バックグラウンドでの実行を許可'), false);
    assert.ok(await hasButton('このスマホの中継を停止')); await refresh(); assert.deepEqual(await calls(), []);
  }
  checks.push('older and partially implemented optional bridges retain existing relay actions and show the automatic-recovery update prompt');

  await open(); await waitText('自動復帰を設定済み'); await waitText('電池の最適化が有効です。画面を閉じると中継が止まることがあります。');
  await screenshot('optimization-enabled'); assert.deepEqual(await calls(), []);
  await click('バックグラウンドでの実行を許可', true); assert.deepEqual(await calls(), ['settings']);
  await waitText('電池の最適化が有効です。画面を閉じると中継が止まることがあります。');
  await refresh({ batteryOptimizationExempt: true }); await waitText('電池の最適化の対象外です。');
  assert.equal(await hasButton('バックグラウンドでの実行を許可'), false);
  await waitText('端末の省電力設定で中継が止まる場合があります。機種に設定がある場合は自動起動も許可してください。強制停止した後は Store App を開いてください。');
  assert.deepEqual(await calls(), ['settings']);
  checks.push('battery optimization requests no action until an explicit click, suppresses double clicks and rereads the returned setting without assuming approval');

  await open({ background: { batteryOptimizationExempt: true, backgroundRestricted: true } });
  await waitText('バックグラウンド動作が制限されています。'); await click('バックグラウンドでの実行を許可'); assert.deepEqual(await calls(), ['settings']);
  await screenshot('background-restricted');
  checks.push('background restriction still offers the settings action when battery optimization is already exempt');

  await open({ background: { automaticResumeEnabled: false } }); await waitText('自動復帰はオフ');
  await waitText('「保存済みの接続を再開」を一度押すと、次回からの自動復帰を設定できます。');
  assert.deepEqual(await calls(), []); await click('保存済みの接続を再開'); await waitText('自動復帰を設定済み'); assert.deepEqual(await calls(), ['resume']);
  await refresh(); assert.deepEqual(await calls(), ['resume']);
  checks.push('a migrated running relay without saved recovery intent requires one explicit resume and allows that button while running');

  await open(); await click('このスマホの中継を停止'); await waitText('自動復帰はオフ'); await waitText('中継サービス停止中');
  const readsBefore = await page.evaluate(() => window.__relayBackgroundReads); await refresh(); await pause(3150);
  assert.ok(await page.evaluate(before => window.__relayBackgroundReads > before, readsBefore)); assert.deepEqual(await calls(), ['stop']);
  await waitText('「保存済みの接続を再開」を一度押すと、次回からの自動復帰を設定できます。');
  await screenshot('manual-stop'); await click('保存済みの接続を再開'); await waitText('自動復帰を設定済み'); assert.deepEqual(await calls(), ['stop', 'resume']);
  checks.push('manual stop remains stopped through polling and focus; only an explicit resume changes the saved recovery choice');

  await open({ running: false, background: { automaticResumeEnabled: false } }); await waitText('自動復帰はオフ'); await refresh(); assert.deepEqual(await calls(), []);
  checks.push('opening a newly mounted page with a saved manual-stop choice never resumes the service');

  await open({ running: false, background: { automaticResumeEnabled: true, hasSavedConnection: false } });
  await waitText('接続情報が保存されていません。'); await waitText('先に、このスマホをお店につないでください。');
  assert.equal(await page.evaluate(() => document.body.textContent.includes('自動復帰を設定済み')), false); assert.deepEqual(await calls(), []);
  checks.push('saved intent without a saved connection is never shown as configured recovery');

  for (const mode of ['malformed', 'invalid-json']) {
    await open({ mode }); await waitText('バックグラウンド設定を確認できません。Store App を開き直してください。');
    assert.equal(await hasButton('バックグラウンドでの実行を許可'), false); assert.deepEqual(await calls(), []);
  }
  checks.push('malformed native status shows an unavailable state and cannot expose a permission action');

  const settingsError = 'Android の設定画面を開けません。Store App のアプリ情報から電池の設定を確認してください。';
  await open({ settingsError }); await click('バックグラウンドでの実行を許可'); await waitText(settingsError); await refresh(); await waitText(settingsError); assert.deepEqual(await calls(), ['settings']);
  checks.push('an Android-settings launch error remains visible locally without starting or resuming the relay');

  for (const lang of ['zh-Hans', 'zh-Hant']) {
    await open({ lang }); await waitText('自動復帰を設定済み'); await waitText('バックグラウンドでの実行を許可'); await screenshot(`background-${lang}`);
    const input = await page.$('input[autocomplete="one-time-code"]'); assert.ok(input);
    assert.equal(await input.evaluate(input => input.maxLength), 6); assert.equal(await input.evaluate(input => input.inputMode), 'numeric');
  }
  await page.type('input[autocomplete="one-time-code"]', '０１２３４５６７');
  assert.equal(await page.$eval('input[autocomplete="one-time-code"]', input => input.value), '012345');
  await click('接続コードで開始'); await page.waitForFunction(() => window.__relayActions.includes('start')); assert.deepEqual(await calls(), ['start']); assert.equal(mutations.at(-1).code, '012345');
  checks.push('Simplified/Traditional Chinese render at 390/768/1440px without overflow; the shared-terminal six-digit normalized code still pairs explicitly');

  const version = await readFile('app/os/components/OsTranslationProvider.tsx', 'utf8'); assert.ok(version.includes('20261018-scale-filter-v84'));
  for (const dict of Object.values(dictionaries)) for (const key of ['画面を閉じた後の中継', '自動復帰を設定済み', '自動復帰はオフ', 'バックグラウンドでの実行を許可', settingsError]) assert.ok(dict[key], `Missing translation: ${key}`);
  assert.deepEqual(unexpectedRequests, []); assert.deepEqual(externalRequests, []); assert.deepEqual(errors, []); traces.push(await calls());
  await writeFile(`${output}/ui-verification.json`, JSON.stringify({ passed: true, checks, traces, pageErrors: errors, unexpectedRequests, externalRequests }, null, 2) + '\n');
  await rm(`${output}/failure.png`, { force: true }); console.log(`PASS relay background UI: ${checks.join('; ')}.`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/ui-verification.json`, JSON.stringify({ passed: false, checks, traces, pageErrors: errors, unexpectedRequests, externalRequests, error: error.stack }, null, 2) + '\n'); throw error;
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
