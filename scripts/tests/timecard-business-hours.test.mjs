import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { getStoreBusinessDayTimeRange, normalizeBusinessHours } from "../../lib/store-business-hours.ts";
import { getBusinessInterval, getShiftInterval } from "../../lib/shift-timeline.ts";

// Exercise the actual private API/UI helpers without importing a route's database
// or mounting the entire timecard workbench. Extract only named declarations.
function loadFunctions(path, names, imports = {}) {
  const source = ts.createSourceFile(path, readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, path.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const declarations = new Map(source.statements.filter(ts.isFunctionDeclaration).map((node) => [node.name?.text, node]));
  const selected = names.map((name) => {
    assert.ok(declarations.has(name), `${path} must retain ${name}`);
    return declarations.get(name).getText(source);
  }).join("\n");
  const { outputText } = ts.transpileModule(selected, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  return new Function(...Object.keys(imports), `${outputText}\nreturn {${names.join(",")}};`)(...Object.values(imports));
}

const page = loadFunctions("app/os/timecard/TimecardPage.tsx", [
  "getWeekdayKeyForDate", "timeToMinutes", "minutesToTime", "getBusinessDayForDate", "getBusinessDayCloseMinutes",
  "isEarlyMorningBusinessDayShift", "getScheduledMinutesForWorkDate", "getShiftDefaults", "getShiftPatterns", "formatMinuteRange", "getDayCoverage"
], { getStoreBusinessDayTimeRange });
const api = loadFunctions("app/api/timecard/route.ts", [
  "toPunchDateTime", "getShiftWindowDateTime", "timeValueToMinutes", "getWeekdayKeyForDate", "getBusinessDayCloseMinutes",
  "isEarlyMorningBusinessDayShift", "getScheduledShiftDateTime"
]);
const requests = loadFunctions("app/os/timecard/requests/page.tsx", ["getShiftWindow", "getCoverageSummary"], {
  getStoreBusinessDayTimeRange, getBusinessInterval, getShiftInterval
});

const workDate = "2026-10-19";
const hours = (day) => normalizeBusinessHours({ weekly: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((key) => [key, day])) });
const shift = (scheduledStart, scheduledEnd) => ({ workDate, scheduledStart, scheduledEnd });
const fullDay = { open: "11:00", close: "20:00", closed: false, open24Hours: true };

test("24-hour shift defaults and patterns use midnight boundaries rather than saved timed hours", () => {
  const businessHours = hours(fullDay);
  assert.deepEqual(page.getShiftDefaults(businessHours, workDate), { scheduledStart: "00:00", scheduledEnd: "00:00", breakMinutes: "60", note: "" });
  const patterns = page.getShiftPatterns(businessHours, workDate);
  assert.deepEqual(patterns.map(({ start, end }) => [start, end]), [["00:00", "00:00"], ["00:00", "12:00"], ["12:00", "00:00"], ["00:00", "06:00"]]);
});

test("24-hour coverage requires the entire calendar day including early morning and late night", () => {
  const businessHours = hours(fullDay);
  assert.deepEqual(page.getDayCoverage(businessHours, workDate, [shift("00:00", "12:00"), shift("12:00", "00:00")]), { status: "covered", missingLabel: "" });
  assert.deepEqual(page.getDayCoverage(businessHours, workDate, [shift("08:00", "20:00")]), { status: "uncovered", missingLabel: "00:00-08:00、20:00-00:00" });
});

test("24-hour early-morning shifts stay on the selected date in API and UI", () => {
  const businessHours = hours(fullDay);
  const earlyShift = shift("02:00", "08:00");
  assert.equal(api.isEarlyMorningBusinessDayShift(earlyShift, businessHours), false);
  assert.equal(page.isEarlyMorningBusinessDayShift(earlyShift, businessHours), false);
  assert.equal(api.getScheduledShiftDateTime(earlyShift, "02:00", null, businessHours).toISOString(), "2026-10-18T17:00:00.000Z");
  assert.equal(page.getScheduledMinutesForWorkDate(earlyShift, "02:00", null, businessHours), 120);
  assert.equal(page.getScheduledMinutesForWorkDate(shift("20:00", "04:00"), "04:00", "20:00", businessHours), 1680);
});

test("timed overnight and legacy equal-time schedules retain their existing attribution", () => {
  for (const day of [{ open: "18:00", close: "03:00", closed: false }, { open: "11:00", close: "11:00", closed: false }]) {
    const businessHours = hours(day);
    const earlyShift = shift("02:00", "03:00");
    assert.equal(api.isEarlyMorningBusinessDayShift(earlyShift, businessHours), true);
    assert.equal(page.isEarlyMorningBusinessDayShift(earlyShift, businessHours), true);
    assert.equal(api.getScheduledShiftDateTime(earlyShift, "02:00", null, businessHours).toISOString(), "2026-10-19T17:00:00.000Z");
    assert.equal(page.getScheduledMinutesForWorkDate(earlyShift, "02:00", null, businessHours), 1560);
    assert.equal(page.getShiftDefaults(businessHours, workDate).scheduledStart, day.open);
    assert.equal(page.getShiftDefaults(businessHours, workDate).scheduledEnd, day.close);
  }
});

test("closed days override a retained 24-hour flag in shift suggestions and coverage", () => {
  const day = { ...fullDay, closed: true };
  const businessHours = hours(day);
  assert.deepEqual(page.getShiftDefaults(businessHours, workDate), { scheduledStart: "", scheduledEnd: "", breakMinutes: "0", note: "休業日" });
  assert.deepEqual(page.getShiftPatterns(businessHours, workDate), []);
  assert.deepEqual(page.getDayCoverage(businessHours, workDate, [shift("00:00", "00:00")]), { status: "closed", missingLabel: "" });
  assert.equal(requests.getCoverageSummary([], [shift("00:00", "00:00")], day, {}), "休業日");
});

test("shift-request coverage uses the 24-hour interval and retains timed-day coverage", () => {
  assert.equal(requests.getCoverageSummary([], [shift("11:00", "20:00")], fullDay, {}), "未充足");
  assert.equal(requests.getCoverageSummary([], [shift("00:00", "12:00"), shift("12:00", "00:00")], fullDay, {}), "充足");
  assert.equal(requests.getCoverageSummary([], [shift("11:00", "20:00")], { ...fullDay, open24Hours: false }, {}), "充足");
  assert.equal(requests.getCoverageSummary([], [shift("18:00", "00:00"), shift("00:00", "03:00")], { open: "18:00", close: "03:00", closed: false }, {}), "充足");
});
