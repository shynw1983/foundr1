import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as unitPolicy from "./product-unit-conversions.ts";
import type { InventoryReceiptInventoryItem, InventoryReceiptSource, InventoryReceiptPayload } from "./inventory-receipt-policy";

const exports: Record<string, any> = {};
runInNewContext(ts.transpileModule(readFileSync(new URL("./inventory-receipt-policy.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { exports, require: (name: string) => {
  if (name === "./product-unit-conversions") return unitPolicy;
  throw new Error(`Unknown policy dependency ${name}`);
} });
const policy = exports;
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const conversion = { purchaseUnit: "袋", countUnit: "個", unitsPerPurchase: 12 };
const source: InventoryReceiptSource = {
  purchaseOrderItemId: uuid(1), purchaseOrderId: uuid(2), storeId: uuid(3), productId: uuid(4), orderNo: "PO-TEST", productName: "same name",
  status: "delivered", purchaseUnit: "袋", actualQuantity: 4, actualUnit: "袋", receivedPurchaseQuantity: 0, receivedPurchaseUnits: [], remainingPurchaseQuantity: 4,
  blockedReason: null, unverifiedBlockedReason: null, unverifiedRemainingPurchaseQuantity: 4, correctionHref: "/os/orders?order=PO-TEST", expectedSource: {
    purchaseOrderItemId: uuid(1), purchaseOrderId: uuid(2), storeId: uuid(3), productId: uuid(4), status: "delivered", actualQuantity: 4, actualUnit: "袋",
    latestActualId: uuid(5), latestActualQuantity: 4, latestActualUnit: "袋", latestActualRecordedAt: "2026-10-09T10:00:00Z", deliveryBatchId: null, deliveryBatchStatus: null
  }
};
const target: InventoryReceiptInventoryItem = {
  id: uuid(6), storeId: uuid(3), productId: uuid(4), productName: "same name", locationId: uuid(7), locationName: "Shelf", countUnit: "個",
  currentQuantity: 4, stockQuantity: 4, stockRevision: 0, currentConversion: conversion, stockConversionSnapshot: conversion,
  countConversionSnapshot: conversion, lastCountedAt: "2026-10-09T12:00:00Z", lastReceivedAt: null, addBlockedReason: null, includedBlockedReason: null, unverifiedBlockedReason: null
};
function payload(patch: Partial<InventoryReceiptPayload> = {}): InventoryReceiptPayload {
  return { requestId: uuid(8), purchaseOrderItemId: source.purchaseOrderItemId, inventoryItemId: target.id, purchaseQuantity: 0.125,
    mode: "add", expectedSource: source.expectedSource, expectedStockRevision: 0, expectedConversion: conversion, ...patch };
}
function errorCode(callback: () => unknown, code: string) {
  assert.throws(callback, (error: any) => error.code === code);
}

test("partial receipt adds exact count units while included leaves book and physical facts unchanged", () => {
  const before = JSON.stringify(target);
  const added = policy.validateInventoryReceipt(payload(), source, target);
  assert.equal(added.countQuantity, 1.5);
  assert.equal(added.afterStockQuantity, 5.5);
  assert.equal(policy.validateInventoryReceipt(payload({ mode: "included" }), source, target).afterStockQuantity, 4);
  assert.equal(JSON.stringify(target), before);
});

test("stable source and exact store/SKU/stock IDs cannot be replaced by same-name products", () => {
  for (const patch of [{ storeId: uuid(9) }, { productId: uuid(9) }, { id: uuid(9) }]) {
    errorCode(() => policy.validateInventoryReceipt(payload(), source, { ...target, ...patch }), "target_mismatch");
  }
  errorCode(() => policy.validateInventoryReceipt(payload(), { ...source, status: "requested" }, target), "source_changed");
  errorCode(() => policy.validateInventoryReceipt(payload({ expectedSource: { ...source.expectedSource, actualQuantity: 5 } }), source, target), "source_changed");
});

test("source quantity and actual purchase unit must be known and partial receipts cannot exceed actual", () => {
  for (const [patch, code] of [
    [{ actualQuantity: null }, "actual_quantity_unknown"], [{ actualQuantity: 0 }, "actual_quantity_zero"],
    [{ actualUnit: null }, "actual_unit_unknown"], [{ actualUnit: "箱" }, "purchase_unit_changed"],
    [{ receivedPurchaseQuantity: 4 }, "fully_received"]
  ] as const) errorCode(() => policy.validateInventoryReceipt(payload(), { ...source, ...patch }, target), code);
  assert.equal(policy.validateInventoryReceipt(payload({ purchaseQuantity: 0.1 }), { ...source, receivedPurchaseQuantity: 3.9 }, target).countQuantity, 1.2);
  errorCode(() => policy.validateInventoryReceipt(payload({ purchaseQuantity: 0.100001 }), { ...source, receivedPurchaseQuantity: 3.9 }, target), "over_receipt");
  errorCode(() => policy.validateInventoryReceipt(payload(), { ...source, receivedPurchaseUnits: [{ quantity: 0.5, purchaseUnit: "箱" }] }, target), "purchase_unit_changed");
  const changedPurchaseUnit = { ...conversion, purchaseUnit: "箱" };
  errorCode(() => policy.validateInventoryReceipt(payload({ expectedConversion: changedPurchaseUnit }), source,
    { ...target, currentConversion: changedPurchaseUnit, stockConversionSnapshot: changedPurchaseUnit }), "purchase_unit_changed");
});

test("unknown book stock and old conversions block both modes; included additionally requires real count", () => {
  for (const mode of ["add", "included"] as const) {
    errorCode(() => policy.validateInventoryReceipt(payload({ mode }), source, { ...target, stockQuantity: null }), "stock_unknown");
    errorCode(() => policy.validateInventoryReceipt(payload({ mode }), source, { ...target, stockConversionSnapshot: null }), "stock_conversion_changed");
    errorCode(() => policy.validateInventoryReceipt(payload({ mode }), source, { ...target, currentConversion: null }), "stock_changed");
  }
  assert.equal(policy.validateInventoryReceipt(payload(), source, { ...target, currentQuantity: null, countConversionSnapshot: null, lastCountedAt: null }).afterStockQuantity, 5.5);
  errorCode(() => policy.validateInventoryReceipt(payload({ mode: "included" }), source, { ...target, currentQuantity: null }), "count_unknown");
  errorCode(() => policy.validateInventoryReceipt(payload({ mode: "included" }), source, { ...target, countConversionSnapshot: null }), "count_conversion_changed");
});

test("revision and conversion snapshots prevent applying an old receipt draft", () => {
  errorCode(() => policy.validateInventoryReceipt(payload(), source, { ...target, stockRevision: 1 }), "stock_changed");
  errorCode(() => policy.validateInventoryReceipt(payload({ expectedConversion: { ...conversion, unitsPerPurchase: 24 } }), source, target), "stock_changed");
});

test("decimal multiplication and addition are exact at six digits rather than binary float guesses", () => {
  assert.equal(policy.exactInventoryReceiptCountQuantity(0.1, 3), 0.3);
  assert.equal(policy.exactInventoryReceiptCountQuantity(0.125, 12), 1.5);
  assert.equal(policy.exactInventoryReceiptCountQuantity(0.000001, 0.1), null);
  assert.equal(policy.addInventoryReceiptQuantities(0.1, 0.2), 0.3);
  assert.equal(policy.addInventoryReceiptQuantities(999999999999, 1), null);
  const tinyConversion = { ...conversion, unitsPerPurchase: 0.1 };
  errorCode(() => policy.validateInventoryReceipt(payload({ purchaseQuantity: 0.000001, expectedConversion: tinyConversion }), source,
    { ...target, currentConversion: tinyConversion, stockConversionSnapshot: tinyConversion }), "unrepresentable_quantity");
});

test("payloads require an explicit mode, positive exact quantity, revision and complete source snapshot", () => {
  assert.equal(policy.normalizeInventoryReceiptPayload({ ...payload(), purchaseQuantity: "1/8" }).purchaseQuantity, 0.125);
  for (const quantity of ["", 0, -1, Infinity, "1/3", "0.0000001"]) errorCode(() => policy.normalizeInventoryReceiptPayload({ ...payload(), purchaseQuantity: quantity }), "invalid_quantity");
  assert.throws(() => policy.normalizeInventoryReceiptPayload({ ...payload(), mode: "auto" }));
  errorCode(() => policy.normalizeInventoryReceiptPayload({ ...payload(), expectedStockRevision: undefined }), "stock_changed");
  errorCode(() => policy.normalizeInventoryReceiptPayload({ ...payload(), expectedSource: {} }), "source_changed");
  errorCode(() => policy.normalizeInventoryReceiptPayload({ ...payload(), expectedConversion: null }), "conversion_unknown");
});

test("unverified records known historical purchase facts without guessing a total or current ratio", () => {
  const rough = payload({ mode: "unverified", expectedConversion: null });
  const unknown = { ...target, stockQuantity: null, stockConversionSnapshot: null, currentConversion: null, currentQuantity: null, countConversionSnapshot: null, lastCountedAt: null };
  const before = JSON.stringify(unknown);
  const result = policy.validateInventoryReceipt(rough, { ...source, purchaseUnit: "箱" }, unknown);
  assert.equal(result.countQuantity, null);
  assert.equal(result.afterStockQuantity, null);
  assert.equal(result.conversionSnapshot, null);
  assert.equal(JSON.stringify(unknown), before);
  assert.equal(policy.normalizeInventoryReceiptPayload(rough).expectedConversion, null);
  errorCode(() => policy.normalizeInventoryReceiptPayload({ ...rough, expectedConversion: conversion }), "conversion_unknown");
});

test("unverified still requires real purchase quantity/unit, source capacity, matching ledger units and revision", () => {
  const rough = payload({ mode: "unverified", expectedConversion: null });
  for (const [patch, code] of [
    [{ actualQuantity: null }, "actual_quantity_unknown"], [{ actualUnit: null }, "actual_unit_unknown"],
    [{ receivedPurchaseQuantity: 4 }, "fully_received"], [{ receivedPurchaseUnits: [{ quantity: 1, purchaseUnit: "箱" }] }, "purchase_unit_changed"]
  ] as const) errorCode(() => policy.validateInventoryReceipt(rough, { ...source, ...patch }, target), code);
  errorCode(() => policy.validateInventoryReceipt({ ...rough, purchaseQuantity: 5 }, source, target), "over_receipt");
  errorCode(() => policy.validateInventoryReceipt(rough, source, { ...target, stockRevision: 1 }), "stock_changed");
});
