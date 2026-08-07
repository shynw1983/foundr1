import assert from "node:assert/strict";
import test from "node:test";
import { getKitchenBusinessDayWindow } from "./kitchen-business-day.ts";

const weekly = {
  mon: { open: "11:00", close: "22:00", closed: false },
  tue: { open: "11:00", close: "22:00", closed: false },
  wed: { open: "11:00", close: "22:00", closed: false },
  thu: { open: "11:00", close: "22:00", closed: false },
  fri: { open: "18:00", close: "03:00", closed: false },
  sat: { open: "18:00", close: "03:00", closed: false },
  sun: { open: "11:00", close: "22:00", closed: false }
};

test("keeps after-midnight kitchen orders in the previous business day", () => {
  assert.deepEqual(
    getKitchenBusinessDayWindow({ weekly }, new Date("2026-08-08T01:30:00+09:00")),
    {
      businessDate: "2026-08-07",
      startAt: "2026-08-07T18:00",
      endAt: "2026-08-08T03:00"
    }
  );
});

test("moves to the new business day after the overnight closing time", () => {
  assert.deepEqual(
    getKitchenBusinessDayWindow({ weekly }, new Date("2026-08-08T04:00:00+09:00")),
    {
      businessDate: "2026-08-08",
      startAt: "2026-08-08T18:00",
      endAt: "2026-08-09T03:00"
    }
  );
});

test("uses the Tokyo calendar day when the store is closed", () => {
  const closedWeekly = {
    ...weekly,
    sat: { open: "18:00", close: "03:00", closed: true }
  };
  assert.deepEqual(
    getKitchenBusinessDayWindow({ weekly: closedWeekly }, new Date("2026-08-08T12:00:00+09:00")),
    {
      businessDate: "2026-08-08",
      startAt: "2026-08-08T00:00",
      endAt: "2026-08-08T23:59"
    }
  );
});
