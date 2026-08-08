import assert from "node:assert/strict";
import test from "node:test";

import { resolveKitchenDisplayAmounts } from "./kitchen-display-pricing.ts";

test("uses the exact Uber item and modifier amounts", () => {
  assert.deepEqual(resolveKitchenDisplayAmounts({
    storedAmount: 5498,
    quantity: 2,
    basePrice: 415,
    optionPriceDeltas: [],
    toppingCount: 3,
    bridgeItem: {
      unitPrice: 830,
      lineTotal: 5498,
      modifiers: [
        { quantity: 2, price: 226 },
        { quantity: 1, price: 0 }
      ]
    }
  }), {
    itemAmount: 830,
    toppingAmounts: [452, 452, 0]
  });
});

test("derives the Rocket base item amount from its exact line prices", () => {
  assert.deepEqual(resolveKitchenDisplayAmounts({
    storedAmount: 1053,
    quantity: 1,
    basePrice: 999,
    optionPriceDeltas: [],
    toppingCount: 3,
    bridgeItem: {
      lineTotal: 1053,
      modifiers: [
        { quantity: 1, price: 216 },
        { quantity: 1, price: 196 },
        { quantity: 1, price: 226 }
      ]
    }
  }), {
    itemAmount: 415,
    toppingAmounts: [216, 196, 226]
  });
});

test("falls back to menu master prices for non-bridge orders", () => {
  assert.deepEqual(resolveKitchenDisplayAmounts({
    storedAmount: 1400,
    quantity: 2,
    basePrice: 500,
    optionPriceDeltas: [100],
    toppingCount: 1,
    bridgeItem: null
  }), {
    itemAmount: 1000,
    toppingAmounts: [200]
  });
});
