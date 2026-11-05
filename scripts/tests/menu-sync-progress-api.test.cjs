const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules = {}) {
  const context = { exports: {}, Response, URL, require: name => modules[name.split('/').at(-1)] ?? {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports;
}

test('source status projects exact current and recent context without exposing command targets', async () => {
  const queries = [];
  const progressTargets = { 'item:soup': { targetName: '麻辣湯', targetKind: 'item', parentName: '定番' } };
  const api = load('app/api/menus/uber-source/route.ts', {
    'api-auth': { requireMasterOsSession: async () => ({ role: 'owner' }) },
    'menu-sync-progress': load('lib/menu-sync-progress.ts'),
    'menu-sync-status': { nextMenuCheck: () => 'next', menuSyncIssueContext: () => ({ issues: [] }) },
    db: { sql: async (parts, ...values) => {
      const query = parts.join('?'); queries.push(query);
      if (query.includes('from menu_uber_sources')) {
        assert.ok(values.includes('brand'));
        return [{ id: 'source', store_id: 'store' }];
      }
      if (query.includes('as "progressTargets"')) {
        assert.ok(values.includes('store')); assert.ok(values.includes('source'));
        assert.match(query, /target->>'sourceKey'=coalesce/);
        assert.match(query, /parent->>'targetId'=target->>'parentId'/);
        assert.match(query, /count\(\*\)=1/);
        assert.match(query, /where ordinal<=10/);
        return [
          { id: 'latest', platform: 'rocket_now', status: 'processing', progress: { sourceKey: 'item:soup', phase: 'content', telemetryVersion: 2, checkedTargets: 323, totalTargets: 323, skippedTargets: 322, contentChanges: 1, contentCompleted: 0, writeRequestsCompleted: 0, readRequestsCompleted: 55, token: 'secret', authorityOperation: { externalId: 'private' }, recent: [{ at: 42, sourceKey: 'item:soup', phase: 'preflight', action: 'read_menu' }] }, progressTargets, targetNames: {} },
          { id: 'older', platform: 'rocket_now', status: 'succeeded', progress: { sourceKey: 'item:soup', phase: 'verifying' }, progressTargets, targetNames: {} }
        ];
      }
      assert.doesNotMatch(query, /cross join lateral/);
      return [];
    } }
  });
  const response = await api.GET(new Request('http://test/api/menus/uber-source?brandId=brand'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(body.jobs.length, 1);
  assert.equal(body.jobs[0].progress.targetName, '麻辣湯');
  assert.equal(body.jobs[0].progress.parentName, '定番');
  assert.equal(body.jobs[0].progress.recent[0].targetKind, 'item');
  assert.equal(body.jobs[0].progress.telemetryVersion, 2);
  assert.equal(body.jobs[0].progress.checkedTargets, 323);
  assert.equal(body.jobs[0].progress.totalTargets, 323);
  assert.equal(body.jobs[0].progress.skippedTargets, 322);
  assert.equal(body.jobs[0].progress.contentChanges, 1);
  assert.equal(body.jobs[0].progress.contentCompleted, 0);
  assert.equal(body.jobs[0].progress.writeRequestsCompleted, 0);
  assert.equal(body.jobs[0].progress.readRequestsCompleted, 55);
  assert.equal(body.jobHistory[1].progress.targetName, '麻辣湯');
  assert.doesNotMatch(JSON.stringify(body), /progressTargets|targetNames|authorityOperation|secret|private/);
  assert.equal(queries.length, 6);
});

test('source status denies access before reading progress', async () => {
  const api = load('app/api/menus/uber-source/route.ts', {
    'api-auth': { requireMasterOsSession: async () => null },
    db: { sql: () => { throw Error('Unauthorized database read'); } }
  });
  assert.equal((await api.GET(new Request('http://test/api/menus/uber-source?brandId=brand'))).status, 403);
});
