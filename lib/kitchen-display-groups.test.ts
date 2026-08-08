import assert from "node:assert/strict";
import test from "node:test";

import { buildKitchenDisplayItemGroups } from "./kitchen-display-groups.ts";

test("keeps production ingredients attached to their ordered套餐", () => {
  const groups = buildKitchenDisplayItemGroups([
    {
      itemName: "豚肉マーラータン",
      quantity: 1,
      toppingLabels: ["結びゆば1個", "白きくらげ", "白身魚"]
    },
    {
      itemName: "牛肉マーラータン",
      quantity: 1,
      toppingLabels: ["うずらの卵1個", "ブンモジャ1本"]
    }
  ], [
    "豚肉マーラータン x1",
    "・具材：結びゆば 1個",
    "・具材：白きくらげ",
    "・具材：白身魚",
    "牛肉マーラータン x1",
    "・具材：うずらの卵 1個",
    "・具材：ブンモジャ 1本"
  ].join("\n"));

  assert.deepEqual(groups[0].productionLines, [
    "・具材：結びゆば 1個",
    "・具材：白きくらげ",
    "・具材：白身魚"
  ]);
  assert.deepEqual(groups[1].productionLines, [
    "・具材：うずらの卵 1個",
    "・具材：ブンモジャ 1本"
  ]);
});

test("counts repeated customer labels within one套餐 without renaming them", () => {
  const groups = buildKitchenDisplayItemGroups([
    {
      itemName: "麻辣湯",
      quantity: 1,
      toppingLabels: ["牛筋麺", "牛筋麺", "うずらの卵", "うずらの卵"]
    }
  ], "麻辣湯 x1\n・麺：牛筋麺 50g x2\n・具材：うずらの卵 1個 x2");

  assert.deepEqual(groups[0].options, [
    { label: "牛筋麺", count: 2, amount: 0 },
    { label: "うずらの卵", count: 2, amount: 0 }
  ]);
});

test("keeps item amounts and sums repeated option amounts", () => {
  const groups = buildKitchenDisplayItemGroups([{
    itemName: "麻辣湯",
    quantity: 2,
    itemAmount: 830,
    toppingLabels: ["粉耗子", "粉耗子", "微麻"],
    toppingAmounts: [452, 452, 0]
  }], "麻辣湯 x2");

  assert.equal(groups[0].amount, 830);
  assert.deepEqual(groups[0].options, [
    { label: "粉耗子", count: 2, amount: 904 },
    { label: "微麻", count: 1, amount: 0 }
  ]);
});
