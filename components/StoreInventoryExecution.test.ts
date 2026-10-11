import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const clone = (value: unknown) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise<void>(resolveTick => setTimeout(resolveTick, 0));

type Request = {
  url: string;
  method: string;
  payload: any;
  options: any;
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
};

/** Exercise real hook and event handlers without a browser or live API. */
function harness(file: string, exportName: string, initialProps: any, extraModules: Record<string, any> = {}) {
  const states: any[] = [], refs: any[] = [], callbacks: any[] = [], memos: any[] = [];
  const effectDeps: Array<any[] | undefined> = [], cleanups: any[] = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, callbackIndex = 0, memoIndex = 0;
  let effects: Array<() => void> = [], nonce = 500, now = Date.parse("2026-10-11T00:00:00Z"), timerId = 0;
  const timers = new Map<number, { callback: () => void; delay: number; due: number; repeat: boolean }>();
  const requests: Request[] = [];
  const storage = new Map<string, string>(), sessionStorage = new Map<string, string>();
  const writes: Array<{ surface: string; key: string; value: string }> = [];
  const depsChanged = (old: any[] | undefined, next?: any[]) => !next || !old || old.length !== next.length || next.some((value, i) => !Object.is(value, old[i]));
  const react = {
    useState(initial: any) {
      const i = stateIndex++;
      if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial;
      return [states[i], (next: any) => { states[i] = typeof next === "function" ? next(states[i]) : next; }];
    },
    useRef(initial: any) { const i = refIndex++; return refs[i] ??= { current: initial }; },
    useCallback(callback: any, deps?: any[]) {
      const i = callbackIndex++;
      if (!callbacks[i] || depsChanged(callbacks[i].deps, deps)) callbacks[i] = { value: callback, deps };
      return callbacks[i].value;
    },
    useMemo(callback: any, deps?: any[]) {
      const i = memoIndex++;
      if (!memos[i] || depsChanged(memos[i].deps, deps)) memos[i] = { value: callback(), deps };
      return memos[i].value;
    },
    useEffect(callback: () => any, deps?: any[]) {
      const i = effectIndex++;
      if (depsChanged(effectDeps[i], deps)) effects.push(() => { cleanups[i]?.(); cleanups[i] = callback(); });
      effectDeps[i] = deps;
    }
  };
  const storageApi = (surface: string, target: Map<string, string>) => ({
    getItem: (key: string) => target.get(key) ?? null,
    setItem: (key: string, value: string) => { writes.push({ surface, key, value }); target.set(key, value); },
    removeItem: (key: string) => target.delete(key)
  });
  const schedule = (callback: () => void, delay: number, repeat: boolean) => {
    const nextId = ++timerId;
    timers.set(nextId, { callback, delay, due: now + delay, repeat });
    return nextId;
  };
  const modules: Record<string, any> = {
    react,
    "react/jsx-runtime": { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }), Fragment: "Fragment" },
    "lucide-react": new Proxy({}, { get: (_target, key) => String(key) }),
    ...extraModules
  };
  const loaded = new Map<string, any>();
  class HarnessDate extends Date {
    constructor(value?: any) { super(value === undefined ? now : value); }
    static now() { return now; }
  }
  const globals = {
    AbortController, URL, URLSearchParams, Response, Date: HarnessDate,
    localStorage: storageApi("local", storage), sessionStorage: storageApi("session", sessionStorage),
    crypto: { randomUUID: () => id(nonce++) },
    setTimeout: (callback: () => void, delay = 0) => schedule(callback, delay, false),
    setInterval: (callback: () => void, delay = 0) => schedule(callback, delay, true),
    clearTimeout: (value: number) => timers.delete(value),
    clearInterval: (value: number) => timers.delete(value),
    window: {
      localStorage: storageApi("local", storage), sessionStorage: storageApi("session", sessionStorage),
      setTimeout: (callback: () => void, delay = 0) => schedule(callback, delay, false),
      setInterval: (callback: () => void, delay = 0) => schedule(callback, delay, true),
      clearTimeout: (value: number) => timers.delete(value), clearInterval: (value: number) => timers.delete(value),
      addEventListener() {}, removeEventListener() {}
    },
    document: { hidden: false },
    fetch: (url: string, options: any = {}) => new Promise<Response>((resolveRequest, reject) => requests.push({
      url, method: options.method ?? "GET", payload: options.body ? JSON.parse(options.body) : null,
      options, resolve: resolveRequest, reject
    }))
  };
  function load(path: string): any {
    if (loaded.has(path)) return loaded.get(path);
    const exports: Record<string, any> = {};
    loaded.set(path, exports);
    runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
    }).outputText, {
      ...globals, exports,
      require(name: string) {
        if (name in modules) return modules[name];
        if (name.endsWith("OsTranslationProvider")) return { useOsTranslation: () => ({ t: (text: string, params: Record<string, string | number> = {}) => text.replace(/\{([^}]+)\}/g, (match, key) => params[key] === undefined ? match : String(params[key])), language: "ja" }) };
        if (name.endsWith(".module.css")) return { default: {} };
        if (name.startsWith(".")) {
          const base = resolve(dirname(path), name);
          const dependency = [base, `${base}.ts`, `${base}.tsx`].find(candidate => existsSync(candidate));
          if (dependency) return load(dependency);
        }
        throw new Error(`Unmocked module ${name} from ${path}`);
      }
    });
    return exports;
  }
  const exports = load(resolve(repoRoot, file));
  return {
    requests, storage, sessionStorage, writes, exports,
    render(props = initialProps) {
      stateIndex = refIndex = effectIndex = callbackIndex = memoIndex = 0;
      effects = [];
      const tree = exports[exportName](props);
      effects.forEach(run => run());
      return tree;
    },
    async respond(index: number, body: any, status = 200) {
      assert.ok(requests[index], `Missing request ${index}`);
      requests[index].resolve(Response.json(body, { status }));
      await tick();
    },
    async reject(index: number, error = new Error("offline")) {
      assert.ok(requests[index], `Missing request ${index}`);
      requests[index].reject(error);
      await tick();
    },
    async advance(milliseconds: number) {
      now += milliseconds;
      for (const [key, timer] of [...timers]) {
        if (timer.due > now) continue;
        if (timer.repeat) timer.due = now + timer.delay;
        else timers.delete(key);
        timer.callback();
      }
      await tick();
    },
    unmount() { cleanups.forEach(cleanup => cleanup?.()); }
  };
}

