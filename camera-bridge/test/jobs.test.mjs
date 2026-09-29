import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CameraJobs } from '../src/jobs.mjs';

const storeId = '10000000-0000-4000-8000-000000000001';
const id = n => `10000000-0000-4000-8000-00000000000${n}`;
function fixture(capture = async () => ({ clip: Buffer.from('video') })) {
  const captured = [], uploads = [], failures = [], removed = [];
  let clock = 100_000;
  const jobs = new CameraJobs({ storeId, cameraBindings: { parking: 'T8170TEST00001' }, now: () => clock,
    capture: async (...args) => { captured.push(args); return capture(...args); },
    upload: async job => uploads.push(job.requestId), failure: async (job, code) => failures.push([job.requestId, code]), remove: async job => removed.push(job.requestId),
  });
  const job = n => ({ storeId, cameraId: 'parking', requestId: id(n), ticket: 'signed-ticket', deadline: clock + 90_000 });
  return { jobs, job, captured, uploads, failures, removed, advance: n => clock += n };
}
test('ignores foreign store, unknown camera, expired job and replay; never polls', async () => {
  const f = fixture();
  await f.jobs.start({ ...f.job(2), storeId: id(3) }); await f.jobs.start({ ...f.job(2), cameraId: 'other' });
  await f.jobs.start({ ...f.job(2), deadline: 1 }); assert.equal(f.captured.length, 0);
  await f.jobs.start(f.job(2)); await f.jobs.start(f.job(2));
  assert.equal(f.captured.length, 1); assert.deepEqual(f.uploads, [id(2)]);
  await f.jobs.start(f.job(3)); assert.deepEqual(f.failures, [[id(3), 'busy']]);
  f.advance(11_000); await f.jobs.start(f.job(4)); assert.equal(f.captured.length, 2);
});
test('only one capture at a time and closing cancels without uploading', async () => {
  const f = fixture((serial, signal) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })));
  const pending = f.jobs.start(f.job(2));
  await f.jobs.start(f.job(3)); assert.equal(f.captured.length, 1);
  f.jobs.cancel({ requestId: id(2), cameraId: 'parking' }); await pending;
  assert.deepEqual(f.uploads, []); assert.deepEqual(f.failures, [[id(3), 'busy'], [id(2), 'cancelled']]);
});
test('cancellation arriving before capture prevents late wakeup', async () => {
  const f = fixture();
  f.jobs.cancel({ requestId: id(2), cameraId: 'parking' }); await f.jobs.start(f.job(2));
  assert.equal(f.captured.length, 0);
});
test('unexpected errors never reveal SDK credentials or raw responses', async () => {
  const f = fixture(async () => { throw new Error('password or raw session response'); });
  await f.jobs.start(f.job(2)); assert.deepEqual(f.failures, [[id(2), 'unavailable']]);
});
