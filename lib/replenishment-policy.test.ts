import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function load(path: string, modules: Record<string, unknown> = {}) {
  const exports: Record<string, any> = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  runInNewContext(source, { exports, require: (name: string) => modules[name] });
  return exports;
}
const policy = load("./replenishment-policy.ts", {
  "./product-catalog-policy": load("./product-catalog-policy.ts", { "./product-unit-conversions.ts": load("./product-unit-conversions.ts") }),
  "./replenishment-order-intent": load("./replenishment-order-intent.ts"),
  "./inventory-quick-policy": load("./inventory-quick-policy.ts")
});
const now = Date.parse("2026-10-08T12:00:00Z");
const product = { id: "sku", name: "商品", unit: "袋", brandScope: "common", catalogVisibility: "brand_stores", isOrderable: true, brandUsages: [], catalogStoreIds: [] };
const menu = { kind: "item", id: "menu", brandId: "brand", name: "メニュー", displayNames: { en: "Menu", zh: "菜单" }, stockStatus: "low_stock", note: "", productIds: ["sku"], availabilityBlockKeys: [] };
function derive(patch: Record<string, unknown> = {}) {
  return policy.deriveReplenishmentSnapshot({ store: { id: "store", name: "店舗", brandIds: ["brand"] }, role: "store_manager", canCreateOrder: true, products: [product], menu: [], inventory: [], orders: [], now, ...patch });
}

test("direct menu shortages deduplicate SKU and sources, while recipe-only blockers produce no risk", () => {
  const direct = { ...menu, stockStatus: "unavailable", availabilityBlockKeys: ["item:menu"] };
  const dependent = { ...menu, id: "recipe", availabilityBlockKeys: ["option:ingredient"], stockStatus: "unavailable" };
  const result = derive({ menu: [menu, menu, direct, dependent] });
  assert.equal(result.risks.length, 1);
  assert.equal(result.risks[0].sources.length, 1);
  assert.equal(result.risks[0].key, "store:sku");
  assert.equal(result.risks[0].sources[0].displayNames.zh, "菜单");
  assert.equal(derive({ menu: [dependent] }).risks.length, 0);
  assert.equal(derive({ menu: [{ ...direct, availabilityBlockKeys: ["manual-existing:menu"] }] }).risks.length, 1);
  assert.equal(derive({ menu: [{ ...direct, availabilityBlockKeys: [] }] }).risks.length, 1);
});

test("visual inventory signals remain separate from book quantities and explicit menu shortages", () => {
  const row = { id: "inventory", productId: "sku", locationName: "Shelf", countUnit: "袋", quantity: 1, safetyStock: 2,
    exceptionCode: "quality", note: "keep quality", lastCountedAt: "2026-09-01T00:00:00Z" };
  const check = { status: "enough", checkedAt: "2026-10-08T11:00:00Z", checkedBy: "Staff", estimate: null, state: "fresh" };
  const result = derive({ menu: [menu], inventory: [{ ...row, quickCheck: check }] });
  assert.equal(result.risks.length, 1);
  assert.equal(result.risks[0].sources.length, 1);
  assert.equal(result.risks[0].sources[0].kind, "item");
  const low = derive({ inventory: [{ ...row, quantity: null, lastCountedAt: null, quickCheck: { ...check, status: "low", state: "recheck" } }] });
  assert.equal(low.risks[0].sources[0].stockStatus, "low_stock");
  assert.equal(low.risks[0].sources[0].quantity, null);
  assert.equal(low.risks[0].sources[0].note, "keep quality");
  assert.equal(low.risks[0].sources[0].quickCheck.state, "recheck");
  assert.equal(derive({ inventory: [{ ...row, quantity: 10, quickCheck: { ...check, status: "out", state: "superseded" } }] }).risks.length, 0);
});

test("unmapped menu signals stay separate and restricted SKUs reveal no identity or order facts", () => {
  const secret = { ...product, id: "secret-id", name: "secret-name", catalogVisibility: "internal" };
  const result = derive({
    products: [secret], menu: [{ ...menu, productIds: ["secret-id"] }, { ...menu, id: "needs-map", productIds: [] }],
    orders: [{ id: "secret-order", orderNo: "SECRET", itemId: "secret-line", productId: "secret-id", status: "requested", requestedQuantity: 9, actualQuantity: null, unit: "袋", actualUnit: null }]
  });
  assert.equal(result.risks.length, 0);
  assert.equal(result.restrictedSourceCount, 1);
  assert.equal(result.unmapped.length, 1);
  assert.equal(result.unmapped[0].id, "needs-map");
  assert.ok(!JSON.stringify(result).includes("secret-id"));
  assert.ok(!JSON.stringify(result).includes("secret-name"));
  assert.ok(!JSON.stringify(result).includes("secret-order"));
});

