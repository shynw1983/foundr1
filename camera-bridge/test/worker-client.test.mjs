import { test } from 'node:test';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { CameraWorker } from '../src/worker-client.mjs';

test('a hung SDK worker is terminated at a hard deadline', async () => {
  const worker = new CameraWorker(() => {}, new URL('./unresponsive-worker.fixture.mjs', import.meta.url));
  const exit = once(worker.child, 'exit');
  await assert.rejects(worker.request('capture', {}, 100), { message: 'timeout' });
  assert.equal(worker.closed, true);
  await exit;
  assert.equal(worker.pending.size, 0);
});
test('closing during capture rejects pending work and does not accept a retry on the old worker', async () => {
  const worker = new CameraWorker(() => {}, new URL('./unresponsive-worker.fixture.mjs', import.meta.url));
  const exit = once(worker.child, 'exit'), pending = assert.rejects(worker.request('capture'), { message: 'cancelled' });
  worker.close(); await pending;
  await assert.rejects(worker.request('capture'), { message: 'cancelled' });
  await exit;
});
