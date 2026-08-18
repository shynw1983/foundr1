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

test("groups normal, replacement, and cold sweet-potato wide noodles", () => {
  const rows = [
    row({ id: "normal", groupKey: "noodles", optionKey: "wide-sweet-potato-noodle", externalId: "wide-sweet-potato-noodle", name: "さつまいも板春雨50g", displayNames: { zh: "红薯宽粉", en: "Wide Sweet Potato Noodles" } }),
    row({ id: "replacement", groupKey: "noodle-replacement", optionKey: "replace-wide-sweet-potato-noodle", externalId: "replace-wide-sweet-potato-noodle", name: "さつまいも板春雨に変更", displayNames: { zh: "更换为红薯宽粉", en: "Wide Sweet Potato Noodles" } }),
    row({ id: "cold", groupKey: "cold-noodles", optionKey: "cold-wide-sweet-potato-noodles", externalId: "cold-wide-sweet-potato-noodles", name: "冷やしさつまいも板春雨100g", displayNames: { zh: "红薯宽粉", en: "Wide Sweet Potato Noodles" } })
  ];

  for (const label of ["さつまいも板春雨50g", "红薯宽粉"]) {
    const result = resolveUberInventoryTargets(label, rows);
    assert.equal(result.inventoryKey, "wide-sweet-potato-noodle");
    assert.deepEqual(result.targets.map((target) => target.menuOptionId), ["normal", "replacement", "cold"]);
  }
});

test("links every consistently keyed noodle surface without a one-off alias", () => {
  const rows = [
    row({ id: "normal", groupKey: "noodles", optionKey: "potato-noodle", externalId: "potato-noodle", name: "じゃがいも麺50g" }),
    row({ id: "replacement", groupKey: "noodle-replacement", optionKey: "replace-potato-noodle", externalId: "replace-potato-noodle", name: "じゃがいも麺に変更" }),
    row({ id: "cold", groupKey: "cold-noodles", optionKey: "cold-potato-noodles", externalId: "cold-potato-noodles", name: "冷やしじゃがいも麺100g" })
  ];

  for (const label of rows.map((item) => item.name)) {
    const result = resolveUberInventoryTargets(label, rows);
    assert.equal(result.inventoryKey, "potato-noodle");
    assert.deepEqual(result.targets.map((target) => target.menuOptionId), ["normal", "replacement", "cold"]);
  }
});

test("groups normal, replacement, and cold hot-pot wide noodles", () => {
  const rows = [
    row({ id: "normal", groupKey: "noodles", optionKey: "hot-pot-wide-noodle", externalId: "hot-pot-wide-noodle", name: "火鍋板春雨", displayNames: { zh: "火锅宽粉" } }),
    row({ id: "replacement", groupKey: "noodle-replacement", optionKey: "replace-hot-pot-wide-noodle", externalId: "replace-hot-pot-wide-noodle", name: "火鍋板春雨に変更", displayNames: { zh: "更换为火锅宽粉" } }),
    row({ id: "cold", groupKey: "cold-noodles", optionKey: "cold-hot-pot-wide-noodles", externalId: "cold-hot-pot-wide-noodles", name: "冷やし火鍋板春雨100g", displayNames: { zh: "火锅宽粉" } })
  ];

  for (const label of ["火鍋板春雨", "火锅宽粉"]) {
    const result = resolveUberInventoryTargets(label, rows);
    assert.equal(result.inventoryKey, "hot-pot-wide-noodle");
    assert.deepEqual(result.targets.map((target) => target.menuOptionId), ["normal", "replacement", "cold"]);
  }
});

test("does not apply noodle prefix linking to unrelated option groups", () => {
  const result = resolveUberInventoryTargets("冷製ソース", [
    row({ id: "normal", groupKey: "sauces", optionKey: "sauce", externalId: "sauce", name: "ソース" }),
    row({ id: "cold", groupKey: "sauces", optionKey: "cold-sauce", externalId: "cold-sauce", name: "冷製ソース" })
  ]);

  assert.equal(result.inventoryKey, "cold-sauce");
  assert.deepEqual(result.targets.map((target) => target.menuOptionId), ["cold"]);
});

test("matches a customer-facing topping label directly", () => {
  const result = resolveUberInventoryTargets("香醋", [
    row({ id: "vinegar", groupKey: "toppings", optionKey: "vinegar", name: "香醋" }),
    row({ id: "black-fungus", groupKey: "toppings", optionKey: "black-fungus", name: "黒きくらげ" })
  ]);

  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0]?.menuOptionId, "vinegar");
});

test("uses an exact Chinese option name before similar yam names", () => {
  const result = resolveUberInventoryTargets("山药粉", [
    row({ id: "yam", groupKey: "noodles", optionKey: "yam-noodle", externalId: "yam-noodle", name: "山芋麺", displayNames: { zh: "山药粉" } }),
    row({ id: "replace-yam", groupKey: "noodle-replacement", optionKey: "replace-yam-noodle", externalId: "replace-yam-noodle", name: "山芋麺に変更", displayNames: { zh: "更换为山药粉" } }),
    row({ id: "yam-sheet", groupKey: "noodles", optionKey: "round-yam-sheet", externalId: "round-yam-sheet", name: "山芋粉皮（丸）", displayNames: { zh: "圆形山药粉皮" } }),
    row({ id: "replace-yam-sheet", groupKey: "noodle-replacement", optionKey: "replace-round-yam-sheet", externalId: "replace-round-yam-sheet", name: "山芋粉皮（丸）に変更", displayNames: { zh: "更换为圆形山药粉皮" } })
  ]);

  assert.equal(result.inventoryKey, "yam-noodle");
  assert.deepEqual(result.targets.map((target) => target.menuOptionId), ["yam", "replace-yam"]);
  assert.equal(result.targets[0]?.label, "山芋麺");
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
