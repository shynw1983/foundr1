import assert from "node:assert/strict";
import test from "node:test";
import { getStoreCashBusinessDayState } from "./store-business-hours.ts";
import { inventorySyncCurrentBusinessDaySql } from "./inventory-sync-business-day.ts";

const pglitePath = process.env.FOUNDR1_PGLITE_MODULE || process.env.PGLITE_MODULE
  || "../outputs/inventory-reference-implementation-20261014/test-deps/node_modules/@electric-sql/pglite/dist/index.js";
const { PGlite } = await import(pglitePath);
const weekdayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const daytime = Object.fromEntries(weekdayKeys.map(day => [day, { open: "11:00", close: "22:00", closed: false }]));
const overnight = { ...daytime, fri: { open: "18:00", close: "03:00", closed: false }, sat: { open: "18:00", close: "03:00", closed: false } };
const friday = "2026-08-07", saturday = "2026-08-08";
const at = (date: string, time: string) => `${date}T${time}+09:00`;

test("inventory business-date SQL matches the shared Tokyo helper, including preparation and overnight boundaries", async t => {
  const db = new PGlite();
  // Replace only the clock expression. The generated production predicate is
  // otherwise executed unchanged against PostgreSQL with JSONB store hours.
  const predicate = inventorySyncCurrentBusinessDaySql("c", "s").replaceAll("CURRENT_TIMESTAMP", "$3::timestamptz");
  const query = `select ${predicate} as included
    from (select $1::timestamptz as created_at, $3::timestamptz as updated_at,
      jsonb_build_object('manualRetryAt', $3::text) as payload) c
    cross join (select $2::jsonb as business_hours) s`;
  type Case = { label: string; hours: unknown; now: string; created: string; expected?: boolean };
  const cases: Case[] = [
    { label: "opening preparation belongs to today", hours: { weekly: daytime }, now: at(saturday, "12:00:00"), created: at(saturday, "08:00:00"), expected: true },
    { label: "post-close work belongs to the same business date", hours: daytime, now: at(saturday, "23:30:00"), created: at(saturday, "22:30:00"), expected: true },
    { label: "yesterday is not revived by updated_at or manualRetryAt today", hours: daytime, now: at(saturday, "12:00:00"), created: at(friday, "23:59:59"), expected: false },
    { label: "Tokyo midnight advances a normal day", hours: daytime, now: at(saturday, "00:00:00"), created: at(friday, "23:59:59"), expected: false },
    { label: "overnight includes previous-date preparation", hours: { weekly: overnight }, now: at(saturday, "01:30:00"), created: at(friday, "17:00:00"), expected: true },
    { label: "overnight includes both sides of midnight", hours: overnight, now: at(saturday, "01:30:00"), created: at(saturday, "00:30:00"), expected: true },
    { label: "entire closing minute still belongs to the previous day", hours: overnight, now: at(saturday, "03:00:59"), created: at(friday, "23:00:00"), expected: true },
    { label: "minute after overnight close advances the business date", hours: overnight, now: at(saturday, "03:01:00"), created: at(friday, "23:00:00"), expected: false },
    { label: "later before-opening work belongs to the new date", hours: overnight, now: at(saturday, "10:00:00"), created: at(saturday, "04:00:00"), expected: true },
    { label: "closed today still respects yesterday's overnight tail", hours: { ...overnight, sat: { ...overnight.sat, closed: true } }, now: at(saturday, "01:00:00"), created: at(friday, "23:00:00"), expected: true },
    { label: "closed day uses today's business date after the tail", hours: { ...overnight, sat: { ...overnight.sat, closed: true } }, now: at(saturday, "12:00:00"), created: at(saturday, "04:00:00"), expected: true },
    { label: "strict JSON boolean true disables yesterday's overnight tail", hours: { ...overnight, fri: { ...overnight.fri, closed: true } }, now: at(saturday, "01:00:00"), created: at(friday, "23:00:00"), expected: false },
    { label: "string true is not a closed flag", hours: { ...overnight, fri: { ...overnight.fri, closed: "true" } }, now: at(saturday, "01:00:00"), created: at(friday, "23:00:00"), expected: true },
    { label: "missing hours use the shared defaults", hours: {}, now: at(saturday, "01:00:00"), created: at(friday, "23:00:00"), expected: false },
    { label: "null hours use the shared defaults", hours: null, now: at(saturday, "12:00:00"), created: at(saturday, "02:00:00"), expected: true },
    { label: "missing previous open defaults to 11:00", hours: { fri: { close: "03:00" } }, now: at(saturday, "01:00:00"), created: at(friday, "23:00:00"), expected: true },
    { label: "malformed previous close defaults to 20:00", hours: { fri: { open: "18:00", close: "3:00" } }, now: at(saturday, "01:00:00"), created: at(friday, "23:00:00"), expected: false },
    { label: "time strings are trimmed like the shared helper", hours: { fri: { open: " 18:00 ", close: " 03:00 " } }, now: at(saturday, "01:00:00"), created: at(friday, "23:00:00"), expected: true },
    { label: "weekly array falls back to default weekdays", hours: { ...overnight, weekly: [] }, now: at(saturday, "01:00:00"), created: at(friday, "23:00:00"), expected: false },
    { label: "midnight close is inclusive for its entire minute", hours: Object.fromEntries(weekdayKeys.map(day => [day, { open: "00:00", close: "00:00", closed: false }])), now: at(saturday, "00:00:59"), created: at(friday, "23:59:59"), expected: true },
    { label: "midnight-close next minute starts a new date", hours: Object.fromEntries(weekdayKeys.map(day => [day, { open: "00:00", close: "00:00", closed: false }])), now: at(saturday, "00:01:00"), created: at(saturday, "00:00:59"), expected: false }
  ];
  const clocks = [at(friday, "09:00:00"), at(friday, "23:30:00"), at(saturday, "00:30:00"), at(saturday, "03:00:59"), at(saturday, "03:01:00"), at(saturday, "10:00:00")];
  for (const hours of [daytime, { weekly: overnight }, {}, null]) for (const now of clocks) for (const created of clocks) {
    cases.push({ label: "cross-clock shared-helper parity", hours, now, created });
  }
  try {
    for (const item of cases) {
      const expected = getStoreCashBusinessDayState(item.hours, new Date(item.created)).businessDate
        === getStoreCashBusinessDayState(item.hours, new Date(item.now)).businessDate;
      if (item.expected !== undefined) assert.equal(expected, item.expected, item.label);
      const result = await db.query(query, [item.created, JSON.stringify(item.hours), item.now]);
      assert.equal(result.rows[0].included, expected, `${item.label}: created=${item.created}, now=${item.now}`);
    }
    t.diagnostic(`${cases.length} PostgreSQL/JS business-date parity cases passed; updated/manual retry clocks never select old commands`);
  } finally { await db.close(); }
});

