import assert from "node:assert/strict";
import test from "node:test";

import { normalizeText, targetNameTiers } from "../src/adapters/common.mjs";
import { withPlatformTargetAliases } from "../src/adapters/platform-target-aliases.mjs";
import { uniqueLocatedRows } from "../src/adapters/rocket-now.mjs";
import { preferCurrentUberMatches, uberItemDetailMatches } from "../src/adapters/uber-eats.mjs";

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
  assert.deepEqual(tiers.exactNames, ["さつまいも板春雨50g"]);
  assert.deepEqual(tiers.fallbackNames, ["さつまいも板春雨"]);
  assert.deepEqual(tiers.aliasNames, ["红薯宽粉", "Wide Sweet Potato Noodles"]);
});

test("keeps an exact weighted noodle name ahead of a legacy weightless title", () => {
  const tiers = targetNameTiers({
    label: "トウモロコシ麺50g",
    aliases: ["玉米面", "Corn Noodles"]
  });

  assert.deepEqual(tiers.exactNames, ["トウモロコシ麺50g"]);
  assert.deepEqual(tiers.fallbackNames, ["トウモロコシ麺"]);
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

test("deduplicates Rocket targets that resolve to the same inventory row", () => {
  const sharedMatch = { checkboxId: "row-soybean", hidden: false };
  const uniqueMatch = { checkboxId: "row-replacement", hidden: false };
  const result = uniqueLocatedRows([
    { label: "小大豆もやし50g", matches: [sharedMatch] },
    { label: "【大分県産】小大豆もやし", matches: [sharedMatch] },
    { label: "小大豆もやしに変更", matches: [uniqueMatch] }
  ]);

  assert.deepEqual(result.map((item) => item.label), ["小大豆もやし50g", "小大豆もやしに変更"]);
});

test("expands a logical Rocket match to every physical inventory row", () => {
  const first = { checkboxId: "row-1", hidden: false };
  const second = { checkboxId: "row-2", hidden: false };
  const result = uniqueLocatedRows([{
    label: "濃厚旨辛スンドゥブスープ",
    matches: [{ ...first, rowMatches: [first, second] }]
  }]);

  assert.deepEqual(result.map((item) => item.matches[0].checkboxId), ["row-1", "row-2"]);
});

test("adds Rocket aliases from the current published menu", () => {
  const projected = withPlatformTargetAliases("rocket_now", {
    label: "極上の肉麻辣湯",
    aliases: ["Premium Meat Malatang"]
  });

  assert.deepEqual(projected.aliases, [
    "Premium Meat Malatang",
    "厳選霜降り黒毛和牛 極上の肉麻辣湯"
  ]);
});

test("adds Rocket-safe aliases for published option names", () => {
  const projected = withPlatformTargetAliases("rocket_now", {
    label: "【旨味が爆発💥】ぶつ切りたこ🐙（約50g）",
    aliases: []
  });

  assert.deepEqual(projected.aliases, ["【旨味が爆発】ぶつ切りたこ約50g"]);
});

test("prefers the current Uber menu record over a legacy duplicate", () => {
  const current = {
    href: "current",
    price: 488,
    hasSchedule: true,
    hasCustomization: true,
    decorated: true
  };
  const legacy = {
    href: "legacy",
    price: 0,
    hasSchedule: false,
    hasCustomization: false,
    decorated: false
  };

  assert.deepEqual(preferCurrentUberMatches([legacy, current]), [current]);
});

test("waits for the expected Uber item identity before trusting its sold-out state", () => {
  const item = {
    label: "【おすすめ❗️】もちもち板春雨50g",
    names: ["もちもち板春雨50g"],
    matches: [{ href: "https://merchants.ubereats.com/manager/menumaker/store/items/wide-noodle" }]
  };

  assert.equal(uberItemDetailMatches(item, {
    found: true,
    url: "https://merchants.ubereats.com/manager/menumaker/store/items/previous-item",
    itemName: "前の商品"
  }), false);
  assert.equal(uberItemDetailMatches(item, {
    found: true,
    url: "https://merchants.ubereats.com/manager/menumaker/store/items/wide-noodle",
    itemName: "さつまいも板春雨50g｜红薯宽粉｜Wide Sweet Potato Noodles"
  }), false);
  assert.equal(uberItemDetailMatches(item, {
    found: true,
    url: "https://merchants.ubereats.com/manager/menumaker/store/items/wide-noodle",
    itemName: "【おすすめ❗️】もちもち板春雨50g｜宽粉｜Wide Sweet Potato Noodles"
  }), true);
});
