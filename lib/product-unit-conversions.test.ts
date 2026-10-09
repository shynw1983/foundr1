import assert from "node:assert/strict";
import test from "node:test";
import {
  createProductUnitConfigurationSnapshot, normalizeInventoryUnitConversions, listProductUnitConversions,
  resolveProductUnitConversion, productUnitConfigurationSnapshotsEqual, unitConversionSnapshotsEqual,
  convertCountToPurchaseQuantity, convertPurchaseToCountQuantity, parseInventoryCountQuantity, formatInventoryCountQuantity
} from "./product-unit-conversions.ts";

const product = {
  unit: "袋", packageQuantity: 20, packageQuantityUnit: "個",
  inventoryUnitConversions: [{ unit: "個", unitsPerPurchase: 20 }, { unit: "1/4袋", unitsPerPurchase: 4, fractionalDenominator: 4 }]
};

test("purchase, packaging and fractional units coexist without adding quantities in different units", () => {
  assert.equal(listProductUnitConversions(product).length, 3);
  const pieces = resolveProductUnitConversion(product, "個");
  const quarter = resolveProductUnitConversion(product, "1/4袋");
  assert.deepEqual(pieces, { purchaseUnit: "袋", countUnit: "個", unitsPerPurchase: 20 });
  assert.equal(convertCountToPurchaseQuantity(10, pieces), 0.5);
  assert.equal(convertCountToPurchaseQuantity(1, quarter), 0.25);
  assert.equal(convertPurchaseToCountQuantity(1.5, pieces), 30);
  assert.deepEqual(resolveProductUnitConversion(product, "袋"), { purchaseUnit: "袋", countUnit: "袋", unitsPerPurchase: 1 });
  assert.equal(resolveProductUnitConversion(product, "kg"), null);
});

test("only explicit packaging relates units; package description and self-unit quantities do not", () => {
  assert.equal(resolveProductUnitConversion({ unit: "箱", packageQuantity: 200, packageQuantityUnit: "個" }, "個")?.unitsPerPurchase, 200);
  assert.equal(resolveProductUnitConversion({ unit: "袋", packageQuantity: 100, packageQuantityUnit: "袋" }, "袋")?.unitsPerPurchase, 1);
  assert.equal(resolveProductUnitConversion({ unit: "1kg袋", packageQuantity: null }, "g"), null);
  assert.equal(resolveProductUnitConversion({ unit: "袋", packageQuantity: 0, packageQuantityUnit: "個" }, "個"), null);
});

test("invalid factors, duplicates and conflicting packaging cannot create a relation", () => {
  for (const factor of [0, -1, NaN, Infinity, 1e-10, 1_000_000_001, "20"]) {
    assert.throws(() => normalizeInventoryUnitConversions([{ unit: "個", unitsPerPurchase: factor }], { unit: "袋" }));
  }
  for (const value of [null, {}, [{ unit: "", unitsPerPurchase: 1 }], [{ unit: "x\n", unitsPerPurchase: 1 }]]) {
    assert.throws(() => normalizeInventoryUnitConversions(value, { unit: "袋" }));
  }
  assert.throws(() => normalizeInventoryUnitConversions([{ unit: "個", unitsPerPurchase: 10 }], product));
  assert.throws(() => normalizeInventoryUnitConversions([{ unit: "個", unitsPerPurchase: 20 }, { unit: " 個 ", unitsPerPurchase: 20 }], product));
  assert.throws(() => normalizeInventoryUnitConversions([{ unit: "袋", unitsPerPurchase: 20 }], product));
});

test("fraction labels, denominator and factor must express the same purchase unit", () => {
  assert.deepEqual(normalizeInventoryUnitConversions([{ unit: "1/3袋", unitsPerPurchase: 3, fractionalDenominator: 3 }], { unit: "袋" }),
    [{ unit: "1/3袋", unitsPerPurchase: 3, fractionalDenominator: 3 }]);
  for (const entry of [
    { unit: "1/4袋", unitsPerPurchase: 4 },
    { unit: "1/4袋", unitsPerPurchase: 4, fractionalDenominator: 3 },
    { unit: "1/4箱", unitsPerPurchase: 4, fractionalDenominator: 4 },
    { unit: "1/4袋", unitsPerPurchase: 0.25, fractionalDenominator: 4 },
    { unit: "1/2.5袋", unitsPerPurchase: 2.5, fractionalDenominator: 2.5 }
  ]) assert.throws(() => normalizeInventoryUnitConversions([entry], { unit: "袋" }));
});

test("configuration equality covers packaging and every conversion while tolerating entry order", () => {
  const snapshot = createProductUnitConfigurationSnapshot(product);
  assert.equal(productUnitConfigurationSnapshotsEqual(snapshot, { ...product, inventoryUnitConversions: [...product.inventoryUnitConversions].reverse() }), true);
  for (const next of [
    { ...snapshot, unit: "箱" }, { ...snapshot, packageQuantity: 30 }, { ...snapshot, packageQuantityUnit: "枚" },
    { ...snapshot, inventoryUnitConversions: [] }
  ]) assert.equal(productUnitConfigurationSnapshotsEqual(snapshot, next), false);
});

test("historical snapshots retain their factor and null remains unknown", () => {
  const oldSnapshot = resolveProductUnitConversion(product, "個");
  const current = resolveProductUnitConversion({ ...product, packageQuantity: 10, inventoryUnitConversions: [{ unit: "個", unitsPerPurchase: 10 }] }, "個");
  assert.equal(unitConversionSnapshotsEqual(oldSnapshot, current), false);
  assert.equal(unitConversionSnapshotsEqual(null, null), false);
  assert.equal(convertCountToPurchaseQuantity(10, oldSnapshot), 0.5);
  assert.equal(convertCountToPurchaseQuantity(10, current), 1);
  assert.equal(convertCountToPurchaseQuantity(10, null), null);
  assert.equal(convertCountToPurchaseQuantity(-1, oldSnapshot), null);
  assert.equal(convertPurchaseToCountQuantity(Infinity, oldSnapshot), null);
});

test("count input accepts zero, six-decimal values and terminating fractions without rounding", () => {
  for (const [value, expected] of [[0, 0], [" 1/8 ", 0.125], ["1 / 2", 0.5], ["2/8", 0.25], [".125", 0.125], ["1.000001", 1.000001], ["0/3", 0]] as const) {
    assert.equal(parseInventoryCountQuantity(value), expected);
  }
  for (const value of ["", null, undefined, -1, "-1/2", "1/0", "1/3", "0.0000001", "1e3", Infinity, "999999999999.999999", "1000000000000"]) {
    assert.equal(parseInventoryCountQuantity(value), null);
  }
  assert.equal(formatInventoryCountQuantity(0.000001), "0.000001");
  assert.equal(formatInventoryCountQuantity(0.125), "0.125");
  assert.equal(formatInventoryCountQuantity(null), "");
});
