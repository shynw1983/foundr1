import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDemaeNoodleGroups } from "../src/demae-menu-rules.mjs";

const group = (optionGroupCode, dispOrder, optionGroupName = optionGroupCode) => ({
  chainId: 410649,
  optionGroupCode,
  optionGroupName,
  dispOrder
});

test("uses replacement noodles directly after seasoning for every hot set", () => {
  const result = normalizeDemaeNoodleGroups("a0a10004", [
    group("a001", 1), group("a002", 2), group("a003", 3), group("a004", 4),
    group("a013", 5), group("a014", 6), group("a011", 9, "🍜麺の種類を選ぶ")
  ]);
  assert.deepEqual(result.map(({ optionGroupCode, dispOrder }) => [optionGroupCode, dispOrder]), [
    ["a001", 1], ["a002", 2], ["a003", 3], ["a004", 4], ["0009", 5], ["a013", 6], ["a014", 7]
  ]);
});

test("uses cold noodles directly after seasoning for both cold sets", () => {
  const result = normalizeDemaeNoodleGroups("00000003", [
    group("a002", 1), group("a003", 2), group("a004", 3),
    group("a013", 4), group("0004", 11), group("0005", 12)
  ]);
  assert.deepEqual(result.map(({ optionGroupCode, dispOrder }) => [optionGroupCode, dispOrder]), [
    ["a002", 1], ["a003", 2], ["a004", 3], ["0004", 4], ["a013", 5], ["0005", 6]
  ]);
});

test("keeps select-noodle semantics for ordinary soup bases", () => {
  const result = normalizeDemaeNoodleGroups("00000001", [
    group("a002", 1), group("a003", 2), group("a004", 3), group("a011", 4), group("a013", 5)
  ]);
  assert.deepEqual(result.map(({ optionGroupCode, dispOrder }) => [optionGroupCode, dispOrder]), [
    ["a002", 1], ["a003", 2], ["a004", 3], ["a011", 4], ["a013", 5]
  ]);
});
