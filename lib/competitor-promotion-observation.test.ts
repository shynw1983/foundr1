import assert from "node:assert/strict";
import test from "node:test";

import { resolvePromotionObservation } from "./competitor-promotion-observation.ts";

const active = {
  active: true,
  campaigns: [{
    title: "Save on Select Items",
    itemCount: 1,
    discountLabels: ["20% off"],
    items: [{ key: "squid", name: "いかと筍", currentPrice: "¥2,014", originalPrice: "¥2,518", discountLabels: ["20% off"] }]
  }]
};

test("closed store keeps the previous promotion instead of recording an end", () => {
  const result = resolvePromotionObservation({ previous: active, current: { active: false, campaigns: [] }, isOpen: false, complete: false });
  assert.deepEqual(result.promotions, active);
  assert.equal(result.status, "closed");
  assert.equal(result.acceptedEnd, false);
});

test("partial open-store observations preserve missing discounted products", () => {
  const result = resolvePromotionObservation({
    previous: active,
    current: { active: true, campaigns: [{ title: "Save on Select Items", items: [{ key: "beef", name: "牛肉", currentPrice: "¥1,592", originalPrice: "¥1,990", discountLabels: ["20% off"] }] }] },
    isOpen: true,
    complete: false
  });
  const items = (result.promotions.campaigns as Array<{ items: Array<{ key: string }> }>)[0].items;
  assert.deepEqual(items.map((item) => item.key).sort(), ["beef", "squid"]);
  assert.equal(result.status, "partial");
});

test("one complete in-hours observation can confirm a promotion end", () => {
  const result = resolvePromotionObservation({ previous: active, current: { active: false, campaigns: [] }, isOpen: true, complete: true });
  assert.deepEqual(result.promotions, { active: false, campaigns: [] });
  assert.equal(result.status, "reliable");
  assert.equal(result.acceptedEnd, true);
});
