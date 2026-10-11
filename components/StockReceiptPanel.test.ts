import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import * as units from "../lib/product-unit-conversions.ts";
const policy: Record<string, any> = {};
const packaging: Record<string, any> = {};
runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/product-packaging-policy.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: packaging, require: (name: string) => { if (name === "./product-unit-conversions") return units; throw new Error(`Unmocked ${name}`); } });
runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/inventory-receipt-policy.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: policy, require: (name: string) => { if (name === "./product-unit-conversions") return units; if (name === "./product-packaging-policy") return packaging; throw new Error(`Unmocked ${name}`); } });

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = { purchaseOrderItemId: id(3), purchaseOrderId: id(4), orderNo: "PO-1", storeId: id(1), productId: id(2), productName: "A", status: "delivered", purchaseUnit: "袋", actualQuantity: 3, actualUnit: "袋", receivedPurchaseQuantity: 0, receivedPurchaseUnits: [], remainingPurchaseQuantity: 3, unverifiedRemainingPurchaseQuantity: 3, blockedReason: null, unverifiedBlockedReason: null, correctionHref: "", expectedSource: { purchaseOrderItemId: id(3), storeId: id(1) } };
const target = { id: id(5), storeId: id(1), productId: id(2), productName: "A", locationId: id(6), locationName: "freezer", countUnit: "個", currentQuantity: 20, stockQuantity: 20, stockRevision: 1, currentConversion: { purchaseUnit: "袋", countUnit: "個", unitsPerPurchase: 20 }, stockConversionSnapshot: null, countConversionSnapshot: null, lastCountedAt: "now", lastReceivedAt: null, addBlockedReason: null, includedBlockedReason: null, unverifiedBlockedReason: null };
const response = (targets: any[] = [target], sources: any[] = [source]) => ({ store: { id: id(1), name: "A" }, canReceive: true, sources, inventoryItems: targets, recentReceipts: [] });