test("explicit 24-hour days use the original operation's rolling 24 hours, without changing timed or closed days", async t => {
  const db = new PGlite();
  const now = at(saturday, "00:30:00");
  const allDay = Object.fromEntries(weekdayKeys.map(day => [day, { open: "11:00", close: "22:00", closed: false, open24Hours: true }]));
  const predicate = inventorySyncCurrentBusinessDaySql("c", "s").replaceAll("CURRENT_TIMESTAMP", "$3::timestamptz");
  const query = `select ${predicate} as included from (select $1::timestamptz as created_at) c
    cross join (select $2::jsonb as business_hours) s`;
  const cases = [
    { label: "previous calendar date remains in range", hours: allDay, created: at(friday, "23:59:59"), expected: true },
    { label: "exactly 24 hours is included", hours: { weekly: allDay }, created: at(friday, "00:30:00"), expected: true },
    { label: "24 hours and one millisecond is expired", hours: allDay, created: at(friday, "00:29:59.999"), expected: false },
    { label: "new operation is included", hours: allDay, created: now, expected: true },
    { label: "future original timestamp is excluded", hours: allDay, created: at(saturday, "00:30:00.001"), expected: false },
    { label: "old failure remains expired despite retry today", hours: allDay, created: "2026-08-01T20:00:00+09:00", expected: false },
    { label: "one explicitly 24-hour weekday is sufficient", hours: { ...daytime, sat: allDay.sat }, created: at(friday, "18:00:00"), expected: true },
    { label: "a different 24-hour weekday does not turn today into rolling hours", hours: { ...daytime, fri: allDay.fri }, created: at(friday, "23:59:59"), expected: false },
    { label: "closed takes priority over conflicting 24-hour flag", hours: { ...allDay, sat: { ...allDay.sat, closed: true } }, created: at(friday, "23:59:59"), expected: false },
    { label: "closed day includes its current-date preparation records", hours: { ...allDay, sat: { ...allDay.sat, closed: true } }, created: at(saturday, "00:10:00"), expected: true },
    { label: "string true does not enable 24 hours", hours: { ...daytime, sat: { ...allDay.sat, open24Hours: "true" } }, created: at(friday, "23:59:59"), expected: false },
    { label: "today is timed after yesterday's 24 hours, no stale saved overnight tail", hours: { ...daytime, fri: { open: "18:00", close: "03:00", closed: false, open24Hours: true } }, created: at(friday, "23:59:59"), expected: false },
    { label: "today's 24 hours starts at midnight despite yesterday's timed overnight", hours: { ...overnight, sat: allDay.sat }, created: at(friday, "00:29:59"), expected: false },
    { label: "normal timed days retain business-date filtering", hours: daytime, created: at(friday, "23:59:59"), expected: false },
    { label: "normal overnight retains its business day", hours: overnight, created: at(friday, "17:00:00"), expected: true },
    { label: "unflagged equal times retain legacy boundaries", hours: Object.fromEntries(weekdayKeys.map(day => [day, { open: "00:00", close: "00:00", closed: false }])), created: at(friday, "23:59:59"), expected: false }
  ];
  try {
    for (const item of cases) {
      const result = await db.query(query, [item.created, JSON.stringify(item.hours), now]);
      assert.equal(result.rows[0].included, item.expected, item.label);
    }
    t.diagnostic(`${cases.length} rolling-window and mixed-schedule cases passed`);
  } finally { await db.close(); }
});
