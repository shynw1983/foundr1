// Isolated browser fixture: actual Store components/styles, in-memory APIs only.
// Run with node --experimental-strip-types scripts/tests/store-theme-ui-fixture.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { build } from "esbuild";
import { getDefaultStoreTheme, normalizeStoreThemeTarget } from "../../lib/store-theme.ts";
import { defaultStoreModuleSettings } from "../../lib/module-setting-defaults.ts";

const storeA = "00000000-0000-4000-8000-000000000001";
const storeB = "00000000-0000-4000-8000-000000000002";
const stores = [{ id: storeA, name: "桜並木店（検証用）" }, { id: storeB, name: "清川店（検証用）" }];
const themes = new Map([[`${storeA}:operations`, { primaryColor: "#245d49", mode: "custom", revision: null }], [`${storeB}:operations`, { primaryColor: "#235a9f", mode: "custom", revision: null }]]);
let revision = 0;
const entry = `
import React, {useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {OsTranslationProvider,OsLanguagePicker} from './app/os/components/OsTranslationProvider';
import {StoreThemeProvider,useStoreTheme} from './app/store/components/StoreThemeProvider';
import {setStoredStoreSelection} from './app/store/components/store-selection';
import Appearance from './app/store/settings/appearance/page';
import Home from './app/store/page';
import Pos from './app/store/pos/page';
import Menu from './app/store/menu/page';
import Kitchen from './app/store/display/kitchen/page';
import Pickup from './app/store/display/pickup/page';
import Customer from './app/store/pos/customer-display/page';
import Courier from './app/store/display/courier/page';
import Seats from './app/store/seats/page';
function TestBar(){const {context,setPreviewColor}=useStoreTheme();return <aside data-fixture-controls style={{position:'fixed',bottom:0,left:0,right:0,zIndex:9999,display:'flex',gap:9,flexWrap:'wrap',padding:'5px 10px',fontSize:11,background:'#fff',borderTop:'1px solid #ccc'}}>
<strong>LOCAL UI TEST</strong><span>{context?.storeName}</span>
{[['/store/settings/appearance','設定'],['/store','ホーム'],['/store/pos','POS'],['/store/menu','販売'],['/store/display/kitchen','厨房'],['/store/display/pickup','取餐'],['/store/pos/customer-display','客显'],['/store/display/courier','配送'],['/store/seats','客席'],['/os','OS退出检查']].map(([href,label])=><a href={href} key={href}>{label}</a>)}
<label>検証色 <input aria-label="検証用テーマ色" type="color" defaultValue="#245d49" onChange={e=>setPreviewColor(e.target.value)}/></label>
<a href="/store/settings/appearance?fixtureRole=staff">staff</a><a href="/store/settings/appearance?fixtureRole=store_terminal">terminal</a><a href="/store/settings/appearance?fixtureRole=owner">owner</a><a href="/fixture/conflict">次回保存409</a><a href="/fixture/deny">次回保存403</a>
</aside>}
function App(){const [path,setPath]=useState(location.pathname);useEffect(()=>{const onPop=()=>setPath(location.pathname);window.addEventListener('popstate',onPop);const click=e=>{const a=e.target.closest('a');if(!a||a.origin!==location.origin||a.pathname.startsWith('/fixture/')||a.search||a.href.includes('/logout'))return;e.preventDefault();history.pushState({},'',a.href);setPath(a.pathname);window.dispatchEvent(new PopStateEvent('popstate'));};document.addEventListener('click',click);return()=>{window.removeEventListener('popstate',onPop);document.removeEventListener('click',click)}},[]);
const pages={'/store':Home,'/store/settings/appearance':Appearance,'/store/pos':Pos,'/store/menu':Menu,'/store/display/kitchen':Kitchen,'/store/display/pickup':Pickup,'/store/pos/customer-display':Customer,'/store/display/courier':Courier,'/store/seats':Seats};const Page=pages[path]||Home;
return <OsTranslationProvider>{path==='/os'?<main className="os-home-shell"><h1>OS theme isolation</h1><button className="primary-button">OS primary</button><a href="/store/settings/appearance">Storeへ戻る</a></main>:<StoreThemeProvider employeeId={window.__fixtureEmployeeId}><Page key={path}/><TestBar/></StoreThemeProvider>}</OsTranslationProvider>}
createRoot(document.getElementById('root')).render(<App/>);`;
const navigationStub = `import {useSyncExternalStore} from 'react';
const subscribe=callback=>{window.addEventListener('popstate',callback);return()=>window.removeEventListener('popstate',callback)};
export const usePathname=()=>useSyncExternalStore(subscribe,()=>location.pathname,()=>'/store/settings/appearance');
export const useRouter=()=>({push:url=>{history.pushState({},'',url);window.dispatchEvent(new PopStateEvent('popstate'))},replace:url=>{history.replaceState({},'',url);window.dispatchEvent(new PopStateEvent('popstate'))}});
export const useSearchParams=()=>new URLSearchParams(location.search);`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false,
  outfile: "/tmp/store-theme-fixture.js", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "fixture-navigation", setup(builder) {
    builder.onResolve({ filter: /^next\/(navigation|image|link)$/ }, args => ({ path: args.path.split("/")[1], namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
      contents: args.path === "navigation" ? navigationStub : args.path === "image"
        ? `import React from 'react';export default function Image({fill,priority,quality,unoptimized,placeholder,blurDataURL,...props}){return <img {...props}/>}`
        : `import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`,
      loader: "jsx", resolveDir: process.cwd()
    }));
  }}]
});
const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const css = (await Promise.all(["app/globals.css", "app/store/store-responsive.css", "app/store/store-theme.css"].map(file => readFile(file, "utf8")))).join("\n")
  + "\n" + bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
