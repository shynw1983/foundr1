import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate as waitForTurn } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const storeA = "11111111-1111-4111-8111-111111111111";
const storeB = "22222222-2222-4222-8222-222222222222";
const selectionKey = "foundr1:store:selectedStoreId";
const cacheKey = (employeeId: string, storeId: string) => `foundr1:store:theme:v2:${employeeId}:${storeId}:operations`;
const source = readFileSync(new URL("./StoreThemeProvider.tsx", import.meta.url), "utf8");
const themeSource = readFileSync(new URL("../../../lib/store-theme.ts", import.meta.url), "utf8");
const themeExports: Record<string, any> = {};
runInNewContext(ts.transpileModule(themeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: themeExports });

function themeData(storeId = storeA, color = "#245d49", revision = "revision-a", canManageTheme = true, target = "operations", mode = "custom") {
  return { target, brand: null, storeId, storeName: storeId === storeA ? "A" : "B", stores: [{ id: storeA, name: "A" }, { id: storeB, name: "B" }],
    canManageTheme, theme: { primaryColor: color, mode, paletteVersion: 1 }, revision, updatedAt: "2026-10-18T01:00:00.000Z" };
}

type PendingRequest = { url: string; options: RequestInit; respond: (body: unknown, status?: number) => void };

/** A small commit/effect harness runs the real provider, including its real palette. */
function fixture(options: { target?: string; applyToDocument?: boolean } = {}) {
  const slots: any[] = [], exports: Record<string, any> = {};
  const requests: PendingRequest[] = [];
  const storage = new Map<string, string>([[selectionKey, storeA]]);
  const listeners = new Map<string, Set<(event: any) => void>>();
  const documentListeners = new Map<string, Set<(event: any) => void>>();
  const timers = new Map<number, { callback: () => void; at: number }>(); let time = 0, nextTimer = 0;
  const styles = new Map<string, [string, string]>([["--store-primary", ["#123456", "important"]], ["--unrelated", ["keep", ""]]]);
  const attributes = new Map<string, string>();
  const meta = { content: "#202a36" };
  let pathname = "/store/settings/appearance", employeeId = "employee-a";
  let index = 0, dirty = false;
  let layout: Array<() => void> = [], passive: Array<() => void> = [];
  const addListener = (map: typeof listeners, name: string, callback: (event: any) => void) => { if (!map.has(name)) map.set(name, new Set()); map.get(name)!.add(callback); };
  const dispatch = (name: string, event: unknown = {}) => listeners.get(name)?.forEach(callback => callback(event));
  const window = {
    location: { search: "" },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    dispatchEvent: (event: any) => { dispatch(event.type, event); return true; },
    addEventListener: (name: string, callback: (event: any) => void) => addListener(listeners, name, callback),
    removeEventListener: (name: string, callback: (event: any) => void) => listeners.get(name)?.delete(callback),
    setInterval: () => 1, clearInterval: () => {}, setTimeout: (callback: () => void, delay: number) => { const id = ++nextTimer; timers.set(id, { callback, at: time + delay }); return id; }, clearTimeout: (id: number) => timers.delete(id)
  };
  const document = {
    body: {
      style: { getPropertyValue: (key: string) => styles.get(key)?.[0] ?? "", getPropertyPriority: (key: string) => styles.get(key)?.[1] ?? "",
        setProperty: (key: string, value: string, priority = "") => styles.set(key, [value, priority]), removeProperty: (key: string) => styles.delete(key) },
      getAttribute: (key: string) => attributes.get(key) ?? null,
      setAttribute: (key: string, value: string) => attributes.set(key, value), removeAttribute: (key: string) => attributes.delete(key)
    },
    visibilityState: "visible", querySelector: () => meta,
    addEventListener: (name: string, callback: (event: any) => void) => addListener(documentListeners, name, callback),
    removeEventListener: (name: string, callback: (event: any) => void) => documentListeners.get(name)?.delete(callback)
  };
  function memo<T>(run: () => T, deps: unknown[]) {
    const slot = index++, previous = slots[slot];
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) slots[slot] = { deps, value: run() };
    return slots[slot].value as T;
  }
  function effect(run: () => void | (() => void), deps: unknown[], queue: Array<() => void>) {
    const slot = index++, previous = slots[slot];
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      queue.push(() => { previous?.cleanup?.(); slots[slot] = { deps, cleanup: run() }; });
    }
  }
  const react = {
    createContext: () => ({ Provider: "ThemeContext.Provider" }), useContext: () => { throw new Error("Unexpected hook outside provider"); },
    useState: (initial: any) => {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], (value: any) => {
        const next = typeof value === "function" ? value(slots[slot]) : value;
        if (!Object.is(next, slots[slot])) { slots[slot] = next; dirty = true; }
      }];
    },
    useRef: (initial: any) => { const slot = index++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useEffect: (run: () => void | (() => void), deps: unknown[]) => effect(run, deps, passive),
    useLayoutEffect: (run: () => void | (() => void), deps: unknown[]) => effect(run, deps, layout),
    useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
    useMemo: memo
  };
  const pollingExports: Record<string, any> = {};
  const pollingSource = readFileSync(new URL("../../../lib/store-polling-client.ts", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(pollingSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: pollingExports, window, document, AbortController, DOMException, Date: class extends Date { static now() { return 1700000000000 + time; } }, Math: Object.assign(Object.create(Math), { random: () => 0 }), require: () => ({ getStoreCashBusinessDayState: () => ({ status: "business_open" }) }) });
  const readRequestExports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("../../../components/useReadRequest.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: readRequestExports, require: () => react, Date });
  const modules: Record<string, any> = {
    "../../../components/useReadRequest": readRequestExports,
    "../../../lib/store-polling-client": pollingExports,
    react, "react/jsx-runtime": { jsx: (type: any, props: any) => ({ type, props }) },
    "next/navigation": { usePathname: () => pathname }, "../../../lib/store-theme": themeExports,
    "./store-selection": { storeSelectionEventName: "store-selection", getStoredStoreSelection: () => storage.get(selectionKey) ?? "",
      setStoredStoreSelection: (id: string) => { storage.set(selectionKey, id); dispatch("store-selection"); } }
  };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, window, document, URLSearchParams, AbortController, CustomEvent: class { type: string; detail: any; constructor(type: string, options: any) { this.type = type; this.detail = options.detail; } }, fetch: (url: string, options: RequestInit) => new Promise(resolve => requests.push({ url, options,
      respond: (body, status = 200) => resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) })),
      require: (name: string) => { if (!(name in modules)) throw new Error(`Unmocked theme dependency: ${name}`); return modules[name]; } });
  function render() {
    for (let pass = 0; pass < 12; pass++) {
      index = 0; dirty = false; layout = []; passive = [];
      const tree = exports.StoreThemeProvider({ children: "store", employeeId, ...options });
      layout.forEach(run => run()); passive.forEach(run => run());
      if (!dirty) return tree.props.value;
    }
    throw new Error("Provider effects did not settle");
  }
  return { render, requests, storage, styles, attributes, meta, dispatch,
    advance: async (ms: number) => {
      const end = time + ms;
      for (let safety = 0; safety < 100; safety++) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = next[1].at; timers.delete(next[0]); next[1].callback(); await waitForTurn(); render();
      }
      time = end; await waitForTurn(); return render();
    },
    navigate: (path: string) => { pathname = path; return render(); },
    select: (storeId: string) => { storage.set(selectionKey, storeId); dispatch("store-selection"); },
    account: (id: string) => { employeeId = id; return render(); },
    query: (search: string) => { window.location.search = search; dispatch("popstate"); return render(); },
    dispose: () => slots.forEach(slot => slot?.cleanup?.()) };
}

