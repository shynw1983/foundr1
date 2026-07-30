import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultMaamaaProductionReferenceSettings,
  localizeMaamaaProductionSummary
} from "./maamaa-production-rules.ts";
import { buildMaamaaProductionItemLines } from "./maamaa-production-summary.ts";

test("adds the common set ingredients to a maamaa set menu", () => {
  const lines = buildMaamaaProductionItemLines({
    itemName: "【超人気】豚肉マーラータン",
    quantity: 1,
    toppingLabels: []
  }, defaultMaamaaProductionReferenceSettings);

  assert.ok(lines.some((line) => line.includes("板春雨 50g")));
  assert.ok(lines.some((line) => line.includes("セット青菜")));
  assert.ok(lines.some((line) => line.includes("セット根菜")));
  assert.ok(lines.some((line) => line.includes("セットきのこ")));
  assert.ok(lines.some((line) => line.includes("黒キクラゲ")));
});

test("merges an added wood ear with the set default", () => {
  const lines = buildMaamaaProductionItemLines({
    itemName: "牛肉マーラータン",
    quantity: 1,
    toppingLabels: ["黒キクラゲ"]
  }, defaultMaamaaProductionReferenceSettings);

  assert.equal(lines.filter((line) => line.includes("黒キクラゲ")).length, 1);
  assert.ok(lines.some((line) => /黒キクラゲ .*x2/.test(line)));
});

test("keeps one default wide noodle, adds extras, and removes it on replacement", () => {
  const defaultLines = buildMaamaaProductionItemLines({
    itemName: "牛肉マーラータン",
    quantity: 1,
    toppingLabels: ["もちもち板春雨"]
  }, defaultMaamaaProductionReferenceSettings);
  assert.ok(defaultLines.some((line) => line.includes("板春雨 50g") && !line.includes("x2")));

  const extraLines = buildMaamaaProductionItemLines({
    itemName: "牛肉マーラータン",
    quantity: 1,
    toppingLabels: ["板春雨追加"]
  }, defaultMaamaaProductionReferenceSettings);
  assert.ok(extraLines.some((line) => /板春雨 50g x2/.test(line)));

  const replacementLines = buildMaamaaProductionItemLines({
    itemName: "牛肉マーラータン",
    quantity: 1,
    toppingLabels: ["牛筋麺"]
  }, defaultMaamaaProductionReferenceSettings);
  assert.ok(replacementLines.some((line) => line.includes("牛筋麺 50g")));
  assert.ok(replacementLines.every((line) => !line.includes("板春雨 50g")));
});

test("localizes the common set groups for the Chinese kitchen display", () => {
  const localized = localizeMaamaaProductionSummary([
    "・麺：平太春雨 50g",
    "・具材：セット青菜",
    "・具材：セット根菜",
    "・具材：セットきのこ"
  ].join("\n"), {}, "zh");

  assert.match(localized, /宽粉 50g/);
  assert.match(localized, /套餐青菜/);
  assert.match(localized, /套餐根菜/);
  assert.match(localized, /套餐菌菇/);
});
