// Real React hook in Chromium. Synthetic DOM/CDP input validates containment,
// not Safari's operating-system edge gesture. All navigation stays in localhost.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((all, value, index, values) => {
  if (value.startsWith('--')) all.push([value.slice(2), values[index + 1]]);
  return all;
}, []));
const source = resolve(args.source || process.cwd()), output = resolve(args.output || 'outputs/customer-display-guard');
await mkdir(output, { recursive: true });
const require = createRequire(join(source, 'package.json'));
const { build, stop } = require('esbuild'), puppeteer = require('puppeteer-core');
const files = ['app/store/pos/customer-display/useCustomerDisplayGuard.ts', 'app/store/pos/customer-display/CustomerDisplayGuard.module.css'];
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async path => [path, createHash('sha256').update(await readFile(join(source, path))).digest('hex')])));
const inputHashes = await hashes();
const entry = `import React,{useRef,useState} from'react';import{createRoot}from'react-dom/client';import{useCustomerDisplayGuard}from'./app/store/pos/customer-display/useCustomerDisplayGuard';
document.documentElement.style.setProperty('overscroll-behavior-x','contain');document.body.style.setProperty('overscroll-behavior-x','auto','important');window.__historyChanges=0;for(const name of['pushState','replaceState']){const original=history[name].bind(history);history[name]=(...args)=>{window.__historyChanges++;return original(...args)}}
function Display({second=false}){const ref=useRef(null);const{confirmExit}=useCustomerDisplayGuard(ref,{exitMessage:'客席表示を終了しますか？'});return <section ref={ref} id={second?'second':'display'}><div id={second?'second-content':'content'}>表示内容</div>{!second&&<><button id="control" onClick={()=>{window.__clicked=(window.__clicked||0)+1}}>メニュー</button><a id="link" href="#controls">リンク</a><select id="select"><option>店舗</option></select><input id="input"/><div id="editable" contentEditable suppressContentEditableWarning>編集</div><div className="customer-display-item-list" id="items"><div style={{height:1300}}>注文一覧</div></div><button id="exit" onClick={()=>confirmExit('/store/exit-fixture')}>客席表示を終了</button></>}</section>}
function Fixture(){const[main,setMain]=useState(true);const[second,setSecond]=useState(false);window.__mount=setMain;window.__second=setSecond;return <><div id="outside">通常設定ページ</div>{main&&<Display/>}{second&&<Display second/>}</>};createRoot(document.getElementById('root')).render(<Fixture/>);`;
const bundle = await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: source }, bundle: true, write: false, outdir: '/virtual', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0}#display{width:100%;height:760px}#items{height:240px;overflow-y:auto;margin:12px 30px;background:#eee}#outside{height:20px}button,input,select,a,[contenteditable]{margin:4px}#second{height:60px}</style><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const requests = [], errors = [], external = [], checks = [];
const server = createServer((req, res) => {
  requests.push(req.url);
  res.writeHead(200, { 'Content-Type': req.url === '/fixture.js' ? 'application/javascript' : 'text/html' });
  res.end(req.url === '/fixture.js' ? js : req.url === '/store/exit-fixture' ? '<!doctype html><title>Exited</title><p id="exited">通常画面</p>' : html);
});
await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, pipe: true });
const check = (name, value) => { assert.ok(value, name); checks.push({ name, passed: true }); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 414, height: 896, isMobile: true, hasTouch: true });
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => request.url().startsWith(origin + '/') ? request.continue() : (external.push(request.url()), request.abort()));
  await page.goto(origin, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('overscroll-behavior-x') === 'none');
  const initialHistoryLength = await page.evaluate(() => history.length);
  async function touch(selector, x, count = 1, cancelable = true) {
    return page.evaluate(({ selector, x, count, cancelable }) => {
      const target = document.querySelector(selector);
      const touches = Array.from({ length: count }, (_, identifier) => new Touch({ identifier, target, clientX: x + identifier * 5, clientY: 100 }));
      const event = new TouchEvent('touchstart', { bubbles: true, cancelable, touches, targetTouches: touches, changedTouches: touches });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    }, { selector, x, count, cancelable });
  }
  check('left-edge-noninteractive-start-cancelled', await touch('#content', 2));
  check('right-edge-noninteractive-start-cancelled', await touch('#content', 412));
  check('middle-touch-keeps-default-behavior', !await touch('#content', 200));
  check('outside-display-route-not-cancelled', !await touch('#outside', 2));
  check('multitouch-not-cancelled', !await touch('#content', 2, 2));
  check('noncancelable-touch-not-modified', !await touch('#content', 2, 1, false));
  for (const selector of ['#control', '#link', '#select', '#input', '#editable']) check('interactive-edge-touch-preserved-' + selector.slice(1), !await touch(selector, 2));
  await page.tap('#control');
  check('real-control-tap-still-works', await page.evaluate(() => window.__clicked === 1));
  const touchAction = await page.$eval('#items', node => getComputedStyle(node).touchAction);
  check('vertical-pan-and-pinch-remain-enabled', touchAction.includes('pan-y') && touchAction.includes('pinch-zoom'));
  const session = await page.createCDPSession();
  const box = await page.$eval('#items', node => { const rect = node.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + 180 }; });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...box, id: 1 }] });
  for (let i = 1; i <= 6; i++) { await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x, y: box.y - i * 20, id: 1 }] }); await new Promise(ok => setTimeout(ok, 20)); }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => document.querySelector('#items').scrollTop > 20);
  check('actual-browser-vertical-item-scroll-preserved', await page.$eval('#items', node => node.scrollTop > 20));
  await session.detach();
  const denied = new Promise(resolve => page.once('dialog', async dialog => { assert.equal(dialog.message(), '客席表示を終了しますか？'); await dialog.dismiss(); resolve(); }));
  await page.tap('#exit'); await denied;
  check('cancel-explicit-exit-keeps-display', new URL(page.url()).pathname === '/');
  await page.evaluate(() => window.__second(true));
  await page.waitForSelector('#second');
  await page.evaluate(() => { window.__retained=document.querySelector('#display'); window.__mount(false); });
  await page.waitForFunction(() => !document.querySelector('#display'));
  check('overlapping-mount-retains-document-guard', await page.evaluate(() => document.documentElement.style.getPropertyValue('overscroll-behavior-x') === 'none'));
  check('unmounted-root-class-and-touch-listener-cleaned', await page.evaluate(() => {
    const root = window.__retained, target = root.querySelector('#content'), touch = new Touch({ identifier: 1, target, clientX: 1, clientY: 100 });
    const event = new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch] }); target.dispatchEvent(event);
    return !event.defaultPrevented && root.className === '';
  }));
  await page.evaluate(() => window.__second(false));
  await page.waitForFunction(() => !document.querySelector('#second'));
  check('last-unmount-restores-exact-document-styles', await page.evaluate(() => document.documentElement.style.getPropertyValue('overscroll-behavior-x') === 'contain' && document.documentElement.style.getPropertyPriority('overscroll-behavior-x') === '' && document.body.style.getPropertyValue('overscroll-behavior-x') === 'auto' && document.body.style.getPropertyPriority('overscroll-behavior-x') === 'important'));
  check('no-history-or-storage-trap', await page.evaluate(expectedLength => window.__historyChanges === 0 && history.length === expectedLength && localStorage.length === 0 && sessionStorage.length === 0, initialHistoryLength));
  await page.evaluate(() => window.__mount(true)); await page.waitForSelector('#exit');
  page.once('dialog', dialog => dialog.accept());
  await Promise.all([page.waitForNavigation(), page.tap('#exit')]);
  check('confirmed-explicit-exit-leaves-display', new URL(page.url()).pathname === '/store/exit-fixture' && await page.$('#exited'));
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(await hashes(), inputHashes);
  await writeFile(join(output, 'report.json'), JSON.stringify({ passed: checks.length, checks, sourceHashes: inputHashes, noSourceDrift: true, actualReactHook: true, verticalScroll: 'Chromium CDP touch gesture', edgeChecks: 'synthetic cancelable DOM TouchEvents', safariSystemGestureVerified: false, noProductionConnections: true, external, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, report: join(output, 'report.json') }));
} finally { await browser.close(); server.closeAllConnections(); await new Promise(ok => server.close(ok)); stop(); }