function elements(tree: any, predicate: (element: any) => boolean): any[] {
  if (!tree || typeof tree !== "object") return [];
  const children = Array.isArray(tree) ? tree : tree.props?.children ?? [];
  return [...(!Array.isArray(tree) && predicate(tree) ? [tree] : []), ...[children].flat().flatMap(child => elements(child, predicate))];
}
function text(tree: any): string {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (tree && typeof tree === "object") return text(tree.props?.children);
  return tree === undefined || tree === null ? "" : String(tree);
}
const field = (tree: any, name: string) => elements(tree, element => element.props?.name === name)[0];
const button = (tree: any, label: string) => elements(tree, element => element.type === "button" && text(element).includes(label))[0];
const change = (tree: any, name: string, value: string) => field(tree, name).props.onChange({ target: { value } });
const submit = (tree: any) => elements(tree, element => element.type === "form")[0].props.onSubmit({ preventDefault() {} });

const operatorContext = (changes: Record<string, unknown> = {}) => ({
  storeId: id(1), canOperate: true, requiresOperatorAuthentication: true,
  operator: { id: id(2), name: "A Staff", role: "staff", expiresAt: "2026-10-11T00:15:00Z" }, ...changes
});
const operatorHarness = (storeId = id(1)) => harness("app/store/components/useStoreInventoryOperator.ts", "useStoreInventoryOperator", storeId);
const countItem = (changes: Record<string, any> = {}) => ({
  id: id(10), storeId: id(1), productId: id(11), productName: "丸子", category: "食品", locationId: id(12), locationName: "冷凍庫",
  countUnit: "個", currentQuantity: null, lastCountedQuantity: null, stockRevision: 1,
  exceptionCode: "", exceptionNote: "", canQuickCheck: true, quickCheck: null,
  currentConversion: { purchaseUnit: "袋", countUnit: "個", unitsPerPurchase: 20 },
  unitChoices: [{ purchaseUnit: "袋", countUnit: "袋", unitsPerPurchase: 1 }, { purchaseUnit: "袋", countUnit: "個", unitsPerPurchase: 20 }],
  quickCheckBasis: {
    storeId: id(1), productId: id(11), locationId: id(12), stockRevision: 1, quickRevision: 1, countUnit: "個", safetyStock: 5,
    unitConfiguration: { unit: "袋", packageQuantity: 20, packageQuantityUnit: "個", inventoryUnitConversions: [] }
  }, ...changes
});
const countKey = (scope: string) => `foundr1-store:count-drafts:v1:${scope}`;
function countHarness(initial = countItem()) {
  const submissions: any[] = [], reports: any[] = [];
  let result: any = { ok: true };
  const props = {
    storeId: id(1), items: [initial], canOperate: true, expectedOperatorId: id(2), draftScopeKey: `${id(1)}:${id(2)}`, saving: false,
    onSave: async (payload: any) => { submissions.push(clone(payload)); return result; },
    onReport: async (...args: any[]) => { reports.push(clone(args)); }
  };
  const h = harness("components/StoreInventoryCountList.tsx", "StoreInventoryCountList", props);
  return { ...h, props, submissions, reports, setResult(next: any) { result = next; } };
}

