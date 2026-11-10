import assert from "node:assert/strict";
import test from "node:test";
import { adjustPosTaxBreakdown } from "./pos-counter-tax.ts";
import { getPosPaymentRoundingAmount, normalizePosPaymentRounding, posRoundingMethods } from "./pos-payment-rounding.ts";

test("five-yen rounding follows only the selected payment method", () => {
  for (const enabled of posRoundingMethods) {
    const settings = normalizePosPaymentRounding({ [enabled]: true });
    for (const method of [...posRoundingMethods, "other"]) {
      for (let amount = 1000; amount <= 1009; amount++) {
        assert.equal(amount - getPosPaymentRoundingAmount(amount, method, settings),
          method === enabled ? Math.floor(amount / 5) * 5 : amount);
      }
    }
  }
  assert.equal(getPosPaymentRoundingAmount(1009, "cash", normalizePosPaymentRounding(null)), 0);
  assert.equal(getPosPaymentRoundingAmount(1009, "cash", normalizePosPaymentRounding({ cash: "false" })), 0);
});

test("rounded tax buckets use the adjusted gross amount", () => {
  const breakdown = [{ rate: 8, grossAmount: 432, taxAmount: 32 }, { rate: 10, grossAmount: 572, taxAmount: 52 }];
  assert.deepEqual(adjustPosTaxBreakdown(breakdown, 1004, 0, 4), [
    { rate: 8, grossAmount: 430, taxAmount: 32 }, { rate: 10, grossAmount: 570, taxAmount: 52 }
  ]);
  assert.deepEqual(adjustPosTaxBreakdown(undefined, 4, 10, 4), [{ rate: 10, grossAmount: 0, taxAmount: 0 }]);
  assert.equal(adjustPosTaxBreakdown(breakdown, 1004, 0, 0), breakdown);
});
