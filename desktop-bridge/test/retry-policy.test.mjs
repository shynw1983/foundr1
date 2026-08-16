import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMAE_CAN_CIRCUIT_FAILURE_THRESHOLD,
  DEMAE_CAN_CIRCUIT_OPEN_MS,
  INVENTORY_COMMAND_MAX_ATTEMPTS,
  inventoryCommandMaxAttempts,
  isDemaeCanCircuitFailure,
  isRetryableInventoryError
} from "../src/retry-policy.mjs";

test("retries transient browser and platform page errors", () => {
  assert.equal(INVENTORY_COMMAND_MAX_ATTEMPTS, 3);
  assert.equal(isRetryableInventoryError("Waiting for selector failed"), true);
  assert.equal(isRetryableInventoryError("CDP Runtime.evaluate timeout"), true);
  assert.equal(isRetryableInventoryError("demae_can_confirmation_timeout"), true);
  assert.equal(isRetryableInventoryError("Target verification failed: 商品=0"), true);
});

test("fails a Demae Can timeout quickly while retaining retries for other platforms", () => {
  assert.equal(inventoryCommandMaxAttempts("demae_can"), 1);
  assert.equal(inventoryCommandMaxAttempts("uber_eats"), INVENTORY_COMMAND_MAX_ATTEMPTS);
  assert.equal(inventoryCommandMaxAttempts("rocket_now"), INVENTORY_COMMAND_MAX_ATTEMPTS);
  assert.equal(DEMAE_CAN_CIRCUIT_FAILURE_THRESHOLD, 2);
  assert.equal(DEMAE_CAN_CIRCUIT_OPEN_MS, 15 * 60 * 1000);
  assert.equal(isDemaeCanCircuitFailure("Runtime.callFunctionOn timed out"), true);
  assert.equal(isDemaeCanCircuitFailure("Waiting for selector failed"), true);
  assert.equal(isDemaeCanCircuitFailure("login required"), false);
});

test("does not retry login or configuration errors", () => {
  assert.equal(isRetryableInventoryError("login required"), false);
  assert.equal(isRetryableInventoryError("demae_can_login_credentials_rejected"), false);
  assert.equal(isRetryableInventoryError("demae_can_credentials_missing"), false);
  assert.equal(isRetryableInventoryError("demae_can_circuit_open_until:2026-08-16T11:00:00.000Z"), false);
  assert.equal(isRetryableInventoryError("No enabled adapter for platform"), false);
  assert.equal(isRetryableInventoryError("platform_ui_changed:demae_can:apply_button"), false);
});
