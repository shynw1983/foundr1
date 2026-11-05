import assert from "node:assert/strict";
import test from "node:test";
import { runPosPrintJobs, type PosPrintJob } from "./pos-print-jobs.ts";

const batch = () => ["037 厨房", "037 出品", "037 番号札", "038 厨房", "038 出品", "038 番号札", "レシート"].map((label, index) => ({
  id: String(index), storeId: "s", orderId: "o", label, state: "pending", error: "", payload: { version: 1 }
} as PosPrintJob));

test("a partial print failure stops the three-ticket batch and retains each document identity", async () => {
  const jobs = batch();
  const sent: string[] = [];
  const states: string[] = [];
  await runPosPrintJobs(jobs, async job => { states.push(`${job.id}:${job.state}`); }, async () => {
    sent.push(jobs[sent.length].label);
    return sent.length === 2 ? { ok: false, error: "paper" } : { ok: true };
  });
  assert.deepEqual(sent, ["037 厨房", "037 出品"]);
  assert.deepEqual(jobs.map(job => job.state), ["sent", "failed", "pending", "pending", "pending", "pending", "pending"]);
  assert.deepEqual(states, ["0:sending", "0:sent", "1:sending", "1:failed"]);
  await runPosPrintJobs(jobs, async () => {}, async () => { throw new Error("must not retry unknown result automatically"); });
  jobs[1].state = "pending"; // operator explicitly confirms/retries only the failed document
  let resumed = 0;
  await runPosPrintJobs(jobs, async () => {}, async () => { resumed++; return { ok: true }; });
  assert.equal(resumed, 6);
});

test("interruption and storage failure never automatically send a second copy", async () => {
  const jobs = batch();
  jobs[0].state = "sending";
  let sends = 0;
  await runPosPrintJobs(jobs, async () => {}, async () => { sends++; return { ok: true }; });
  assert.equal(sends, 0);
  await assert.rejects(runPosPrintJobs(batch(), async () => { throw new Error("storage"); }, async () => { sends++; return { ok: true }; }), /storage/);
  assert.equal(sends, 0);
});
