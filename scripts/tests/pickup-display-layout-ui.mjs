// Isolated UI fixture: real PickupBoard and CSS, synthetic orders, no application API.
// node scripts/tests/pickup-display-layout-ui.mjs --source /path/to/source --output /tmp/pickup-layout --mode after
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const source = resolve(option("--source", process.env.PICKUP_LAYOUT_SOURCE || resolve(dirname(fileURLToPath(import.meta.url)), "../..")));
const mode = option("--mode", process.env.PICKUP_LAYOUT_MODE || "after");
assert(["before", "after"].includes(mode), "--mode must be before or after");
const output = resolve(option("--output", process.env.PICKUP_LAYOUT_OUTPUT || `/private/tmp/pickup-density-preview-20261020/${mode}`));
const require = createRequire(`${source}/package.json`);
const { build, stop } = require("esbuild");
const { default: puppeteer } = await import(pathToFileURL(require.resolve("puppeteer-core")).href);
await mkdir(output, { recursive: true });

const sourceFiles = ["app/store/display/pickup/PickupBoard.tsx", "app/store/display/pickup/pickup-display.module.css", "app/globals.css"];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash("sha256").update(await readFile(`${source}/${path}`)).digest("hex")])));
const initialHashes = await sourceHashes();
const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{PickupBoard}from'./app/store/display/pickup/PickupBoard';import styles from './app/store/display/pickup/pickup-display.module.css';
const RealResizeObserver=window.ResizeObserver;window.__resizeEvents=[];window.ResizeObserver=class extends RealResizeObserver{constructor(callback){super((entries,observer)=>{window.__resizeEvents.push(entries.map(entry=>({width:entry.target.clientWidth,height:entry.target.clientHeight})));callback(entries,observer)})}};
const intervals=new Map();let timerId=0;window.setInterval=(fn,ms)=>{const id=++timerId;intervals.set(id,{fn,ms});return id};window.clearInterval=id=>intervals.delete(id);window.__advance=ms=>{for(const timer of [...intervals.values()]){if(timer.ms===8000&&ms>=8000)timer.fn()}};window.__activeIntervals=()=>[...intervals.values()].map(t=>t.ms);
const orders=(count,start,ready)=>Array.from({length:count},(_,i)=>({pickupCode:String(start+i).padStart(3,'0'),createdTime:'2026-10-20T00:00:'+String(i).padStart(2,'0')+'Z',status:ready?'ready':'preparing',orderType:'eat_in'}));
function Fixture(){const[counts,setCounts]=useState([2,8]);const[menuOpen,setMenuOpen]=useState(false);const[longCodes,setLongCodes]=useState(false);window.__setCounts=(r,p)=>setCounts([r,p]);window.__setMenu=setMenuOpen;window.__setLongCodes=setLongCodes;const mapped=(items)=>longCodes?items.map((item,index)=>({...item,pickupCode:index%2?'OABCDEF12-3':'P-1204'})):items;return <main className={styles.shell}><button className={'store-display-menu-button '+styles.menuButton} aria-label="メニュー" type="button" onClick={()=>setMenuOpen(v=>!v)}/><header className={styles.masthead}><div className={styles.title}><span className={styles.mark} aria-hidden="true"/>お受け取り<span className={styles.subtitle}>ORDER PICKUP</span></div><span className={styles.storeName}>桜並木店</span></header><PickupBoard ready={mapped(orders(counts[0],37,true))} preparing={mapped(orders(counts[1],37+counts[0],false))} menuOpen={menuOpen}/></main>};createRoot(document.getElementById('root')).render(<Fixture/>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: source, loader: "tsx" }, bundle: true, write: false, outdir: "/virtual", charset: "utf8", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const css = (await readFile(`${source}/app/globals.css`, "utf8")) + "\n" + bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const server = createServer((req, res) => {
  if (!["/", "/fixture.js", "/favicon.ico"].includes(req.url)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": req.url === "/fixture.js" ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8" });
  res.end(req.url === "/fixture.js" ? js : req.url === "/favicon.ico" ? "" : html);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [], externalRequests = [], failures = [], results = [];
const check = (condition, message, detail) => { if (!condition) failures.push({ message, detail }); };
const measure = page => page.evaluate(() => {
  const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
  const shell = document.querySelector("main"), board = shell.querySelector(":scope > section");
  return { viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, shell: rect(shell), board: rect(board), documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight, observerEvents: window.__resizeEvents.length, intervals: window.__activeIntervals(), columns: [...board.children].map((column, index) => {
    const grid = column.children[1], footer = column.querySelector("footer");
    return { kind: index ? "preparing" : "ready", rect: rect(column), grid: rect(grid), footer: footer ? { rect: rect(footer), text: footer.textContent, parts: [...footer.children].filter(element => element.getClientRects().length).map(element => ({ text: element.textContent, rect: rect(element) })), controls: [...footer.querySelectorAll("button")].filter(element => element.getClientRects().length).map(element => ({ text: element.textContent, rect: rect(element) })) } : null, header: rect(column.children[0]), headerParts: [...column.children[0].querySelectorAll("h2,p")].filter(element => element.getClientRects().length).map(element => ({ text: element.textContent, rect: rect(element) })), empty: grid.querySelector("strong") ? null : [...grid.children].map(element => ({ text: element.textContent, rect: rect(element) })), cells: [...grid.querySelectorAll("strong")].map(strong => { const range = document.createRange(); range.selectNodeContents(strong); const cell = strong.parentElement; const cellRect = cell.getBoundingClientRect(), style = getComputedStyle(cell); const left = cellRect.x + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft), top = cellRect.y + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop), right = cellRect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight), bottom = cellRect.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom); return { content: { x: left, y: top, right, bottom }, code: strong.textContent, text: rect(range), strong: rect(strong), cell: rect(strong.parentElement), fontSize: getComputedStyle(strong).fontSize, fontFamily: getComputedStyle(strong).fontFamily }; }) };
  }) };
});
const verifyGeometry = (snapshot, label) => {
  const { width, height } = snapshot.viewport;
  const inside = (inner, outer) => inner.x >= outer.x - 1 && inner.right <= outer.right + 1 && inner.y >= outer.y - 1 && inner.bottom <= outer.bottom + 1;
  const overlaps = (left, right) => Math.min(left.right, right.right) - Math.max(left.x, right.x) > 1 && Math.min(left.bottom, right.bottom) - Math.max(left.y, right.y) > 1;
  check(snapshot.documentWidth <= width + 1 && snapshot.documentHeight <= height + 1, `${label}: no document overflow`, snapshot);
  for (const column of snapshot.columns) {
    check(column.rect.x >= -1 && column.rect.right <= width + 1 && column.rect.y >= -1 && column.rect.bottom <= height + 1, `${label}: column within viewport`, column);
    check(column.grid.height >= 0 && column.grid.y >= column.header.bottom - 1, `${label}: grid follows header`, column);
    for (const part of column.headerParts) check(inside(part.rect, column.header), `${label}: header text within header`, part);
    if (column.headerParts.length === 2) check(!overlaps(column.headerParts[0].rect, column.headerParts[1].rect), `${label}: title and instruction do not overlap`, column.headerParts);
    if (column.footer) {
      check(column.grid.bottom <= column.footer.rect.y + 1, `${label}: grid does not overlap footer`, column);
      for (const part of [...column.footer.parts, ...column.footer.controls]) check(inside(part.rect, column.footer.rect), `${label}: footer label/control within footer`, part);
      if (column.footer.parts.length === 2) check(!overlaps(column.footer.parts[0].rect, column.footer.parts[1].rect), `${label}: footer label and paging do not overlap`, column.footer.parts);
      for (let i = 1; i < column.footer.controls.length; i++) check(!overlaps(column.footer.controls[i - 1].rect, column.footer.controls[i].rect), `${label}: paging controls do not overlap`, column.footer.controls);
    }
    for (const empty of column.empty || []) check(inside(empty.rect, column.grid), `${label}: empty state within grid`, empty);
    for (const cell of column.cells) {
      check(cell.text.x >= cell.content.x - 1 && cell.text.right <= cell.content.right + 1 && cell.text.y >= cell.content.y - 1 && cell.text.bottom <= cell.content.bottom + 1, `${label}: number ${cell.code} not clipped`, cell);
      check(cell.cell.x >= column.grid.x - 1 && cell.cell.right <= column.grid.right + 1 && cell.cell.y >= column.grid.y - 1 && cell.cell.bottom <= column.grid.bottom + 1, `${label}: number ${cell.code} within grid`, cell);
    }
  }
};
const viewports = [{ width: 960, height: 540, deviceScaleFactor: 2 }, { width: 640, height: 360, deviceScaleFactor: 3 }, { width: 1280, height: 720, deviceScaleFactor: 1.5 }, { width: 1920, height: 1080, deviceScaleFactor: 1 }, { width: 390, height: 844, deviceScaleFactor: 1 }, { width: 768, height: 1024, deviceScaleFactor: 1 }];
try {
  for (const viewport of viewports) {
    const page = await browser.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewport(viewport);
    await page.setRequestInterception(true);
    page.on("request", request => request.url().startsWith(base + "/") ? request.continue() : (externalRequests.push(request.url()), request.abort()));
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForSelector("main section strong", { timeout: 10000 });
    await pause(200);
    const normal = await measure(page);
    verifyGeometry(normal, `${viewport.width} normal`);
    if (mode === "after" && viewport.width > viewport.height) check(normal.columns[0].cells.length === 2 && (viewport.width < 960 || normal.columns[1].cells.length === 8), `${viewport.width}: ordinary 2 ready and 8 waiting fit together`, normal);
    await page.screenshot({ path: `${output}/${mode}-two-ready-${viewport.width}.png` });
    await page.evaluate(() => window.__setCounts(0, 0)); await pause(100);
    const empty = await measure(page); verifyGeometry(empty, `${viewport.width} empty`);
    check(empty.columns.every(column => column.cells.length === 0), `${viewport.width}: empty queue has no numbers`, empty);
    await page.evaluate(() => window.__setCounts(2, 8)); await pause(150);
    const restored = await measure(page); verifyGeometry(restored, `${viewport.width} restored from empty`);
    check(JSON.stringify(restored.columns.map(column => column.cells.map(cell => cell.code))) === JSON.stringify(normal.columns.map(column => column.cells.map(cell => cell.code))), `${viewport.width}: empty queue restores ordinary capacity`, { normal, restored });
    await page.evaluate(() => window.__setCounts(10, 24)); await pause(150);
    const busy = await measure(page); verifyGeometry(busy, `${viewport.width} busy`);
    await page.screenshot({ path: `${output}/${mode}-busy-${viewport.width}.png` });
    const transitions = [];
    for (const counts of [[1, 1], [2, 2], [20, 20], [1, 1]]) {
      await page.evaluate(([r, p]) => window.__setCounts(r, p), counts); await pause(100);
      const start = await measure(page); await pause(200); const settled = await measure(page);
      verifyGeometry(settled, `${viewport.width} counts ${counts.join("+")}`);
      check(start.observerEvents === settled.observerEvents, `${viewport.width}: ResizeObserver settles after ${counts.join("+")}`, { start: start.observerEvents, settled: settled.observerEvents });
      transitions.push({ counts, snapshot: settled });
    }
    await page.evaluate(() => { window.__setCounts(2, 2); window.__setLongCodes(true); }); await pause(150);
    const longCodes = await measure(page); verifyGeometry(longCodes, `${viewport.width} long codes`);
    await page.screenshot({ path: `${output}/${mode}-long-codes-${viewport.width}.png` });
    results.push({ viewport, normal, empty, restored, busy, transitions, longCodes });
    console.log(JSON.stringify({ mode, viewport, normal: normal.columns.map(c => ({ kind: c.kind, visible: c.cells.length, footer: c.footer?.text })), busy: busy.columns.map(c => ({ kind: c.kind, visible: c.cells.length, footer: c.footer?.text })), resizeStable: transitions.every(t => t.snapshot.observerEvents < 100) }));
    await page.close();
  }

  const resizePage = await browser.newPage();
  resizePage.on("pageerror", error => errors.push(error.message));
  await resizePage.setRequestInterception(true); resizePage.on("request", request => request.url().startsWith(base + "/") ? request.continue() : (externalRequests.push(request.url()), request.abort()));
  await resizePage.setViewport(viewports[1]); await resizePage.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 }); await resizePage.waitForSelector("main section strong");
  const rotation = [];
  for (const viewport of [viewports[1], viewports[4], viewports[0]]) {
    await resizePage.setViewport(viewport); await pause(150); const start = await measure(resizePage); await pause(200); const settled = await measure(resizePage);
    verifyGeometry(settled, `mounted resize ${viewport.width}x${viewport.height}`);
    check(start.observerEvents === settled.observerEvents, `mounted resize ${viewport.width}: ResizeObserver settles`, { start: start.observerEvents, settled: settled.observerEvents });
    rotation.push(settled);
  }
  check(rotation[2].observerEvents > rotation[0].observerEvents, "mounted direction changes trigger ResizeObserver", rotation.map(snapshot => snapshot.observerEvents));
  results.push({ mountedResize: rotation }); await resizePage.close();

  // Make both zones multi-page at 960 CSS pixels; advance only the board's actual 8s intervals.
  const page = await browser.newPage(); await page.setViewport(viewports[0]);
  page.on("pageerror", error => errors.push(error.message));
  await page.setRequestInterception(true); page.on("request", request => request.url().startsWith(base + "/") ? request.continue() : (externalRequests.push(request.url()), request.abort()));
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 }); await page.waitForSelector("main section strong");
  await page.evaluate(() => window.__setCounts(20, 40)); await pause(200);
  const initial = await measure(page);
  const numbers = snapshot => snapshot.columns.map(column => column.cells.map(cell => cell.code));
  const clickColumn = async (index, label) => page.evaluate(({ index, label }) => document.querySelector("main > section").children[index].querySelector(`button[aria-label="${label}"]`).click(), { index, label });
  await clickColumn(0, "次のページ"); await pause(60); const manualNext = await measure(page);
  check(JSON.stringify(numbers(initial)[0]) !== JSON.stringify(numbers(manualNext)[0]) && JSON.stringify(numbers(initial)[1]) === JSON.stringify(numbers(manualNext)[1]), "ready manual next does not advance waiting", { initial, manualNext });
  await clickColumn(0, "前のページ"); await pause(60); const manualBack = await measure(page);
  check(JSON.stringify(numbers(initial)) === JSON.stringify(numbers(manualBack)), "manual previous returns original numbers", { initial, manualBack });
  await page.evaluate(() => window.__advance(7999)); await pause(60); const beforeEightSeconds = await measure(page);
  check(JSON.stringify(numbers(initial)) === JSON.stringify(numbers(beforeEightSeconds)), "no auto-page before 8 seconds", beforeEightSeconds);
  await page.evaluate(() => window.__advance(8000)); await pause(60); const automatic = await measure(page);
  check(numbers(automatic).every((codes, index) => JSON.stringify(codes) !== JSON.stringify(numbers(initial)[index])), "both zones auto-page after 8 seconds", { initial, automatic });
  await page.evaluate(() => window.__setMenu(true)); await pause(60); const menuOpened = await measure(page);
  await page.evaluate(() => window.__advance(8000)); await pause(60); const menuStillOpen = await measure(page);
  check(JSON.stringify(numbers(menuOpened)) === JSON.stringify(numbers(menuStillOpen)) && !menuStillOpen.intervals.includes(8000), "opening menu pauses auto-page", { menuOpened, menuStillOpen });
  await page.evaluate(() => document.querySelector("main > section").children[0].querySelectorAll("footer button")[2].click()); await pause(60);
  await page.evaluate(() => window.__setMenu(false)); await pause(60); const onePaused = await measure(page);
  await page.evaluate(() => window.__advance(8000)); await pause(60); const independent = await measure(page);
  check(JSON.stringify(numbers(onePaused)[0]) === JSON.stringify(numbers(independent)[0]) && JSON.stringify(numbers(onePaused)[1]) !== JSON.stringify(numbers(independent)[1]), "per-zone pause does not stop other zone", { onePaused, independent });
  results.push({ pagination: { initial, manualNext, manualBack, beforeEightSeconds, automatic, menuOpened, menuStillOpen, onePaused, independent } });
  await page.close();
} finally {
  const hashes = await sourceHashes();
  check(JSON.stringify(initialHashes) === JSON.stringify(hashes), "source hashes unchanged during test", { initialHashes, hashes });
  check(errors.length === 0, "no browser errors", errors);
  check(externalRequests.length === 0, "no external requests", externalRequests);
  await writeFile(`${output}/results.json`, JSON.stringify({ source, mode, hashes, fixture: { ordinary: "037,038 ready; 039-046 waiting", busy: "10 ready + 24 waiting", network: "localhost fixture only", font: "unmodified application CSS and platform fallback", noProductionWrites: true }, results, failures, errors, externalRequests }, null, 2));
  await writeFile(`${output}/fixture-entry.tsx`, entry);
  await writeFile(`${output}/executed-test.mjs`, await readFile(fileURLToPath(import.meta.url), "utf8"));
  stop(); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({ mode, failures: failures.length, browserErrors: errors, externalRequests, output }));
if (mode === "after") assert.equal(failures.length, 0, `Layout failures: ${JSON.stringify(failures.map(f => f.message))}`);
