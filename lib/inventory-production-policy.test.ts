import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
function load(path: string, modules: Record<string, unknown> = {}) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected dependency ${name}`);
    return modules[name];
  } });
  return exports;
}
const units = load("./product-unit-conversions.ts");
const policy = load("./inventory-production-policy.ts", { "./product-unit-conversions": units });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const payload = () => ({ requestId: id(1), storeId: id(2), recipeVersionId: id(3), outputInventoryItemId: id(4), outputQuantity: 10, expectedOutputStockRevision: 0, inputs: [{ productId: id(5), inventoryItemId: id(6), quantity: 4, unit: "g", mode: "estimate", expectedStockRevision: 0 }] });
test("manufacturing input coverage and explicitly scaled standards", () => {
  const normalized = policy.normalizeInventoryProductionPayload(payload());
  const snapshot = { basis: "measured", inputs: [{ productId: id(5), quantity: 2, unit: "g", mode: "estimate" }], output: { productId: id(7), quantity: 5, unit: "g" } };
  policy.validateProductionInputs(normalized, snapshot);
  assert.throws(() => policy.validateProductionInputs({ ...normalized, inputs: [] }, snapshot));
  assert.throws(() => policy.validateProductionInputs({ ...normalized, inputs: [{ ...normalized.inputs[0], quantity: 3 }] }, snapshot));
  policy.validateProductionInputs({ ...normalized, inputs: [{ ...normalized.inputs[0], mode: "exact", quantity: 3 }] }, snapshot);
});
test("unmeasured inputs require null and duplicate SKUs reject", () => {
  const original = payload();
  assert.throws(() => policy.normalizeInventoryProductionPayload({ ...original, inputs: [...original.inputs, ...original.inputs] }));
  assert.throws(() => policy.normalizeInventoryProductionPayload({ ...original, inputs: [{ ...original.inputs[0], mode: "unmeasured" }] }));
  assert.equal(policy.normalizeInventoryProductionPayload({ ...original, inputs: [{ ...original.inputs[0], quantity: null, mode: "unmeasured" }] }).inputs[0].quantity, null);
});
test("exact units and six-decimal signed bookkeeping preserve unknown and negative balances", () => {
  assert.equal(policy.convertProductionQuantity(0.125, { unit: "箱", packageQuantity: 12, packageQuantityUnit: "袋" }, "箱", "袋").quantity, "1.500000");
  assert.equal(policy.changeProductionBook(null, "1.500000"), null);
  assert.equal(policy.changeProductionBook("1.000000", "-2.500000"), "-1.500000");
  assert.throws(() => policy.convertProductionQuantity(0.000001, { unit: "箱", packageQuantity: 0.1, packageQuantityUnit: "袋" }, "箱", "袋"));
  assert.throws(() => policy.changeProductionBook("999999999999.999999", "0.000001"));
});
test("stable base quantities do not change with purchase-pack factors", () => {
  const current = { purchaseUnit: "箱", countUnit: "袋", unitsPerPurchase: 12 };
  policy.requireProductionBookSnapshot(null, null, current);
  policy.requireProductionBookSnapshot("1", null, current);
  policy.requireProductionBookSnapshot("1", { ...current, unitsPerPurchase: 24 }, current);
  assert.throws(() => policy.requireProductionBookSnapshot("1", { ...current, countUnit: "箱" }, current));
  assert.equal(policy.convertProductionQuantity(2, { unit: "箱" }, "g", "g").quantity, "2.000000");
  assert.equal(policy.convertProductionQuantity(2, { unit: "箱" }, "g", "g", { hasBatchPackaging: true }).quantity, "2.000000");
  assert.throws(() => policy.convertProductionQuantity(2, { unit: "箱", packageQuantity: 12, packageQuantityUnit: "袋" }, "箱", "袋", { hasBatchPackaging: true }));
});
test("dispatch and partial receive use explicit separate commands and prices", () => {
  const dispatch = policy.normalizeInventoryProductionPayload({ action: "transfer_dispatch", requestId: id(1), sourceStoreId: id(2), targetStoreId: id(3), productId: id(4), sourceInventoryItemId: id(5), targetInventoryItemId: id(6), quantity: 2, unit: "g", expectedSourceStockRevision: 0, costPriceJpy: 12, supplyPriceJpy: 20 });
  assert.equal(dispatch.costPriceJpy, 12); assert.equal(dispatch.supplyPriceJpy, 20);
  assert.throws(() => policy.normalizeInventoryProductionPayload({ ...dispatch, targetStoreId: dispatch.sourceStoreId }));
  assert.equal(policy.normalizeInventoryProductionPayload({ action: "transfer_receive", requestId: id(1), transferId: id(2), quantity: 0.5, expectedTargetStockRevision: 1 }).action, "transfer_receive");
});