test("operator password clears immediately on every attempt and never enters browser storage", async () => {
  const credentials: any[] = [];
  let complete: (result: boolean) => void = () => {};
  const context = {
    operator: null, canOperate: false, requiresOperatorAuthentication: true, loading: false, busy: false, error: "",
    refresh() {}, clear() {}, authorize: (loginId: string, password: string) => {
      credentials.push({ loginId, password });
      return new Promise<boolean>(resolveAttempt => { complete = resolveAttempt; });
    }
  };
  const h = harness("app/store/components/StoreInventoryOperatorPanel.tsx", "StoreInventoryOperatorPanel", { context });
  let tree = h.render();
  change(tree, "operatorLoginId", "  a.staff  "); tree = h.render();
  change(tree, "operatorPassword", "private-password"); tree = h.render();
  submit(tree); tree = h.render();
  assert.equal(field(tree, "operatorPassword").props.value, "");
  assert.deepEqual(credentials, [{ loginId: "a.staff", password: "private-password" }]);
  assert.equal(h.storage.size, 0); assert.equal(h.sessionStorage.size, 0); assert.equal(h.writes.length, 0);
  complete(false); await tick(); tree = h.render();
  assert.equal(field(tree, "operatorPassword").props.value, "");
  assert.equal(button(tree, "本人を確認して操作").props.disabled, true);
  change(tree, "operatorPassword", "second-password"); tree = h.render(); submit(tree); tree = h.render();
  assert.equal(field(tree, "operatorPassword").props.value, "");
  assert.equal(h.writes.length, 0); complete(false); await tick();
});