test("a late response from the previous store cannot replace the new store or its cache", async () => {
  const f = fixture(); f.render(); await waitForTurn();
  const old = f.requests[0];
  f.select(storeB); f.render(); await waitForTurn();
  assert.equal(f.requests.length, 2);
  f.requests[1].respond(themeData(storeB, "#235a9f", "revision-b"));
  await waitForTurn();
  assert.equal(f.render().context.storeId, storeB);
  old.respond(themeData(storeA, "#9e3f66", "revision-old"));
  await waitForTurn();
  assert.equal(f.render().context.storeId, storeB);
  assert.equal(f.styles.get("--store-primary")?.[0], "#235a9f");
  assert.equal(f.storage.has(cacheKey("employee-a", storeA)), false);
});

test("preview stays local to the editor and clears when leaving appearance settings", async () => {
  const f = fixture(); f.render(); await waitForTurn();
  f.requests[0].respond(themeData()); await waitForTurn();
  const current = f.render(), cache = f.storage.get(cacheKey("employee-a", storeA));
  current.setPreviewColor("#ffffff");
  assert.equal(f.render().previewColor, "#ffffff");
  assert.equal(f.styles.get("--store-primary")?.[0], "#245d49");
  assert.equal(f.storage.get(cacheKey("employee-a", storeA)), cache);
  assert.equal(f.navigate("/store/menu").previewColor, null);
  assert.equal(f.styles.get("--store-primary")?.[0], "#245d49");
});

