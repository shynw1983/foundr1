import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMenuSyncProgress } from './menu-sync-progress.ts';

const targets = {
  'option:g:corn': { targetName: 'チーズコーンボール｜芝士玉米球', targetKind: 'option', parentName: 'トッピング｜配料' },
  'item:soup': { targetName: '麻辣湯', targetKind: 'item', parentName: '定番メニュー' }
};

test('current and historical targets recover only their own exact saved context', () => {
  const progress = projectMenuSyncProgress({
    phase: 'content', sourceKey: 'option:g:corn', action: 'save', completed: 3, total: 8,
    recent: [{ at: 42, phase: 'preflight', action: 'read_menu', sourceKey: 'item:soup' }]
  }, targets);
  assert.equal(progress.targetName, targets['option:g:corn'].targetName);
  assert.equal(progress.targetKind, 'option');
  assert.equal(progress.parentName, 'トッピング｜配料');
  assert.deepEqual(progress.recent, [{ at: 42, phase: 'preflight', action: 'read_menu', sourceKey: 'item:soup', targetName: '麻辣湯', targetKind: 'item', parentName: '定番メニュー' }]);
  assert.equal(progress.completed, 3);
});

test('global requests do not borrow a product from previous responses', () => {
  const progress = projectMenuSyncProgress({
    phase: 'preflight', action: 'read_menu', targetName: '',
    recent: [{ at: 42, phase: 'content', action: 'save', sourceKey: 'item:soup' }]
  }, targets);
  assert.equal(progress.targetName, undefined);
  assert.equal(progress.targetKind, undefined);
  assert.equal(progress.sourceKey, undefined);
  assert.equal(progress.recent?.[0].targetName, '麻辣湯');
  assert.equal(projectMenuSyncProgress({ sourceKey: 'item:unknown' }, targets).targetName, undefined);
});

test('legacy durable progress may resolve its exact target without exposing the operation', () => {
  const progress = projectMenuSyncProgress({
    phase: 'creating', authorityOperation: { sourceKey: 'item:soup', status: 'creating', externalId: 'native-private' }
  }, targets);
  assert.deepEqual(progress, { phase: 'creating', sourceKey: 'item:soup', targetName: '麻辣湯', targetKind: 'item', parentName: '定番メニュー' });
});

test('native request names and context are kept while IDs are never promoted to names', () => {
  assert.equal(projectMenuSyncProgress({ targetName: '  竹笋\n50g ', targetKind: 'option', parentName: '野菜' }).targetName, '竹笋 50g');
  for (const targetName of ['option:g:corn', '01234567-89ab-cdef-0123-456789abcdef', 'https://merchant.example/private']) {
    const row = projectMenuSyncProgress({ targetName, sourceKey: 'option:g:corn', targetKind: 'invalid' }, targets);
    assert.equal(row.targetName, targets['option:g:corn'].targetName);
    assert.equal(row.targetKind, 'option');
  }
  const row = projectMenuSyncProgress({ sourceKey: '__proto__' });
  assert.equal(row.targetName, undefined);
});

test('public telemetry is bounded and excludes request paths, credentials and durable state', () => {
  const progress = projectMenuSyncProgress({
    phase: '/private/path', action: 'https://merchant.example/token', completed: -1, total: Infinity,
    startedAt: 100, updatedAt: 101, requestsCompleted: 20, retry: 2,
    requestState: 'waiting', token: 'secret', path: '/private',
    authorityMigration: { sourceKey: 'item:soup', native: 'secret' },
    recent: Array.from({ length: 30 }, (_, i) => ({ at: i, action: 'read_options', targetName: 'Corn', state: 'received', occurrences: 3, token: 'secret', phase: 'content' }))
  });
  assert.equal(progress.recent?.length, 10);
  assert.deepEqual(progress.recent?.[0], { at: 0, action: 'read_options', targetName: 'Corn', state: 'received', occurrences: 3, phase: 'content' });
  assert.equal(progress.completed, undefined);
  assert.equal(progress.total, undefined);
  assert.equal(progress.phase, undefined);
  assert.equal(progress.action, undefined);
  assert.equal(progress.requestsCompleted, 20);
  assert.doesNotMatch(JSON.stringify(progress), /secret|private|authorityMigration/);
  assert.deepEqual(projectMenuSyncProgress(null), {});
  assert.deepEqual(projectMenuSyncProgress({ recent: [null, {}, { at: NaN }, { at: Number.MAX_SAFE_INTEGER }] }).recent, []);
  assert.equal(projectMenuSyncProgress({ updatedAt: Number.MAX_SAFE_INTEGER }).updatedAt, undefined);
  for (const action of ['read_item', 'read_category']) assert.equal(projectMenuSyncProgress({ action }).action, action);
});

test('version 2 keeps checked objects, content differences and native response counters separate', () => {
  const counts = {
    checkedTargets: 323, totalTargets: 323, skippedTargets: 322,
    contentChanges: 1, contentCompleted: 0, writeRequestsCompleted: 0, readRequestsCompleted: 72
  };
  assert.deepEqual(projectMenuSyncProgress({
    telemetryVersion: 2, ...counts, completed: 0, total: 1,
    writes: ['private request'], plan: { nativePayload: 'secret' }
  }), { telemetryVersion: 2, ...counts, completed: 0, total: 1 });
  assert.equal(projectMenuSyncProgress({ telemetryVersion: '2' }).telemetryVersion, undefined);
  assert.equal(projectMenuSyncProgress({ telemetryVersion: 3 }).telemetryVersion, undefined);
  for (const key of Object.keys(counts)) {
    for (const invalid of [-1, 0.5, Infinity, NaN, '323', Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(projectMenuSyncProgress({ [key]: invalid })[key as keyof typeof counts], undefined, `${key} rejects ${String(invalid)}`);
    }
    assert.equal(projectMenuSyncProgress({ [key]: 0 })[key as keyof typeof counts], 0);
  }
});