test("operator store switching hides the old actor immediately and ignores late old-store authorization", async () => {
  const h = operatorHarness(); h.render(); await h.respond(0, operatorContext());
  let context = h.render(); assert.equal(context.canOperate, true); assert.equal(context.operator.id, id(2));
  const authorization = context.authorize("other.staff", "private-password");
  assert.equal(h.requests[1].method, "POST"); assert.equal(h.requests[1].payload.storeId, id(1));
  context = h.render(id(99)); assert.equal(context.operator, null); assert.equal(context.canOperate, false);
  await h.respond(1, { ok: true }); assert.equal(await authorization, false);
  await h.respond(2, operatorContext({ storeId: id(99), operator: { id: id(3), name: "B Staff", role: "staff", expiresAt: null } }));
  context = h.render(id(99)); assert.equal(context.operator.id, id(3));
  assert.equal(h.writes.length, 0); assert.equal(h.storage.size, 0); assert.equal(h.sessionStorage.size, 0);
});

test("operator 403 refresh and local expiry both remove write authority", async () => {
  const denied = operatorHarness(); denied.render(); await denied.respond(0, operatorContext());
  let context = denied.render(); assert.equal(context.canOperate, true);
  void context.refresh(); await denied.respond(1, { error: "scope denied" }, 403);
  context = denied.render(); assert.equal(context.canOperate, false); assert.equal(context.operator, null);
  const expired = operatorHarness(); expired.render(); await expired.respond(0, operatorContext());
  context = expired.render(); assert.equal(context.canOperate, true);
  await expired.advance(15 * 60 * 1000); context = expired.render();
  assert.equal(context.canOperate, false); assert.equal(context.operator, null);
  assert.equal(expired.requests[1].method, "GET");
  await expired.respond(1, { error: "operator expired", code: "operator_expired" }, 401);
  context = expired.render(); assert.equal(context.canOperate, false);
});

test("count quantity starts blank; half a bag sends its explicit unit and real operator identity", async () => {
  const h = countHarness(); h.render(); let tree = h.render();
  const quantity = `countQuantity-${id(10)}`, unit = `countUnit-${id(10)}`;
  assert.equal(field(tree, quantity).props.value, ""); assert.match(text(tree), /未確認/);
  assert.equal(button(tree, "数えて保存").props.disabled, true);
  submit(tree); await tick(); assert.equal(h.submissions.length, 0);
  change(tree, unit, "袋"); tree = h.render(); assert.equal(field(tree, quantity).props.value, "");
  change(tree, quantity, "0.5"); tree = h.render(); assert.equal(button(tree, "数えて保存").props.disabled, false);
  submit(tree); await tick();
  assert.deepEqual(h.submissions[0], { action: "count", storeId: id(1), itemId: id(10), quantity: 0.5, inputUnit: "袋", countUnit: "個", expectedConversion: { purchaseUnit: "袋", countUnit: "個", unitsPerPurchase: 20 }, expectedInputConversion: { purchaseUnit: "袋", countUnit: "袋", unitsPerPurchase: 1 }, expectedStockRevision: 1, expectedOperatorId: id(2) });
  tree = h.render(); assert.equal(field(tree, quantity).props.value, "");
  change(tree, quantity, "0"); tree = h.render(); assert.equal(button(tree, "数えて保存").props.disabled, false);
  submit(tree); await tick(); assert.equal(h.submissions[1].quantity, 0);
  assert.deepEqual(h.submissions[1].expectedInputConversion, { purchaseUnit: "袋", countUnit: "個", unitsPerPurchase: 20 });
});

