import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { InventoryQuickCheckBasis, InventoryQuickCheckFacts } from "./inventory-quick-policy";

const exports: Record<string, unknown> = {};
runInNewContext(ts.transpileModule(readFileSync(new URL("./inventory-quick-policy.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { exports, require: (name: string) => { throw new Error(`Unexpected policy dependency ${name}`); } });
const policy = exports as unknown as typeof import("./inventory-quick-policy");
const now = Date.parse("2026-10-09T12:00:00Z");
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const basis: InventoryQuickCheckBasis = {
  storeId: uuid(1), productId: uuid(2), locationId: uuid(3), stockRevision: 4, quickRevision: 2,
  countUnit: "個", safetyStock: 2,
  unitConfiguration: {
    unit: "袋", packageQuantity: 20, packageQuantityUnit: "個",
    inventoryUnitConversions: [{ unit: "個", unitsPerPurchase: 20 }, { unit: "1/4袋", unitsPerPurchase: 4 }]
  }
};
const counted = { quantity: 1, safetyStock: 2, exceptionCode: "low", lastCountedAt: "2026-10-08T12:00:00Z", countUnit: "個" };
function facts(patch: Partial<InventoryQuickCheckFacts> = {}): InventoryQuickCheckFacts {
  return { quickStatus: "enough", quickCheckedAt: new Date(now).toISOString(), quickCheckedBy: uuid(4), quickBasis: basis, ...patch };
}
function read(patch: Partial<InventoryQuickCheckFacts> = {}, currentBasis = basis) {
  return policy.readInventoryQuickCheck(facts(patch), currentBasis, now);
}
function status(patch: Partial<InventoryQuickCheckFacts> = {}, currentBasis = basis, stock: Omit<Parameters<typeof policy.effectiveQuickInventoryStockStatus>[0], "quickCheck"> = counted) {
  return policy.effectiveQuickInventoryStockStatus({ ...stock, quickCheck: read(patch, currentBasis) });
}

test("Enough suppresses shortages only with the same basis within 24 hours", () => {
  for (const age of [0, policy.inventoryQuickCheckFreshnessMs]) {
    const patch = { quickCheckedAt: new Date(now - age).toISOString() };
    assert.equal(read(patch)?.state, "fresh");
    assert.equal(status(patch), "available");
  }
  for (const checkedAt of [new Date(now - policy.inventoryQuickCheckFreshnessMs - 1).toISOString(), new Date(now + 1).toISOString(), "invalid"]) {
    assert.equal(read({ quickCheckedAt: checkedAt })?.state, "recheck");
    assert.equal(status({ quickCheckedAt: checkedAt }), "low_stock");
  }
  assert.equal(status({}, { ...basis, stockRevision: 5 }), "low_stock");
  assert.equal(read({ quickStatus: "other" }), null);
  assert.equal(read({ quickCheckedAt: null }), null);
});

test("low and out remain actionable after expiry or changed facts until superseded", () => {
  const ampleStock = { ...counted, quantity: 20, exceptionCode: "" };
  for (const [quickStatus, expected] of [["low", "low_stock"], ["out", "unavailable"]] as const) {
    for (const patch of [
      {}, { quickCheckedAt: new Date(now - policy.inventoryQuickCheckFreshnessMs - 1).toISOString() }, { quickCheckedAt: "invalid" }
    ]) {
      assert.equal(status({ ...patch, quickStatus }, basis, ampleStock), expected);
      assert.equal(status({ ...patch, quickStatus }, { ...basis, stockRevision: 5 }, ampleStock), expected);
    }
    assert.equal(read({ quickStatus, quickSupersededAt: new Date(now).toISOString() })?.state, "superseded");
    assert.equal(status({ quickStatus, quickSupersededAt: new Date(now).toISOString() }, basis, ampleStock), "available");
  }
});

test("stock, observation, identity, threshold and raw unit configuration changes invalidate Enough", () => {
  const config = basis.unitConfiguration;
  const changes: InventoryQuickCheckBasis[] = [
    { ...basis, storeId: uuid(9) }, { ...basis, productId: uuid(9) }, { ...basis, locationId: uuid(9) },
    { ...basis, stockRevision: 5 }, { ...basis, quickRevision: 3 }, { ...basis, countUnit: "袋" },
    { ...basis, safetyStock: null }, { ...basis, safetyStock: 0 }, { ...basis, safetyStock: 3 },
    { ...basis, unitConfiguration: { ...config, unit: "箱" } },
    { ...basis, unitConfiguration: { ...config, packageQuantity: 0 } },
    { ...basis, unitConfiguration: { ...config, packageQuantity: null } },
    { ...basis, unitConfiguration: { ...config, packageQuantityUnit: null } },
    { ...basis, unitConfiguration: { ...config, packageQuantityUnit: "" } },
    { ...basis, unitConfiguration: { ...config, inventoryUnitConversions: [] } },
    { ...basis, unitConfiguration: { ...config, inventoryUnitConversions: [{ unit: "個", unitsPerPurchase: 21 }, { unit: "1/4袋", unitsPerPurchase: 4 }] } },
    { ...basis, unitConfiguration: { ...config, inventoryUnitConversions: [...config.inventoryUnitConversions as unknown[]].reverse() } }
  ];
  for (const changed of changes) {
    assert.equal(policy.inventoryQuickCheckBasesEqual(basis, changed), false);
    assert.equal(read({}, changed)?.state, "recheck");
    assert.equal(status({}, changed), "low_stock");
  }
  assert.equal(policy.inventoryQuickCheckBasesEqual(
    { ...basis, safetyStock: 0, unitConfiguration: { ...config, packageQuantity: 0, packageQuantityUnit: "" } },
    { ...basis, safetyStock: null, unitConfiguration: { ...config, packageQuantity: null, packageQuantityUnit: null } }
  ), false);
  // Object key order is irrelevant, while conversion array order remains part of the raw basis.
  assert.equal(policy.inventoryQuickCheckBasesEqual(basis, { ...basis, unitConfiguration: { inventoryUnitConversions: config.inventoryUnitConversions, packageQuantityUnit: "個", packageQuantity: 20, unit: "袋" } }), true);
  assert.equal(policy.inventoryQuickCheckBasesEqual(null, null), false);
});

test("basis construction preserves zero/null package values and the raw package unit", () => {
  const row = { ...basis, purchaseUnit: "袋", packageQuantity: 0, packageQuantityUnit: "個", rawPackageQuantityUnit: null, inventoryUnitConversions: [] };
  const zero = policy.createInventoryQuickCheckBasis({ ...row, safetyStock: 0 });
  const unknown = policy.createInventoryQuickCheckBasis({ ...row, packageQuantity: null, safetyStock: null });
  assert.equal(zero.safetyStock, 0);
  assert.equal(zero.unitConfiguration.packageQuantity, 0);
  assert.equal(zero.unitConfiguration.packageQuantityUnit, null);
  assert.equal(unknown.safetyStock, null);
  assert.equal(unknown.unitConfiguration.packageQuantity, null);
  assert.equal(policy.inventoryQuickCheckBasesEqual(zero, unknown), false);
  assert.equal(policy.createInventoryQuickCheckBasis({ ...row, rawPackageQuantityUnit: "" }).unitConfiguration.packageQuantityUnit, "");
});

test("rough numeric estimates require a finite nonnegative six-decimal number and the original purchase unit", () => {
  for (const quantity of [0, 0.125, 0.000001, 20]) {
    const estimate = policy.normalizeInventoryQuickCheckEstimate({ kind: "quantity", quantity, purchaseUnit: "袋" }, "袋");
    assert.ok(estimate && estimate.kind === "quantity");
    assert.equal(estimate.quantity, quantity);
    assert.equal(estimate.purchaseUnit, "袋");
  }
  for (const quantity of [-1, NaN, Infinity, "1", null, 0.0000001, 1 / 3, 1_000_000_000_000]) {
    assert.equal(policy.normalizeInventoryQuickCheckEstimate({ kind: "quantity", quantity, purchaseUnit: "袋" }, "袋"), false);
  }
  for (const purchaseUnit of [null, "箱", " 袋", "袋 ", ""]) {
    assert.equal(policy.normalizeInventoryQuickCheckEstimate({ kind: "quantity", quantity: 1, purchaseUnit }, "袋"), false);
  }
  assert.equal(policy.normalizeInventoryQuickCheckEstimate({ kind: "quantity", quantity: 1, purchaseUnit: "" }, ""), false);
});

test("qualitative Small and absent estimates stay qualitative instead of turning into zero", () => {
  for (const purchaseUnit of [null, "袋"]) {
    const estimate = policy.normalizeInventoryQuickCheckEstimate({ kind: "small", purchaseUnit }, "袋");
    assert.ok(estimate && estimate.kind === "small");
    assert.equal(estimate.purchaseUnit, purchaseUnit);
    assert.equal("quantity" in estimate, false);
  }
  for (const value of [null, undefined]) assert.equal(policy.normalizeInventoryQuickCheckEstimate(value, "袋"), null);
  for (const value of [false, 0, "small", [], {}, { kind: "small" }, { kind: "small", purchaseUnit: "箱" }, { kind: "unknown" }]) {
    assert.equal(policy.normalizeInventoryQuickCheckEstimate(value, "袋"), false);
  }
});

test("configuration changes retain the estimate's historical purchase unit without reinterpreting it", () => {
  const changed = { ...basis, unitConfiguration: { ...basis.unitConfiguration, unit: "箱" } };
  const check = read({ quickStatus: "low", quickEstimate: { kind: "quantity", quantity: 0.5, purchaseUnit: "袋" } }, changed);
  assert.equal(check?.state, "recheck");
  assert.equal(check?.estimate?.kind, "quantity");
  assert.equal(check?.estimate?.purchaseUnit, "袋");
  assert.equal(read({ quickEstimate: { kind: "quantity", quantity: 0.5, purchaseUnit: "箱" } }, changed)?.estimate, null);
});

test("rough quantities never supply a physical count or change shortage severity", () => {
  const uncounted = { quantity: null, safetyStock: 2, exceptionCode: "quality", lastCountedAt: null, countUnit: "個" };
  const before = JSON.stringify(uncounted);
  for (const quantity of [0, 100]) {
    const quickEstimate = { kind: "quantity", quantity, purchaseUnit: "袋" };
    assert.equal(status({ quickStatus: "enough", quickEstimate }, basis, uncounted), "available");
    assert.equal(status({ quickStatus: "low", quickEstimate }, basis, uncounted), "low_stock");
    assert.equal(status({ quickStatus: "out", quickEstimate }, basis, uncounted), "unavailable");
    assert.equal(status({ quickStatus: "out", quickEstimate, quickSupersededAt: new Date(now).toISOString() }, basis, uncounted), "available");
  }
  assert.equal(JSON.stringify(uncounted), before);
  assert.equal(policy.effectiveQuickInventoryStockStatus(uncounted), "available");
  assert.equal(policy.effectiveQuickInventoryStockStatus({ ...uncounted, quantity: 0, lastCountedAt: counted.lastCountedAt }), "unavailable");
  assert.equal(policy.effectiveQuickInventoryStockStatus({ ...uncounted, quantity: 1, lastCountedAt: counted.lastCountedAt }), "low_stock");
  assert.equal(policy.effectiveQuickInventoryStockStatus({ ...uncounted, exceptionCode: "out" }), "unavailable");
  assert.equal(policy.effectiveQuickInventoryStockStatus({ ...uncounted, exceptionCode: "low" }), "low_stock");
});

test("superseding a rough observation restores exact-count and exception fallback", () => {
  const superseded = { quickStatus: "enough", quickSupersededAt: new Date(now).toISOString() };
  assert.equal(status(superseded), "low_stock");
  assert.equal(status(superseded, basis, { ...counted, quantity: 0, exceptionCode: "" }), "unavailable");
  assert.equal(status(superseded, basis, { ...counted, quantity: 10, exceptionCode: "" }), "available");
  for (const patch of [{ quantity: Infinity }, { safetyStock: null }, { safetyStock: -1 }, { lastCountedAt: null }, { countUnit: " " }]) {
    assert.equal(policy.effectiveQuickInventoryStockStatus({ ...counted, exceptionCode: "quality", ...patch }), "available");
  }
});

test("quick checks require a valid basis and operational roles exclude store terminals", () => {
  assert.equal(policy.validInventoryQuickCheckBasis(basis), true);
  for (const changed of [
    null, [], {}, { ...basis, productId: "same-name" }, { ...basis, stockRevision: -1 }, { ...basis, quickRevision: 0.5 },
    { ...basis, countUnit: " " }, { ...basis, safetyStock: NaN }, { ...basis, unitConfiguration: { ...basis.unitConfiguration, inventoryUnitConversions: {} } }
  ]) assert.equal(policy.validInventoryQuickCheckBasis(changed), false);
  for (const role of ["owner", "manager", "store_owner", "store_manager", "staff"]) assert.equal(policy.canQuickCheckInventoryRole(role), true);
  for (const role of ["store_terminal", "", "unknown"]) assert.equal(policy.canQuickCheckInventoryRole(role), false);
});


test("negative theoretical stock remains an actionable shortage, without becoming a physical count", () => {
  assert.equal(policy.effectiveQuickInventoryStockStatus({quantity:-1,safetyStock:2,exceptionCode:"",lastCountedAt:"2026-10-08T12:00:00Z",countUnit:"個"}),"unavailable");
});