test("location observations preserve mixed units and count freshness without producing a total or order quantity", () => {
  const observation = { id: "location-a", productId: "sku", locationName: "冷蔵", countUnit: "袋", quantity: 1, safetyStock: 2, exceptionCode: "low", note: "", lastCountedAt: "2026-09-01T00:00:00Z" };
  const result = derive({ inventory: [observation, { ...observation, id: "location-b", locationName: "棚", countUnit: "箱", quantity: null, lastCountedAt: null, exceptionCode: "out" }] });
  assert.equal(result.risks.length, 1);
  const sources = result.risks[0].sources;
  assert.equal(sources.length, 2);
  assert.equal(sources[0].countUnit, "袋");
  assert.equal(sources[0].quantity, 1);
  assert.equal(sources[0].countConfidence, "stale");
  assert.equal(sources[1].quantity, null);
  assert.equal(sources[1].countConfidence, "unknown");
  assert.equal(sources[1].stockStatus, "unavailable");
  assert.equal(result.risks[0].totalQuantity, undefined);
  assert.equal(result.risks[0].suggestedQuantity, undefined);
  assert.equal(policy.inventoryReplenishmentSignal({ ...observation, exceptionCode: "", quantity: null }), null);
  assert.equal(policy.inventoryReplenishmentSignal({ ...observation, exceptionCode: "", quantity: 0 }), "unavailable");
});

test("open demand remains a hint, and unknown actual quantities never use requested quantities", () => {
  const order = { id: "order", orderNo: "PO-1", itemId: "line", productId: "sku", status: "requested", requestedQuantity: 9, actualQuantity: null, unit: "袋", actualUnit: null };
  const result = derive({ menu: [menu], orders: [order, order, { ...order, itemId: "received", status: "received" }, { ...order, itemId: "receipt", orderNo: "RCPT-TEST" }, { ...order, itemId: "unavailable", status: "unavailable" }, { ...order, itemId: "delivered", status: "delivered", actualQuantity: 2, actualUnit: "箱" }] });
  assert.equal(result.risks.length, 1);
  assert.equal(result.risks[0].sources.length, 1);
  assert.equal(result.risks[0].openOrders.length, 2);
  assert.equal(result.risks[0].openOrders[0].actualQuantity, null);
  assert.equal(result.risks[0].openOrders[0].requestedQuantity, 9);
  assert.equal(result.risks[0].openOrders[1].actualUnit, "箱");
});

test("stopped SKUs stay identifiable without order controls and an empty fresh read clears prior risks", () => {
  const result = derive({ products: [{ ...product, isOrderable: false }], menu: [menu], canCreateOrder: false });
  assert.equal(result.risks[0].product.name, "商品");
  assert.equal(result.risks[0].product.isOrderable, false);
  assert.equal(result.risks[0].blockedReason, "not_orderable");
  assert.equal(result.canCreateOrder, false);
  assert.equal(derive().risks.length, 0);
  assert.equal(derive().unmapped.length, 0);
});

test("a stale menu link cannot borrow another brand's SKU from a store carrying both brands", () => {
  const specific = { ...product, name: "Brand A SKU", brandScope: "specific", brandUsages: [{ brandId: "brand-a", isOrderable: true }] };
  const staleMenu = { ...menu, brandId: "brand-b" };
  const store = { id: "store", name: "店舗", brandIds: ["brand-a", "brand-b"] };
  for (const role of ["store_manager", "owner", "manager"]) {
    const result = derive({ store, role, products: [specific], menu: [staleMenu] });
    assert.equal(result.risks.length, 0);
    assert.equal(result.restrictedSourceCount, 1);
    assert.ok(!JSON.stringify(result).includes("Brand A SKU"));
    assert.ok(!JSON.stringify(result).includes('"sku"'));
  }
  const inventory = { id: "stock", productId: "sku", locationName: "棚", countUnit: "袋", quantity: null, safetyStock: 1, exceptionCode: "low", note: "", lastCountedAt: null };
  const result = derive({ store, products: [specific], menu: [staleMenu], inventory: [inventory] });
  assert.equal(result.risks.length, 1);
  assert.equal(result.risks[0].sources.length, 1);
  assert.equal(result.risks[0].sources[0].kind, "inventory");
  assert.equal(result.restrictedSourceCount, 1);
});
