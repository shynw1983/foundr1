import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as observations from "./inventory-observation-policy.ts";
import * as units from "./product-unit-conversions.ts";
const countInputs={ normalizeInventoryCountInput: () => ({quantity:0}) };

const storeA = "00000000-0000-4000-8000-000000000001";
const storeB = "00000000-0000-4000-8000-000000000002";
const payload = (selectedStoreId: string) => ({ selectedStoreId, stores: [{ id: storeA, name: "A" }, { id: storeB, name: "B" }], locations: [], products: [], items: [], recentChecks: [] });

function pageHarness(search: string) {
  const exports: Record<string, any> = {};
  const state: any[] = [], refs: any[] = [], previousEffects: any[][] = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0;
  let effects: Array<() => void> = [];
  const listeners = new Map<string, () => void>();
  const requests: Array<{ url: string; body: any; resolve: (response: Response) => void }> = [];
  const storage = new Map<string, string>();
  const location = { search, href: `https://example.test/os/inventory${search}` };
  const react = {
    useState(initial: any) {
      const index = stateIndex++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (next: any) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
    },
    useRef(initial: any) { const index = refIndex++; return refs[index] ??= { current: initial }; },
    useMemo(callback: () => any) { return callback(); },
    useEffect(callback: () => void, deps: any[]) {
      const index = effectIndex++;
      if (!previousEffects[index] || deps.some((value, i) => value !== previousEffects[index][i])) effects.push(callback);
      previousEffects[index] = deps;
    }
  };
  const modules: Record<string, unknown> = {
    react, "react/jsx-runtime": { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) }, "lucide-react": {},
    "../components/ActionNotice": { useActionNotice: () => ({ notice: null, showNotice() {}, clearNotice() {} }) },
    "../../../components/ReplenishmentPanel": { ReplenishmentPanel: "ReplenishmentPanel" },
    "../../../components/StockReceiptPanel": { StockReceiptPanel: "StockReceiptPanel" },
    "../../../components/InventoryUsagePanel": { InventoryUsagePanel: () => null },
    "../../../components/ManufacturingPanel": { ManufacturingPanel: () => null },
    "../../../components/QuickInventoryList": { QuickInventoryList: "QuickInventoryList" },
    "../components/MobileNavMenu": {}, "../components/OsNavList": {}, "../components/UserBadge": {},
    "../components/OsTranslationProvider": { useOsTranslation: () => ({ t: (value: string) => value, language: "ja" }) },
    "../../../lib/inventory-count-input-policy": countInputs, "../../../lib/inventory-observation-policy": observations, "../../../lib/product-unit-conversions": units
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL("../app/os/inventory/page.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, {
    exports, URL, URLSearchParams,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    window: { location, addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name),
      history: { state: null, replaceState: (_: unknown, __: string, value: URL) => { location.search = value.search; location.href = String(value); } } },
    fetch: (url: string, options?: any) => new Promise<Response>((resolve) => requests.push({ url, body: options?.body ? JSON.parse(options.body) : null, resolve })),
    require: (name: string) => { if (!(name in modules)) throw new Error(`Unmocked dependency ${name}`); return modules[name]; }
  });
  return {
    requests, location,
    render() {
      stateIndex = refIndex = effectIndex = 0; effects = [];
      const tree = exports.default(); const pendingEffects = effects; pendingEffects.forEach((effect) => effect()); return tree;
    },
    async respond(index: number, body: unknown, status = 200) { requests[index].resolve(Response.json(body, { status })); await new Promise((resolve) => setTimeout(resolve, 0)); },
    navigate(search: string) { location.search = search; location.href = `https://example.test/os/inventory${search}`; listeners.get("popstate")?.(); }
  };
}
function elements(tree: any, predicate: (element: any) => boolean): any[] {
  if (!tree || typeof tree !== "object") return [];
  const children = Array.isArray(tree) ? tree : tree.props?.children ?? [];
  return [...(!Array.isArray(tree) && predicate(tree) ? [tree] : []), ...[children].flat().flatMap((child) => elements(child, predicate))];
}
const receiptStores = (tree: any) => elements(tree, (element) => element.type === "StockReceiptPanel").map((element) => element.props.storeId);
function openReceipts(page: ReturnType<typeof pageHarness>) {
  const fold = elements(page.render(), element => element.type === "details" && element.props.className === "panel inventory-receipts-fold")[0];
  fold.props.onToggle({ currentTarget: { open: true } });
  return page.render();
}

