import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveUberInventoryItemTarget,
  resolveUberInventoryTargets,
  type UberInventoryOptionRow
} from "./uber-inventory-targets.ts";

function row(input: Partial<UberInventoryOptionRow> & Pick<UberInventoryOptionRow, "id" | "groupKey" | "optionKey" | "name">): UberInventoryOptionRow {
  return {
    brandId: "brand",
    externalId: "",
    displayNames: {},
    isAvailable: true,
    ...input
  };
}

test("groups normal and replacement noodles as one physical inventory item", () => {
  const result = resolveUberInventoryTargets("・麺：牛筋麺 50g（4時間水につける）", [
    row({ id: "normal", groupKey: "noodles", optionKey: "beef-noodle", name: "【もちもちつるん】牛筋麺" }),
    row({ id: "replacement", groupKey: "noodle-replacement", optionKey: "replace-beef-noodle", name: "牛筋麺に変更" }),
    row({ id: "other", groupKey: "noodles", optionKey: "harusame", name: "春雨" })
  ]);

  assert.equal(result.inventoryKey, "beef-noodle");
  assert.deepEqual(result.targets.map((target) => target.menuOptionId), ["normal", "replacement"]);
});

test("groups the default wide noodle and the extra wide noodle action", () => {
  const result = resolveUberInventoryTargets("・麺：板春雨 50g", [
    row({ id: "normal", groupKey: "noodles", optionKey: "wide-harusame", name: "もちもち板春雨" }),
    row({ id: "replacement", groupKey: "noodle-replacement", optionKey: "replace-extra-wide-harusame", name: "板春雨追加" }),
    row({ id: "thin", groupKey: "noodles", optionKey: "harusame", name: "春雨" }),
    row({ id: "sweet-potato", groupKey: "noodles", optionKey: "wide-sweet-potato-noodle", name: "さつまいも板春雨" })
  ]);

  assert.equal(result.inventoryKey, "wide-harusame");
  assert.equal(result.targets.length, 2);
});

test("matches a customer-facing topping label directly", () => {
  const result = resolveUberInventoryTargets("香醋", [
    row({ id: "vinegar", groupKey: "toppings", optionKey: "vinegar", name: "香醋" }),
    row({ id: "black-fungus", groupKey: "toppings", optionKey: "black-fungus", name: "黒きくらげ" })
  ]);

  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0]?.menuOptionId, "vinegar");
});

test("matches a catalog item by its localized customer-facing name", () => {
  const result = resolveUberInventoryItemTarget("经典麻辣烫套餐", [{
    id: "item-1",
    brandId: "brand",
    externalId: "uber-123",
    name: "定番マーラータンセット",
    displayNames: { zh: "经典麻辣烫套餐", en: "Classic Malatang Set" },
    isAvailable: true
  }]);

  assert.equal(result.inventoryKey, "item:uber-123");
  assert.deepEqual(result.targets.map((target) => target.menuCatalogItemId), ["item-1"]);
});

test("does not guess when two catalog items have the same display name", () => {
  const result = resolveUberInventoryItemTarget("套餐", [
    { id: "item-1", brandId: "brand", externalId: "1", name: "套餐", displayNames: {}, isAvailable: true },
    { id: "item-2", brandId: "brand", externalId: "2", name: "套餐", displayNames: {}, isAvailable: true }
  ]);

  assert.equal(result.targets.length, 0);
});
