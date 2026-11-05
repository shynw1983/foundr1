// Execute with PGLITE_MODULE pointing to an isolated @electric-sql/pglite.
// Production projection/retry SQL runs against in-memory PostgreSQL only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {
  buildInventorySyncRuns, inventorySyncCommandsSql, inventorySyncCommandRecheckSql, inventorySyncTargetLabels,
  retryInventorySyncCommandSql, type InventorySyncCommand
} from './inventory-sync-attention.ts';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const a = { kind: 'item', targetId: 'a', label: '同名商品', knownExternalIds: ['native-a'] };
const b = { kind: 'option', targetId: 'b', label: '同名商品', knownExternalIds: ['native-b'] };
const progress = { progress: { phase: 'queued', attempt: 1, maxAttempts: 3 } };

test('current-business-day inventory attention uses exact current intent and bounded success history', async t => {
  const pg = new PGlite();
  // Hold the isolated database clock at noon so preparation/overdue/history
  // cases do not change meaning when the test runner crosses Tokyo midnight.
  const nowSql = "'2026-10-18T12:00:00+09:00'::timestamptz";
  const atTestClock = (query: string) => query.replace(/\bnow\(\)/gi, nowSql).replace(/\bCURRENT_TIMESTAMP\b/gi, nowSql);
  const db = {
    exec: (query: string) => pg.exec(atTestClock(query)),
    query: (query: string, params?: unknown[]) => pg.query(atTestClock(query), params),
    close: () => pg.close()
  };
  await db.exec(`create table stores (id text primary key, name text, external_id text, business_hours jsonb default '{}');
    insert into stores(id,name,external_id) values ('store', '店舗A', 'merchant-store-a-not-json'), ('other', '店舗B', 'merchant-store-b-not-json');
    create table local_bridge_commands (
      id text primary key, store_id text default 'store', platform text default 'rocket_now',
      command_type text default 'set_inventory_availability', status text default 'failed',
      payload jsonb default '{}', result jsonb default '{}', last_error text default '', attempts integer default 0,
      created_at timestamptz default now(), updated_at timestamptz default now(), available_at timestamptz,
      claimed_by_device_id text, claimed_at timestamptz, claim_expires_at timestamptz, completed_at timestamptz
    )`);
  type Options = { run?: string; status?: string; platform?: string; store?: string; age?: number; extra?: Record<string, unknown>; error?: string; type?: string };
  const add = async (id: string, targets: unknown = [a], options: Options = {}) => {
    const payload = { syncRunId: options.run ?? id, isAvailable: false, feedbackLabel: '商品', targets, ...options.extra };
    await db.query(`insert into local_bridge_commands (id,store_id,platform,status,payload,created_at,last_error,command_type)
      values ($1,$2,$3,$4,$5,now()-$6::numeric*interval '1 minute',$7,$8)`,
    [id, options.store ?? 'store', options.platform ?? 'rocket_now', options.status ?? 'failed', JSON.stringify(payload),
      options.age ?? 1, options.error ?? '', options.type ?? 'set_inventory_availability']);
  };
  const reset = () => db.exec('truncate local_bridge_commands');
  const rows = async (storeId: string | null = 'store'): Promise<InventorySyncCommand[]> => {
    const result = await db.query(inventorySyncCommandsSql, [storeId]);
    return result.rows.map((row: Omit<InventorySyncCommand, 'targetLabels'>) => ({ ...row, targetLabels: inventorySyncTargetLabels(row) }));
  };
  const retry = async (id: string, store = 'store') => (await db.query(retryInventorySyncCommandSql, [id, store, JSON.stringify(progress)])).rows;
  try {
    await t.test('current-day failures and all current-day active work survive refreshes while older failures stay in history', async () => {
      await add('old', [a], { age: 60 * 24 * 20 });
      await add('current-failure', [{ ...a, targetId: 'current-failure' }], { age: 100 });
      for (let i = 0; i < 7; i++) await add(`active-${i}`, [{ ...a, targetId: `active-${i}` }], { status: i % 2 ? 'processing' : 'pending', age: 20 });
      const before = await rows();
      assert.equal(before.length, 8);
      assert.ok(!before.some(row => row.id === 'old'));
      assert.ok(before.every(row => row.needsAttention));
      assert.equal(before.filter(row => row.overdue).length, 7);
      assert.deepEqual((await rows()).map(row => row.attentionKey), before.map(row => row.attentionKey));
      assert.equal(buildInventorySyncRuns(before).length, 8);
      assert.equal((await db.query("select status from local_bridge_commands where id='old'")).rows[0].status, 'failed');
    });
    await t.test('native ID JSON validation remains distinct from production stores.external_id TEXT', async () => {
      await reset();
      assert.equal((await db.query("select pg_typeof(external_id)::text as type from stores where id='store'")).rows[0].type, 'text');
      await add('valid-native-id', [{ ...a, targetId: 'valid-native-id' }]);
      for (const [id, externalIds] of [['blank-native-id', ['']], ['numeric-native-id', [42]], ['null-native-id', [null]], ['object-native-id', [{}]]] as const) {
        await add(id, [{ ...a, targetId: id, knownExternalIds: externalIds }]);
      }
      const projected = await rows();
      assert.equal(projected.find(row => row.id === 'valid-native-id')!.canRetry, true);
      for (const row of projected.filter(row => row.id !== 'valid-native-id')) {
        assert.equal(row.needsAttention, true, row.id);
        assert.equal(row.canRetry, false, row.id);
        assert.equal((await retry(row.id)).length, 0, row.id);
      }
      assert.equal((await retry('valid-native-id')).length, 1);
      assert.equal((await db.query("select external_id from stores where id='store'")).rows[0].external_id, 'merchant-store-a-not-json');
    });
    await t.test('success history stays bounded and failures are restricted to the current business day', async () => {
      await reset();
      for (let i = 1; i <= 6; i++) await add(`ok-${i}`, [{ ...a, targetId: `ok-${i}` }], { status: 'succeeded', age: i });
      await add('expired-success', [{ ...a, targetId: 'expired' }], { status: 'succeeded', age: 31 });
      await add('unresolved', [{ ...a, targetId: 'unresolved' }], { age: 120 });
      await add('previous-day-failure', [{ ...a, targetId: 'previous-day' }], { age: 1500 });
      assert.deepEqual((await rows()).map(row => row.id).sort(), ['ok-1', 'ok-2', 'ok-3', 'ok-4', 'unresolved']);
    });
    await t.test('mixed platform intentions retain the actual requested state of each command', async () => {
      await reset();
      await add('restore', [a], { run: 'mixed', platform: 'uber_eats', extra: { isAvailable: true } });
      await add('stop', [b], { run: 'mixed', extra: { isAvailable: false } });
      const result = await rows();
      const [run] = buildInventorySyncRuns([result.find(row => row.id === 'restore')!, result.find(row => row.id === 'stop')!]);
      assert.equal(run.isAvailable, true);
      assert.equal(run.platforms.find(platform => platform.commandId === 'restore')!.desiredAvailable, true);
      assert.equal(run.platforms.find(platform => platform.commandId === 'stop')!.desiredAvailable, false);
    });
    await t.test('new pending intent removes the old failure without pretending success', async () => {
      await reset(); await add('old', [a], { age: 100 }); await add('new', [a], { status: 'pending' });
      const result = await rows();
      assert.deepEqual(result.map(row => row.id), ['new']);
      assert.equal(result[0].needsAttention, false);
      assert.equal(buildInventorySyncRuns(result)[0].platforms.find(p => p.platform === 'rocket_now')?.status, 'queued');
      assert.equal((await retry('old')).length, 0);
    });
    await t.test('partial overlap preserves only unresolved exact targets and retry trims atomically', async () => {
      await reset(); await add('old', [a, b], { age: 30 }); await add('new', [a], { status: 'succeeded' });
      const old = (await rows()).find(row => row.id === 'old')!;
      assert.deepEqual(old.payload.targets, [b]); assert.deepEqual(old.targetLabels, [b.label]);
      assert.equal(old.canRetry, true);
      assert.equal((await db.query("select payload from local_bridge_commands where id='old'")).rows[0].payload.targets.length, 2);
      assert.equal((await retry('old')).length, 1);
      const receipt = (await db.query("select * from local_bridge_commands where id='old'")).rows[0];
      assert.deepEqual(receipt.payload.targets, [b]); assert.deepEqual(receipt.payload.supersededTargets, [a]);
      assert.equal(receipt.status, 'pending');
      const retried = (await rows()).find(row => row.id === 'old')!;
      assert.equal(retried.needsAttention, true); assert.equal(retried.attentionKey, old.attentionKey);
      assert.equal(retried.canRetry, false);
      await db.exec("update local_bridge_commands set status='succeeded' where id='old'");
      assert.ok((await rows()).every(row => !row.needsAttention));
    });
    await t.test('same names, store, platform, kind and target IDs never merge unrelated targets', async () => {
      await reset(); await add('old', [a, b], { age: 40 });
      await add('other-store', [a], { status: 'succeeded', store: 'other' });
      await add('other-platform', [a], { status: 'succeeded', platform: 'uber_eats' });
      await add('other-kind', [{ ...a, kind: 'option' }], { status: 'succeeded' });
      await add('other-id', [{ ...a, targetId: 'not-a' }], { status: 'succeeded' });
      const old = (await rows()).find(row => row.id === 'old')!;
      assert.deepEqual(old.payload.targets, [a, b]); assert.deepEqual(old.targetLabels, [a.label, b.label]);
      assert.ok((await rows()).every(row => row.storeId === 'store'));
      assert.ok((await rows(null)).some(row => row.storeId === 'other'));
    });
    await t.test('cancelled and fully replaced failures stop alerting; old success still resolves exact failure', async () => {
      await reset(); await add('old', [a], { age: 10000 });
      await add('success', [a], { status: 'succeeded', age: 1000 });
      await add('cancelled', [b], { status: 'cancelled', age: 10 });
      assert.deepEqual(await rows(), []);
    });
    await t.test('same-run siblings remain separate; full-sync identities also replace older operations', async () => {
      await reset(); await add('one', [a], { age: 20, run: 'one-run' });
      await add('two', [a], { age: 10, run: 'one-run' });
      assert.equal((await rows()).length, 2);
      assert.ok((await rows()).every(row => row.canRetry), 'same-run siblings do not block each other');
      await add('full', [a], { status: 'pending', extra: { syncRunId: '', fullSyncRunId: 'whole-store-run' } });
      assert.deepEqual((await rows()).map(row => row.id), ['full']);
    });
    await t.test('unknown or malformed identities remain visible and cannot be retried', async () => {
      await reset();
      await add('no-run', [a], { run: '' });
      await add('no-targets', []);
      await add('malformed', { wrong: true });
      await add('no-id', [{ label: a.label, kind: 'item', knownExternalIds: ['native-a'] }]);
      await add('no-kind', [{ targetId: 'a', knownExternalIds: ['native-a'] }]);
      await add('no-mapping', [{ ...a, targetId: 'no-mapping', knownExternalIds: [] }]);
      await add('mixed', [b, { targetId: 'a', knownExternalIds: ['native-a'] }]);
      await add('mapping-blocked', [{ ...a, targetId: 'blocked' }], { extra: { mappingBlocked: true } });
      await add('no-state', [{ ...a, targetId: 'no-state' }], { extra: { isAvailable: null } });
      for (const row of await rows()) {
        assert.equal(row.needsAttention, true, row.id); assert.equal(row.canRetry, false, row.id);
        assert.equal((await retry(row.id)).length, 0, row.id);
      }
      assert.equal((await rows()).length, 9);
    });
    await t.test('manual retry remains attention until success, even before five minutes', async () => {
      await reset(); await add('failed', [a]);
      assert.equal((await retry('failed')).length, 1);
      const row = (await rows())[0]; assert.equal(row.overdue, false); assert.equal(row.needsAttention, true);
      await db.exec("update local_bridge_commands set status='succeeded' where id='failed'");
      assert.equal((await rows())[0].needsAttention, false);
    });
    await t.test('ambiguous operation ordering and invalid native IDs are visible without replay', async () => {
      await reset(); await add('one', [a], { age: 20 }); await add('two', [a], { age: 10 });
      await db.exec("update local_bridge_commands set created_at=(select created_at from local_bridge_commands where id='one') where id='two'");
      assert.ok((await rows()).every(row => row.needsAttention && !row.canRetry));
      assert.equal((await retry('one')).length, 0); assert.equal((await retry('two')).length, 0);
      await reset(); await add('old', [a], { age: 20 }); await add('unknown-operation', [a], { run: '' });
      assert.ok((await rows()).every(row => row.needsAttention && !row.canRetry));
      assert.equal((await retry('old')).length, 0);
      await reset();
      for (const [id, ids] of [['empty-id', ['']], ['null-id', [null]], ['object-id', [{}]]] as const) {
        await add(id, [{ ...a, targetId: id, knownExternalIds: ids }]);
        assert.equal((await retry(id)).length, 0);
      }
      assert.ok((await rows()).every(row => !row.canRetry));
    });
    await t.test('in-flight work cannot be retried; same-store full read blocks retry and legacy Demae release is refused', async () => {
      await reset(); await add('failed');
      await add('read', [], { type: 'audit_inventory', status: 'processing', extra: { availabilityAuthority: 'uber_eats' } });
      assert.equal((await rows())[0].canRetry, false); assert.equal((await retry('failed')).length, 0);
      await db.exec("delete from local_bridge_commands where id='read'");
      await add('processing', [b], { status: 'processing' });
      assert.equal((await retry('processing')).length, 0);
      await add('demae', [b], { platform: 'demae_can', extra: { isAvailable: true } });
      assert.equal((await rows()).find(row => row.id === 'demae')!.canRetry, false);
      assert.equal((await retry('demae')).length, 0);
      await db.exec("update local_bridge_commands set payload=payload||'{\"manualItemRelease\":true}'::jsonb where id='demae'");
      assert.equal((await retry('demae')).length, 1);
    });
    await t.test('route authorization/origin gates run before reads or retry; GET returns persistent attention', async () => {
      await reset(); await add('failed', [a], { age: 60, error: 'Bridge command expired before execution.' });
      const calls: string[] = [];
      function route(file: string, options: { authenticated?: boolean; scoped?: boolean; lockBusy?: boolean } = {}) {
        const sql = Object.assign(() => { throw Error('unexpected tagged SQL'); }, {
          query: async (query: string, args: unknown[]) => { calls.push('sql'); return (await db.query(query, args)).rows; }
        });
        const modules: Record<string, unknown> = {
          'api-auth': { requireOsSession: async () => options.authenticated === false ? null : { id: 'staff', role: 'staff' } },
          'store-order-access': { getStoreOrderAccess: async () => ({ stores: [{ id: 'store' }] }),
            getScopedStoreFilter: (_access: unknown, storeId: string) => options.scoped === false || storeId !== 'store' ? '__forbidden__' : storeId },
          'inventory-sync-attention': { buildInventorySyncRuns, retryInventorySyncCommandSql,
            getInventorySyncCommands: async (storeId: string) => { calls.push(`read:${storeId}`); return rows(storeId); } },
          'inventory-operation-lock': { withInventoryOperationLock: async (store: string, operation: () => Promise<unknown>) => {
            calls.push(`lock:${store}`); if (options.lockBusy) throw Error('busy'); return operation();
          } },
          'local-bridge-realtime': { publishBridgeCommandAvailable: async () => { calls.push('available'); }, publishBridgeCommandUpdated: async () => { calls.push('updated'); } },
          db: { sql }
        };
        const exports: { GET?: (request: Request) => Promise<Response>; POST?: (request: Request) => Promise<Response> } = {};
        vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
          { exports, Response, URL, require: (name: string) => modules[name.split('/').at(-1)!] ?? {} });
        return exports;
      }
      const getFile = 'app/api/store/menu-sync-runs/route.ts';
      const retryFile = 'app/api/store/menu-sync-runs/retry/route.ts';
      const request = (origin = 'https://test', storeId = 'store') => new Request('https://test/api/store/menu-sync-runs/retry', {
        method: 'POST', headers: { 'Content-Type': 'application/json', origin }, body: JSON.stringify({ storeId, commandId: 'failed' })
      });
      assert.equal((await route(getFile, { authenticated: false }).GET!(new Request('https://test/api/store/menu-sync-runs'))).status, 401);
      assert.equal((await route(getFile, { scoped: false }).GET!(new Request('https://test/api/store/menu-sync-runs?storeId=other'))).status, 403);
      assert.equal((await route(retryFile, { authenticated: false }).POST!(request())).status, 401);
      assert.equal((await route(retryFile).POST!(request('https://other'))).status, 403);
      assert.equal((await route(retryFile).POST!(request('', 'store'))).status, 403);
      assert.equal((await route(retryFile, { scoped: false }).POST!(request())).status, 403);
      assert.equal(calls.length, 0);
      const response = await route(getFile).GET!(new Request('https://test/api/store/menu-sync-runs?storeId=store'));
      const body = await response.json(); assert.equal(body.attention.count, 1);
      assert.equal(body.runs[0].storeId, 'store');
      assert.equal(body.runs[0].platforms[1].status, 'timed_out');
      assert.equal(body.runs[0].platforms[1].canRetry, true);
      assert.equal((await route(retryFile, { lockBusy: true }).POST!(request())).status, 409);
      assert.equal((await db.query("select status from local_bridge_commands where id='failed'")).rows[0].status, 'failed');
      assert.equal((await route(retryFile).POST!(request())).status, 200);
      assert.ok(calls.includes('lock:store')); assert.ok(calls.includes('sql'));
      assert.equal((await db.query("select status from local_bridge_commands where id='failed'")).rows[0].status, 'pending');
    });
    await t.test('set-based latest heads and single-command rechecks match the correlated target projection', async () => {
      await reset();
      await add('run-a-old', [a, b], { run: 'run-a', age: 50 });
      await add('run-b', [a], { run: 'run-b', age: 40 });
      await add('run-a-new', [a], { run: 'run-a', age: 30 });
      await add('run-c', [a], { run: 'run-c', age: 20 });
      await add('run-c-sibling', [b], { run: 'run-c', age: 10 });
      await add('run-d-tie', [a], { run: 'run-d', age: 20 });
      await db.exec("update local_bridge_commands set created_at=(select created_at from local_bridge_commands where id='run-c') where id='run-d-tie'");
      const missingRunTarget = { ...a, targetId: 'missing-run-target' };
      await add('unknown-old', [missingRunTarget], { run: '', age: 50 });
      await add('known-new', [missingRunTarget], { age: 10 });
      await add('malformed-target', [{ ...a, targetId: 'malformed', knownExternalIds: [null] }]);
      await add('empty-targets', []);
      await add('cancelled-newer', [b], { status: 'cancelled' });
      const allRows = await rows();
      const byId = new Map(allRows.map(row => [row.id, row]));
      assert.ok(!byId.has('run-a-old') && !byId.has('run-a-new') && !byId.has('run-b'));
      assert.equal(byId.get('run-c')?.canRetry, false);
      assert.equal(byId.get('run-d-tie')?.canRetry, false);
      assert.equal(byId.get('run-c-sibling')?.canRetry, true);
      assert.equal(byId.get('unknown-old')?.canRetry, false);
      assert.equal(byId.get('known-new')?.canRetry, true);
      assert.equal(byId.get('malformed-target')?.canRetry, false);
      // The mutation query intentionally retains the original single-command
      // correlated projection. It is an independent semantic oracle here.
      const legacyProjection = retryInventorySyncCommandSql.match(/cross join lateral \(([\s\S]*?)\) parts where/)?.[1];
      assert.ok(legacyProjection);
      const sourceRows = (await db.query("select id, payload from local_bridge_commands where status='failed'")).rows;
      for (const source of sourceRows) {
        const projected = await db.query(`select parts.remaining from local_bridge_commands target
          cross join lateral (${legacyProjection}) parts where target.id::text = $1`, [source.id]);
        const remaining = projected.rows[0].remaining;
        const hasOriginalTargets = Array.isArray(source.payload.targets) && source.payload.targets.length > 0;
        assert.equal(byId.has(source.id), remaining.length > 0 || !hasOriginalTargets, source.id);
        if (byId.has(source.id)) assert.deepEqual(byId.get(source.id)!.payload.targets, remaining, source.id);
        // Standalone SQL has only store/command parameters. Production embeds
        // this same specialization with command ID at the existing $7 binding.
        const current = await db.query(inventorySyncCommandRecheckSql.replaceAll('$7', '$2'), ['store', source.id]);
        assert.deepEqual(current.rows, byId.has(source.id) ? [byId.get(source.id)!].map(({ targetLabels, ...row }) => row) : [], source.id);
      }
      const otherStore = await db.query(inventorySyncCommandRecheckSql.replaceAll('$7', '$2'), ['other', 'known-new']);
      assert.deepEqual(otherStore.rows, [], 'single-command specialization keeps the store scope');
    });
    await t.test('large production-shaped history excludes old failures while retaining every uncovered current-day failure', async () => {
      await reset();
      // Production had 950 failed and about 3,000 successful availability
      // commands, with up to 20 targets each. Successful operations outside
      // the visible-success window must still replace exact current-day targets.
      await db.exec(`
        with common as (
          select jsonb_agg(jsonb_build_object('kind', 'item', 'targetId', 'shared-' || n,
            'knownExternalIds', jsonb_build_array('native-' || n)) order by n) as targets
          from generate_series(1, 19) n
        )
        insert into local_bridge_commands (id, status, payload, created_at)
        select 'legacy-' || n, 'failed', jsonb_build_object('syncRunId', 'failed-run-' || n, 'isAvailable', false,
          'targets', common.targets || jsonb_build_array(jsonb_build_object('kind', 'option',
            'targetId', 'uncovered-' || n, 'knownExternalIds', jsonb_build_array('native-uncovered-' || n)))),
          now() - interval '4 hours' + n * interval '1 second'
        from generate_series(1, 950) n cross join common;
        with common as (
          select jsonb_agg(jsonb_build_object('kind', 'item', 'targetId', 'shared-' || n,
            'knownExternalIds', jsonb_build_array('native-' || n)) order by n) as targets
          from generate_series(1, 20) n
        )
        insert into local_bridge_commands (id, status, payload, created_at)
        select 'historical-ok-' || n, 'succeeded', jsonb_build_object('fullSyncRunId', 'success-run-' || n,
          'isAvailable', true, 'targets', common.targets), now() - interval '2 hours' + n * interval '1 second'
        from generate_series(1, 3000) n cross join common;
      `);
      await add('historical-failure', [{ ...a, targetId: 'historical-only' }], { age: 100 * 24 * 60 });
      await db.exec("update local_bridge_commands set updated_at=now(), payload=payload||jsonb_build_object('manualRetryAt',now()) where id='historical-failure'");
      assert.equal((await db.query('select count(*)::int as count from local_bridge_commands')).rows[0].count, 3951);
      for (const scope of ['store', null]) {
        const started = performance.now();
        const result = await rows(scope);
        const elapsed = performance.now() - started;
        assert.equal(result.length, 950, 'all current-day uncovered failures survive without a row cutoff');
        assert.ok(result.every(row => row.needsAttention && row.canRetry && Array.isArray(row.payload.targets) && row.payload.targets.length === 1
          && row.payload.targets[0].targetId === row.id.replace('legacy-', 'uncovered-')));
        assert.ok(elapsed < 15_000, `set-based ${scope ?? 'global'} scan took ${Math.round(elapsed)}ms`);
        t.diagnostic(`3,951 commands / 79,001 targets, ${scope ?? 'global'} scan: ${Math.round(elapsed)}ms`);
      }
    });
  } finally { await db.close(); }
});
