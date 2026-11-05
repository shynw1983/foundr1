import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBusinessHoursSummary,
  getCurrentBusinessDayClosing,
  getNextBusinessOpening,
  getStoreBusinessDayTimeRange,
  getStoreCashBusinessDayState,
  getStoreReceptionState,
  isPickupWithinBusinessHours,
  normalizeBusinessHours,
  serializeBusinessHours,
  weekdayKeys,
  type StoreBusinessDay,
  type StoreBusinessHours
} from "./store-business-hours.ts";
import { getKitchenBusinessDayWindow } from "./kitchen-business-day.ts";

const at = (value: string) => new Date(`${value}+09:00`);
const timedDay: StoreBusinessDay = { open: "11:00", close: "20:00", closed: false };
const allDay: StoreBusinessDay = { open: "18:00", close: "03:00", closed: false, open24Hours: true };
function weekly(day: StoreBusinessDay = timedDay): StoreBusinessHours {
  return Object.fromEntries(weekdayKeys.map(key => [key, { ...day }])) as StoreBusinessHours;
}

test("24-hour mode survives serialization without replacing retained timed fields", () => {
  const input = { weekly: { ...weekly(), fri: allDay } };
  const stored = JSON.parse(serializeBusinessHours(input));
  assert.deepEqual(stored.weekly.fri, allDay);
  assert.deepEqual(normalizeBusinessHours(JSON.stringify(stored)).fri, allDay);
  assert.deepEqual(normalizeBusinessHours({ weekly: { fri: { ...allDay, open24Hours: false } } }).fri, {
    open: "18:00", close: "03:00", closed: false
  });
});

test("only explicit boolean true enables 24-hour mode", () => {
  for (const value of [false, "true", "false", 1, null, undefined]) {
    const day = normalizeBusinessHours({ fri: { ...allDay, open24Hours: value } }).fri;
    assert.equal(day.open24Hours, undefined);
  }
  assert.equal(normalizeBusinessHours({ fri: allDay }).fri.open24Hours, true);
  for (const day of [
    { open: "00:00", close: "00:00", closed: false },
    { open: "00:00", close: "23:59", closed: false }
  ]) assert.equal(normalizeBusinessHours({ fri: day }).fri.open24Hours, undefined);
});

test("effective time range uses the full calendar day and keeps timed overnight ranges", () => {
  assert.deepEqual(getStoreBusinessDayTimeRange(allDay), {
    open: "00:00", close: "00:00", openMinutes: 0, closeMinutes: 1440
  });
  assert.deepEqual(getStoreBusinessDayTimeRange({ ...allDay, open24Hours: false }), {
    open: "18:00", close: "03:00", openMinutes: 1080, closeMinutes: 1620
  });
  assert.deepEqual(getStoreBusinessDayTimeRange({ ...allDay, closed: true }), {
    open: "18:00", close: "03:00", openMinutes: 1080, closeMinutes: 1620
  });
});

test("summary groups 24-hour days separately and closed takes precedence", () => {
  assert.equal(formatBusinessHoursSummary({ weekly: weekly(allDay) }), "月火水木金土日 24時間営業");
  assert.equal(formatBusinessHoursSummary({ weekly: weekly({ ...allDay, closed: true }) }), "全日休業");
  const input = weekly();
  input.fri = allDay;
  assert.equal(formatBusinessHoursSummary(input), "月火水木土日 11:00-20:00 / 金 24時間営業");
});

test("24-hour pickup and reception accept the whole specified date", () => {
  const hours = { weekly: weekly(allDay) };
  for (const time of ["00:00", "00:01", "03:00", "11:00", "23:59"]) {
    assert.equal(isPickupWithinBusinessHours(hours, "2026-08-08", time), true, time);
  }
  assert.equal(isPickupWithinBusinessHours(hours, "2026-08-08", "24:00"), false);
  const state = getStoreReceptionState({
    businessHours: hours, reservationsEnabled: true, now: at("2026-08-08T00:00:00")
  });
  assert.equal(state.isWithinBusinessHours, true);
  assert.equal(state.isAcceptingNow, true);
  assert.equal(state.nextOpenLabel, "");
  assert.equal(getStoreReceptionState({
    businessHours: hours, reservationsEnabled: false, now: at("2026-08-08T23:59:59")
  }).isAcceptingNow, false);
});