test("unprivileged context cannot apply a preview", async () => {
  const f = fixture(); f.render(); await waitForTurn();
  f.requests[0].respond(themeData(storeA, "#235a9f", "revision-a", false)); await waitForTurn();
  f.render().setPreviewColor("#ffffff");
  assert.equal(f.render().previewColor, null);
  assert.equal(f.styles.get("--store-primary")?.[0], "#235a9f");
});

test("a successful save survives an older in-flight GET and keeps the saved cache", async () => {
  const f = fixture(); f.render(); await waitForTurn();
  f.requests[0].respond(themeData()); await waitForTurn();
  let current = f.render();
  const refresh = current.refresh(); await waitForTurn(); const stale = f.requests[1];
  const save = current.saveTheme("#63509b", "revision-a");
  f.requests[2].respond(themeData(storeA, "#63509b", "revision-saved"));
  await save; current = f.render();
  assert.equal(current.context.revision, "revision-saved");
  stale.respond(themeData()); await refresh; await waitForTurn();
  assert.equal(f.render().context.theme.primaryColor, "#63509b");
  assert.equal(JSON.parse(f.storage.get(cacheKey("employee-a", storeA))!).revision, "revision-saved");
});

test("an old-account save response cannot grant the new account management on the same store", async () => {
  const f = fixture(); f.render(); await waitForTurn();
  f.requests[0].respond(themeData()); await waitForTurn();
  const save = f.render().saveTheme("#63509b", "revision-a"), oldSave = f.requests[1];
  const rejection = assert.rejects(save, (failure: any) => failure.status === 401);
  f.account("employee-b"); await waitForTurn();
  const nextAccountGet = f.requests.findLast(request => request.options.method !== "POST")!;
  nextAccountGet.respond(themeData(storeA, "#235a9f", "revision-b", false)); await waitForTurn();
  assert.equal(f.render().context.canManageTheme, false);
  oldSave.respond(themeData(storeA, "#63509b", "revision-saved", true));
  await rejection; await waitForTurn();
  const current = f.render();
  assert.equal(current.context.canManageTheme, false);
  assert.equal(current.context.theme.primaryColor, "#235a9f");
  assert.equal(JSON.parse(f.storage.get(cacheKey("employee-b", storeA))!).primaryColor, "#235a9f");
  assert.equal(JSON.parse(f.storage.get(cacheKey("employee-a", storeA))!).primaryColor, "#245d49");
});

