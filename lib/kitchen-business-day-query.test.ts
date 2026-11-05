import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getKitchenBusinessDayWindow } from "./kitchen-business-day.ts";

const pglitePath = process.env.FOUNDR1_PGLITE_MODULE || process.env.PGLITE_MODULE
  || "../outputs/inventory-reference-implementation-20261014/test-deps/node_modules/@electric-sql/pglite/dist/index.js";
const { PGlite } = await import(pglitePath);

// Execute the actual kitchen route's date predicate, rather than a duplicate implementation.
const source = readFileSync(new URL("../app/api/store/display/kitchen/route.ts", import.meta.url), "utf8");
const predicateStart = source.indexOf("      and (\n        (\n          concat(");
const predicateEnd = source.indexOf("      and (${area} = ''", predicateStart);
assert.ok(predicateStart >= 0 && predicateEnd > predicateStart, "kitchen route's date predicate is present");
const predicate = source.slice(predicateStart + "      and ".length, predicateEnd)
  .replaceAll("${businessDay.startAt}", "$1")
  .replaceAll("${businessDay.endAt}", "$2")
  .replaceAll("${businessDay.endExclusive === true}", "$3::boolean");
assert.equal(predicate.includes("${"), false);

test("actual kitchen SQL excludes next midnight from a 24-hour day and includes it in the new day", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table store_customer_orders (
      id text primary key, pickup_date date, pickup_time text, created_at timestamptz
    )`);
    await db.exec(`insert into store_customer_orders values
      ('before-start', '2026-08-06', '23:59', '2026-08-06T23:59:59+09:00'),
      ('at-start', '2026-08-07', '00:00', '2026-08-07T00:00:00+09:00'),
      ('last-minute', '2026-08-07', '23:59', '2026-08-07T23:59:59+09:00'),
      ('midnight-both', '2026-08-08', '00:00', '2026-08-08T00:00:00+09:00'),
      ('midnight-pickup-only', '2026-08-08', '00:00', '2026-08-05T12:00:00+09:00'),
      ('midnight-created-only', '2026-08-10', '12:00', '2026-08-08T00:00:00+09:00'),
      ('after-end', '2026-08-08', '00:01', '2026-08-08T00:01:00+09:00')`);
    const hours = { fri: { open: "18:00", close: "03:00", closed: false, open24Hours: true },
      sat: { open: "11:00", close: "20:00", closed: false, open24Hours: true } };
    async function matchingIds(now: string) {
      const window = getKitchenBusinessDayWindow(hours, new Date(now));
      const result = await db.query(`select id from store_customer_orders where ${predicate} order by id`,
        [window.startAt, window.endAt, window.endExclusive === true]);
      return result.rows.map((row: { id: string }) => row.id);
    }
    assert.deepEqual(await matchingIds("2026-08-07T12:00:00+09:00"), ["at-start", "last-minute"]);
    assert.deepEqual(await matchingIds("2026-08-08T00:00:00+09:00"), [
      "after-end", "midnight-both", "midnight-created-only", "midnight-pickup-only"
    ]);
  } finally { await db.close(); }
});

test("actual kitchen SQL preserves timed and overnight closing boundaries", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table store_customer_orders (
      id text primary key, pickup_date date, pickup_time text, created_at timestamptz
    )`);
    for (const [label, day, now, closeDate, closeTime] of [
      ["timed", { open: "11:00", close: "20:00", closed: false }, "2026-08-07T12:00:00+09:00", "2026-08-07", "20:00"],
      ["overnight", { open: "18:00", close: "03:00", closed: false }, "2026-08-08T01:00:00+09:00", "2026-08-08", "03:00"]
    ] as const) {
      await db.exec("truncate store_customer_orders");
      await db.query(`insert into store_customer_orders values
        ('pickup-at-close', $1::date, $2, '2026-08-05T12:00:00+09:00'),
        ('created-at-close', '2026-08-10', '12:00', $3::timestamptz),
        ('after-close', '2026-08-10', '12:00', $3::timestamptz + interval '1 second')`,
        [closeDate, closeTime, `${closeDate}T${closeTime}:00+09:00`]);
      const window = getKitchenBusinessDayWindow({ fri: day }, new Date(now));
      assert.equal(window.endExclusive, undefined, label);
      const result = await db.query(`select id from store_customer_orders where ${predicate} order by id`,
        [window.startAt, window.endAt, window.endExclusive === true]);
      assert.deepEqual(result.rows.map((row: { id: string }) => row.id), ["created-at-close", "pickup-at-close"], label);
    }
  } finally { await db.close(); }
});
