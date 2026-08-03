import assert from "node:assert/strict";
import test from "node:test";
import { resolveUberInventoryTargets, type UberInventoryOptionRow } from "./uber-inventory-targets.ts";

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