test("24-hour day ends at midnight and does not spill into a following closed day", () => {
  const hours = weekly({ ...timedDay, closed: true });
  hours.fri = allDay;
  assert.equal(isPickupWithinBusinessHours(hours, "2026-08-07", "23:59"), true);
  assert.equal(isPickupWithinBusinessHours(hours, "2026-08-08", "00:00"), false);
  assert.equal(isPickupWithinBusinessHours(hours, "2026-08-08", "02:00"), false);
  for (const time of ["00:00:00", "00:00:59", "02:00:00"]) {
    const state = getStoreCashBusinessDayState(hours, at(`2026-08-08T${time}`));
    assert.equal(state.businessDate, "2026-08-08");
    assert.equal(state.status, "closed_day");
  }
});

test("24-hour yesterday does not open today's timed day before its opening", () => {
  const hours = weekly();
  hours.fri = allDay;
  assert.equal(isPickupWithinBusinessHours(hours, "2026-08-08", "01:00"), false);
  assert.equal(getStoreCashBusinessDayState(hours, at("2026-08-08T01:00:00")).status, "before_open");
});

test("closed flag overrides 24-hour mode but keeps an actual previous timed overnight tail", () => {
  const hours = weekly({ ...allDay, closed: true });
  assert.equal(isPickupWithinBusinessHours(hours, "2026-08-08", "12:00"), false);
  hours.fri = { open: "18:00", close: "03:00", closed: false };
  assert.equal(isPickupWithinBusinessHours(hours, "2026-08-08", "01:00"), true);
  assert.equal(isPickupWithinBusinessHours(hours, "2026-08-08", "03:01"), false);
  const state = getStoreCashBusinessDayState(hours, at("2026-08-08T01:00:00"));
  assert.equal(state.businessDate, "2026-08-07");
  assert.equal(state.closeAt, "2026-08-08T03:00");
});

test("explicit current 24-hour day uses its calendar date even after a timed overnight day", () => {
  const hours = weekly();
  hours.fri = { open: "18:00", close: "03:00", closed: false };
  hours.sat = allDay;
  for (const time of ["00:00:00", "00:00:59", "02:00:00", "23:59:59"]) {
    const state = getStoreCashBusinessDayState(hours, at(`2026-08-08T${time}`));
    assert.equal(state.businessDate, "2026-08-08");
    assert.equal(state.openAt, "2026-08-08T00:00");
    assert.equal(state.closeAt, "2026-08-09T00:00");
    assert.equal(state.closeExclusive, true);
    assert.equal(state.status, "business_open");
  }
  assert.equal(getCurrentBusinessDayClosing(hours, at("2026-08-08T01:00:00"))?.toISOString(), "2026-08-08T15:00:00.000Z");
});

test("consecutive 24-hour days advance cash and kitchen dates exactly at Tokyo midnight", () => {
  const hours = weekly(allDay);
  const before = getStoreCashBusinessDayState(hours, at("2026-08-07T23:59:59"));
  const after = getStoreCashBusinessDayState(hours, at("2026-08-08T00:00:00"));
  assert.equal(before.businessDate, "2026-08-07");
  assert.equal(after.businessDate, "2026-08-08");
  assert.deepEqual(getKitchenBusinessDayWindow(hours, at("2026-08-08T00:00:00")), {
    businessDate: "2026-08-08", startAt: "2026-08-08T00:00", endAt: "2026-08-09T00:00", endExclusive: true
  });
});

test("next 24-hour opening starts at midnight rather than its retained timed opening", () => {
  const hours = weekly({ ...timedDay, closed: true });
  hours.sat = allDay;
  assert.equal(getNextBusinessOpening(hours, at("2026-08-07T23:59:59")), "2026-08-08 00:00");
  assert.equal(getStoreReceptionState({
    businessHours: hours, reservationsEnabled: true, now: at("2026-08-07T23:59:59")
  }).nextOpenLabel, "2026-08-08 00:00");
  assert.equal(getCurrentBusinessDayClosing(hours, at("2026-08-07T23:59:59"))?.toISOString(), "2026-08-08T15:00:00.000Z");
});

test("legacy equal-time and 00:00–23:59 records retain their existing midnight behavior", () => {
  const equal = weekly({ open: "00:00", close: "00:00", closed: false });
  assert.equal(getStoreCashBusinessDayState(equal, at("2026-08-08T00:00:59")).businessDate, "2026-08-07");
  assert.equal(getStoreCashBusinessDayState(equal, at("2026-08-08T00:01:00")).businessDate, "2026-08-08");
  const nearlyAllDay = weekly({ open: "00:00", close: "23:59", closed: false });
  const state = getStoreCashBusinessDayState(nearlyAllDay, at("2026-08-08T00:00:00"));
  assert.equal(state.businessDate, "2026-08-08");
  assert.equal(state.closeAt, "2026-08-08T23:59");
});
