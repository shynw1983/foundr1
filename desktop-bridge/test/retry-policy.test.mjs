import assert from "node:assert/strict";
import test from "node:test";

import {
  INVENTORY_COMMAND_MAX_ATTEMPTS,
  isRetryableInventoryError
} from "../src/retry-policy.mjs";

test("retries transient browser and platform page errors", () => {
  assert.equal(INVENTORY_COMMAND_MAX_ATTEMPTS, 3);
  assert.equal(isRetryableInventoryError("Waiting for selector failed"), true);
  assert.equal(isRetryableInventoryError("CDP Runtime.evaluate timeout"), true);
  assert.equal(isRetryableInventoryError("demae_can_confirmation_timeout"), true);
});

test("does not retry permanent target or configuration errors", () => {
  assert.equal(isRetryableInventoryError("Target verification failed: 商品=0"), false);
  assert.equal(isRetryableInventoryError("login required"), false);
  assert.equal(isRetryableInventoryError("No enabled adapter for platform"), false);
});
