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

test("reports confirmed Uber name differences without mutating platform data", () => {
  const preview = buildDeliveryMenuPublishPreview({
    items: [{ id: "1", externalId: "corn", name: "トウモロコシ麺", displayNames: { zh: "玉米面", ko: "옥수수면", en: "Corn noodles" }, basePrice: 170, isActive: true }],
    options: [],
    uberBaselineItems: [{ websiteId: "corn", name: "旧名称", uberPrice: 216 }],
    uberBaselineOptions: [],
    uberBaselineCapturedAt: "2026-08-11",
    pendingTasksByPlatform: {}
  });
  const uber = preview.platforms.find((platform) => platform.platformKey === "uber_eats");
  assert.equal(preview.mode, "read_only");
  assert.equal(uber?.baselineStatus, "ready");
  assert.equal(uber?.changes.some((change) => change.kind === "rename" && change.confidence === "confirmed"), true);
  assert.equal(uber?.changes.some((change) => change.kind === "reprice"), false);
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
    },
    pendingTasksByPlatform: {}
  });
  const rocket = preview.platforms.find((platform) => platform.platformKey === "rocket_now");
  assert.equal(rocket?.baselineStatus, "ready");
  assert.equal(rocket?.changes.some((change) => change.kind === "rename" && change.targetId === "1"), true);
  assert.equal(rocket?.changes.some((change) => change.kind === "delete" && change.requiresExplicitConfirmation), true);
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
    },
    pendingTasksByPlatform: {}
  });
  const rocket = preview.platforms.find((platform) => platform.platformKey === "rocket_now");
  assert.equal(rocket?.baselineStatus, "missing");
  assert.equal(rocket?.blockers.some((blocker) => blocker.includes("1件")), true);
});
