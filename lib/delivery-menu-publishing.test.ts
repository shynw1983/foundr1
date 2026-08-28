import assert from "node:assert/strict";
import test from "node:test";
import { buildDeliveryMenuPublishPreview, projectDeliveryName, projectDeliveryPrice, projectNewHighTierPrice } from "./delivery-menu-publishing.ts";

test("projects names according to each delivery platform rule", () => {
  const displayNames = { zh: "玉米面", ko: "옥수수면", en: "Corn noodles" };
  assert.equal(projectDeliveryName("uber_eats", "トウモロコシ麺", displayNames), "トウモロコシ麺｜玉米面｜옥수수면｜Corn noodles");
  assert.equal(projectDeliveryName("rocket_now", "トウモロコシ麺", displayNames), "トウモロコシ麺");
  assert.equal(projectDeliveryName("demae_can", "トウモロコシ麺", displayNames), "トウモロコシ麺｜玉米面｜옥수수면｜Corn noodles");
});

test("uses the provisional high-tier price rule for new prices", () => {
  assert.equal(projectNewHighTierPrice(330), 413);
  assert.equal(projectNewHighTierPrice(1780), 2225);
});

test("applies platform emoji and price rules with per-target overrides", () => {
  assert.equal(projectDeliveryName("uber_eats", "おすすめ🔥", { zh: "推荐🔥", ko: "추천🔥", en: "Recommended 🔥" }), "おすすめ🔥｜推荐🔥｜추천🔥｜Recommended 🔥");
  assert.equal(projectDeliveryName("rocket_now", "おすすめ🔥", {}), "おすすめ");
  assert.equal(projectDeliveryName("demae_can", "おすすめ🔥", { zh: "推荐🔥", ko: "추천🔥", en: "Recommended 🔥" }), "おすすめ｜推荐｜추천｜Recommended");
  assert.equal(projectDeliveryName("rocket_now", "おすすめ🔥", {}, { emojiMode: "show" }), "おすすめ🔥");
  assert.equal(projectDeliveryPrice("uber_eats", 170), 213);
  assert.equal(projectDeliveryPrice("uber_eats", 170, { priceOverride: 216 }), 216);
  assert.equal(projectDeliveryPrice("demae_can", 170), 170);
});

test("keeps the authoritative Uber delivery price when projecting to Rocket", () => {
  const preview = buildDeliveryMenuPublishPreview({
    items: [],
    options: [{
      id: "fish-roll",
      groupKey: "standard",
      groupLabel: "ベーシックトッピング",
      optionKey: "fish-roll",
      name: "チーズ入りフィッシュロール",
      displayNames: {},
      priceDelta: 170,
      isActive: true,
      platformSettings: {
        uber_eats: { isEnabled: true, priceOverride: 216 },
        rocket_now: { isEnabled: true }
      }
    }],
    platformBaselines: {
      rocket_now: {
        capturedAt: "2026-08-22",
        items: [],
        options: [{
          targetId: "fish-roll",
          externalId: "rocket-fish-roll",
          groupKey: "standard",
          optionKey: "fish-roll",
          name: "チーズ入りフィッシュロール",
          price: 213,
          sourceBasePrice: 170,
          isActive: true
        }]
      },
      demae_can: {
        capturedAt: "2026-08-22",
        items: [],
        options: [{
          targetId: "fish-roll",
          externalId: "demae-fish-roll",
          groupKey: "standard",
          optionKey: "fish-roll",
          name: "チーズ入りフィッシュロール",
          price: 170,
          sourceBasePrice: 170,
          isActive: true
        }]
      }
    }
  });
  const rocket = preview.platforms.find((platform) => platform.platformKey === "rocket_now");
  const demae = preview.platforms.find((platform) => platform.platformKey === "demae_can");
  const rocketPriceChange = rocket?.changes.find((change) => change.targetId === "fish-roll" && change.kind === "reprice");
  assert.equal(rocketPriceChange?.projectedState?.price, 216);
  assert.equal(rocketPriceChange?.projectedValue, "¥216");
  assert.equal(rocketPriceChange?.confidence, "confirmed");
  assert.equal(demae?.changes.some((change) => change.targetId === "fish-roll" && change.kind === "reprice"), false);
});

