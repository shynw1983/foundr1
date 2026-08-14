import assert from "node:assert/strict";
import test from "node:test";

import { normalizeText, targetNameTiers } from "../src/adapters/common.mjs";

test("normalizes decorative vinegar text used differently by platforms", () => {
  assert.equal(
    normalizeText("【別添容器】香酢👈️超おすすめです🤫"),
    normalizeText("香酢超おすすめです")
  );
});

test("keeps Japanese source variants ahead of shared translated aliases", () => {
  const tiers = targetNameTiers({
    label: "さつまいも板春雨50g",
    aliases: ["红薯宽粉", "Wide Sweet Potato Noodles"]
  });

  assert.deepEqual(tiers.primaryNames, ["さつまいも板春雨50g", "さつまいも板春雨"]);
  assert.deepEqual(tiers.aliasNames, ["红薯宽粉", "Wide Sweet Potato Noodles"]);
});

test("generates safe platform variants without merging noodle categories", () => {
  assert.deepEqual(
    targetNameTiers({ label: "【お一人様1回限り】トウモロコシ麺50gに変更", aliases: [] }).primaryNames,
    ["トウモロコシ麺50gに変更", "トウモロコシ麺に変更"]
  );
  assert.deepEqual(
    targetNameTiers({ label: "冷やしトウモロコシ麺100g", aliases: [] }).primaryNames,
    ["冷やしトウモロコシ麺100g", "冷やしトウモロコシ麺"]
  );
  assert.deepEqual(
    targetNameTiers({ label: "極上の肉麻辣湯", aliases: [] }).primaryNames,
    ["極上の肉麻辣湯", "極上の肉マーラータン"]
  );
});

test("matches platform titles that omit a trailing ingredient description", () => {
  const tiers = targetNameTiers({
    label: "痛風海鮮5種盛り👑（広島県産牡蠣3個、丸ごとホタテ1個、大海老1尾、あさり身約50g、ぶつ切りたこ約50g）",
    aliases: []
  });

  assert.deepEqual(tiers.primaryNames, [
    "痛風海鮮5種盛り(広島県産牡蠣3個、丸ごとホタテ1個、大海老1尾、あさり身約50g、ぶつ切りたこ約50g)",
    "痛風海鮮5種盛り",
    "痛風海鮮5種盛り(広島県産牡蠣3個、丸ごとホタテ1個、大海老1尾、あさり身、ぶつ切りたこ)"
  ]);
});
