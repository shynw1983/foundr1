import assert from "node:assert/strict";
import test from "node:test";
import { buildDeliveryMenuPublishPreview, projectDeliveryName, projectNewHighTierPrice } from "./delivery-menu-publishing.ts";

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