test("count conflict retains raw text, unit and original basis until explicit review of refreshed stock", async () => {
  const h = countHarness(); h.setResult({ ok: false, error: "conflict", status: 409 });
  h.render(); let tree = h.render(); const quantity = `countQuantity-${id(10)}`, unit = `countUnit-${id(10)}`;
  change(tree, unit, "袋"); tree = h.render(); change(tree, quantity, "0.50"); tree = h.render(); submit(tree); await tick();
  tree = h.render(); assert.equal(field(tree, quantity).props.value, "0.50"); assert.equal(field(tree, unit).props.value, "袋");
  const saved = JSON.parse(h.storage.get(countKey(h.props.draftScopeKey))!)[id(10)]; assert.equal(saved.basis.stockRevision, 1);
  const next = { ...h.props, items: [countItem({ stockRevision: 2, currentQuantity: 7 })] };
  tree = h.render(next); assert.equal(field(tree, quantity).props.value, "0.50"); assert.equal(button(tree, "数えて保存").props.disabled, true);
  submit(tree); await tick(); assert.equal(h.submissions.length, 1);
  button(tree, "最新の数量・単位を確認して数え直す").props.onClick(); tree = h.render(next);
  assert.equal(field(tree, quantity).props.value, "0.50"); assert.equal(field(tree, unit).props.value, "袋");
  h.setResult({ ok: true }); submit(tree); await tick(); assert.equal(h.submissions[1].expectedStockRevision, 2);
  assert.deepEqual(h.submissions[1].expectedInputConversion, { purchaseUnit: "袋", countUnit: "袋", unitsPerPurchase: 1 });
});

test("changed unit configuration preserves old text before review and requires a fresh explicit count after review", async () => {
  const h = countHarness(); h.render(); let tree = h.render(); const quantity = `countQuantity-${id(10)}`, unit = `countUnit-${id(10)}`;
  change(tree, unit, "袋"); tree = h.render(); change(tree, quantity, "0.5"); tree = h.render();
  const item = countItem(), nextItem = { ...item, stockRevision: 2, currentConversion: { ...item.currentConversion, unitsPerPurchase: 24 }, unitChoices: item.unitChoices.map(choice => choice.countUnit === "個" ? { ...choice, unitsPerPurchase: 24 } : choice), quickCheckBasis: { ...item.quickCheckBasis, stockRevision: 2, unitConfiguration: { ...item.quickCheckBasis.unitConfiguration, packageQuantity: 24 } } };
  const next = { ...h.props, items: [nextItem] };
  tree = h.render(next); assert.equal(field(tree, quantity).props.value, "0.5"); assert.equal(field(tree, unit).props.value, "袋"); assert.equal(button(tree, "数えて保存").props.disabled, true);
  assert.equal(JSON.parse(h.storage.get(countKey(h.props.draftScopeKey))!)[id(10)].basis.currentConversion.unitsPerPurchase, 20);
  button(tree, "最新の数量・単位を確認して数え直す").props.onClick(); tree = h.render(next);
  assert.equal(field(tree, quantity).props.value, ""); assert.equal(field(tree, unit).props.value, "個"); assert.equal(button(tree, "数えて保存").props.disabled, true);
  submit(tree); await tick(); assert.equal(h.submissions.length, 0);

  const auxiliary = clone(countItem());
  auxiliary.unitChoices.push({ purchaseUnit: "袋", countUnit: "箱", unitsPerPurchase: 0.5 });
  auxiliary.quickCheckBasis.unitConfiguration.inventoryUnitConversions = [{ unit: "箱", unitsPerPurchase: 0.5 }];
  const a = countHarness(auxiliary); a.setResult({ ok: false, error: "input conversion changed" });
  a.render(); let auxiliaryTree = a.render();
  change(auxiliaryTree, unit, "箱"); auxiliaryTree = a.render();
  change(auxiliaryTree, quantity, "1"); auxiliaryTree = a.render();
  assert.match(text(auxiliaryTree), /40 個/);
  submit(auxiliaryTree); await tick();
  assert.deepEqual(a.submissions[0].expectedConversion, { purchaseUnit: "袋", countUnit: "個", unitsPerPurchase: 20 });
  assert.deepEqual(a.submissions[0].expectedInputConversion, { purchaseUnit: "袋", countUnit: "箱", unitsPerPurchase: 0.5 });
  const freshAuxiliary = clone(auxiliary);
  freshAuxiliary.unitChoices.find((choice: any) => choice.countUnit === "箱").unitsPerPurchase = 0.25;
  freshAuxiliary.quickCheckBasis.unitConfiguration.inventoryUnitConversions[0].unitsPerPurchase = 0.25;
  const freshProps = { ...a.props, items: [freshAuxiliary] };
  auxiliaryTree = a.render(freshProps);
  assert.equal(field(auxiliaryTree, quantity).props.value, "1");
  assert.equal(field(auxiliaryTree, unit).props.value, "箱");
  assert.match(text(auxiliaryTree), /40 個/);
  assert.equal(button(auxiliaryTree, "数えて保存").props.disabled, true);
  submit(auxiliaryTree); await tick(); assert.equal(a.submissions.length, 1);
  button(auxiliaryTree, "最新の数量・単位を確認して数え直す").props.onClick(); auxiliaryTree = a.render(freshProps);
  assert.equal(field(auxiliaryTree, quantity).props.value, "");
  assert.equal(field(auxiliaryTree, unit).props.value, "個");
});

