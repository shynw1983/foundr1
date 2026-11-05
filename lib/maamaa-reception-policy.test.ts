import assert from "node:assert/strict";
import test from "node:test";
import { applyMaamaaReceptionWindowPolicy, maamaaSameDayReceptionStartTime } from "./maamaa-reception-policy.ts";
import { getStoreCashBusinessDayState, weekdayKeys } from "./store-business-hours.ts";

const date = "2026-10-19";
const now = (time: string) => new Date(`${date}T${time}:00+09:00`);
const hours = Object.fromEntries(weekdayKeys.map((day) => [day, { open: "11:00", close: "20:00", closed: false, open24Hours: true }]));
const fullDay = [{ date, start: "00:00", end: "23:59" }];
// Existing Maamaa UI uses the API windows to recognize overnight continuation.
const frontendHasContinuation = (windows: typeof fullDay, time: string) => windows.some((window) => window.date === date && window.start <= time && window.end >= time);

test("24-hour public windows retain noon reception while matching the existing frontend continuation predicate", () => {
  const windows = applyMaamaaReceptionWindowPolicy(fullDay, { businessDay: getStoreCashBusinessDayState(hours, now("02:00")), acceptanceMode: "auto" });
  assert.equal(maamaaSameDayReceptionStartTime, "12:00");
  assert.deepEqual(windows, [{ date, start: "12:00", end: "23:59" }]);
  for (const time of ["00:00", "02:00", "11:59"]) assert.equal(frontendHasContinuation(windows, time), false, time);
  for (const time of ["12:00", "18:00", "23:59"]) assert.equal(frontendHasContinuation(windows, time), true, time);
  assert.deepEqual(fullDay, [{ date, start: "00:00", end: "23:59" }], "must not mutate reservation windows used by other consumers");
});

test("24-hour reception clipping preserves staffing limits and discards windows wholly before noon", () => {
  const windows = applyMaamaaReceptionWindowPolicy([
    { date, start: "01:00", end: "08:00" },
    { date, start: "11:00", end: "13:00" },
    { date, start: "18:15", end: "22:30" }
  ], { businessDay: getStoreCashBusinessDayState(hours, now("02:00")) });
  assert.deepEqual(windows, [{ date, start: "12:00", end: "13:00" }, { date, start: "18:15", end: "22:30" }]);
});

test("manual reception keeps its original full-day windows", () => {
  const windows = applyMaamaaReceptionWindowPolicy(fullDay, { businessDay: getStoreCashBusinessDayState(hours, now("02:00")), acceptanceMode: "force_open" });
  assert.equal(windows, fullDay);
  assert.equal(frontendHasContinuation(windows, "02:00"), true);
});

test("timed overnight continuation and unflagged legacy full-day hours keep their existing windows", () => {
  const overnight = Object.fromEntries(weekdayKeys.map((day) => [day, { open: "18:00", close: "03:00", closed: false }]));
  const windows = [{ date, start: "00:00", end: "03:00" }];
  const businessDay = getStoreCashBusinessDayState(overnight, now("02:00"));
  assert.equal(businessDay.businessDate, "2026-10-18");
  assert.equal(applyMaamaaReceptionWindowPolicy(windows, { businessDay, acceptanceMode: "auto" }), windows);
  assert.equal(frontendHasContinuation(windows, "02:00"), true);
  const legacy = Object.fromEntries(weekdayKeys.map((day) => [day, { open: "00:00", close: "23:59", closed: false }]));
  assert.equal(applyMaamaaReceptionWindowPolicy(fullDay, { businessDay: getStoreCashBusinessDayState(legacy, now("02:00")) }), fullDay);
});