test("unmount restores pre-existing body tokens, unrelated styles, and browser theme color", async () => {
  const f = fixture(); f.render(); await waitForTurn();
  f.requests[0].respond(themeData(storeA, "#63509b")); await waitForTurn(); f.render();
  assert.equal(f.meta.content, "#63509b");
  assert.equal(f.attributes.has("data-store-theme"), true);
  f.dispose();
  assert.equal(f.attributes.has("data-store-theme"), false);
  assert.deepEqual(f.styles.get("--store-primary"), ["#123456", "important"]);
  assert.deepEqual(f.styles.get("--unrelated"), ["keep", ""]);
  assert.equal(f.styles.has("--store-primary-soft"), false);
  assert.equal(f.meta.content, "#202a36");
});


test("customer routes use independent defaults, records and cache keys while kitchen stays operational", async () => {
  const f = fixture(); f.render(); await waitForTurn();
  f.requests[0].respond(themeData(storeA, "#3478d4")); await waitForTurn(); f.render();
  f.navigate("/store/display/pickup"); await waitForTurn();
  assert.equal(f.styles.get("--store-primary")?.[0], "#c30d23");
  assert.match(f.requests.at(-1)!.url, /target=pickup/);
  f.requests.at(-1)!.respond(themeData(storeA, "#c30d23", "pickup-rev", true, "pickup", "brand"));
  await waitForTurn(); assert.equal(f.render().context.target, "pickup");
  assert.equal(JSON.parse(f.storage.get(cacheKey("employee-a", storeA))!).primaryColor, "#3478d4");
  assert.equal(JSON.parse(f.storage.get(`foundr1:store:theme:v2:employee-a:${storeA}:pickup`)!).primaryColor, "#c30d23");
  f.navigate("/store/pos/customer-display"); await waitForTurn();
  assert.match(f.requests.at(-1)!.url, /target=customer/);
  assert.equal(f.styles.get("--store-primary")?.[0], "#262827");
  f.navigate("/store/display/courier"); await waitForTurn(); assert.match(f.requests.at(-1)!.url, /target=courier/);
  f.navigate("/store/display/kitchen"); await waitForTurn(); assert.match(f.requests.at(-1)!.url, /target=operations/);
  assert.equal(f.styles.get("--store-primary")?.[0], "#3478d4");
});

test("editor resources cannot alter document tokens even after saving a customer color", async () => {
  const f = fixture({ target: "pickup", applyToDocument: false }); f.render(); await waitForTurn();
  f.requests[0].respond(themeData(storeA, "#c30d23", "pickup-rev", true, "pickup", "brand")); await waitForTurn();
  const state = f.render(); state.setPreviewColor("#8264d9"); f.render();
  assert.deepEqual(f.styles.get("--store-primary"), ["#123456", "important"]);
  assert.equal(f.meta.content, "#202a36"); assert.equal(f.attributes.has("data-store-theme"), false);
  const save = state.saveTheme("#8264d9", "pickup-rev", "custom");
  const request = f.requests.at(-1)!;
  assert.deepEqual(JSON.parse(request.options.body as string), { storeId: storeA, target: "pickup", mode: "custom", primaryColor: "#8264d9", expectedRevision: "pickup-rev" });
  request.respond(themeData(storeA, "#8264d9", "pickup-saved", true, "pickup", "custom")); await save; f.render();
  assert.deepEqual(f.styles.get("--store-primary"), ["#123456", "important"]);
  assert.equal(f.meta.content, "#202a36");
});

