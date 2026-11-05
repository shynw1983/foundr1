import test from "node:test";
import assert from "node:assert/strict";
import { createAvailabilityDrafts } from "./staff-shift-availability.ts";

test("uses each date's defaults without automatically requesting work", () => {
  const drafts = createAvailabilityDrafts(["2026-10-26", "2026-10-27"], [], [
    { workDate: "2026-10-26", availableStart: "10:30", availableEnd: "23:00" },
    { workDate: "2026-10-27", availableStart: "11:30", availableEnd: "01:00" }
  ]);
  assert.deepEqual(drafts.map(({ availableStart, availableEnd, wantsWork }) => ({ availableStart, availableEnd, wantsWork })), [
    { availableStart: "10:30", availableEnd: "23:00", wantsWork: false },
    { availableStart: "11:30", availableEnd: "01:00", wantsWork: false }
  ]);
});
test("preserves submitted employee choices and notes when store defaults change", () => {
  const drafts = createAvailabilityDrafts(["2026-10-26"], [{
    requestType: "availability", workDate: "2026-10-26", note: "original",
    windows: [{ workDate: "2026-10-26", availableStart: "13:00", availableEnd: "18:00", note: "school" }]
  }], [{ workDate: "2026-10-26", availableStart: "10:30", availableEnd: "23:00" }]);
  assert.deepEqual(drafts[0], { workDate: "2026-10-26", availableStart: "13:00", availableEnd: "18:00", wantsWork: true, note: "school" });
});
test("leaves days without defaults blank rather than inventing a fixed shift", () => {
  assert.deepEqual(createAvailabilityDrafts(["2026-10-28"], [])[0], {
    workDate: "2026-10-28", wantsWork: false, availableStart: "", availableEnd: "", note: ""
  });
});
