import assert from "node:assert/strict";
import test from "node:test";

import {
  dependentSetRuleNames,
  inventoryDependencyMatches
} from "./inventory-dependency-rules.ts";
import type { MaamaaProductionReferenceSettings } from "./maamaa-production-rules.ts";

const settings: MaamaaProductionReferenceSettings = {
  productionRules: [],
  seasoningRules: [],
  setRules: [
    { name: "セットメニュー共通", defaultItems: ["板春雨50g"], items: [{ productName: "板春雨50g", affectsAvailability: true }] },
    { name: "牛肉マーラータン", defaultItems: ["牛肉80g", "青梗菜30g"], items: [{ productName: "牛肉80g", affectsAvailability: true }] },
    { name: "ラムマーラータン", defaultItems: ["ラム肉80g", "青梗菜30g"], items: [{ productName: "ラム肉80g", affectsAvailability: true }] },
    { name: "野菜マーラータン", defaultItems: ["青梗菜30g"], items: [{ productName: "青梗菜30g", affectsAvailability: false }] }
  ]
};

test("matches weighted variants as one physical ingredient", () => {
  assert.equal(inventoryDependencyMatches("牛肉スライス 50g", "牛肉80g"), true);
  assert.equal(inventoryDependencyMatches("牛肉丸1个", "牛肉80g"), false);
  assert.equal(inventoryDependencyMatches("羊肉麻辣烫", "ラムマーラータン"), true);
});

test("links a missing meat only to the set that requires it", () => {
  assert.deepEqual(dependentSetRuleNames("牛肉スライス 50g", settings), ["牛肉マーラータン"]);
  assert.deepEqual(dependentSetRuleNames("羊肉", settings), ["ラムマーラータン"]);
});

test("links a missing common set ingredient to every set", () => {
  assert.deepEqual(dependentSetRuleNames("板春雨 50g", settings), [
    "牛肉マーラータン",
    "ラムマーラータン",
    "野菜マーラータン"
  ]);
});

test("allows a procedure item to opt out of sales availability linking", () => {
  const customized: MaamaaProductionReferenceSettings = {
    ...settings,
    setRules: settings.setRules.map((rule) => rule.name === "牛肉マーラータン"
      ? { ...rule, items: [{ productName: "牛肉80g", affectsAvailability: false }] }
      : rule)
  };
  assert.deepEqual(dependentSetRuleNames("牛肉スライス 50g", customized), []);
});

test("does not infer availability linking from legacy recipe text", () => {
  const legacy: MaamaaProductionReferenceSettings = {
    ...settings,
    setRules: [{ name: "牛肉マーラータン", defaultItems: ["牛肉80g"] }]
  };
  assert.deepEqual(dependentSetRuleNames("牛肉スライス 50g", legacy), []);
});