test("count drafts are isolated by store and actor; lost authority disables fields and blocks submission", async () => {
  const h = countHarness(); h.render(); let tree = h.render(); const quantity = `countQuantity-${id(10)}`;
  change(tree, quantity, "9.25"); tree = h.render();
  assert.ok(h.storage.has(countKey(h.props.draftScopeKey)));
  const actorB = { ...h.props, expectedOperatorId: id(3), draftScopeKey: `${id(1)}:${id(3)}` };
  tree = h.render(actorB); assert.equal(field(tree, quantity).props.value, ""); tree = h.render(actorB);
  change(tree, quantity, "4"); tree = h.render(actorB); submit(tree); await tick(); assert.equal(h.submissions[0].expectedOperatorId, id(3));
  tree = h.render(h.props); assert.equal(field(tree, quantity).props.value, ""); tree = h.render(h.props); assert.equal(field(tree, quantity).props.value, "9.25");
  const denied = { ...h.props, canOperate: false, expectedOperatorId: "" };
  tree = h.render(denied); assert.equal(field(tree, quantity).props.disabled, true); assert.equal(button(tree, "数えて保存").props.disabled, true);
  submit(tree); await tick(); assert.equal(h.submissions.length, 1);
  const otherStore = { ...h.props, storeId: id(99), draftScopeKey: `${id(99)}:${id(2)}`, items: [countItem({ storeId: id(99) })] };
  tree = h.render(otherStore); assert.equal(field(tree, quantity).props.value, "");
  assert.equal(JSON.parse(h.storage.get(countKey(h.props.draftScopeKey))!)[id(10)].text, "9.25");
});

test("quick-check actor scope switch hides the previous actor's estimate on its first render and cannot submit it", async () => {
  const submissions: any[] = [];
  const props = { storeId: id(1), items: [countItem()], saving: false, draftScopeKey: `${id(1)}:${id(2)}`, onSave: async (checks: any[]) => { submissions.push(clone(checks)); return true; } };
  const h = harness("components/QuickInventoryList.tsx", "QuickInventoryList", props);
  h.render(); let tree = h.render();
  elements(tree, element => element.props?.["data-quick-status"] === "low")[0].props.onClick(); tree = h.render();
  elements(tree, element => element.type === "input")[0].props.onChange({ target: { value: "0.5" } }); tree = h.render();
  const actorAKey = `foundr1-os:quick-inventory-draft:v1:${props.draftScopeKey}`;
  assert.equal(JSON.parse(h.storage.get(actorAKey)!)[id(10)].estimate.quantity, 0.5);
  const actorB = { ...props, draftScopeKey: `${id(1)}:${id(3)}` };
  tree = h.render(actorB);
  button(tree, "確認した状態を保存").props.onClick(); await tick();
  assert.equal(submissions.length, 0);
  assert.equal(elements(tree, element => element.props?.["data-quick-status"] === "low")[0].props["aria-pressed"], false);
  assert.equal(elements(tree, element => element.type === "input")[0]?.props.value ?? "", "");
  tree = h.render(actorB); assert.ok(h.storage.has(actorAKey));
});