test("a direct store B inventory link requests and displays B rather than the API default A", async () => {
  const page = pageHarness(`?storeId=${storeB}`);
  page.render();
  assert.equal(page.requests[0].url, `/api/inventory?storeId=${storeB}`);
  await page.respond(0, payload(storeB));
  const tree = openReceipts(page);
  assert.deepEqual(receiptStores(tree), [storeB]);
  const storeSelect = elements(tree, (element) => element.type === "select" && element.props.value === storeB)[0];
  storeSelect.props.onChange({ target: { value: storeA } });
  assert.equal(new URL(page.location.href).searchParams.get("storeId"), storeA);
  assert.equal(page.requests[1].url, `/api/inventory?storeId=${storeA}`);
});

test("history navigation preserves the linked store and a late A response cannot replace B", async () => {
  const page = pageHarness(`?storeId=${storeA}`);
  page.render();
  page.navigate(`?storeId=${storeB}`);
  await page.respond(1, payload(storeB));
  await page.respond(0, payload(storeA));
  assert.deepEqual(receiptStores(openReceipts(page)), [storeB]);
  assert.deepEqual(page.requests.map((request) => request.url), [`/api/inventory?storeId=${storeA}`, `/api/inventory?storeId=${storeB}`]);
});

test("quick-check refresh keeps the mounted draft list while awaiting fresh data, including CAS conflicts", async () => {
  for (const status of [200, 409]) {
    const page = pageHarness(`?storeId=${storeB}`);
    page.render();
    const quickItem = { id: "00000000-0000-4000-8000-000000000003", storeId: storeB, productName: "A", locationName: "freezer", category: "food", safetyStock: 2, currentQuantity: null,
      exceptionCode: "", quickCheck: null, canQuickCheck: true, effectiveStockStatus: "available" };
    await page.respond(0, { ...payload(storeB), items: [quickItem] });
    const list = elements(page.render(), element => element.type === "QuickInventoryList")[0];
    const result = list.props.onSave([{ itemId: quickItem.id, status: "low", expectedBasis: {} }]);
    assert.equal(page.requests[1].body.storeId, storeB);
    assert.equal(page.requests[1].body.action, "batch_quick_check");
    await page.respond(1, status === 200 ? { ok: true } : { error: "changed", code: "quick_check_basis_changed" }, status);
    assert.equal(page.requests[2].url, `/api/inventory?storeId=${storeB}`);
    assert.equal(elements(page.render(), element => element.type === "QuickInventoryList").length, 1);
    await page.respond(2, { ...payload(storeB), items: [quickItem] });
    assert.equal(await result, status === 200);
    assert.equal(elements(page.render(), element => element.type === "QuickInventoryList").length, 1);
  }
});

test("denied B and an unexpected default-store response never silently display A", async () => {
  for (const status of [403, 200]) {
    const page = pageHarness(`?storeId=${storeB}`);
    page.render();
    await page.respond(0, status === 403 ? { error: "この店舗の在庫を確認する権限がありません。" } : payload(storeA), status);
    const tree = page.render();
    assert.deepEqual(receiptStores(tree), []);
    assert.equal(elements(tree, (element) => element.props?.role === "alert").length, 1);
    assert.ok(elements(tree, (element) => element.type === "select" && element.props.value === storeB).length);
    assert.equal(page.requests.length, 1);
    assert.equal(new URL(page.location.href).searchParams.get("storeId"), storeB);
  }
});