test("keeps the shared Uber price ahead of an old Rocket price override", () => {
  const preview = buildDeliveryMenuPublishPreview({
    items: [{
      id: "custom-price",
      externalId: "custom-price",
      name: "個別価格商品",
      displayNames: {},
      basePrice: 170,
      isActive: true,
      platformSettings: {
        uber_eats: { isEnabled: true, priceOverride: 216 },
        rocket_now: { isEnabled: true, priceOverride: 220 }
      }
    }],
    options: [],
    platformBaselines: {
      rocket_now: {
        capturedAt: "2026-08-22",
        items: [{ targetId: "custom-price", externalId: "rocket-custom", name: "個別価格商品", price: 220, sourceBasePrice: 170, isActive: true }],
        options: []
      }
    }
  });
  const rocket = preview.platforms.find((platform) => platform.platformKey === "rocket_now");
  const priceChange = rocket?.changes.find((change) => change.targetId === "custom-price" && change.kind === "reprice");
  assert.equal(priceChange?.projectedValue, "¥216");
});

test("keeps an adopted platform name exact instead of appending translations again", () => {
  assert.equal(projectDeliveryName(
    "uber_eats",
    "トウモロコシ麺",
    { zh: "玉米面", ko: "옥수수면", en: "Corn noodles" },
    { nameOverride: "プラットフォームで直接編集した名称｜Custom name", placementConfig: { useExactNameOverride: true } }
  ), "プラットフォームで直接編集した名称｜Custom name");
});

test("reports Uber name and direct price differences without mutating platform data", () => {
  const preview = buildDeliveryMenuPublishPreview({
    items: [{ id: "1", externalId: "corn", name: "トウモロコシ麺", displayNames: { zh: "玉米面", ko: "옥수수면", en: "Corn noodles" }, basePrice: 170, isActive: true }],
    options: [],
    uberBaselineItems: [{ websiteId: "corn", name: "旧名称", uberPrice: 216 }],
    uberBaselineOptions: [],
    uberBaselineCapturedAt: "2026-08-11"
  });
  const uber = preview.platforms.find((platform) => platform.platformKey === "uber_eats");
  assert.equal(preview.mode, "read_only");
  assert.equal(uber?.baselineStatus, "ready");
  assert.equal(uber?.changes.some((change) => change.kind === "rename" && change.confidence === "confirmed"), true);
  assert.equal(uber?.changes.some((change) => change.kind === "reprice"), true);
});

test("ignores invisible whitespace differences in multilingual platform names", () => {
  const preview = buildDeliveryMenuPublishPreview({
    items: [{
      id: "hellfire",
      externalId: "hellfire",
      name: "地獄の業火",
      displayNames: { zh: "地狱业火", ko: "지옥의 업화", en: "Infernal Hellfire" },
      basePrice: 800,
      isActive: true
    }],
    options: [],
    platformBaselines: {
      uber_eats: {
        capturedAt: "2026-08-20",
        items: [{
          targetId: "hellfire",
          externalId: "hellfire",
          name: "地獄の業火｜ 地狱业火 ｜지옥의 업화  ｜Infernal  Hellfire ",
          price: 1000,
          sourceBasePrice: 800,
          isActive: true
        }],
        options: []
      }
    }
  });
  const uber = preview.platforms.find((platform) => platform.platformKey === "uber_eats");
  assert.equal(uber?.changes.some((change) => change.kind === "rename"), false);
});

test("still reports meaningful multilingual name differences", () => {
  const preview = buildDeliveryMenuPublishPreview({
    items: [{
      id: "hellfire",
      externalId: "hellfire",
      name: "地獄の業火",
      displayNames: { zh: "地狱业火", ko: "지옥의 업화", en: "Infernal Hellfire" },
      basePrice: 800,
      isActive: true
    }],
    options: [],
    platformBaselines: {
      uber_eats: {
        capturedAt: "2026-08-20",
        items: [{
          targetId: "hellfire",
          externalId: "hellfire",
          name: "地獄の業火｜地狱业火｜지옥의 불꽃｜Infernal Hellfire",
          price: 1000,
          sourceBasePrice: 800,
          isActive: true
        }],
        options: []
      }
    }
  });
  const uber = preview.platforms.find((platform) => platform.platformKey === "uber_eats");
  assert.equal(uber?.changes.some((change) => change.kind === "rename"), true);
});

