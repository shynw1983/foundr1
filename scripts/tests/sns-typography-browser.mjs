import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';

// Run against a local server started with DATABASE_URL set to this dummy value.
// Every browser API request is answered locally; external browser requests fail.
const base = process.env.SNS_BASE || 'http://localhost:3177';
const evidence = process.env.SNS_EVIDENCE || '/tmp/sns-typography-evidence';
const secret = process.env.SNS_AUTH_SECRET || 'postgresql://local:local@localhost:5432/local';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'SNS_BASE must be local');
await fs.mkdir(evidence, { recursive: true });

const photo = path.join(evidence, 'synthetic-food.png');
await sharp(Buffer.from(`<svg width="1440" height="2160" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="background" x2="1" y2="1"><stop stop-color="#607567"/><stop offset=".5" stop-color="#314b39"/><stop offset="1" stop-color="#152b21"/></linearGradient><radialGradient id="soup"><stop stop-color="#cf7b42"/><stop offset="1" stop-color="#783723"/></radialGradient></defs>
  <rect width="1440" height="2160" fill="url(#background)"/><path d="M0 1500L1440 430M0 1570L1440 500" stroke="#ffffff" stroke-opacity=".035" stroke-width="35"/>
  <ellipse cx="720" cy="1210" rx="640" ry="540" fill="#11261b" opacity=".4"/><ellipse cx="720" cy="1160" rx="600" ry="510" fill="#eee4c7"/><ellipse cx="720" cy="1150" rx="540" ry="450" fill="url(#soup)"/>
  <path d="M350 1080 Q550 790 770 1010T1080 1150M320 1160Q580 920 760 1150T1100 1230M380 1290Q650 1040 870 1270" fill="none" stroke="#ead49a" stroke-width="23" stroke-linecap="round"/>
  <g fill="#8d9e5f"><ellipse cx="420" cy="925" rx="95" ry="55" transform="rotate(-30 420 925)"/><ellipse cx="1000" cy="1060" rx="100" ry="70" transform="rotate(30 1000 1060)"/><ellipse cx="540" cy="1430" rx="110" ry="45" transform="rotate(20 540 1430)"/></g>
  <g fill="#f4dab2"><circle cx="650" cy="1190" r="55"/><circle cx="910" cy="1340" r="65"/><circle cx="790" cy="945" r="60"/></g><g fill="#b7382b"><circle cx="530" cy="1050" r="20"/><circle cx="830" cy="1420" r="19"/><circle cx="1000" cy="1200" r="17"/></g>
  <path d="M1050 610L1160 1500M1110 600L1220 1490" stroke="#d5b48c" stroke-width="24" stroke-linecap="round"/>
</svg>`)).png().toFile(photo);
const photoData = `data:image/png;base64,${(await fs.readFile(photo)).toString('base64')}`;
const logos = Object.fromEntries(await Promise.all(['black', 'white'].map(async color => [color, await fs.readFile(`assets/sns/maamaa-complete-logo-${color}.png`)])));
const browser = await puppeteer.launch({
  executablePath: process.env.SNS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-first-run', '--no-default-browser-check'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
const pageErrors = [], blockedRequests = [], apiRequests = [], passed = [];
const record = value => { passed.push(value); console.log('PASS', value); };
page.on('pageerror', error => pageErrors.push(error.message));
const stores = [{ id: '00000000-0000-4000-8000-000000000002', name: 'まぁ麻 · テスト店舗' }];
const fixture = {
  employee: { id: 'test-owner', loginId: 'test-owner', sessionVersion: 1, role: 'owner', name: 'Typography Test', permittedNavPaths: ['/os/sns', '/store'] },
  access: { role: 'owner', canUseAllStoreView: true, stores },
  selectedStoreId: stores[0].id,
  runs: [], notifications: [], orders: [], jobs: [], stores,
  settings: {
    availability: { targets: { items: true, options: true }, optionDisplayMode: 'separate_category', allowStorePriceEdit: false, allowChannelToggle: false },
    header: { showClock: true, showNotifications: true, showLanguagePicker: true, userDisplay: 'avatar' },
    orderAlerts: { sound: 'kitchen_bell', repeatUntilHandled: true },
  },
};
const payload = Buffer.from(JSON.stringify({ ...fixture.employee, sessionId: '00000000-0000-4000-8000-000000000001', expiresAt: Date.now() + 3_600_000 })).toString('base64url');
const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
await page.setCookie({ name: 'foundr1_os_session', value: `${payload}.${signature}`, url: base });
await page.setRequestInterception(true);
page.on('request', request => {
  const url = new URL(request.url());
  if (url.protocol === 'data:' || url.protocol === 'blob:') return void request.continue();
  if (url.origin !== new URL(base).origin) {
    blockedRequests.push(request.url());
    return void request.abort('blockedbyclient');
  }
  if (url.pathname.startsWith('/api/')) {
    apiRequests.push({ method: request.method(), path: url.pathname, search: url.search });
    assert.equal(request.method(), 'GET', 'editor must not send mutations');
    if (url.pathname === '/api/sns' && url.searchParams.has('asset')) {
      return void request.respond({ status: 200, contentType: 'image/png', body: logos[url.searchParams.get('color') || 'black'] });
    }
    const response = url.pathname === '/api/sns' ? { stores, canManage: true }
      : url.pathname === '/api/store/realtime-config' ? { enabled: false }
      : url.pathname === '/api/store/theme' ? { target: 'operations', storeId: stores[0].id, storeName: stores[0].name, stores, brand: null, canManageTheme: true, updatedAt: null, revision: null, theme: { mode: 'custom', primaryColor: '#18563e', paletteVersion: 1 } }
      : fixture;
    return void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  }
  return void request.continue();
});

const testid = id => `[data-testid="${id}"]`;
async function clickText(text) {
  await page.evaluate(value => {
    const button = [...document.querySelectorAll('.sns-editor button')].find(element => element.textContent.trim() === value || element.textContent.trim().startsWith(value));
    if (!button || button.disabled) throw Error(`Enabled button not found: ${value}`);
    button.click();
  }, text);
  await settled();
}
async function clickId(id) {
  const element = await page.$(testid(id));
  assert.ok(element, `Control exists: ${id}`);
  assert.equal(await element.evaluate(element => element.matches(':disabled')), false, `Control enabled: ${id}`);
  await element.click();
  await settled();
}
async function setValue(id, value) {
  await page.$eval(testid(id), (element, value) => {
    if (element.matches(':disabled')) throw Error(`Disabled: ${element.dataset.testid}`);
    element.focus();
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, String(value));
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  }, value);
  await settled();
  await page.$eval(testid(id), element => element.blur());
  await settled();
}
async function typeNumber(id, value, commit = 'Enter') {
  const element = await page.$(testid(id));
  await element.evaluate(element => { element.focus(); element.select(); });
  await page.keyboard.type(String(value));
  await settled();
  assert.equal(await element.evaluate(element => Number(element.value)), value, `numeric draft accepts uncommitted ${id}`);
  if (commit === 'Enter') await page.keyboard.press('Enter');
  else await element.evaluate(element => element.blur());
  await settled();
  assert.equal(await element.evaluate(element => Number(element.value)), value, `ordinary numeric typing commits ${id}`);
}
async function settled() {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function upload() {
  await (await page.$('.sns-editor input[type="file"]')).uploadFile(photo);
  await page.waitForFunction(() => [...document.querySelectorAll('.sns-editor button')].some(button => button.textContent.trim() === '画像を保存' && !button.disabled));
  await settled();
}
async function canvasData() {
  return page.$eval('.sns-stage canvas', canvas => canvas.toDataURL('image/png'));
}
async function hash() {
  return crypto.createHash('sha256').update(await canvasData()).digest('hex');
}
async function saveCanvas(name) {
  const data = await canvasData();
  await fs.writeFile(path.join(evidence, name), Buffer.from(data.split(',')[1], 'base64'));
  return data;
}
async function contactSheet() {
  const layouts = [['cover', 'Modern cover'], ['center', 'Serif center'], ['footer', 'Minimal footer'], ['split', 'Bilingual split']];
  const cards = await Promise.all(layouts.map(async ([id, label]) => {
    const bytes = await fs.readFile(path.join(evidence, `layout-${id}.png`));
    return `<article><div class="label">${label}</div><img alt="${label}" src="data:image/png;base64,${bytes.toString('base64')}"></article>`;
  }));
  const gallery = await browser.newPage();
  try {
    await gallery.setViewport({ width: 1000, height: 560, deviceScaleFactor: 1 });
    await gallery.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;padding:24px;background:#f2f3ef;color:#263b30;font:14px Arial,sans-serif}h1{font-size:22px;font-weight:600;margin:0 0 6px}p{margin:0 0 18px;color:#67756b;font-size:12px}.gallery{display:grid;grid-template-columns:repeat(4,216px);gap:16px}article{margin:0}.label{font-size:12px;letter-spacing:.06em;margin:0 0 10px}img{display:block;width:216px;height:384px;box-shadow:0 3px 12px #20342618}
    </style></head><body><h1>SNS typography layouts</h1><p>SYNTHETIC DEMO PHOTO · Same photo and copy in every layout · 1080 × 1920 export</p><main class="gallery">${cards.join('')}</main></body></html>`, { waitUntil: 'load' });
    await gallery.evaluate(() => document.fonts.ready);
    await gallery.screenshot({ path: path.join(evidence, 'layouts-overview.png') });
  } finally { await gallery.close(); }
}
async function cropHash() {
  // Top-left background is outside every default text layout and the logo.
  return page.$eval('.sns-stage canvas', async canvas => {
    const bytes = canvas.getContext('2d').getImageData(0, 0, 48, 48).data;
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].join(',');
  });
}
async function guide() {
  return page.evaluate(() => {
    const element = document.querySelector('[data-testid^="sns-text-bound-"][aria-selected="true"]') || document.querySelector('[data-testid^="sns-text-bound-"]') || document.querySelector('.sns-text-guide.is-selected') || document.querySelector('.sns-text-guide');
    if (!element) throw Error('Text guide missing');
    const rect = element.getBoundingClientRect(), canvas = document.querySelector('.sns-stage canvas').getBoundingClientRect();
    return { x: element.dataset.x ? Number(element.dataset.x) : (rect.x - canvas.x) * 1080 / canvas.width, y: element.dataset.y ? Number(element.dataset.y) : (rect.y - canvas.y) * 1920 / canvas.height, width: element.dataset.width ? Number(element.dataset.width) : rect.width * 1080 / canvas.width, height: element.dataset.height ? Number(element.dataset.height) : rect.height * 1920 / canvas.height, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
  });
}
async function assertGuideSafe() {
  const bounds = await guide();
  assert.ok(bounds.x >= 31.5 && bounds.y >= 31.5, `text starts inside safe margin ${JSON.stringify(bounds)}`);
  assert.ok(bounds.x + bounds.width <= 1048.5 && bounds.y + bounds.height <= 1580.5, `text ends above logo ${JSON.stringify(bounds)}`);
  return bounds;
}

try {
  await page.goto(`${base}/os/sns`, { waitUntil: 'networkidle0', timeout: 90_000 });
  await page.waitForFunction(() => document.querySelector('.sns-editor input[type="file"]') && ![...document.querySelectorAll('.sns-editor button')].find(button => button.textContent.trim() === '写真を選択')?.disabled);
  await upload();
  await page.evaluate(() => {
    window.__exports = [];
    const originalBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
      originalBlob.call(this, blob => {
        const reader = new FileReader();
        reader.onload = () => { window.__lastBlob = { data: reader.result, type: blob.type }; callback(blob); };
        reader.readAsDataURL(blob);
      }, ...args);
    };
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
      if (this.download) { window.__exports.push({ name: this.download, ...window.__lastBlob }); return; }
      originalClick.call(this);
    };
  });
  const originalCanvas = await saveCanvas('01-logo-only.png');
  const differences = await page.evaluate(async ({ photo, logo }) => {
    const image = async src => { const element = new Image(); element.src = src; await element.decode(); return element; };
    const original = await image(photo), brand = await image(logo), expected = document.createElement('canvas');
    expected.width = 1080; expected.height = 1920;
    const context = expected.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, 1080, 1920);
    const scale = Math.max(1080 / original.width, 1920 / original.height);
    context.drawImage(original, (1080 - original.width * scale) / 2, (1920 - original.height * scale) / 2, original.width * scale, original.height * scale);
    context.drawImage(brand, 345, 1658, 390, 130);
    const a = context.getImageData(0, 0, 1080, 1920).data, b = document.querySelector('.sns-stage canvas').getContext('2d').getImageData(0, 0, 1080, 1920).data;
    let count = 0; for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) count++;
    return count;
  }, { photo: photoData, logo: `data:image/png;base64,${logos.black.toString('base64')}` });
  assert.equal(differences, 0, 'text disabled preserves exact legacy photo+logo pixels');
  record('Text disabled matches an independent legacy rendering pixel for pixel');

  await clickId('sns-text-add-overlay');
  await page.waitForSelector(testid('sns-text-content'));
  assert.notEqual(await canvasData(), originalCanvas, 'text changes rendered pixels');
  await assertGuideSafe();
  await saveCanvas('02-initial-typography.png');
  record('Enabling text renders in safe area above logo');

  const copyOptions = await page.$$eval(`${testid('sns-text-copy')} option`, options => options.map(option => ({ value: option.value, text: option.textContent })));
  assert.ok(copyOptions.length >= 4, 'curated copy choices available');
  const chosenCopy = copyOptions.at(-1);
  await setValue('sns-text-copy', chosenCopy.value);
  await clickId('sns-text-copy-apply');
  assert.ok((await page.$eval(testid('sns-text-content'), element => element.value)).length > 0);

  const layoutButtons = await page.$$eval('[data-testid^="sns-text-layout-"]', elements => elements.map(element => element.dataset.testid));
  assert.ok(layoutButtons.length >= 3, 'at least three layout systems');
  await setValue('sns-text-copy', copyOptions[2].value);
  await clickId('sns-text-copy-apply');
  await clickText('白文字');
  await page.waitForFunction(() => [...document.querySelectorAll('.sns-editor button')].some(button => button.textContent.trim() === '画像を保存' && !button.disabled));
  for (const id of layoutButtons) {
    await clickId(id);
    await assertGuideSafe();
    await saveCanvas(`layout-${id.replace('sns-text-layout-', '')}.png`);
  }
  await contactSheet();
  await setValue('sns-text-copy', chosenCopy.value);
  await clickId('sns-text-copy-apply');
  await clickText('黒文字');
  await page.waitForFunction(() => [...document.querySelectorAll('.sns-editor button')].some(button => button.textContent.trim() === '画像を保存' && !button.disabled));
  await clickId(layoutButtons[0]);
  await clickId('sns-text-add-layer');
  await clickId('sns-text-add-layer');
  assert.equal((await page.$$('[data-testid^="sns-text-layer-"]')).length, 4, 'up to four editable text layers');
  assert.equal(await page.$eval(testid('sns-text-add-layer'), element => element.matches(':disabled')), true, 'fifth layer blocked');
  await clickId('sns-text-delete-layer');
  assert.equal((await page.$$('[data-testid^="sns-text-layer-"]')).length, 3, 'delete selected layer');
  await clickId('sns-text-delete-layer');
  await clickId('sns-text-layer-0');
  await setValue('sns-text-size', 128);
  await typeNumber('sns-text-size', 60);
  await page.$eval(testid('sns-text-size'), element => { element.focus(); element.select(); });
  await page.keyboard.type('90'); await page.keyboard.press('Escape'); await settled();
  await page.$eval(testid('sns-text-size'), element => element.blur()); await settled();
  assert.equal(await page.$eval(testid('sns-text-size'), element => Number(element.value)), 60, 'Escape discards numeric draft');
  await setValue('sns-text-width', 936);
  await typeNumber('sns-text-width', 860, 'blur');
  record('Numeric typing allows 128 to 60, width commit on blur, and Escape discards drafts');
  const fonts = await page.$$eval(`${testid('sns-text-font')} option`, elements => elements.map(element => element.value));
  assert.ok(fonts.length >= 3, 'distinct font families available');
  const previousFont = await hash();
  await setValue('sns-text-font', fonts.at(-1));
  assert.notEqual(await hash(), previousFont, 'font selection changes output');
  await setValue('sns-text-tracking', 8);
  await setValue('sns-text-size', 84);
  await setValue('sns-text-line-height', 1.3);
  await setValue('sns-text-width', 860);
  for (const alignment of ['left', 'center', 'right']) await clickId(`sns-text-align-${alignment}`);
  for (const color of ['black', 'white', 'coral', 'cream']) await clickId(`sns-text-color-${color}`);
  await clickId('sns-text-align-left');
  await clickId('sns-text-color-white');
  await setValue('sns-text-content', 'Make room\nfor something good.');
  await assertGuideSafe();
  record('Copy, layouts, fonts, tracking, size, line height, width, alignment, colors');
  const beforeDeselect = await hash();
  const blank = await page.$eval('.sns-stage canvas', canvas => { const rect = canvas.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height * 0.72 }; });
  await page.mouse.click(blank.x, blank.y);
  await settled();
  assert.equal((await page.$$(testid('sns-text-content'))).length, 0, 'blank click deselects text consistently');
  assert.equal(await hash(), beforeDeselect, 'deselecting text preserves image');
  await clickId('sns-text-layer-0');

  const cropBeforeDrag = await cropHash();
  const beforeDrag = await guide();
  await page.mouse.move(beforeDrag.clientX, beforeDrag.clientY);
  await page.mouse.down();
  await page.mouse.move(beforeDrag.clientX + 14, beforeDrag.clientY + 17, { steps: 5 });
  await page.mouse.up();
  await settled();
  const afterDrag = await guide();
  assert.ok(afterDrag.x !== beforeDrag.x || afterDrag.y !== beforeDrag.y, 'drag moves selected text');
  assert.equal(await cropHash(), cropBeforeDrag, 'dragging selected text preserves photo crop');
  await page.$eval('.sns-stage canvas', canvas => canvas.focus());
  await page.keyboard.press('ArrowDown');
  await settled();
  const afterArrow = await guide();
  assert.ok(afterArrow.y > afterDrag.y, 'arrow key moves selected text');
  assert.equal(await cropHash(), cropBeforeDrag, 'text arrow key preserves photo crop');
  record('Dragging and arrow keys move text independently of photo crop');
  const beforeModeSwitch = await hash();
  await clickId('sns-edit-photo');
  assert.equal(await hash(), beforeModeSwitch, 'hiding selected guide leaves image unchanged');
  const photoBox = await page.$eval('.sns-stage canvas', canvas => { const rect = canvas.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height * 0.7 }; });
  await page.mouse.move(photoBox.x, photoBox.y); await page.mouse.down(); await page.mouse.move(photoBox.x + 14, photoBox.y, { steps: 4 }); await page.mouse.up();
  await settled();
  assert.notEqual(await cropHash(), cropBeforeDrag, 'photo mode moves photo crop');
  await clickId('sns-edit-text');
  const textAfterCrop = await guide();
  assert.equal(textAfterCrop.x, afterArrow.x, 'photo movement preserves text x');
  assert.equal(textAfterCrop.y, afterArrow.y, 'photo movement preserves text y');
  record('Photo/text mode selection is independent and guide remains outside exported pixels');

  const content = '今日も、自分らしい一杯を。🌶️\nA little heat, a lot to love. 🍜\n心地よい余白と、選ぶ楽しさ。';
  await setValue('sns-text-content', content);
  await setValue('sns-text-width', 460);
  await setValue('sns-text-size', 150);
  await assertGuideSafe();
  await saveCanvas('03-wrapped-japanese-english-emoji.png');
  assert.equal(await page.$eval(testid('sns-text-content'), element => element.value), content, 'mixed copy preserved');
  record('Long Japanese/English/emoji copy wraps and remains in safe area');

  const textBeforeLogo = await page.$eval(testid('sns-text-content'), element => element.value);
  await clickText('白文字');
  await page.waitForFunction(() => [...document.querySelectorAll('.sns-editor button')].some(button => button.textContent.trim() === '画像を保存' && !button.disabled));
  await clickText('B ·');
  await clickText('構図をリセット');
  assert.equal(await page.$eval(testid('sns-text-content'), element => element.value), textBeforeLogo, 'logo/crop actions preserve text');
  record('Changing logo color/preset and resetting crop preserves text');

  const beforePreview = await hash();
  await clickText('プレビュー');
  assert.equal(await hash(), beforePreview, 'HTML edit guides are never baked into output');
  const unlockedTypography = await page.$$eval(`${testid('sns-text-controls')} input,${testid('sns-text-controls')} select,${testid('sns-text-controls')} textarea,${testid('sns-text-controls')} button`, elements => elements.filter(element => !element.matches(':disabled')).map(element => ({ tag: element.tagName, name: element.dataset.testid || element.getAttribute('aria-label') || element.textContent })));
  assert.deepEqual(unlockedTypography, [], 'preview disables every typography control');
  const canvasBox = await page.$eval('.sns-stage canvas', canvas => { const rect = canvas.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; });
  await page.mouse.move(canvasBox.x, canvasBox.y); await page.mouse.down(); await page.mouse.move(canvasBox.x + 20, canvasBox.y + 20); await page.mouse.up();
  await page.$eval('.sns-stage canvas', canvas => canvas.focus()); await page.keyboard.press('ArrowRight'); await settled();
  assert.equal(await hash(), beforePreview, 'preview prevents dragging and keyboard edits');
  record('Preview removes HTML guides and locks typography, pointer, keyboard editing');

  for (const mime of ['image/png', 'image/jpeg']) {
    await page.evaluate(mime => {
      const select = [...document.querySelectorAll('.sns-editor select')].find(element => [...element.options].some(option => option.value === mime));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, mime);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, mime);
    const expected = await page.$eval('.sns-stage canvas', (canvas, mime) => canvas.toDataURL(mime, 0.94), mime);
    const index = await page.evaluate(() => window.__exports.length);
    await clickText('画像を保存');
    await page.waitForFunction(index => window.__exports.length > index, {}, index);
    const exported = await page.evaluate(index => window.__exports[index], index);
    assert.equal(exported.type, mime);
    assert.equal(exported.data, expected, 'export bytes exactly match preview canvas');
    const buffer = Buffer.from(exported.data.split(',')[1], 'base64');
    const metadata = await sharp(buffer).metadata();
    assert.equal(metadata.width, 1080); assert.equal(metadata.height, 1920);
    await fs.writeFile(path.join(evidence, mime === 'image/png' ? 'export.png' : 'export.jpg'), buffer);
  }
  record('PNG/JPEG export 1080x1920 with bytes identical to preview canvas');

  await clickText('編集に戻る');
  await clickId('sns-text-clear');
  const remaining = await page.$$(testid('sns-text-content'));
  assert.equal(remaining.length, 0, 'clear removes text layers');
  await clickId('sns-text-add-overlay');
  await setValue('sns-text-content', 'A little heat.\nA lot to love.');
  await clickId(layoutButtons[0]);
  for (const [name, width, height] of [['desktop', 1280, 1000], ['tablet', 820, 1180], ['phone', 390, 844]]) {
    await page.setViewport({ width, height });
    await settled();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} no horizontal overflow`);
    await page.screenshot({ path: path.join(evidence, `editor-${name}.png`), fullPage: true });
    if (name === 'phone') {
      await page.$eval(testid('sns-text-content'), element => { element.scrollIntoView({ block: 'center' }); element.focus(); });
      await settled();
      await page.screenshot({ path: path.join(evidence, 'editor-phone-typing.png') });
    }
  }
  record('Desktop 1280, tablet 820, phone 390 layouts have no horizontal overflow');

  await page.goto(`${base}/store/sns`, { waitUntil: 'networkidle0', timeout: 90_000 });
  await page.waitForSelector(testid('sns-text-add-overlay'));
  await upload();
  await clickId('sns-text-add-overlay');
  await assertGuideSafe();
  await page.screenshot({ path: path.join(evidence, 'store-phone.png'), fullPage: true });
  record('Store SNS route uses the shared typography editor');
  const chineseDictionary = JSON.parse(await fs.readFile('public/locales/os/zh-Hans.json', 'utf8'));
  await page.evaluate(() => { localStorage.setItem('foundr1-os-language', 'zh-Hans'); localStorage.setItem('foundr1-os-language-preference', 'manual'); });
  await page.reload({ waitUntil: 'networkidle0', timeout: 90_000 });
  await page.waitForFunction(() => document.documentElement.lang === 'zh-Hans');
  await page.waitForSelector(testid('sns-text-add-overlay'));
  await clickId('sns-text-add-overlay');
  await page.waitForFunction(expected => document.querySelector('[data-testid="sns-text-controls"] legend')?.textContent === expected, {}, chineseDictionary['写真に載せる文字']);
  assert.deepEqual(await page.$$eval(`${testid('sns-text-copy')} option`, elements => elements.map(element => ({ value: element.value, text: element.textContent }))), copyOptions, 'Chinese UI preserves exact curated Japanese/English copy');
  await setValue('sns-text-copy', copyOptions[2].value);
  await clickId('sns-text-copy-apply');
  assert.equal(await page.$eval(testid('sns-text-content'), element => element.value), '今日の気分を、\nひと鉢に。', 'Japanese photo text remains exact in Chinese UI');
  record('Chinese UI translates editor controls while preserving Japanese/English artwork copy');
  assert.deepEqual(pageErrors, [], 'no browser runtime errors');
  assert.deepEqual(blockedRequests, [], 'no external requests attempted');
  console.log(JSON.stringify({ passed, evidence }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
  await fs.writeFile(path.join(evidence, 'failure.html'), await page.content()).catch(() => {});
  throw error;
} finally {
  await fs.writeFile(path.join(evidence, 'browser-results.json'), JSON.stringify({ passed, pageErrors, blockedRequests, apiRequests, limitations: ['All authorization/store APIs use local fixtures; production permissions and SQL were not exercised.', 'Chrome desktop emulation does not verify a real Android native share or image-save bridge.'] }, null, 2));
  await browser.close();
}
