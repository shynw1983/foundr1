import assert from "node:assert/strict";
import test from "node:test";

import {
  BASE_PRODUCTION_MINUTES,
  calculateProductionEstimateMinutes
} from "./production-estimate.ts";

test("uses ten minutes for one bowl", () => {
  assert.equal(calculateProductionEstimateMinutes(1), 10);
});

test("adds two minutes for every additional bowl", () => {
  assert.equal(calculateProductionEstimateMinutes(2), 12);
  assert.equal(calculateProductionEstimateMinutes(3), 14);
  assert.equal(calculateProductionEstimateMinutes(6), 20);
});

test("uses the one-bowl baseline for invalid or empty counts", () => {
  assert.equal(calculateProductionEstimateMinutes(0), BASE_PRODUCTION_MINUTES);
  assert.equal(calculateProductionEstimateMinutes(Number.NaN), BASE_PRODUCTION_MINUTES);
});
