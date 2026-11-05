// Actual editor/canvas, isolated Chromium only. No production API or hardware calls.
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
const output = resolve(args.output || 'outputs/pos-display-editor-placement-ui');
await mkdir(output, { recursive: true });
const require = createRequire(join(source, 'package.json'));
const { build, stop } = require('esbuild');
const puppeteer = require('puppeteer-core');
const files = ['components/pos/PosDisplayStandbyCanvas.tsx', 'components/pos/PosDisplayStandbyCanvas.module.css', 'app/os/pos/PosDisplayStandbyEditor.tsx', 'app/os/pos/PosDisplayStandbyEditor.module.css', 'lib/pos-display-standby-geometry.ts', 'lib/pos-display-standby.ts'];
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async path => [path, createHash('sha256').update(await readFile(join(source, path))).digest('hex')])));
const before = await hashes(), checks = [], errors = [], denied = [];
const record = (name, condition, detail) => { assert.ok(condition, `${name}: ${JSON.stringify(detail)}`); checks.push({ name, ...(detail ? { detail } : {}) }); };
const geometryBundle = await build({ entryPoints: [join(source, 'lib/pos-display-standby-geometry.ts')], bundle: true, write: false, format: 'esm', platform: 'node' });
const { snapStandbyPosition: snap, standbyCenteredAxes: centered, standbyCenterPosition: center } = await import(`data:text/javascript;base64,${Buffer.from(geometryBundle.outputFiles[0].text).toString('base64')}`);
assert.equal(snap(22.2, 43, true), 20);
assert.equal(snap(29.1, 43, true), 28.5);
assert.equal(snap(22.26, 43, false), 22.3);
assert.equal(snap(-10, 43, true), 0);
assert.equal(snap(99, 43, true), 57);
assert.equal(center(43.1), 28.45);
assert.deepEqual(centered({ x: 28.45, y: 38, width: 43.1, height: 24 }), { horizontal: true, vertical: true });
assert.deepEqual(centered({ x: 28.4, y: 39, width: 43.1, height: 24 }), { horizontal: false, vertical: false });
checks.push({ name: 'Geometry: grid, off-grid center priority, free drag, bounds and exact odd-width centering' });

