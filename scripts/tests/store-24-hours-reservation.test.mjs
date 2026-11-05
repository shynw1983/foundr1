// Actual reservation-window module with an isolated staffing query.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as businessHours from '../../lib/store-business-hours.ts';

const code = ts.transpileModule(readFileSync('lib/store-reservation-windows.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const hours = businessHours.normalizeBusinessHours({ sat: { open: '11:00', close: '22:00', open24Hours: true }, sun: { closed: true } });
const now = new Date('2026-08-08T12:00:00+09:00');
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(rows = []) {
  const exports = {};
  let reads = 0;
  runInNewContext(code, { exports, require: name => {
    if (name === './db') return { sql: async () => { reads++; return rows; } };
    if (name === './store-business-hours') return businessHours;
    throw Error(`Unexpected dependency ${name}`);
  } });
  return { ...exports, reads: () => reads };
}

test('24-hour manual reception returns one full calendar day and never opens the following closed midnight', async () => {
  const f = fixture();
  const windows = await f.getStoreReservationWindowsForCurrentBusinessDay({ storeId: 'isolated', businessHours: hours, ignoreStaffSchedule: true, now });
  assert.deepEqual(plain(windows), [{ date: '2026-08-08', start: '00:00', end: '23:59' }]);
  assert.equal(f.reads(), 0);
  assert.equal(businessHours.isPickupWithinBusinessHours(hours, '2026-08-09', '00:00'), false);
});

test('24-hour business hours preserve staffing buffers and do not invent unstaffed availability', async () => {
  const f = fixture([{ workDate: '2026-08-08', scheduledStart: '08:00', scheduledEnd: '18:00' }]);
  assert.deepEqual(plain(await f.getStoreReservationWindowsForCurrentBusinessDay({ storeId: 'isolated', businessHours: hours, now })), [
    { date: '2026-08-08', start: '08:15', end: '17:30' }
  ]);
  const empty = fixture();
  assert.deepEqual(plain(await empty.getStoreReservationWindowsForCurrentBusinessDay({ storeId: 'isolated', businessHours: hours, now })), []);
});

test('ordinary overnight windows retain both dates', async () => {
  const f = fixture();
  assert.deepEqual(plain(await f.getStoreReservationWindowsForCurrentBusinessDay({
    storeId: 'isolated', businessHours: { fri: { open: '18:00', close: '03:00', closed: false } },
    ignoreStaffSchedule: true, now: new Date('2026-08-08T01:00:00+09:00')
  })), [
    { date: '2026-08-07', start: '18:00', end: '23:59' },
    { date: '2026-08-08', start: '00:00', end: '03:00' }
  ]);
});