test("compares all platform baselines and protects destructive changes", () => {
  const preview = buildDeliveryMenuPublishPreview({
    items: [{ id: "1", externalId: "corn", name: "トウモロコシ麺", displayNames: { zh: "玉米面", ko: "옥수수면", en: "Corn noodles" }, basePrice: 170, isActive: true }],
    options: [],
    platformBaselines: {
      rocket_now: {
        capturedAt: "2026-08-18",
        items: [
          { targetId: "1", externalId: "rocket-corn", name: "旧トウモロコシ麺", price: 216, sourceBasePrice: 170, isActive: true },
          { externalId: "orphan", name: "旧商品", price: 100, isActive: true }
        ],
        options: []
      }
    }
  });
  const rocket = preview.platforms.find((platform) => platform.platformKey === "rocket_now");
  assert.equal(rocket?.baselineStatus, "ready");
  assert.equal(rocket?.changes.some((change) => change.kind === "rename" && change.targetId === "1"), true);
  const orphan = rocket?.changes.find((change) => change.kind === "delete" && change.requiresExplicitConfirmation);
  assert.equal(orphan?.currentState?.externalId, "orphan");
});

test("blocks publication when a captured baseline has unmatched targets", () => {
  const preview = buildDeliveryMenuPublishPreview({
    items: [{ id: "1", externalId: "corn", name: "トウモロコシ麺", displayNames: {}, basePrice: 170, isActive: true }],
    options: [],
    platformBaselines: {
      rocket_now: {
        capturedAt: "2026-08-18",
        items: [],
        options: [],
        complete: false,
        missingTargets: ["トウモロコシ麺"]
      }
    }
  });
  const rocket = preview.platforms.find((platform) => platform.platformKey === "rocket_now");
  assert.equal(rocket?.baselineStatus, "missing");
  assert.equal(rocket?.blockers.some((blocker) => blocker.includes("1件")), true);
  assert.equal(rocket?.reconciliationIssues.length, 1);
  assert.equal(rocket?.changes.some((change) => change.kind === "create"), false);
});

test("turns an unconfirmed create diff into an actionable reconciliation issue", () => {
  const preview = buildDeliveryMenuPublishPreview({
    items: [],
    options: [{
      id: "new-fish-tofu",
      groupKey: "standard",
      groupLabel: "ベーシックトッピング",
      optionKey: "new-fish-tofu",
      name: "【NEW】魚豆腐",
      displayNames: {},
      priceDelta: 170,
      isActive: true
    }],
    platformBaselines: {
      rocket_now: {
        capturedAt: "2026-08-22",
        items: [],
        options: [],
        complete: true,
        missingTargets: []
      }
    }
  });
  const rocket = preview.platforms.find((platform) => platform.platformKey === "rocket_now");
  assert.equal(rocket?.baselineStatus, "missing");
  assert.equal(rocket?.reconciliationIssues.length, 1);
  assert.equal(rocket?.reconciliationIssues[0]?.targetLabel, "【NEW】魚豆腐");
  assert.equal(rocket?.reconciliationIssues[0]?.locationLabel, "選択グループ: ベーシックトッピング");
  assert.equal(rocket?.changes.some((change) => change.kind === "create"), false);
});

test("treats a confirmed platform creation as a resolved baseline target", () => {
  const preview = buildDeliveryMenuPublishPreview({
    items: [{
      id: "1",
      externalId: "corn",
      name: "トウモロコシ麺",
      displayNames: {},
      basePrice: 170,
      isActive: true,
      platformSettings: {
        rocket_now: { isEnabled: true, placementConfig: { confirmedPlatformCreate: true } }
      }
    }],
    options: [],
    platformBaselines: {
      rocket_now: {
        capturedAt: "2026-08-21",
        items: [],
        options: [],
        complete: false,
        missingTargets: ["トウモロコシ麺"]
      },
      demae_can: {
        capturedAt: "2026-08-21",
        items: [],
        options: [],
        complete: false,
        missingTargets: ["トウモロコシ麺"]
      }
    }
  });
  const rocket = preview.platforms.find((platform) => platform.platformKey === "rocket_now");
  const demae = preview.platforms.find((platform) => platform.platformKey === "demae_can");
  assert.equal(rocket?.baselineStatus, "confirmed");
  assert.equal(rocket?.reconciliationIssues.length, 0);
  assert.equal(rocket?.blockers.some((blocker) => blocker.includes("基準取込")), false);
  assert.equal(rocket?.changes.some((change) => change.kind === "create" && change.confidence === "confirmed"), true);
  assert.equal(demae?.baselineStatus, "missing");
  assert.equal(demae?.reconciliationIssues.length, 1);
});