const id = index => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const brand = { id: id(10), name: "まぁ麻" };
const items = [{ id: id(11), brandId: brand.id, brandName: brand.name, name: "麻辣湯", displayNames: {}, itemKind: "product", category: "麻辣湯", imageUrl: "", basePrice: 980, priceOverride: null, posPricingMode: "fixed", posWeightUnit: "g", posWeightUnitPrice: null, isAvailable: true, variableSchema: {} }];
let forceConflict = false, forceDenied = false;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const role = url.searchParams.get("fixtureRole") ?? /fixtureRole=([^;]+)/.exec(request.headers.cookie ?? "")?.[1] ?? "owner";
  const storeId = url.searchParams.get("storeId") || storeA;
  const access = { role, stores, allStores: true, canUseAllStoreView: role === "owner", canViewSalesStats: true, canCancelOrders: true };
  const json = (data, status = 200) => { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(data)); };
  const themeContext = (selectedStoreId, target = "operations") => {
    const saved = themes.get(`${selectedStoreId}:${target}`) ?? { ...getDefaultStoreTheme(target), revision: null };
    const brand = target === "operations" ? null : { name: "まぁ麻", logoUrl: "/brands/maamaa-slogan-landscape.png", primaryColor: "#c30d23" };
    return { storeId: selectedStoreId, storeName: stores.find(store => store.id === selectedStoreId)?.name ?? "", stores, target, brand,
      canManageTheme: role === "owner", theme: { primaryColor: saved.mode === "brand" ? brand.primaryColor : saved.primaryColor, mode: saved.mode, paletteVersion: 1 }, revision: saved.revision, updatedAt: null };
  };
  try {
    if (url.pathname === "/fixture/conflict" || url.pathname === "/fixture/deny") {
      if (url.pathname.endsWith("conflict")) forceConflict = true;
      else forceDenied = true;
      response.writeHead(302, { Location: "/store/settings/appearance" }); response.end(); return;
    }
    if (url.pathname === "/api/store/theme") {
      if (request.method === "POST") {
        let data = ""; for await (const chunk of request) data += chunk;
        const body = JSON.parse(data);
        const target = normalizeStoreThemeTarget(body.target);
        if (!target) { json({error:"invalid target"},400); return; }
        const key = `${body.storeId}:${target}`;
        const current = themes.get(key) ?? { ...getDefaultStoreTheme(target), revision: null };
        if (role !== "owner" || forceDenied) { forceDenied = false; json({ error: "テーマを変更する権限がありません。" }, 403); return; }
        if (forceConflict || body.expectedRevision !== current.revision) {
          forceConflict = false;
          themes.set(key, { primaryColor: "#63509b", mode: "custom", revision: `fixture-${++revision}` });
          json({ error: "設定が変更されています。最新の内容を読み込んでから保存してください。" }, 409); return;
        }
        themes.set(key, { primaryColor: body.primaryColor, mode: body.mode, revision: `fixture-${++revision}` });
        json(themeContext(body.storeId, target)); return;
      }
      if (!stores.some(store => store.id === storeId)) { json({ error: "権限がありません。" }, 403); return; }
      const target = normalizeStoreThemeTarget(url.searchParams.has("target") ? url.searchParams.get("target") : undefined);
      if (!target) { json({error:"invalid target"},400); return; }
      json(themeContext(storeId, target)); return;
    }
    if (url.pathname === "/api/auth/me") { json({ employee: { id: id(role === "owner" ? 100 : 101), name: "検証担当", loginId: "local-fixture", role, permissions: role === "owner" ? ["store.theme.manage", "store.inventory"] : ["store.inventory"] } }); return; }
    if (url.pathname === "/api/settings") { json({ settings: { ...defaultStoreModuleSettings, header: { ...defaultStoreModuleSettings.header, showNotifications: false } } }); return; }
    if (url.pathname === "/api/store/context" || url.pathname === "/api/os/store-context") { json({ access, stores, selectedStoreId: storeId, canSwitchStore: false }); return; }
    if (url.pathname === "/api/store/pos/reconciliation") { json({ businessDate: "2026-10-18", businessState: { isOpen: true }, activeSession: { id: id(55), status: "open", openingCashAmount: 10000 } }); return; }
    if (url.pathname === "/api/store/pos") { json({ access, selectedStoreId: storeId, stores, brands: [brand], categories: [{ id: id(12), brandId: brand.id, name: "麻辣湯", sortOrder: 0 }], items, optionGroups: [], posSettings: {}, todaySummary: { orderCount: 3, total: 2940, average: 980, latestOrders: [] } }); return; }
    if (url.pathname === "/api/store/menu-settings") { json({ access, selectedStoreId: storeId, brands: [brand], categories: [], items, options: [], settings: { availability: { targets: { items: true, options: true }, optionDisplayMode: "separate_category", allowStorePriceEdit: false, allowChannelToggle: false } } }); return; }
    if (url.pathname === "/api/store/display/pickup") { json({ access, selectedStoreId: storeId, preparing: [{ pickupCode: "A101", status: "preparing", orderType: "pickup", createdTime: new Date().toISOString() }], ready: [{ pickupCode: "A102", status: "ready", orderType: "pickup", createdTime: new Date().toISOString() }], lastUpdatedAt: new Date().toISOString() }); return; }
    if (url.pathname === "/api/store/display/kitchen") { json({ access, selectedStoreId: storeId, serverNow: new Date().toISOString(), areas: [], tasks: [{ id: id(31), orderId: id(30), brandId: brand.id, status: "preparing", productionArea: "kitchen", productionAreaLabel: "厨房", printStatus: "pending", itemSummary: "麻辣湯", itemCount: 1, itemGroups: [], isHistorical: false, pickupCode: "A101", estimatedPrepMinutes: 8, estimatedReadyAt: new Date(Date.now() + 5 * 60000).toISOString(), createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), amount: 980, currency: "JPY", orderSource: "web", orderType: "pickup", note: "", noteOriginal: "", customerName: "", tableLabel: "", kitchenLanguage: "ja", showAmounts: false }] }); return; }
    if (url.pathname === "/api/store/pos/customer-display") { json({ access, selectedStoreId: storeId, state: { revision: 1, status: "cart", storeName: stores[0].name, subtotal: 980, items: [{ name: "麻辣湯", optionLabel: "中辛", quantity: 1, unitPrice: 980, amount: 980 }] } }); return; }
    if (url.pathname === "/api/store/seats") { json({ store: stores[0], stores, targets: [{ label: "A", status: "cooking", partySize: 2, startedAt: new Date().toISOString(), activityStatus: "cooking", overdue: false, groupLabel: "" }], sharedTables: [] }); return; }
    if (url.pathname.startsWith("/api/")) { json({ enabled: false, stores: [], runs: [], orders: [], pendingCount: 0 }); return; }
    if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
      response.writeHead(200, { "Content-Type": url.pathname.endsWith(".js") ? "text/javascript" : "text/css" }); response.end(url.pathname.endsWith(".js") ? js : css); return;
    }
    if (url.pathname.startsWith("/brands/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/locales/") || url.pathname.startsWith("/assets/")) {
      const path = resolve("public", `.${url.pathname}`);
      if (!path.startsWith(`${resolve("public")}/`)) { response.writeHead(403); response.end(); return; }
      const contents = await readFile(path);
      response.writeHead(200, { "Content-Type": ({ ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json" })[extname(path)] ?? "application/octet-stream" }); response.end(contents); return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": `fixtureRole=${role}; Path=/; SameSite=Lax` });
    response.end(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#202a36"><link rel="stylesheet" href="/fixture.css"><title>Store theme local verification</title></head><body><div id="root"></div><script>window.__fixtureEmployeeId=${JSON.stringify(id(role === "owner" ? 100 : 101))};</script><script src="/fixture.js"></script></body></html>`);
  } catch (error) { if (url.pathname.startsWith("/api/")) json({ error: String(error) }, 500); else { response.writeHead(404); response.end("not found"); } }
});
server.listen(Number(process.env.STORE_THEME_UI_PORT || 0), "127.0.0.1", () => console.log(`Store theme local fixture: http://127.0.0.1:${server.address().port}/store/settings/appearance`));
