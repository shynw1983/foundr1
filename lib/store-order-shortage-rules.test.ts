import assert from "node:assert/strict";
import test from "node:test";
import { calculateShortageRefundAmount, canHandleShortageAsSeparateOption } from "./store-order-shortage-rules.ts";

test("allocates an option refund from the amount actually paid after a coupon", () => {
  assert.equal(calculateShortageRefundAmount({
    targetType: "option",
    targetPrice: 200,
    grossAmount: 1000,
    paidAmount: 900,
    refundedAmount: 0
  }), 180);
});

test("caps later shortage refunds at the unpaid remainder", () => {
  assert.equal(calculateShortageRefundAmount({
    targetType: "option",
    targetPrice: 500,
    grossAmount: 1000,
    paidAmount: 800,
    refundedAmount: 700
  }), 100);
  assert.equal(calculateShortageRefundAmount({
    targetType: "item",
    targetPrice: 1000,
    grossAmount: 1000,
    paidAmount: 800,
    refundedAmount: 180
  }), 620);
});

test("requires the whole item to be handled for free or essential choices", () => {
  assert.equal(canHandleShortageAsSeparateOption("トッピング", 120), true);
  assert.equal(canHandleShortageAsSeparateOption("トッピング", 0), false);
  assert.equal(canHandleShortageAsSeparateOption("サイズ", 100), false);
});
