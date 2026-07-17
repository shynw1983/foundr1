import test from "node:test";
import assert from "node:assert/strict";
import { getBusinessInterval, getShiftInterval, getTimelineInterval } from "./shift-timeline.ts";

test("keeps preparation time before opening on the same business day", () => {
  const business = getBusinessInterval("12:00", "00:30");
  assert.deepEqual(getShiftInterval("11:30", "16:00", business), { start: 690, end: 960 });
  assert.deepEqual(getShiftInterval("11:30", "00:30", business), { start: 690, end: 1470 });
});

test("keeps closing time after midnight on the same business day", () => {
  const business = getBusinessInterval("12:00", "00:30");
  assert.deepEqual(getShiftInterval("18:00", "00:45", business), { start: 1080, end: 1485 });
});

test("expands the timeline beyond business hours", () => {
  const business = getBusinessInterval("12:00", "00:30");
  const timeline = getTimelineInterval(business, [
    getShiftInterval("11:30", "16:00", business),
    getShiftInterval("18:00", "00:45", business)
  ]);
  assert.deepEqual(timeline, { start: 690, end: 1485 });
});

test("supports preparation before a midnight opening", () => {
  const business = getBusinessInterval("00:00", "08:00");
  assert.deepEqual(getShiftInterval("23:30", "08:00", business), { start: -30, end: 480 });
});
