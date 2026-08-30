import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveFullSyncAvailability,
  shouldResetPlatformAvailabilityOverrides
} from "./inventory-availability-policy.ts";

test("inventory unavailability wins over a stale platform available override", () => {
  assert.equal(resolveFullSyncAvailability(false, "available"), false);
});

test("platform unavailable can stop otherwise available inventory", () => {
  assert.equal(resolveFullSyncAvailability(true, "unavailable"), false);
  assert.equal(resolveFullSyncAvailability(true, "available"), true);
  assert.equal(resolveFullSyncAvailability(true, undefined), true);
});

test("overall availability changes clear platform overrides server-side", () => {
  assert.equal(shouldResetPlatformAvailabilityOverrides({
    stockStatus: "unavailable",
    hasPlatformOverride: false
  }), true);
  assert.equal(shouldResetPlatformAvailabilityOverrides({
    stockStatus: "available",
    hasPlatformOverride: false
  }), true);
});

test("channel-only and low-stock changes preserve intentional platform overrides", () => {
  assert.equal(shouldResetPlatformAvailabilityOverrides({
    persistOverall: false,
    stockStatus: "unavailable",
    hasPlatformOverride: true
  }), false);
  assert.equal(shouldResetPlatformAvailabilityOverrides({
    stockStatus: "low_stock",
    hasPlatformOverride: false
  }), false);
});
