// Run with PGLITE_MODULE pointing to an isolated @electric-sql/pglite install.
// This executes production SQL against an in-memory PostgreSQL, never production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileInventoryCommandsSql, newerInventoryOperationSql, inventoryTargetOverlapSql } from '../../lib/inventory-command-supersession.ts';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');

test('inventory queue reconciliation and retry use exact identities', async t => {
  const db = new PGlite();
  await db.exec(`create table local_bridge_commands (
    id text primary key, store_id text default 'store', platform text default 'rocket_now',
    command_type text default 'set_inventory_availability', status text default 'pending',
    payload jsonb, result jsonb default '{}', last_error text default '',
    created_at timestamptz, updated_at timestamptz, completed_at timestamptz
  )`);
  const item = { kind: 'item', targetId: 'beef-meal', label: '牛肉マーラータン' };
  const option = { kind: 'option', targetId: 'beef-option', label: '牛肉片' };
  const add = async (id, targets, { run = id, status = 'pending', platform = 'rocket_now', store = 'store', time = Number(id), key = 'shared', full = false } = {}) => {
    await db.query(`insert into local_bridge_commands(id,store_id,platform,status,payload,created_at)
      values($1,$2,$3,$4,$5, to_timestamp($6::double precision))`,
    [id, store, platform, status, JSON.stringify({ inventoryKey: key, [full ? 'fullSyncRunId' : 'syncRunId']: run, targets }), time]);
  };
  const reconcile = () => db.query(reconcileInventoryCommandsSql, ['store', ['rocket_now', 'uber_eats', 'demae_can']]);
  const rows = async () => (await db.query('select * from local_bridge_commands order by created_at')).rows;
  const reset = () => db.exec('truncate local_bridge_commands');
  try {
    await t.test('same operation preserves every item and option child, including shared IDs', async () => {
      await add('1', [item], { run: 'same' });
      await add('2', [option], { run: 'same' });
      await add('3', [item], { run: 'same' });
      await reconcile();
      assert.deepEqual((await rows()).map(r => r.status), ['pending','pending','pending']);
    });
    await t.test('later partial overlap removes only covered targets, retaining order and audit data', async () => {
      await reset(); await add('1', [item, option]); await add('2', [option], { key: 'different-link' });
      await reconcile();
      const [old] = await rows();
      assert.equal(old.status, 'pending'); assert.deepEqual(old.payload.targets, [item]);
      assert.deepEqual(old.payload.supersededTargets, [option]);
      await reconcile(); assert.deepEqual((await rows())[0].payload, old.payload);
    });
    for (const platform of ['rocket_now', 'uber_eats', 'demae_can']) {
      await t.test(`${platform}: repeated changes leave only latest target operation`, async () => {
        await reset();
        for (const id of ['1','2','3']) await add(id, [option], { platform });
        await reconcile();
        const result = await rows();
        assert.deepEqual(result.map(r => r.status), ['cancelled','cancelled','pending']);
        assert.equal(result[0].result.outcome, 'superseded'); assert.equal(result[0].last_error, '');
      });
    }
    await t.test('processing command is untouched even with a later operation', async () => {
      await reset(); await add('1', [option], { status: 'processing' }); await add('2', [option]);
      await reconcile(); assert.equal((await rows())[0].status, 'processing');
      assert.deepEqual((await rows())[0].payload.targets, [option]);
    });
    await t.test('store, platform, kind, and target ID isolate unrelated work', async () => {
      await reset(); await add('1', [item]);
      await add('2', [item], { store: 'other' });
      await add('3', [item], { platform: 'uber_eats' });
      await add('4', [{ ...item, kind: 'option' }]);
      await add('5', [{ ...item, targetId: 'other-id' }]);
      await reconcile(); assert.ok((await rows()).every(r => r.status === 'pending'));
    });
    await t.test('missing identity is not guessed; legacy fullSyncRunId works', async () => {
      await reset(); await add('1', [item], { run: '' }); await add('2', [item]);
      await reconcile(); assert.equal((await rows())[0].status, 'pending');
      await reset(); await add('1', [item, option], { full: true }); await add('2', [item]);
      await reconcile(); assert.deepEqual((await rows())[0].payload.targets, [option]);
    });
    await t.test('same-run siblings do not block retry, later exact targets do', async () => {
      await reset(); await add('1', [item], { run: 'same', status: 'failed' });
      await add('2', [option], { run: 'same' });
      const blocked = async () => (await db.query(`select exists (
        select 1 from local_bridge_commands target join local_bridge_commands newer
          on ${newerInventoryOperationSql('target')}
        cross join lateral jsonb_array_elements(target.payload->'targets') old_target
        cross join lateral jsonb_array_elements(newer.payload->'targets') newer_target
        where target.id='1' and ${inventoryTargetOverlapSql}) as blocked`)).rows[0].blocked;
      assert.equal(await blocked(), false);
      await add('3', [item]); assert.equal(await blocked(), true);
    });
  } finally { await db.close(); }
});
