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

test("keeps published linked noodle variants while excluding absent Rocket variants", () => {
  const absent = item("トッポッキ50g");
  const published = item("トッポッキに変更");

  assert.deepEqual(
    projectInventoryTargetsForPlatform("rocket_now", [absent, published]).map((target) => target.label),
    ["トッポッキに変更"]
  );
});