const entry = `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{PosDisplayStandbyEditor}from'./app/os/pos/PosDisplayStandbyEditor';
import{PosDisplayStandbyCanvas}from'./components/pos/PosDisplayStandbyCanvas';
import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
import{defaultPosDisplayStandbySettings}from'./lib/pos-display-standby';
window.__changes=[];window.__saved=[];
function App(){const[value,setValue]=useState(()=>defaultPosDisplayStandbySettings());window.__value=value;
if(location.pathname==='/display')return <div style={{height:'100dvh'}}><PosDisplayStandbyCanvas settings={value} orientation="landscape" storeName="検証店舗" selectedId="welcome"/></div>;
return <main style={{maxWidth:1280,margin:'0 auto',padding:16}}><PosDisplayStandbyEditor value={value} onChange={v=>{window.__changes.push(v);setValue(v)}} onSave={()=>window.__saved.push(value)} storeName="検証店舗" storeId="11111111-1111-4111-8111-111111111111" canManage={!location.search.includes('readonly')} saving={false}/></main>}
createRoot(document.getElementById('root')).render(<OsTranslationProvider><App/></OsTranslationProvider>);
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: source, loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = await readFile(join(source, 'app/globals.css'), 'utf8') + '\n' + bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://fixture').pathname;
  if (path === '/fixture.js') { response.writeHead(200, { 'Content-Type': 'application/javascript' }); response.end(js); }
  else if (path === '/' || path === '/display') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html); }
  else if (path === '/favicon.ico') { response.writeHead(204); response.end(); }
  else { denied.push({ path, method: request.method }); response.writeHead(403); response.end(); }
});
await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, pipe: true });
const pause = ms => new Promise(ok => setTimeout(ok, ms));
let activePage;
async function pageAt(viewport, path = '/') {
  const page = await browser.newPage(); activePage = page;
  await page.setViewport(viewport); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => { localStorage.setItem('foundr1-os-language', 'ja'); localStorage.setItem('foundr1-os-language-preference', 'manual'); });
  await page.setRequestInterception(true);
  page.on('request', request => request.url().startsWith(origin + '/') ? request.continue() : (denied.push(request.url()), request.abort()));
  await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-standby-canvas]'); return page;
}
async function click(page, selector) {
  await page.$eval(selector, node => node.scrollIntoView({ block: 'center', inline: 'center' })); await pause(40);
  const box = await (await page.$(selector)).boundingBox(); assert.ok(box);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await pause(40);
}
async function input(page, name, value) {
  const selector = `[name="standby-${name}"]`; await click(page, selector); await page.$eval(selector, node => node.select());
  await page.keyboard.press('Backspace'); await page.type(selector, String(value)); await page.keyboard.press('Tab'); await pause(40);
}
const value = page => page.evaluate(() => window.__value);
const block = async page => (await value(page)).layouts.landscape.find(item => item.id === 'clock');
async function dragTo(page, x, y, touch = false) {
  await page.$eval('[data-standby-canvas]', node => node.scrollIntoView({ block: 'center' })); await pause(40);
  const current = await block(page);
  const bounds = await page.$eval('[data-standby-canvas]', node => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  const start = { x: bounds.x + (current.x + current.width / 2) / 100 * bounds.width, y: bounds.y + (current.y + current.height / 2) / 100 * bounds.height };
  const target = { x: start.x + (x - current.x) / 100 * bounds.width, y: start.y + (y - current.y) / 100 * bounds.height };
  if (touch) {
    await page.touchscreen.touchStart(start.x, start.y);
    await page.touchscreen.touchMove(target.x, target.y); await page.touchscreen.touchEnd();
  } else {
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 8 }); await page.mouse.up();
  }
  await pause(60);
}
try {
  for (const viewport of [{ width: 896, height: 414, hasTouch: true }, { width: 808, height: 320 }, { width: 414, height: 896 }, { width: 800, height: 1100 }, { width: 1366, height: 900 }]) {
    const page = await pageAt(viewport);
    const portrait = (await value(page)).layouts.portrait;
    record('Snap defaults on', await page.$eval('[data-standby-snap]', node => node.checked), viewport);
    await click(page, '[data-standby-orientation="landscape"]');
    await page.select('[data-standby-select]', 'clock');
    const beforeClick = await block(page); await click(page, '[data-standby-block="clock"]');
    assert.deepEqual(await block(page), beforeClick);
    await dragTo(page, 22.2, 32.2);
    let result = await block(page); assert.equal(result.x, 20); assert.equal(result.y, 30);
    record('Actual pointer drag snaps to grid without click mutation', true, viewport);
    await dragTo(page, 29, 38.4); result = await block(page);
    assert.equal(result.x, 28.5); assert.equal(result.y, 38);
    for (const axis of ['horizontal', 'vertical']) assert.equal(await page.$eval(`[data-standby-centered="${axis}"]`, node => node.dataset.centered), 'true');
    assert.equal(await page.$$eval('[data-standby-guide][data-centered="true"]', nodes => nodes.length), 2);
    record('Center takes priority over grid, both guide and state confirm', true, viewport);
    if (viewport.hasTouch) {
      await dragTo(page, 15.7, 25.7, true); result = await block(page); assert.equal(result.x, 15); assert.equal(result.y, 25);
      record('Native Chromium touch drag snaps without scrolling the canvas', true, viewport);
    }
    await click(page, '[data-standby-snap]');
    await dragTo(page, 22.2, 32.2); result = await block(page);
    assert.ok(Math.abs(result.x - 22.2) <= .15); assert.ok(Math.abs(result.y - 32.2) <= .15);
    assert.equal(await page.$$eval('[data-standby-guide][data-centered="true"]', nodes => nodes.length), 0);
    record('Snapping can be disabled for free placement', true, viewport);
    await input(page, 'width', 43.1);
    const beforeCenter = await block(page); await click(page, '[data-standby-center="horizontal"]'); result = await block(page);
    assert.equal(result.x, 28.45); assert.equal(result.y, beforeCenter.y); assert.equal(result.align, beforeCenter.align); assert.equal(result.width, 43.1);
    await click(page, '[data-standby-center="vertical"]'); result = await block(page); assert.equal(result.y, 38);
    await click(page, '[name="standby-x"]'); await page.keyboard.press('Tab'); assert.equal((await block(page)).x, 28.45);
    const stable = await block(page); await click(page, '[data-standby-snap]'); assert.deepEqual(await block(page), stable);
    await dragTo(page, 28.45, 51); result = await block(page); assert.equal(result.x, 28.45); assert.equal(result.y, 50);
    await click(page, '[data-standby-center="vertical"]');
    // Keyboard remains precise even with snapping enabled.
    await click(page, '[data-standby-block="clock"]'); await page.keyboard.press('ArrowRight');
    result = await block(page); assert.equal(result.x, 29.45);
    record('Center buttons preserve size and text alignment; focus/blur and single-axis drag keep exact center; keyboard remains a fine adjustment', true, viewport);
    assert.deepEqual((await value(page)).layouts.portrait, portrait);
    await click(page, '[data-standby-save]');
    const saved = await page.evaluate(() => window.__saved.at(-1));
    assert.deepEqual(saved, await value(page)); assert.equal('snapToGrid' in saved, false);
    record('Orientation and save isolation; editor snap preference not persisted', true, viewport);
    // Restore the clock and select the centered welcome block for readable screenshots.
    await input(page, 'x', 5); await input(page, 'y', 6); await input(page, 'width', 43);
    await page.select('[data-standby-select]', 'welcome');
    await page.$eval('[data-standby-canvas]', node => node.scrollIntoView({ block: 'center' })); await pause(40);
    const bounds = await page.evaluate(() => {
      const section = document.querySelector('#pos-display-standby-settings'), r = section.getBoundingClientRect();
      return { left: r.left, right: r.right, scrollWidth: document.documentElement.scrollWidth, width: innerWidth, controls: [...section.querySelectorAll('input,button,select,textarea')].map(node => { const b = node.getBoundingClientRect(); return { left: b.left, right: b.right }; }) };
    });
    record('Editor controls fit viewport without horizontal overflow', bounds.left >= 0 && bounds.right <= viewport.width && bounds.scrollWidth <= viewport.width && bounds.controls.every(control => control.left >= 0 && control.right <= viewport.width), { viewport, bounds });
    await page.screenshot({ path: join(output, `editor-placement-${viewport.width}x${viewport.height}.png`) });
    await page.close();
  }
  const readonly = await pageAt({ width: 896, height: 414 }, '/?readonly');
  assert.equal(await readonly.$('[data-standby-canvas] button'), null);
  assert.equal(await readonly.$('[data-standby-guide]'), null);
  for (const selector of ['[data-standby-snap]', '[data-standby-center="horizontal"]', '[data-standby-center="vertical"]']) assert.equal(await readonly.$eval(selector, node => node.matches(':disabled')), true);
  assert.deepEqual(await readonly.evaluate(() => window.__changes), []); await readonly.close();
  checks.push({ name: 'Read-only editor cannot drag, snap, center or save; no guide rendering' });
  const display = await pageAt({ width: 896, height: 414 }, '/display');
  assert.equal(await display.$('[data-standby-guide]'), null);
  assert.equal(await display.$('[data-standby-canvas] button'), null);
  assert.equal(await display.$eval('[data-standby-canvas]', node => getComputedStyle(node).backgroundImage), 'none');
  await display.close(); checks.push({ name: 'Actual customer canvas has no grid, guide, editor buttons or snapping effects' });
  assert.deepEqual(errors, []); assert.deepEqual(denied, []); assert.deepEqual(await hashes(), before);
  await writeFile(join(output, 'verification-summary.json'), JSON.stringify({ passed: true, checks, errors, denied, sourceHashes: before }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, output }));
} catch (error) {
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(join(output, 'verification-summary.json'), JSON.stringify({ passed: false, checks, error: error.stack, errors, denied, sourceHashes: before }, null, 2));
  throw error;
} finally { await browser.close(); await new Promise(ok => server.close(ok)); stop(); }