test("a route change rejects stale target saves and GET responses even for the same account and store", async () => {
  const f = fixture(); f.render(); await waitForTurn(); f.requests[0].respond(themeData()); await waitForTurn();
  const save = f.render().saveTheme("#8264d9", "revision-a"), oldSave = f.requests.at(-1)!;
  const rejection = assert.rejects(save, (failure: any) => failure.status === 401);
  f.navigate("/store/display/pickup"); await waitForTurn();
  const pickupRead = f.requests.at(-1)!;
  pickupRead.respond(themeData(storeA, "#c30d23", "pickup-rev", true, "pickup", "brand")); await waitForTurn(); f.render();
  oldSave.respond(themeData(storeA, "#8264d9", "revision-saved")); await rejection;
  assert.equal(f.render().context.target, "pickup"); assert.equal(f.styles.get("--store-primary")?.[0], "#c30d23");
  const refresh = f.render().refresh(); await waitForTurn(); const oldRead = f.requests.at(-1)!;
  f.navigate("/store/display/courier");
  oldRead.respond(themeData(storeA, "#ea8054", "pickup-old", true, "pickup", "custom")); await refresh;
  assert.equal(f.render().context, null); assert.equal(f.styles.get("--store-primary")?.[0], "#262827");
});

test("a response for another target cannot seed the active target or cache", async () => {
  const f = fixture({ target: "pickup" }); f.render(); await waitForTurn();
  f.requests[0].respond(themeData(storeA, "#245d49")); await waitForTurn();
  assert.equal(f.render().context, null); assert.match(f.render().error, /テーマ/);
  assert.equal(f.styles.get("--store-primary")?.[0], "#c30d23");
  assert.equal(f.storage.has(`foundr1:store:theme:v2:employee-a:${storeA}:pickup`), false);
});


test("an explicitly empty or invalid store URL never reads another store's theme", async () => {
  const f = fixture();
  f.query("?storeId="); await waitForTurn();
  assert.equal(f.requests.length, 0); assert.equal(f.render().context, null); assert.match(f.render().error, /店舗/);
  f.query("?storeId=invalid"); await waitForTurn();
  assert.equal(f.requests.length, 0); assert.equal(f.render().context, null);
});


test("theme without cross-device push uses one fifteen-minute nonurgent read and no minute polling", async () => {
  const f = fixture(); f.render(); await waitForTurn();
  f.requests[0].respond(themeData()); await waitForTurn(); f.render();
  await f.advance(899999); assert.equal(f.requests.length, 1);
  await f.advance(1); assert.equal(f.requests.length, 2);
  f.requests[1].respond(themeData(storeA, "#63509b", "remote-update")); await waitForTurn();
  assert.equal(f.render().context.theme.primaryColor, "#63509b"); f.dispose();
});

test("theme changes arriving during a read require one trailing read", async () => {
  const f = fixture(); f.render(); await waitForTurn();
  f.requests[0].respond(themeData()); await waitForTurn(); f.render();
  const event = { detail: { storeId: storeA, target: "operations" } };
  f.dispatch("foundr1:store:theme-updated", event); await waitForTurn();
  f.dispatch("foundr1:store:theme-updated", event);
  assert.equal(f.requests.length, 2);
  f.requests[1].respond(themeData()); await waitForTurn(); assert.equal(f.requests.length, 3);
  f.requests[2].respond(themeData(storeA, "#63509b", "changed")); await waitForTurn();
  assert.equal(f.render().context.revision, "changed"); f.dispose();
});

test("theme auth denial clears its cache and stops periodic and manual re-reads", async () => {
  const f = fixture(); f.render(); await waitForTurn();
  f.requests[0].respond(themeData()); await waitForTurn(); f.render();
  const refresh = f.render().refresh(); const rejection = assert.rejects(refresh, (e: any) => e.status === 401);
  await waitForTurn(); f.requests[1].respond({ error: "Unauthorized" }, 401); await rejection; await waitForTurn();
  assert.equal(f.render().context, null); assert.equal(f.storage.has(cacheKey("employee-a", storeA)), false);
  await f.advance(1800000); assert.equal(f.requests.length, 2);
  await assert.rejects(f.render().refresh(), (e: any) => e.status === 401); assert.equal(f.requests.length, 2); f.dispose();
});