function harness() {
  const exports: Record<string, any> = {};
  const states: any[] = [], refs: any[] = [], deps: any[][] = [], callbacks: any[] = [];
  let si = 0, ri = 0, ei = 0, ci = 0;
  let effects: Array<() => void> = [];
  const storage = new Map<string, string>();
  const requests: Array<{ url: string; payload: any; resolve: (response: Response) => void }> = [];
  let nonce = 40;
  const react = {
    useState(initial: any) { const i = si++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], (next: any) => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; },
    useRef(initial: any) { const i = ri++; return refs[i] ??= { current: initial }; },
    useEffect(fn: () => void, next: any[]) { const i = ei++; if (!deps[i] || next.some((v, n) => v !== deps[i][n])) effects.push(fn); deps[i] = next; },
    useCallback(fn: any, next: any[]) { const i = ci++; const prev = callbacks[i]; if (!prev || next.some((v, n) => v !== prev.deps[n])) callbacks[i] = { fn, deps: next }; return callbacks[i].fn; }
  };
  const modules: Record<string, any> = { react, "react/jsx-runtime": { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) }, "lucide-react": {},
    "../app/os/components/OsTranslationProvider": { useOsTranslation: () => ({ t: (s: string) => s, language: "ja" }) },
    "../app/os/components/currentEmployeeStore": { loadCurrentEmployee: async () => null },
    "../lib/inventory-receipt-policy": policy, "../lib/product-packaging-policy": packaging, "../lib/product-unit-conversions": units, "./BatchPackagingTemplateSaver": { BatchPackagingTemplateSaver: "BatchPackagingTemplateSaver" }, "./StockReceiptPanel.module.css": { default: {} } };
  runInNewContext(ts.transpileModule(readFileSync(new URL("./StockReceiptPanel.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, URLSearchParams, AbortController, crypto: { randomUUID: () => id(nonce++) }, window: { localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) } },
      fetch: (url: string, options?: any) => new Promise<Response>(resolve => requests.push({ url, payload: options?.body ? JSON.parse(options.body) : null, resolve })),
      require: (name: string) => { if (!(name in modules)) throw new Error(`Unmocked ${name}`); return modules[name]; } });
  return { exports, requests, storage,
    render(input: string | Record<string, unknown> = id(1)) { si = ri = ei = ci = 0; effects = []; const props = typeof input === "string" ? { storeId: input } : input; const tree = exports.StockReceiptPanel(props); const run = effects; run.forEach(fn => fn()); return tree; },
    async respond(index: number, body: any, status = 200) { requests[index].resolve(Response.json(body, { status })); await new Promise(resolve => setTimeout(resolve, 0)); }
  };
}
function elements(tree: any, predicate: (e: any) => boolean): any[] { if (!tree || typeof tree !== "object") return []; const children = Array.isArray(tree) ? tree : tree.props?.children ?? []; return [...(!Array.isArray(tree) && predicate(tree) ? [tree] : []), ...[children].flat().flatMap(child => elements(child, predicate))]; }
function text(tree: any): string { if (Array.isArray(tree)) return tree.map(text).join(""); if (tree && typeof tree === "object") return text(tree.props?.children); return tree === undefined || tree === null ? "" : String(tree); }
const button = (tree: any, label: string) => elements(tree, e => e.type === "button" && text(e).includes(label))[0];
const field = (tree: any, name: string) => elements(tree, e => e.props?.name === name)[0];

test("quick receipt uses a visible unique exact location, waits for explicit whole-arrival confirmation", async () => {
  const h = harness(); h.render(); await h.respond(0, response()); let tree = h.render();
  assert.equal(field(tree, "inventoryItemId").props.value, target.id);
  assert.equal(field(tree, "purchaseQuantity").props.value, "");
  assert.equal(button(tree, "新しい到着分を在庫に加算").props.disabled, true);
  assert.equal(h.requests.length, 1);
  button(tree, "今回の未入庫分をすべて受け取りました").props.onClick(); tree = h.render();
  button(tree, "新しい到着分を在庫に加算").props.onClick();
  assert.equal(h.requests[1].payload.purchaseQuantity, 3);
  assert.equal(h.requests[1].payload.mode, "add");
  assert.equal(h.requests[1].payload.inventoryItemId, target.id);
});

test("multiple locations require choosing one; same-name different SKU cannot become an entry target", async () => {
  const h = harness(); h.render(); await h.respond(0, response([target, { ...target, id: id(7) }, { ...target, id: id(8), productId: id(9) }])); const tree = h.render();
  assert.equal(field(tree, "inventoryItemId").props.value, "");
  assert.equal(button(tree, "今回の未入庫分をすべて受け取りました").props.disabled, true);
  assert.equal(elements(field(tree, "inventoryItemId"), e => e.type === "option").length, 3);
});

test("unknown balance/conversion records only known actual-unit arrival with a null conversion", async () => {
  const h = harness(); h.render(); await h.respond(0, response([{ ...target, stockQuantity: null, currentConversion: null, addBlockedReason: "conversion_unknown", includedBlockedReason: "conversion_unknown" }], [{ ...source, purchaseUnit: "箱", remainingPurchaseQuantity: null, blockedReason: "purchase_unit_changed" }]));
  let tree = h.render(); button(tree, "今回の未入庫分をすべて受け取りました").props.onClick(); tree = h.render();
  assert.equal(button(tree, "新しい到着分を在庫に加算").props.disabled, true);
  assert.equal(button(tree, "到着だけ記録・総在庫は未確認にする").props.disabled, false);
  button(tree, "到着だけ記録・総在庫は未確認にする").props.onClick();
  assert.equal(h.requests[1].payload.mode, "unverified"); assert.equal(h.requests[1].payload.expectedConversion, null); assert.equal(h.requests[1].payload.purchaseQuantity, 3);
  assert.equal(text(h.render()).includes("入庫換算"), false);
});

test("failed sends retain the same nonce and stale conflicts preserve quantity until explicit review", async () => {
  const h = harness(); h.render(); await h.respond(0, response()); let tree = h.render();
  button(tree, "今回の未入庫分をすべて受け取りました").props.onClick(); tree = h.render(); button(tree, "新しい到着分を在庫に加算").props.onClick();
  const first = h.requests[1].payload; await h.respond(1, { error: "network" }, 503); tree = h.render();
  elements(tree, e => e.type === "form")[0].props.onSubmit({ preventDefault() {} }); assert.deepEqual(h.requests[2].payload, first);
  await h.respond(2, { error: "stale" }, 409); await h.respond(3, response()); tree = h.render();
  assert.equal(field(tree, "purchaseQuantity").props.value, "3"); assert.equal(button(tree, "新しい到着分を在庫に加算").props.disabled, true);
  const review = field(tree, "receiptUpdatedFactsConfirmed"); review.props.onChange({ target: { checked: true } }); tree = h.render();
  button(tree, "新しい到着分を在庫に加算").props.onClick(); assert.notEqual(h.requests[4].payload.requestId, first.requestId);
});

test("batch packaging uses explicit contents, a stable destination unit, and confirmation rather than today's SKU ratio", async () => {
  const h = harness(), batch = { purchaseUnit: "袋", contentQuantity: 3, contentUnit: "kg", countUnit: "kg", stockQuantityPerPurchase: 3 };
  const targetKg = { ...target, countUnit: "kg", stockQuantity: 20, currentConversion: null, addBlockedReason: "conversion_unknown", includedBlockedReason: "conversion_unknown", batchAddBlockedReason: null, batchIncludedBlockedReason: null };
  h.render(); await h.respond(0, { ...response([targetKg], [{ ...source, purchaseUnit: "箱", blockedReason: "purchase_unit_changed" }]), packagingTemplates: [{ ...batch, id: id(50), productId: source.productId, name: "3kg袋", status: "active" }] }); let tree = h.render();
  field(tree, "batchPackagingEnabled").props.onChange({ target: { checked: true } }); tree = h.render(); field(tree, "batchPackagingTemplate").props.onChange({ target: { value: id(50) } }); tree = h.render();
  button(tree, "今回の未入庫分をすべて受け取りました").props.onClick(); tree = h.render(); assert.equal(button(tree, "新しい到着分を在庫に加算").props.disabled, true);
  field(tree, "batchPackagingConfirmed").props.onChange({ target: { checked: true } }); tree = h.render(); assert.equal(button(tree, "新しい到着分を在庫に加算").props.disabled, false); button(tree, "新しい到着分を在庫に加算").props.onClick();
  assert.equal(h.requests[1].payload.expectedConversion, null); assert.equal(h.requests[1].payload.batchPackaging.stockQuantityPerPurchase, 3); assert.equal(h.requests[1].payload.batchPackaging.purchaseUnit, "袋"); assert.equal(h.requests[1].payload.purchaseQuantity, 3);
  assert.equal(h.exports.receiptPreview({ ...source, actualPackaging: batch }, targetKg, 3, "add").after, 29);
  assert.equal(h.exports.receiptModeBlockedReason(source, { ...targetKg, countUnit: "袋" }, "add", batch), "batch_unit_mismatch");
});

test("a frozen purchase batch is read-only, included requires an actual count, and retry preserves its snapshot", async () => {
  const batch = { purchaseUnit: "袋", contentQuantity: 3, contentUnit: "kg", countUnit: "kg", stockQuantityPerPurchase: 3 };
  const h = harness(), targetKg = { ...target, countUnit: "kg", currentConversion: null, currentQuantity: null, lastCountedAt: null, batchAddBlockedReason: null, batchIncludedBlockedReason: "count_unknown" };
  h.render(); await h.respond(0, response([targetKg], [{ ...source, actualPackaging: batch }])); let tree = h.render(); assert.equal(field(tree, "batchPackagingEnabled"), undefined); assert.match(text(tree), /記録済みの購入包装仕様/);
  button(tree, "今回の未入庫分をすべて受け取りました").props.onClick(); tree = h.render(); assert.equal(button(tree, "棚卸に含まれているため加算しない").props.disabled, true); button(tree, "新しい到着分を在庫に加算").props.onClick(); const sent = JSON.stringify(h.requests[1].payload);
  await h.respond(1, { error: "temporary" }, 503); tree = h.render(); elements(tree, e => e.type === "form")[0].props.onSubmit({ preventDefault() {} }); assert.equal(JSON.stringify(h.requests[2].payload), sent); assert.equal(h.requests[2].payload.batchPackaging.contentQuantity, 3);
});

test("a stock unit change preserves the original batch basis and refuses to reinterpret its factor after conflict", async () => {
  const h = harness(), targetKg = { ...target, countUnit: "kg", currentConversion: null, batchAddBlockedReason: null, batchIncludedBlockedReason: null };
  h.render(); await h.respond(0, response([targetKg])); let tree = h.render(); field(tree, "batchPackagingEnabled").props.onChange({ target: { checked: true } }); tree = h.render();
  field(tree, "batchContentQuantity").props.onChange({ target: { value: "3" } }); tree = h.render(); field(tree, "batchPackagingConfirmed").props.onChange({ target: { checked: true } }); tree = h.render(); button(tree, "今回の未入庫分をすべて受け取りました").props.onClick(); tree = h.render(); button(tree, "新しい到着分を在庫に加算").props.onClick();
  await h.respond(1, { error: "unit changed" }, 409); await h.respond(2, response([{ ...targetKg, countUnit: "g", stockRevision: 2 }])); tree = h.render();
  assert.equal(field(tree, "batchStockQuantityPerPurchase").props.value, "3"); assert.match(text(tree), /購入または保管先の単位が変わりました/); assert.match(text(elements(tree, e => e.type === "label" && elements(e, child => child.props?.name === "batchStockQuantityPerPurchase").length > 0)[0]), /kg/);
  field(tree, "receiptUpdatedFactsConfirmed").props.onChange({ target: { checked: true } }); tree = h.render(); assert.equal(button(tree, "新しい到着分を在庫に加算").props.disabled, true); assert.equal(button(tree, "到着だけ記録・総在庫は未確認にする").props.disabled, true); assert.equal(h.requests.length, 3);
});


test("Store receipt uses the verified operator and atomic confirmation, retaining the original nonce after authentication expiry", async () => {
  const h = harness(); let authRequired = 0;
  const props = { storeId: id(1), surface: "store", expectedOperatorId: id(70), draftScopeKey: `store:${id(1)}:${id(70)}`, canOperate: true, onAuthorizationRequired: () => { ++authRequired; } };
  h.render(props); assert.match(h.requests[0].url, /^\/api\/store\/inventory\/receipts/); await h.respond(0, response()); let tree = h.render(props);
  button(tree, "今回の未入庫分をすべて受け取りました").props.onClick(); tree = h.render(props); button(tree, "新しい到着分を在庫に加算").props.onClick();
  const first = JSON.stringify(h.requests[1].payload); assert.equal(h.requests[1].payload.expectedOperatorId, id(70)); assert.equal(h.requests[1].payload.confirmStoreReceiving, true); assert.equal(h.requests[1].url, "/api/store/inventory/receipts");
  await h.respond(1, { error: "expired", code: "operator_expired" }, 401); assert.equal(authRequired, 1); assert.equal(h.storage.size, 1);
  tree = h.render({ ...props, canOperate: false }); elements(tree, e => e.type === "form")[0].props.onSubmit({ preventDefault() {} }); assert.equal(h.requests.length, 2);
  tree = h.render(props); elements(tree, e => e.type === "form")[0].props.onSubmit({ preventDefault() {} }); assert.equal(JSON.stringify(h.requests[2].payload), first);
  tree = h.render({ ...props, expectedOperatorId: id(71), draftScopeKey: `store:${id(1)}:${id(71)}` }); assert.equal(elements(tree, e => e.type === "form").length, 0); assert.equal(h.storage.size, 1);
});

test("Store receipt never exposes OS management links or template management, while keeping batch confirmation", async () => {
  const h = harness(), props = { storeId: id(1), surface: "store", expectedOperatorId: id(70), draftScopeKey: `store:${id(1)}:${id(70)}` };
  h.render(props); await h.respond(0, response([target], [{ ...source, correctionHref: "/os/orders?order=PO-1" }])); let tree = h.render(props);
  field(tree, "batchPackagingEnabled").props.onChange({ target: { checked: true } }); tree = h.render(props);
  field(tree, "batchContentQuantity").props.onChange({ target: { value: "20" } }); tree = h.render(props); field(tree, "batchPackagingConfirmed").props.onChange({ target: { checked: true } }); tree = h.render(props);
  assert.equal(elements(tree, e => e.type === "BatchPackagingTemplateSaver").length, 0); assert.equal(elements(tree, e => e.type === "a" && String(e.props.href).startsWith("/os")).length, 0); assert.ok(field(tree, "batchPackagingTemplate"));
});
