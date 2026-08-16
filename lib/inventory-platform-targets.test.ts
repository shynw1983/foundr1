import assert from "node:assert/strict";
import test from "node:test";

import { projectInventoryTargetsForPlatform } from "./inventory-platform-targets.ts";

function item(label: string) {
  return {
    kind: "item" as const,
    targetId: label,
    menuCatalogItemId: label,
    brandId: "brand",
    inventoryKey: `item:${label}`,
    label,
    aliases: [label],
    isAvailable: true
  };
}

test("excludes a legacy item only from the platform where it is not published", () => {
  const target = item("夏限定・新定番！クセになる冷やし麻辣拌のピリ辛＆濃厚ハーモニー");

  assert.equal(projectInventoryTargetsForPlatform("uber_eats", [target]).length, 0);
  assert.equal(projectInventoryTargetsForPlatform("rocket_now", [target]).length, 1);
  assert.equal(projectInventoryTargetsForPlatform("demae_can", [target]).length, 1);
});

test("excludes an option that is no longer published on Uber", () => {
  const target = item("🦆合鴨あぶりスモーク");

  assert.equal(projectInventoryTargetsForPlatform("uber_eats", [target]).length, 0);
  assert.equal(projectInventoryTargetsForPlatform("rocket_now", [target]).length, 1);
  assert.equal(projectInventoryTargetsForPlatform("demae_can", [target]).length, 1);
});

test("does not map an absent Uber noodle through a shared translation", () => {
  const target = item("さつまいも板春雨50g");

  assert.equal(projectInventoryTargetsForPlatform("uber_eats", [target]).length, 0);
  assert.equal(projectInventoryTargetsForPlatform("rocket_now", [target]).length, 1);
  assert.equal(projectInventoryTargetsForPlatform("demae_can", [target]).length, 1);
});

test("does not map an absent platform bundle onto its single-item ingredient", () => {
  const target = item("🥇山盛りうずら×🔟");

  assert.equal(projectInventoryTargetsForPlatform("demae_can", [target]).length, 0);
  assert.equal(projectInventoryTargetsForPlatform("uber_eats", [target]).length, 1);
  assert.equal(projectInventoryTargetsForPlatform("rocket_now", [target]).length, 0);
});

test("does not map an absent Rocket shrimp product onto a different shrimp row", () => {
  const target = item("大海老1匹");

  assert.equal(projectInventoryTargetsForPlatform("rocket_now", [target]).length, 0);
  assert.equal(projectInventoryTargetsForPlatform("uber_eats", [target]).length, 1);
  assert.equal(projectInventoryTargetsForPlatform("demae_can", [target]).length, 1);
});

test("keeps Rocket variants after they are published", () => {
  const publishedTopping = item("トッポッキ50g");
  const published = item("トッポッキに変更");

  assert.deepEqual(
    projectInventoryTargetsForPlatform("rocket_now", [publishedTopping, published]).map((target) => target.label),
    ["トッポッキ50g", "トッポッキに変更"]
  );
});
