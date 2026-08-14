import assert from "node:assert/strict";
import test from "node:test";
import {
  getScheduledOrderReminderAt,
  getStoreOrderAlertPhase,
  shouldRepeatStoreOrderAlert
} from "./store-order-alert-timing.ts";

test("calculates the maamaa preparation reminder 20 minutes before JST pickup", () => {
  const reminderAt = getScheduledOrderReminderAt({
    pickupDate: "2026-08-12",
    pickupTime: "18:00"
  });
  assert.equal(reminderAt?.toISOString(), "2026-08-12T08:40:00.000Z");
});

test("scheduled maamaa orders move from waiting to reminder at the due time", () => {
  const order = {
    orderSource: "maamaa_web",
    pickupTiming: "scheduled",
    pickupDate: "2026-08-12",
    pickupTime: "18:00",
    paidAt: "2026-08-12T07:00:00.000Z"
  };
  assert.equal(getStoreOrderAlertPhase(order, Date.parse("2026-08-12T08:39:59.000Z")), "scheduled_waiting");
  assert.equal(getStoreOrderAlertPhase(order, Date.parse("2026-08-12T08:40:00.000Z")), "scheduled_reminder");
  assert.equal(shouldRepeatStoreOrderAlert("scheduled_reminder"), true);
});

test("the initial scheduled-order receipt alert does not repeat", () => {
  const order = {
    orderSource: "maamaa_web",
    pickupTiming: "scheduled",
    pickupDate: "2026-08-12",
    pickupTime: "18:00",
    paidAt: "2026-08-12T07:00:00.000Z"
  };
  assert.equal(getStoreOrderAlertPhase(order, Date.parse("2026-08-12T07:01:30.000Z")), "scheduled_initial");
  assert.equal(shouldRepeatStoreOrderAlert("scheduled_initial"), false);
});
