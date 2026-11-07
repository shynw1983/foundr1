// Actual OS settings React panel and translations against local synthetic responses only.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const output = 'outputs/pos-counter-menu-settings-ui';
await mkdir(output, { recursive: true });
const compiled = await build({ stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{PosCounterMenuPolicySettings}from'./app/os/pos/PosCounterMenuPolicySettings';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
function Fixture(){const[id,setId]=useState('store-a');const[active,setActive]=useState(true);return <main style={{padding:16,maxWidth:1040,margin:'0 auto'}}><label>Fixture store<select id="fixture-store" value={id} onChange={e=>setId(e.target.value)}><option value="store-a">桜並木店</option><option value="store-b">別店舗</option></select></label><button id="fixture-tab" type="button" onClick={()=>setActive(!active)}>Fixture tab</button><div hidden={!active}><PosCounterMenuPolicySettings storeId={id} active={active} canManage blocked={false}/></div></main>};createRoot(document.getElementById('root')).render(<OsTranslationProvider><Fixture/></OsTranslationProvider>);`, loader: 'tsx', resolveDir: process.cwd() }, jsx: 'automatic', bundle: true, write: false, outdir: '/virtual', define: { 'process.env.NODE_ENV': '"development"' } });
const javascript = compiled.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = (await readFile('app/globals.css', 'utf8')) + '\n' + compiled.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const chinese = JSON.parse(await readFile('public/locales/os/zh-Hans.json', 'utf8'));
const drinkId = '00000000-0000-4000-8000-000000000101', beerId = '00000000-0000-4000-8000-000000000102';
const empty = { sharedMenuForTakeout: false, standardTaxCategoryIds: [], takeoutRestrictedCategoryIds: [] };
const selected = { sharedMenuForTakeout: true, standardTaxCategoryIds: [beerId], takeoutRestrictedCategoryIds: [beerId] };
const a = { ready: true, revision: 'policy-1', menuRevision: 'menu-a-1', policy: empty, hasEnabledMenu: true, priceTaxMode: 'tax_included', dineInTaxRate: 10, takeoutTaxRate: 8,
  categories: [{ id: drinkId, name: 'ソフトドリンク', brandId: 'brand-a', brandName: 'まぁ麻' }, { id: beerId, name: '酒類', brandId: 'brand-a', brandName: 'まぁ麻' }] };
const b = { ...a, revision: 'policy-b', menuRevision: 'menu-b', categories: [], hasEnabledMenu: false, priceTaxMode: 'tax_excluded' };
const posts = [], reads = [], unexpectedRequests = [], pageErrors = [], externalRequests = [], checks = [];
let denyManage = false, rejectSave = false, holdRead = false, heldRead;
const json = (res, payload, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture');
  if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(javascript); return; }
  if (url.pathname.startsWith('/locales/')) { json(res, url.pathname.endsWith('/zh-Hans.json') ? chinese : {}); return; }
  if (url.pathname === '/api/os/pos/settings') {
    if (req.method === 'POST') {
      let raw = ''; for await (const part of req) raw += part;
      const body = JSON.parse(raw); posts.push(body);
      if (rejectSave) { json(res, { error: '税率・販売設定または店内メニューが変更されました。再読み込みして確認してください。' }, 409); return; }
      a.policy = body.counterMenuPolicy; a.revision = `policy-${posts.length + 1}`;
      json(res, { selectedStoreId: body.storeId, counterMenu: a, ok: true }); return;
    }
    const id = url.searchParams.get('storeId'); reads.push(id);
    if (url.searchParams.get('section') !== 'counterMenuPolicy') unexpectedRequests.push(req.url);
    const result = { selectedStoreId: id, counterMenu: structuredClone(id === 'store-a' ? a : b), access: { canManagePosSettings: !denyManage } };
    if (holdRead && id === 'store-a') { holdRead = false; heldRead = () => json(res, result); return; }
    json(res, result); return;
  }
  if (url.pathname.startsWith('/api/') || req.method !== 'GET') { unexpectedRequests.push(req.url); json(res, {}, 403); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let page;
async function open(language = 'ja') {
  if (page) await page.close();
  page = await browser.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.setRequestInterception(true);
  page.on('request', request => { if (request.url().startsWith(origin + '/')) request.continue(); else { externalRequests.push(request.url()); request.abort(); } });
  await page.evaluateOnNewDocument(language => { localStorage.setItem('foundr1-os-language', language); localStorage.setItem('foundr1-os-language-preference', 'manual'); }, language);
  await page.goto(origin, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('[data-pos-settings-pane="counterMenuPolicy"] label input');
}
const waitText = text => page.waitForFunction(text => document.body.textContent.includes(text), {}, text);
const labelState = (label, click = false) => page.evaluate(({ label, click }) => {
  const target = [...document.querySelectorAll('[data-pos-settings-pane="counterMenuPolicy"] label')].find(element => element.textContent.trim().startsWith(label));
  const input = target?.querySelector('input');
  if (!input) return null;
  if (click) input.click();
  return { checked: input.checked, disabled: input.matches(':disabled') };
}, { label, click });
const button = (label, click = false) => page.evaluate(({ label, click }) => {
  const target = [...document.querySelectorAll('[data-pos-settings-pane="counterMenuPolicy"] button')].find(element => element.textContent.trim() === label);
  if (!target) return null;
  if (click) target.click();
  return { disabled: target.disabled };
}, { label, click });
const capture = async name => {
  for (const width of [390, 768, 1366]) {
    await page.setViewport({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} overflows at ${width}px`);
    await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
  }
};
const sharedLabel = '店頭持ち帰りにも店舗専用メニューを使う', saveLabel = '共用メニュー設定を保存', reloadLabel = '共用メニュー設定を再読み込み';
try {
  await open(); assert.deepEqual(await labelState(sharedLabel), { checked: false, disabled: false });
  assert.deepEqual(await button(saveLabel), { disabled: true });
  await labelState(sharedLabel, true); await waitText('持ち帰りに標準税率を使う分類');
  await labelState('酒類', true); await labelState('店内販売のみ', true);
  assert.deepEqual(await labelState('ソフトドリンク'), { checked: false, disabled: false });
  await page.click('#fixture-tab'); await page.click('#fixture-tab');
  assert.deepEqual(await labelState('店内販売のみ'), { checked: true, disabled: false });
  assert.deepEqual(reads, ['store-a']); assert.deepEqual(posts, []);
  await capture('configured-ja');
  await button(saveLabel, true); await waitText('共用メニューの設定を保存しました。');
  assert.deepEqual(posts, [{ storeId: 'store-a', section: 'counterMenuPolicy', counterMenuPolicy: selected, counterMenuPolicyRevision: 'policy-1', counterMenuRevision: 'menu-a-1' }]);
  assert.deepEqual(await button(saveLabel), { disabled: true });
  checks.push('selection remains a draft across settings tabs; dedicated save carries stable category IDs, restriction and both versions');

  rejectSave = true; await labelState('店内販売のみ', true); await button(saveLabel, true);
  await waitText('税率・販売設定または店内メニューが変更されました。');
  assert.deepEqual(await labelState('店内販売のみ'), { checked: false, disabled: false });
  assert.deepEqual(a.policy, selected); rejectSave = false;
  await button(reloadLabel, true);
  await page.waitForFunction(() => [...document.querySelectorAll('label')].some(label => label.textContent.trim() === '店内販売のみ' && label.querySelector('input')?.checked));
  assert.deepEqual(await button(saveLabel), { disabled: true });
  checks.push('conflict preserves unsaved draft and explicit reload restores the saved settings');

  holdRead = true; await button(reloadLabel, true);
  for (let attempt = 0; !heldRead && attempt < 50; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(heldRead); await page.select('#fixture-store', 'store-b'); await waitText('共用する店内メニューを有効にしてください。');
  heldRead(); heldRead = undefined;
  await page.waitForNetworkIdle();
  assert.deepEqual(await labelState(sharedLabel), { checked: false, disabled: true });
  assert.equal(await labelState('酒類'), null);
  assert.deepEqual(await button(saveLabel), { disabled: true });
  checks.push('foreign delayed response does not expose the previous store; no menu or tax-excluded store cannot enable');

  denyManage = true; await open(); assert.deepEqual(await labelState(sharedLabel), { checked: true, disabled: true });
  assert.deepEqual(await button(saveLabel), { disabled: true }); assert.equal(posts.length, 2);
  checks.push('readonly response cannot edit or save even if the parent page offered management controls');

  denyManage = false; await open('zh-Hans'); await waitText(chinese['店内・持ち帰りの共用メニュー']);
  await waitText(chinese['持ち帰りに標準税率を使う分類']); await waitText(chinese['店内販売のみ']);
  await waitText(chinese['共用メニュー設定を保存']);
  await capture('configured-zh-Hans');
  checks.push('actual Simplified Chinese provider and Japanese panel are responsive at 390/768/1366px');
  assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []); assert.deepEqual(unexpectedRequests, []);
  await writeFile(`${output}/verification.json`, JSON.stringify({ passed: true, checks, pageErrors, externalRequests, unexpectedRequests }, null, 2) + '\n');
  console.log(`PASS POS counter menu settings UI: ${checks.length} groups`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/verification.json`, JSON.stringify({ passed: false, checks, pageErrors, externalRequests, unexpectedRequests, error: error.stack }, null, 2) + '\n');
  throw error;
} finally { heldRead?.(); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
