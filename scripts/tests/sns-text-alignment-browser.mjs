import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';

// Use only an isolated local server with DATABASE_URL set to the same dummy value.
// Every API is a local fixture. Any external browser request is blocked and fails QA.
const base = process.env.SNS_BASE || 'http://localhost:3177';
const evidence = process.env.SNS_EVIDENCE || '/tmp/sns-text-alignment-evidence';
const secret = process.env.SNS_AUTH_SECRET || 'postgresql://local:local@localhost:5432/local';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname));
await fs.mkdir(evidence, { recursive: true });
const photo = path.join(evidence, 'dark-alignment-fixture.png');
await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#152b21' } }).png().toFile(photo);
const logos = Object.fromEntries(await Promise.all(['black', 'white'].map(async color => [color, await fs.readFile(`assets/sns/maamaa-complete-logo-${color}.png`)])));
const browser = await puppeteer.launch({ executablePath: process.env.SNS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run', '--no-default-browser-check'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
const pageErrors = [], blockedRequests = [], apiRequests = [], passed = [];
const record = value => { passed.push(value); console.log('PASS', value); };
page.on('pageerror', error => pageErrors.push(error.message));
const stores = [{ id: '00000000-0000-4000-8000-000000000002', name: 'まぁ麻 · テスト店舗' }];
const fixture = {
  employee: { id: 'test-owner', loginId: 'test-owner', sessionVersion: 1, role: 'owner', name: 'Alignment Test', permittedNavPaths: ['/os/sns', '/store'] },
  access: { role: 'owner', canUseAllStoreView: true, stores }, selectedStoreId: stores[0].id,
  runs: [], notifications: [], orders: [], jobs: [], stores,
  settings: { availability: { targets: { items: true, options: true }, optionDisplayMode: 'separate_category', allowStorePriceEdit: false, allowChannelToggle: false }, header: { showClock: true, showNotifications: true, showLanguagePicker: true, userDisplay: 'avatar' }, orderAlerts: { sound: 'kitchen_bell', repeatUntilHandled: true } },
};
const payload = Buffer.from(JSON.stringify({ ...fixture.employee, sessionId: '00000000-0000-4000-8000-000000000001', expiresAt: Date.now() + 3_600_000 })).toString('base64url');
const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
await page.setCookie({ name: 'foundr1_os_session', value: `${payload}.${signature}`, url: base });
await page.setRequestInterception(true);
page.on('request', request => {
  const url = new URL(request.url());
  if (url.protocol === 'data:' || url.protocol === 'blob:') return void request.continue();
  if (url.origin !== new URL(base).origin) { blockedRequests.push(request.url()); return void request.abort('blockedbyclient'); }
  if (url.pathname.startsWith('/api/')) {
    apiRequests.push({ method: request.method(), path: url.pathname, search: url.search });
    assert.equal(request.method(), 'GET', 'Editor must not send mutations');
    if (url.pathname === '/api/sns' && url.searchParams.has('asset')) return void request.respond({ status: 200, contentType: 'image/png', body: logos[url.searchParams.get('color') || 'black'] });
    const response = url.pathname === '/api/sns' ? { stores, canManage: true }
      : url.pathname === '/api/store/realtime-config' ? { enabled: false }
      : url.pathname === '/api/store/theme' ? { target: 'operations', storeId: stores[0].id, storeName: stores[0].name, stores, brand: null, canManageTheme: true, updatedAt: null, revision: null, theme: { mode: 'custom', primaryColor: '#18563e', paletteVersion: 1 } } : fixture;
    return void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  }
  return void request.continue();
});

const testid = id => `[data-testid="${id}"]`;
async function settled() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function clickId(id, programmatic = false) {
  const element = await page.$(testid(id)); assert.ok(element, `Control exists: ${id}`);
  assert.equal(await element.evaluate(element => element.matches(':disabled')), false, `Control enabled: ${id}`);
  if (programmatic) await element.evaluate(element => element.click()); else await element.click();
  await settled();
}
async function clickText(text, programmatic = false) {
  const handle = await page.evaluateHandle(text => [...document.querySelectorAll('.sns-editor button')].find(button => button.textContent.trim() === text), text);
  const element = handle.asElement(); assert.ok(element, `Button exists: ${text}`);
  if (programmatic) await element.evaluate(element => element.click()); else await element.click();
  await handle.dispose(); await settled();
}
async function setValue(id, value) {
  await page.$eval(testid(id), (element, value) => {
    element.focus();
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, String(value));
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  }, value);
  await settled(); await page.$eval(testid(id), element => element.blur()); await settled();
}
async function setChecked(id, value) {
  if (await page.$eval(testid(id), element => element.checked) !== value) await clickId(id);
}
async function canvasRect() {
  return page.$eval('.sns-stage canvas', canvas => { const r = canvas.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scale: r.width / 1080 }; });
}
async function ink(color = 'white') {
  // Independent raster measurement; does not call the editor's layout functions.
  // Ignore the black logo below the text-safe area and use saturated coral for a second layer.
  return page.$eval('.sns-stage canvas', (canvas, color) => {
    const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 1080, 1580).data;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, count = 0;
    for (let y = 0; y < 1580; y++) for (let x = 0; x < 1080; x++) {
      const i = (y * 1080 + x) * 4;
      const hit = color === 'white' ? data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235 : data[i] > 170 && data[i + 1] < 95 && data[i + 2] < 95;
      if (!hit) continue;
      left = Math.min(left, x); right = Math.max(right, x + 1); top = Math.min(top, y); bottom = Math.max(bottom, y + 1); count++;
    }
    if (!count) throw Error(`No ${color} glyph pixels found`);
    return { x: left, y: top, width: right - left, height: bottom - top, cx: (left + right) / 2, cy: (top + bottom) / 2, count };
  }, color);
}
async function inkLines() {
  return page.$eval('.sns-stage canvas', canvas => {
    const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 1080, 1580).data;
    const result = []; let current = null;
    for (let y = 0; y < 1580; y++) {
      let left = Infinity, right = -Infinity;
      for (let x = 0; x < 1080; x++) { const i = (y * 1080 + x) * 4; if (pixels[i] > 235 && pixels[i + 1] > 235 && pixels[i + 2] > 235) { left = Math.min(left, x); right = Math.max(right, x + 1); } }
      if (left === Infinity) { current = null; continue; }
      if (!current) { current = { left, right, top: y, bottom: y + 1 }; result.push(current); }
      else { current.left = Math.min(current.left, left); current.right = Math.max(current.right, right); current.bottom = y + 1; }
    }
    return result.map(line => ({ ...line, cx: (line.left + line.right) / 2 }));
  });
}
async function guides() {
  return page.$$eval('[data-testid="sns-snap-guide-x"],[data-testid="sns-snap-guide-y"]', elements => elements.map(element => ({ axis: element.dataset.testid.endsWith('-x') ? 'x' : 'y', position: Number(element.dataset.position), target: element.dataset.target, anchor: element.dataset.anchor, sourceAnchor: element.dataset.sourceAnchor })));
}
async function expectGuide(axis, position) {
  const guide = (await guides()).find(item => item.axis === axis);
  assert.ok(guide, `${axis} snapping guide visible`); assert.ok(Math.abs(guide.position - position) < 0.05, `${axis} guide at ${position}, got ${JSON.stringify(guide)}`);
}
function near(actual, expected, tolerance, message) { assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected} ±${tolerance}, got ${actual}`); }
async function hash() { return crypto.createHash('sha256').update(await page.$eval('.sns-stage canvas', canvas => canvas.toDataURL())).digest('hex'); }
async function saveCanvas(name) { const data = await page.$eval('.sns-stage canvas', canvas => canvas.toDataURL('image/png')); await fs.writeFile(path.join(evidence, name), Buffer.from(data.split(',')[1], 'base64')); }
async function beginDrag() {
  await page.$eval('.sns-stage canvas', element => element.scrollIntoView({ block: 'center' })); await settled();
  const rect = await canvasRect(), bounds = await ink();
  const start = { x: rect.x + bounds.cx * rect.scale, y: rect.y + bounds.cy * rect.scale, ink: bounds, rect };
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await settled();
  return start;
}
async function dragTo(start, cx, cy) {
  await page.mouse.move(start.x + (cx - start.ink.cx) * start.rect.scale, start.y + (cy - start.ink.cy) * start.rect.scale, { steps: 1 }); await settled();
}
async function stopDrag() { await page.mouse.up(); await settled(); assert.deepEqual(await guides(), [], 'Guides clear when pointer ends'); }
async function oneLayer() {
  if (await page.$(testid('sns-text-clear'))) await clickId('sns-text-clear');
  await clickId('sns-text-add-overlay');
  await clickId('sns-text-layer-1'); await clickId('sns-text-delete-layer'); await clickId('sns-text-layer-0');
  await setValue('sns-text-content', 'HEAT'); await setValue('sns-text-font', 'sans'); await setValue('sns-text-weight', 700); await setValue('sns-text-size', 96); await setValue('sns-text-tracking', 0);
  await clickId('sns-text-align-left'); await clickId('sns-text-color-white'); await setChecked('sns-text-shadow', false); await setChecked('sns-text-snap', true);
}
async function resetPosition(width = 400, x = 120, y = 300) {
  await clickId('sns-text-align-left'); await setValue('sns-text-width', width); await setValue('sns-text-x', x); await setValue('sns-text-y', y); await settled();
}

try {
  await page.goto(`${base}/store/sns`, { waitUntil: 'networkidle0', timeout: 90_000 });
  await page.waitForSelector(testid('sns-text-add-overlay'));
  await (await page.$('.sns-editor input[type="file"]')).uploadFile(photo);
  await page.waitForFunction(() => [...document.querySelectorAll('.sns-editor button')].some(button => button.textContent.trim() === '画像を保存' && !button.disabled));
  await oneLayer();
  assert.equal(await page.$eval(testid('sns-text-snap'), element => element.checked), true, 'Snapping is enabled by default');

  await resetPosition(936, 72, 300);
  const wideInk = await ink(), wideX = await page.$eval(testid('sns-text-x'), element => Number(element.value)), wideWidth = await page.$eval(testid('sns-text-width'), element => Number(element.value));
  near(wideX + wideWidth / 2, 540, 0.01, 'Wide left-aligned frame is centered');
  assert.ok(Math.abs(wideInk.cx - 540) > 100, 'Visible text is deliberately far from frame center');
  let start = await beginDrag(); await dragTo(start, wideInk.cx + 1 / start.rect.scale, wideInk.cy);
  assert.equal((await guides()).filter(item => item.axis === 'x').length, 0, 'A centered frame must not show a false text-center guide');
  await dragTo(start, 540 + 5 / start.rect.scale, wideInk.cy); await expectGuide('x', 540);
  near((await ink()).cx, 540, 1.5, 'Wide frame left-aligned text can be dragged to its visible center');
  assert.equal(await page.$eval(testid('sns-text-width'), element => Number(element.value)), 936, 'Dragging preserves text width and wrapping');
  assert.equal(await page.$eval(testid('sns-text-align-left'), element => element.getAttribute('aria-pressed')), 'true', 'Dragging preserves left alignment');
  await stopDrag();
  record('Wide left-aligned frame waits for actual glyph centering, then snaps without changing width or alignment');

  await resetPosition(936, 72, 300);
  const previousY = (await ink()).cy;
  await clickId('sns-text-center-horizontal');
  assert.equal(await page.$eval(testid('sns-text-align-center'), element => element.getAttribute('aria-pressed')), 'true', 'One-click centering also aligns individual lines');
  near((await ink()).cx, 540, 1.5, 'One-click horizontal center uses actual visible glyph bounds');
  near((await ink()).cy, previousY, 1, 'Horizontal centering preserves vertical position');
  await clickId('sns-text-center-vertical');
  near((await ink()).cy, 960, 1.5, 'One-click vertical center uses actual visible glyph bounds');
  await setValue('sns-text-content', 'HEAT\nOO'); await clickId('sns-text-center-horizontal');
  const lines = await inkLines(); assert.equal(lines.length, 2, 'Two independently visible lines');
  for (const [index, line] of lines.entries()) near(line.cx, 540, 1.5, `Multiline line ${index + 1} is visually centered`);
  for (const punctuation of ['.', '’', '—', '・']) {
    await setValue('sns-text-content', punctuation); await clickId('sns-text-center-vertical');
    near((await ink()).cy, 960, 1.5, `Punctuation-only ${punctuation} is centered using its visible ink`);
  }
  await setValue('sns-text-content', 'HEAT'); await clickId('sns-text-center-vertical');
  await saveCanvas('01-centered-visible-glyphs.png');
  record('One-click horizontal and vertical centering independently measured at x=540/y=960');

  for (const [name, width, height] of [['desktop', 1280, 1000], ['tablet', 820, 1180], ['phone', 390, 844]]) {
    await page.setViewport({ width, height }); await settled(); await resetPosition();
    start = await beginDrag();
    const ratio = 1 / start.rect.scale;
    await dragTo(start, 540 + 7 * ratio, start.ink.cy);
    assert.equal((await guides()).filter(item => item.axis === 'x').length, 0, `${name}: 7 screen px does not capture`);
    await dragTo(start, 540 + 5 * ratio, start.ink.cy);
    await expectGuide('x', 540); near((await ink()).cx, 540, 1.5, `${name}: 5 screen px captures visible center`);
    await dragTo(start, 540 + 8 * ratio, start.ink.cy);
    await expectGuide('x', 540); near((await ink()).cx, 540, 1.5, `${name}: 8 screen px keeps the latch`);
    await page.screenshot({ path: path.join(evidence, `snap-center-${name}.png`), fullPage: true });
    await dragTo(start, 540 + 11 * ratio, start.ink.cy);
    assert.equal((await guides()).filter(item => item.axis === 'x').length, 0, `${name}: 11 screen px releases`);
    near((await ink()).cx, 540 + 11 * ratio, 1.5, `${name}: released text follows raw pointer`);
    await stopDrag();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} has no horizontal overflow`);
  }
  record('Desktop, tablet and phone keep 6 screen px capture / 10 screen px release independent of preview scale');

  await page.setViewport({ width: 1280, height: 1000 }); await settled(); await resetPosition();
  start = await beginDrag();
  await dragTo(start, 540 + 4 / start.rect.scale, 960 + 4 / start.rect.scale);
  await expectGuide('x', 540); await expectGuide('y', 960);
  near((await ink()).cx, 540, 1.5, 'Diagonal drag snaps horizontal visible center'); near((await ink()).cy, 960, 1.5, 'Diagonal drag snaps vertical visible center');
  const snappedHash = await hash(); await saveCanvas('02-diagonal-center-snap.png');
  await page.screenshot({ path: path.join(evidence, '02-diagonal-center-guides.png') });
  await (await page.$('.sns-canvas-wrap')).screenshot({ path: path.join(evidence, 'center-guides-preview.png') });
  await page.screenshot({ path: path.join(evidence, 'center-guides-editor-desktop.png') });
  await stopDrag(); assert.equal(await hash(), snappedHash, 'Removing DOM guides does not change canvas pixels');
  record('Diagonal drag shows both canvas-center guides; guides are absent from raster output');

  await resetPosition(); start = await beginDrag(); await page.keyboard.down('Alt');
  await dragTo(start, 540 + 3 / start.rect.scale, 960 + 3 / start.rect.scale);
  assert.deepEqual(await guides(), [], 'Alt temporarily bypasses snapping');
  near((await ink()).cx, 540 + 3 / start.rect.scale, 1.5, 'Alt drag still moves text freely');
  await stopDrag(); await page.keyboard.up('Alt');
  await setChecked('sns-text-snap', false); await resetPosition(); start = await beginDrag();
  await dragTo(start, 540 + 3 / start.rect.scale, 960 + 3 / start.rect.scale);
  assert.deepEqual(await guides(), [], 'Disabled checkbox bypasses snapping');
  near((await ink()).cx, 540 + 3 / start.rect.scale, 1.5, 'Disabled snapping preserves free movement'); await stopDrag(); await setChecked('sns-text-snap', true);
  record('Alt bypass and snapping toggle preserve free dragging');

  // A second color makes the target layer independently measurable in the raster.
  await resetPosition(400, 200, 500); await clickId('sns-text-color-coral');
  const targetInk = await ink('coral');
  await clickId('sns-text-add-layer'); await setValue('sns-text-content', 'HI'); await setValue('sns-text-font', 'sans'); await setValue('sns-text-weight', 700); await setValue('sns-text-size', 56); await setValue('sns-text-tracking', 0); await setChecked('sns-text-shadow', false); await clickId('sns-text-color-white');
  const point = (bounds, axis, anchor) => (axis === 'x' ? bounds.x : bounds.y) + (axis === 'x' ? bounds.width : bounds.height) * (anchor === 'start' ? 0 : anchor === 'end' ? 1 : 0.5);
  for (const axis of ['x', 'y']) for (const anchor of ['start', 'center', 'end']) {
    await resetPosition(220, axis === 'x' ? 600 : 120, axis === 'x' ? 1100 : 900);
    start = await beginDrag(); const targetPoint = point(targetInk, axis, anchor), sourcePoint = point(start.ink, axis, anchor);
    await dragTo(start, start.ink.cx + (axis === 'x' ? targetPoint - sourcePoint + 0.5 / start.rect.scale : 0), start.ink.cy + (axis === 'y' ? targetPoint - sourcePoint + 0.5 / start.rect.scale : 0));
    const guide = (await guides()).find(item => item.axis === axis);
    assert.ok(guide && guide.target !== 'canvas', `Other-layer ${axis}/${anchor} guide visible`);
    assert.equal(guide.anchor, anchor, `Other-layer ${axis} target ${anchor}`); assert.equal(guide.sourceAnchor, anchor, `Other-layer ${axis} source ${anchor}`);
    const aligned = await ink(); near(point(aligned, axis, anchor), targetPoint, 1.5, `Actual visible ${axis} ${anchor} edges align between layers`);
    if (axis === 'x' && anchor === 'center') await page.screenshot({ path: path.join(evidence, '03-two-layer-center-guide.png') });
    await stopDrag();
  }
  record('Other text layers align visible left/center/right and top/middle/bottom anchors');
  await page.setViewport({ width: 820, height: 1180 }); await settled();
  await clickId('sns-text-layer-0'); await setValue('sns-text-width', 220); await setValue('sns-text-size', 48); await clickId('sns-text-align-right'); await setValue('sns-text-x', 828);
  const edgeTarget = await ink('coral');
  await clickId('sns-text-layer-1'); await setValue('sns-text-content', 'HI'); await resetPosition(220, 120, 1100); await clickId('sns-text-align-right');
  start = await beginDrag();
  await dragTo(start, start.ink.cx + edgeTarget.x + edgeTarget.width - start.ink.x - start.ink.width - 1 / start.rect.scale, start.ink.cy);
  const edgeGuide = (await guides()).find(guide => guide.axis === 'x'); assert.ok(edgeGuide && edgeGuide.position > 1000 && edgeGuide.target !== 'canvas', 'Layer guide near canvas right edge');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Tablet right-edge layer guide does not cause horizontal overflow');
  await page.screenshot({ path: path.join(evidence, '04-tablet-right-edge-guide.png'), fullPage: true }); await stopDrag();
  await page.setViewport({ width: 1280, height: 1000 }); await settled();
  record('Tablet guide labels near the canvas right edge do not overflow the page');
  await oneLayer();

  for (const eventName of ['pointercancel', 'lostpointercapture']) {
    await resetPosition(); start = await beginDrag(); await dragTo(start, 540 + 3 / start.rect.scale, start.ink.cy); await expectGuide('x', 540);
    await page.$eval('.sns-stage canvas', (canvas, eventName) => canvas.dispatchEvent(new PointerEvent(eventName, { pointerId: 1, bubbles: true })), eventName); await settled();
    assert.deepEqual(await guides(), [], `${eventName} clears guides`); const before = await hash();
    await page.mouse.move(start.x + 100, start.y + 20); await settled(); assert.equal(await hash(), before, `${eventName} stops stale dragging`); await stopDrag();
  }
  for (const mode of ['photo', 'preview', 'disable-snap']) {
    await resetPosition(); start = await beginDrag(); await dragTo(start, 540 + 3 / start.rect.scale, start.ink.cy); await expectGuide('x', 540);
    if (mode === 'photo') await clickId('sns-edit-photo', true); else if (mode === 'preview') await clickText('プレビュー', true); else await clickId('sns-text-snap', true);
    assert.deepEqual(await guides(), [], `${mode} clears guides`); const before = await hash();
    await page.mouse.move(start.x + 100, start.y + 20); await settled(); assert.equal(await hash(), before, `${mode} stops stale dragging`); await stopDrag();
    if (mode === 'photo') await clickId('sns-edit-text'); else if (mode === 'preview') await clickText('編集に戻る'); else await setChecked('sns-text-snap', true);
  }
  record('Pointer up/cancel/lost capture, photo mode, preview and disabling snapping clear guides and end the active drag');

  await page.evaluate(() => {
    window.__exports = [];
    const originalBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) { originalBlob.call(this, blob => { const reader = new FileReader(); reader.onload = () => { window.__lastBlob = { data: reader.result, type: blob.type }; callback(blob); }; reader.readAsDataURL(blob); }, ...args); };
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() { if (this.download) { window.__exports.push({ name: this.download, ...window.__lastBlob }); return; } originalClick.call(this); };
  });
  for (const mime of ['image/png', 'image/jpeg']) {
    await resetPosition(); start = await beginDrag(); await dragTo(start, 540 + 3 / start.rect.scale, start.ink.cy); await expectGuide('x', 540);
    await page.evaluate(mime => { const select = [...document.querySelectorAll('.sns-editor select')].find(element => [...element.options].some(option => option.value === mime)); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, mime); select.dispatchEvent(new Event('change', { bubbles: true })); }, mime); await settled();
    const expected = await page.$eval('.sns-stage canvas', (canvas, mime) => canvas.toDataURL(mime, 0.94), mime), index = await page.evaluate(() => window.__exports.length);
    await clickText('画像を保存', true); await page.waitForFunction(index => window.__exports.length > index, {}, index);
    const exported = await page.evaluate(index => window.__exports[index], index);
    assert.equal(exported.type, mime); assert.equal(exported.data, expected, `${mime} export equals guide-free canvas byte-for-byte`);
    const buffer = Buffer.from(exported.data.split(',')[1], 'base64'), metadata = await sharp(buffer).metadata(); assert.equal(metadata.width, 1080); assert.equal(metadata.height, 1920);
    await fs.writeFile(path.join(evidence, mime === 'image/png' ? 'export.png' : 'export.jpg'), buffer); await stopDrag();
  }
  record('PNG and JPEG export exactly match canvas even when a snapping guide was visible');
  assert.deepEqual(pageErrors, [], 'No browser runtime errors'); assert.deepEqual(blockedRequests, [], 'No external requests attempted');
  console.log(JSON.stringify({ passed, evidence }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
  await fs.writeFile(path.join(evidence, 'failure.html'), await page.content()).catch(() => {});
  throw error;
} finally {
  await fs.writeFile(path.join(evidence, 'browser-results.json'), JSON.stringify({ passed, pageErrors, blockedRequests, apiRequests, limitations: ['All store/auth APIs use local fixtures; production SQL and permissions were not exercised.', 'Desktop Chrome emulation does not verify a real touch device or native image-share bridge.'] }, null, 2));
  await browser.close();
}
