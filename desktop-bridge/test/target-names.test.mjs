import assert from "node:assert/strict";
import test from "node:test";

import { normalizeText, targetNameTiers, tieredTargetCandidates } from "../src/adapters/common.mjs";
import { withPlatformTargetAliases } from "../src/adapters/platform-target-aliases.mjs";
import { rocketInventoryUrl, uniqueLocatedRows } from "../src/adapters/rocket-now.mjs";
import {
  parseUberSoldOutDuration,
  preferCurrentUberMatches,
  projectUberInventoryAudit,
  projectUberMenuSnapshot,
  uberTargetNameTiers,
  uberItemDetailMatches
} from "../src/adapters/uber-eats.mjs";

test("normalizes decorative vinegar text used differently by platforms", () => {
  assert.equal(
    normalizeText("【別添容器】香酢👈️超おすすめです🤫"),
    normalizeText("香酢超おすすめです")
  );
});

test("opens Rocket inventory directly on the configured merchant store", () => {
  assert.equal(
    rocketInventoryUrl("118575", "option"),
    "https://store.rocketnow.co.jp/merchant/management/oos/118575/option"
  );
  assert.equal(
    rocketInventoryUrl("118575", "item"),
    "https://store.rocketnow.co.jp/merchant/management/oos/118575/menu"
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

test("requires the republished sweet-potato wide noodle to match its full Uber name", () => {
  const tiers = uberTargetNameTiers({
    label: "さつまいも板春雨50g",
    aliases: ["红薯宽粉", "Wide Sweet Potato Noodles"]
  });

  assert.deepEqual(tiers.exactNames, ["さつまいも板春雨50g"]);
  assert.deepEqual(tiers.primaryNames, ["さつまいも板春雨50g"]);
  assert.deepEqual(tiers.fallbackNames, []);
  assert.deepEqual(tiers.aliasNames, []);
});

test("keeps an exact weighted noodle name ahead of a legacy weightless title", () => {
  const tiers = targetNameTiers({
    label: "トウモロコシ麺50g",
    aliases: ["玉米面", "Corn Noodles"]
  });

  assert.deepEqual(tiers.exactNames, ["トウモロコシ麺50g"]);
  assert.deepEqual(tiers.fallbackNames, ["トウモロコシ麺"]);
});

test("prefers a Japanese exact name over duplicated multilingual aliases", () => {
  const rows = [
    {
      targetId: "regular-corn",
      normalizedExactNames: ["トウモロコシ麺50g"],
      normalizedFallbackNames: ["トウモロコシ麺"],
      normalizedAliasNames: ["玉米面", "옥수수면", "Corn Noodles"]
    },
    {
      targetId: "cold-corn",
      normalizedExactNames: ["冷やしトウモロコシ麺100g"],
      normalizedFallbackNames: ["冷やしトウモロコシ麺"],
      normalizedAliasNames: ["玉米面", "옥수수면", "Corn Noodles"]
    }
  ];
  const result = tieredTargetCandidates(rows, ["トウモロコシ麺50g", "玉米面", "옥수수면", "Corn Noodles"]);
  assert.equal(result.matchBasis, "exact_name");
  assert.deepEqual(result.candidates.map((candidate) => candidate.targetId), ["regular-corn"]);
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

test("does not reuse Demae's single quail egg for the absent ten-egg bundle", () => {
  const projected = withPlatformTargetAliases("demae_can", {
    label: "🥇山盛りうずら×🔟",
    aliases: []
  });

  assert.deepEqual(projected.aliases, []);
});

test("does not reuse Rocket rows for absent logical products", () => {
  const quail = withPlatformTargetAliases("rocket_now", { label: "🥇山盛りうずら×🔟", aliases: [] });
  const shrimp = withPlatformTargetAliases("rocket_now", { label: "大海老1匹", aliases: [] });
  assert.equal(quail.aliases.includes("うずらの卵1個"), false);
  assert.equal(shrimp.aliases.includes("むき海老 大"), false);
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

test("normalizes Uber sold-out duration labels before permanent-state verification", () => {
  assert.equal(parseUberSoldOutDuration("Selected 期限を設定しない."), "期限を設定しない");
  assert.equal(parseUberSoldOutDuration("Selected 期限を設定しない..  "), "期限を設定しない");
  assert.equal(parseUberSoldOutDuration("Selected 本日。"), "本日");
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

test("captures the current Uber menu graph and keeps availability separate from publication", () => {
  const currentProductId = "current-product";
  const currentOptionId = "current-option";
  const snapshot = projectUberMenuSnapshot({
    data: {
      menuMapping: [{ menuType: "MENU_TYPE_FULFILLMENT_DELIVERY", menuUUID: "delivery-menu" }],
      menus: {
        "delivery-menu": {
          subsectionsMap: {
            category: { uuid: "category", displayItems: [{ uuid: currentProductId }] }
          },
          entities: {
            customizationsMap: {
              group: { uuid: "group", options: [{ uuid: currentOptionId }] }
            },
            itemsMap: {
              [currentProductId]: {
                itemInfo: { title: { defaultValue: "商品｜Product" } },
                paymentInfo: { priceInfo: { defaultValue: { price: { low: 41500, high: 0 } } } },
                suspensionInfo: { defaultValue: { suspendUntilMilliseconds: "2026-08-22T00:00:00.000Z" } }
              },
              [currentOptionId]: {
                itemInfo: { title: { defaultValue: "選択肢｜Option" } },
                paymentInfo: { priceInfo: { defaultValue: { price: { low: 15000, high: 0 } } } }
              },
              orphan: {
                itemInfo: { title: { defaultValue: "旧商品" } },
                paymentInfo: { priceInfo: { defaultValue: { price: { low: 0, high: 0 } } } }
              }
            }
          }
        }
      }
    }
  }, [
    {
      kind: "item",
      targetId: "os-product",
      label: "商品",
      knownExternalIds: [currentProductId],
      exactNames: ["商品"],
      fallbackNames: [],
      aliasNames: []
    },
    {
      kind: "option",
      targetId: "os-option",
      label: "選択肢",
      knownExternalIds: [currentOptionId],
      exactNames: ["選択肢"],
      fallbackNames: [],
      aliasNames: []
    }
  ], Date.parse("2026-08-21T00:00:00.000Z"));

  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.options.length, 1);
  assert.equal(snapshot.items[0].price, 415);
  assert.equal(snapshot.items[0].isActive, true);
  assert.equal(snapshot.items[0].metadata.isAvailable, false);
  assert.equal(snapshot.options[0].metadata.isAvailable, true);
  assert.equal([...snapshot.items, ...snapshot.options].some((entry) => entry.externalId === "orphan"), false);
});

test("matches same-named Uber products and options within their own kinds", () => {
  const snapshot = projectUberMenuSnapshot({
    data: {
      menuMapping: [{ menuType: "MENU_TYPE_FULFILLMENT_DELIVERY", menuUUID: "delivery-menu" }],
      menus: {
        "delivery-menu": {
          subsectionsMap: {
            category: { uuid: "category", displayItems: [{ uuid: "product" }] }
          },
          entities: {
            customizationsMap: {
              group: { uuid: "group", options: [{ uuid: "option" }] }
            },
            itemsMap: {
              product: { itemInfo: { title: { defaultValue: "旨味マーラータンスープ" } } },
              option: { itemInfo: { title: { defaultValue: "旨味マーラータンスープ" } } }
            }
          }
        }
      }
    }
  }, [{
    kind: "item",
    targetId: "os-product",
    label: "旨味マーラータンスープ",
    knownExternalIds: [],
    exactNames: ["旨味マーラータンスープ"],
    fallbackNames: [],
    aliasNames: []
  }, {
    kind: "option",
    targetId: "os-option",
    label: "旨味マーラータンスープ",
    knownExternalIds: [],
    exactNames: ["旨味マーラータンスープ"],
    fallbackNames: [],
    aliasNames: []
  }]);

  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.items[0].targetId, "os-product");
  assert.equal(snapshot.options[0].targetId, "os-option");
});

test("converts an Uber menu snapshot into a read-only inventory audit", () => {
  const audit = projectUberInventoryAudit({
    items: [{
      targetId: "os-product",
      observedKind: "item",
      metadata: { isAvailable: false }
    }],
    options: [{
      targetId: "os-option",
      observedKind: "option",
      metadata: { isAvailable: true }
    }, {
      targetId: "",
      observedKind: "option",
      metadata: { isAvailable: false }
    }]
  }, 3);

  assert.deepEqual(audit, {
    outcome: "audited",
    targetCount: 3,
    items: [{
      kind: "item",
      targetId: "os-product",
      isAvailable: false,
      found: true,
      status: "sold_out"
    }, {
      kind: "option",
      targetId: "os-option",
      isAvailable: true,
      found: true,
      status: "available"
    }]
  });
});
