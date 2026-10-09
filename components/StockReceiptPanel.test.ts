import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import * as units from "../lib/product-unit-conversions.ts";
const policy: Record<string, any> = {};
runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/inventory-receipt-policy.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: policy, require: (name: string) => { if (name === "./product-unit-conversions") return units; throw new Error(`Unmocked ${name}`); } });

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
    "../lib/inventory-receipt-policy": policy, "../lib/product-unit-conversions": units, "./StockReceiptPanel.module.css": { default: {} } };
  runInNewContext(ts.transpileModule(readFileSync(new URL("./StockReceiptPanel.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, URLSearchParams, AbortController, crypto: { randomUUID: () => id(nonce++) }, window: { localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) } },
      fetch: (url: string, options?: any) => new Promise<Response>(resolve => requests.push({ url, payload: options?.body ? JSON.parse(options.body) : null, resolve })),
      require: (name: string) => { if (!(name in modules)) throw new Error(`Unmocked ${name}`); return modules[name]; } });
  return { exports, requests, storage,
    render(storeId = id(1)) { si = ri = ei = ci = 0; effects = []; const tree = exports.StockReceiptPanel({ storeId }); const run = effects; run.forEach(fn => fn()); return tree; },
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
  const review = elements(tree, e => e.type === "input" && e.props.type === "checkbox")[0]; review.props.onChange({ target: { checked: true } }); tree = h.render();
  button(tree, "新しい到着分を在庫に加算").props.onClick(); assert.notEqual(h.requests[4].payload.requestId, first.requestId);
});