test("keeps a confirmed create confirmed while other targets still need reconciliation", () => {
  const preview = buildDeliveryMenuPublishPreview({
    items: [],
    options: [
      {
        id: "confirmed-fish-tofu",
        groupKey: "standard",
        groupLabel: "ベーシックトッピング",
        optionKey: "confirmed-fish-tofu",
        name: "【NEW】魚豆腐",
        displayNames: {},
        priceDelta: 170,
        isActive: true,
        platformSettings: {
          rocket_now: { isEnabled: true, placementConfig: { confirmedPlatformCreate: true } }
        }
      },
      {
        id: "unresolved-pouch",
        groupKey: "standard",
        groupLabel: "ベーシックトッピング",
        optionKey: "unresolved-pouch",
        name: "【NEW】魚卵入り巾着",
        displayNames: {},
        priceDelta: 340,
        isActive: true
      }
    ],
    platformBaselines: {
      rocket_now: {
        capturedAt: "2026-08-22",
        items: [],
        options: [],
        complete: false,
        missingTargets: ["【NEW】魚卵入り巾着"]
      }
    }
  });
  const rocket = preview.platforms.find((platform) => platform.platformKey === "rocket_now");
  const confirmedCreate = rocket?.changes.find((change) => change.targetId === "confirmed-fish-tofu" && change.kind === "create");
  assert.equal(rocket?.baselineStatus, "missing");
  assert.equal(confirmedCreate?.confidence, "confirmed");
  assert.equal(rocket?.reconciliationIssues.some((issue) => issue.targetId === "unresolved-pouch"), true);
});

test("describes unmatched targets with their OS group and actionable candidates", () => {
  const preview = buildDeliveryMenuPublishPreview({
    items: [],
    options: [{
      id: "replacement",
      groupKey: "noodle-replacement",
      groupLabel: "麺の種類を変更する",
      optionKey: "replace-corn",
      name: "トウモロコシ麺に変更",
      displayNames: {},
      priceDelta: 170,
      isActive: true
    }],
    platformBaselines: {
      uber_eats: {
        capturedAt: "2026-08-21",
        items: [],
        options: [
          { targetId: "replacement", externalId: "uber-a", name: "トウモロコシ麺に変更 A", price: 213 },
          { targetId: "replacement", externalId: "uber-b", name: "トウモロコシ麺に変更 B", price: 213 }
        ],
        complete: false,
        missingTargets: ["トウモロコシ麺に変更"]
      }
    }
  });
  const uber = preview.platforms.find((platform) => platform.platformKey === "uber_eats");
  assert.equal(uber?.reconciliationIssues[0]?.issueKind, "multiple");
  assert.equal(uber?.reconciliationIssues[0]?.locationLabel, "選択グループ: 麺の種類を変更する");
  assert.deepEqual(uber?.reconciliationIssues[0]?.candidates.map((candidate) => candidate.externalId), ["uber-a", "uber-b"]);
  assert.equal(uber?.blockers.some((blocker) => blocker.includes("候補重複 1件")), true);
});

test("assigns a shared missing label to the option when the same-named item was captured", () => {
  const preview = buildDeliveryMenuPublishPreview({
    items: [{
      id: "soup-item",
      externalId: "soup-item",
      name: "旨味マーラータンスープ",
      category: "旨味ベースの特別仕立てスープ",
      displayNames: {},
      basePrice: 330,
      isActive: true
    }],
    options: [{
      id: "soup-option",
      groupKey: "soup-selection",
      groupLabel: "スープを選ぶ",
      optionKey: "umami-soup",
      name: "旨味マーラータンスープ",
      displayNames: {},
      priceDelta: 0,
      isActive: true
    }],
    platformBaselines: {
      rocket_now: {
        capturedAt: "2026-08-21",
        items: [{
          targetId: "soup-item",
          externalId: "rocket-soup",
          name: "【自由にカスタム】旨味マーラータンスープ",
          price: null,
          isActive: true
        }],
        options: [],
        complete: false,
        missingTargets: ["旨味マーラータンスープ"]
      }
    }
  });
  const rocket = preview.platforms.find((platform) => platform.platformKey === "rocket_now");
  assert.equal(rocket?.reconciliationIssues.length, 1);
  assert.equal(rocket?.reconciliationIssues[0]?.targetType, "option");
  assert.equal(rocket?.reconciliationIssues[0]?.targetId, "soup-option");
  assert.equal(rocket?.reconciliationIssues[0]?.locationLabel, "選択グループ: スープを選ぶ");
});
