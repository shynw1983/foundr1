import test from "node:test";
import assert from "node:assert/strict";
import { defaultBusinessHours, getShiftRequestDefaultTimes, normalizeShiftRequestOffset } from "./store-business-hours.ts";

const hours = { weekly: {
  ...defaultBusinessHours,
  mon: { open: "11:00", close: "22:00", closed: false },
  tue: { open: "12:00", close: "00:30", closed: false },
  wed: { open: "11:00", close: "20:00", closed: true },
  thu: { open: "00:00", close: "08:00", closed: false },
  fri: { open: "11:00", close: "20:00", closed: false, open24Hours: true }
} };

test("uses the requested weekday rather than a fixed shift", () => {
  assert.deepEqual(getShiftRequestDefaultTimes(hours, "2026-10-26"), { availableStart: "11:00", availableEnd: "22:00" });
  assert.deepEqual(getShiftRequestDefaultTimes(hours, "2026-10-27"), { availableStart: "12:00", availableEnd: "00:30" });
});
test("independently offsets opening and closing with arbitrary integer minutes", () => {
  assert.deepEqual(getShiftRequestDefaultTimes(hours, "2026-10-26", -30, 60), { availableStart: "10:30", availableEnd: "23:00" });
  assert.deepEqual(getShiftRequestDefaultTimes(hours, "2026-10-26", 45, -15), { availableStart: "11:45", availableEnd: "21:45" });
});
test("handles midnight closing and preparation before midnight opening", () => {
  assert.deepEqual(getShiftRequestDefaultTimes(hours, "2026-10-27", -60, 30), { availableStart: "11:00", availableEnd: "01:00" });
  assert.deepEqual(getShiftRequestDefaultTimes(hours, "2026-10-29", -30, 0), { availableStart: "23:30", availableEnd: "08:00" });
});
test("leaves closed, unavailable and unrepresentable windows for manual input", () => {
  const empty = { availableStart: "", availableEnd: "" };
  assert.deepEqual(getShiftRequestDefaultTimes(hours, "2026-10-28"), empty);
  assert.deepEqual(getShiftRequestDefaultTimes({}, "2026-10-26"), empty);
  assert.deepEqual(getShiftRequestDefaultTimes(null, "2026-10-26"), empty);
  assert.deepEqual(getShiftRequestDefaultTimes(hours, "invalid"), empty);
  assert.deepEqual(getShiftRequestDefaultTimes(hours, "2026-10-26", 720, -720), empty);
  assert.deepEqual(getShiftRequestDefaultTimes(hours, "2026-10-30", -30, 30), empty);
  assert.deepEqual(getShiftRequestDefaultTimes(hours, "2026-10-30"), { availableStart: "00:00", availableEnd: "00:00" });
});
test("validates bounded integer offsets including zero and negative values", () => {
  for (const value of [0, -30, 60, 47, -720, 720]) assert.equal(normalizeShiftRequestOffset(value), value);
  for (const value of [721, -721, 0.5, "abc", Infinity]) assert.equal(normalizeShiftRequestOffset(value), null);
  assert.equal(normalizeShiftRequestOffset(null), 0);
});
