// Execute real reference-sync SQL in isolated Postgres. Never loads DATABASE_URL.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require(process.env.FOUNDR1_TYPESCRIPT_MODULE || 'typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Native ID normalization is a real shared pure function. Importing this
// module performs no browser/network action; no native client is constructed.
const nativeIdentity = await import(pathToFileURL(resolve(root, 'desktop-bridge/src/uber-authority-parents.mjs')).href);
const copy = (value) => JSON.parse(JSON.stringify(value));
const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const platforms = ['uber_eats', 'rocket_now', 'demae_can'];

async function fixture() {
  const db = new PGlite();
  try {
  const ids = { store: uuid(1), otherStore: uuid(2), brand: uuid(3), employee: uuid(4), source: uuid(5), item: uuid(20) };
  const statements = [];
  let wakeCount = 0;
  let sequence = 9000;
  let session = { id: ids.employee, name: 'Test operator', role: 'store_manager' };
  let permitted = true;
  const access = { role: 'store_manager', allStores: false, stores: [{ id: ids.store, name: 'Test store' }], storeIds: [ids.store] };
  async function execute(query, connection = db) {
    statements.push({ text: query.text, values: copy(query.values) });
    return (await connection.query(query.text, query.values)).rows;
  }
  const sql = Object.assign((parts, ...values) => ({
    text: parts.reduce((text, part, index) => text + part + (index < values.length ? `$${index + 1}` : ''), ''),
    values,
    then(onResolve, onReject) { return execute(this).then(onResolve, onReject); }
  }), {
    transaction: (queries) => db.transaction(async (transaction) => {
      const results = [];
      for (const query of queries) results.push(await execute(query, transaction));
      return results;
    })
  });
  const mocks = {
    'lib/db.ts': { sql },
    'desktop-bridge/src/uber-authority-parents.mjs': nativeIdentity,
    'lib/local-bridge-realtime.ts': { publishBridgeCommandAvailable: async () => { wakeCount++; } },
    'lib/api-auth.ts': { requireOsSession: async () => session },
    'lib/store-order-access.ts': {
      getStoreOrderAccess: async () => access,
      getScopedStoreFilter: (_access, requestedStoreId) => permitted && requestedStoreId === ids.store ? ids.store : '__forbidden__'
    },
    // Unrelated single-target writer is not part of a reference-sync route test.
    'lib/inventory-availability.ts': {
      applyInventoryAvailability: async () => { throw new Error('Unexpected single-target write'); },
      loadInventoryAvailabilityTargets: async () => { throw new Error('Unexpected single-target resolution'); }
    }
  };
  const cache = new Map();
  function load(path) {
    if (mocks[path]) return mocks[path];
    if (cache.has(path)) return cache.get(path);
    const filename = resolve(root, path);
    const exports = {};
    cache.set(path, exports);
    const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    runInNewContext(source, { exports, Response, Request, URL, console, require: (name) => {
      if (name === 'node:crypto') return require(name);
      if (!name.startsWith('.')) throw new Error(`Unexpected dependency: ${name}`);
      const candidate = resolve(dirname(filename), name);
      const dependency = existsSync(candidate) ? candidate : `${candidate}.ts`;
      assert.ok(dependency.startsWith(`${root}/`));
      return load(dependency.slice(root.length + 1));
    } }, { filename });
    return exports;
  }
  await db.exec(`
    create table brands(id uuid primary key,name text,status text default 'active');
    create table store_brands(store_id uuid,brand_id uuid,primary key(store_id,brand_id));
    create table menu_catalog_items(id uuid primary key,brand_id uuid,store_id uuid,name text,display_names jsonb default '{}',external_id text,base_price numeric,is_active boolean default true,sort_order integer default 0);
    create table menu_option_groups(id uuid primary key,brand_id uuid,group_key text,name text,display_names jsonb default '{}',selection_type text,rule_json jsonb default '{}',sort_order integer default 0,is_active boolean default true);
    create table menu_options(id uuid primary key,option_group_id uuid,option_key text,name text,display_names jsonb default '{}',external_id text,price_delta numeric,sort_order integer default 0,is_active boolean default true);
    create table menu_store_settings(id uuid primary key default gen_random_uuid(),brand_id uuid,store_id uuid,menu_catalog_item_id uuid,is_available boolean default true,stock_status text default 'available',status_note text default '',price_override numeric,updated_at timestamptz default now(),unique(store_id,menu_catalog_item_id));
    create table menu_option_store_settings(id uuid primary key default gen_random_uuid(),brand_id uuid,store_id uuid,menu_option_id uuid,is_available boolean default true,stock_status text default 'available',status_note text default '',updated_at timestamptz default now(),unique(store_id,menu_option_id));
    create table menu_platform_availability_settings(id uuid primary key default gen_random_uuid(),brand_id uuid,store_id uuid,target_kind text,target_id uuid,platform text,availability text,created_at timestamptz default now(),updated_at timestamptz default now(),unique(store_id,target_kind,target_id,platform));
    create table menu_inventory_availability_blocks(store_id uuid,brand_id uuid,target_kind text,target_id uuid,inventory_key text,source_label text default '',created_at timestamptz default now(),updated_at timestamptz default now(),primary key(store_id,target_kind,target_id,inventory_key));
    create table menu_inventory_operation_locks(store_id uuid primary key,token uuid,expires_at timestamptz);
    create table menu_inventory_sync_runs(id uuid primary key default gen_random_uuid(),store_id uuid,run_type text default 'availability_change',action text,item_label text default '',inventory_key text default '',source text default 'store',requested_by uuid,details jsonb default '{}',created_at timestamptz default now());
    create table local_bridge_commands(id uuid primary key default gen_random_uuid(),store_id uuid,platform text,command_type text,idempotency_key text unique,payload jsonb default '{}',status text default 'pending',attempts integer default 0,available_at timestamptz default now(),claimed_at timestamptz,claim_expires_at timestamptz,completed_at timestamptz,result jsonb default '{}',last_error text default '',created_at timestamptz default now(),updated_at timestamptz default now());
    create table store_sales_sources(id uuid primary key default gen_random_uuid(),store_id uuid,source_platform text,source_label text default '',is_enabled boolean default true,metadata jsonb default '{}',updated_at timestamptz default now());
    create table menu_external_platforms(id uuid primary key,brand_id uuid,store_id uuid,platform_key text,name text default '',is_active boolean default true,rule_config jsonb default '{}');
    create table menu_platform_object_mappings(id uuid primary key default gen_random_uuid(),brand_id uuid,store_id uuid,external_platform_id uuid,target_type text,target_id uuid,external_id text,external_parent_id text default '',external_name text default '',last_observed_state jsonb default '{}',last_verified_at timestamptz,updated_at timestamptz default now(),unique(external_platform_id,target_type,external_id));
    create table menu_platform_target_settings(id uuid primary key default gen_random_uuid(),brand_id uuid,store_id uuid,external_platform_id uuid,target_type text,target_id uuid,is_enabled boolean default true,updated_at timestamptz default now());
    create table menu_uber_sources(id uuid primary key,brand_id uuid,store_id uuid,uber_store_uuid text,enabled boolean default true,auto_publish boolean default false,publish_config jsonb default '{}',revision integer default 44,last_content_hash text default 'fixture-hash',updated_at timestamptz default now());
    create table menu_uber_objects(source_id uuid,source_key text,kind text,uber_id text,parent_uber_id text default '',target_id uuid,source_payload jsonb default '{}',archived boolean default false,updated_at timestamptz default now(),primary key(source_id,source_key),unique(source_id,kind,target_id));
  `);
  await db.query('insert into brands(id,name) values ($1,$2)', [ids.brand, 'Test malatang']);
  await db.query('insert into store_brands values ($1,$2)', [ids.store, ids.brand]);
  await db.query('insert into menu_uber_sources(id,brand_id,store_id,uber_store_uuid,publish_config) values ($1,$2,$3,$4,$5)', [
    ids.source, ids.brand, ids.store, uuid(600), JSON.stringify({ rocket_now: { merchantId: '118575' }, demae_can: { merchantId: '410649', menuPatternCode: 'D8Ta' } })
  ]);
  for (const [index, platform] of platforms.entries()) {
    await db.query('insert into store_sales_sources(store_id,source_platform,source_label) values ($1,$2,$2)', [ids.store, platform]);
    await db.query('insert into menu_external_platforms(id,brand_id,platform_key) values ($1,$2,$3)', [uuid(100 + index), ids.brand, platform]);
  }
  const groups = [
    { id: uuid(200), key: 'soup-selection', name: '汤底选择', selection: 'single', rule: { minSelect: 1, maxSelect: 1, defaultOptionKey: 'classic' } },
    { id: uuid(201), key: 'basic', name: '数量配料', selection: 'multiple', rule: { allowQuantity: true, maxSelect: 100 } },
    { id: uuid(202), key: 'option-any', name: '普通选项', selection: 'single', rule: {} },
    { id: uuid(203), key: '', name: '未来无 key 组', selection: 'single', rule: {} }
  ];
  for (const [index, group] of groups.entries()) {
    await db.query('insert into menu_option_groups(id,brand_id,group_key,name,selection_type,rule_json,sort_order) values ($1,$2,$3,$4,$5,$6,$7)', [group.id, ids.brand, group.key, group.name, group.selection, JSON.stringify(group.rule), index]);
    await db.query('insert into menu_uber_objects(source_id,source_key,kind,uber_id,target_id,source_payload) values ($1,$2,$3,$4,$5,$6)', [ids.source, `option_group:${uuid(620 + index)}`, 'option_group', uuid(620 + index), group.id, JSON.stringify({ name: group.name })]);
  }
  const definitions = [
    { group: 0, name: '经典汤底', key: 'classic', price: 0, os: false, uber_eats: false, rocket_now: true, demae_can: true },
    { group: 0, name: '药膳牛骨汤底', key: 'bone', price: 103, os: true, uber_eats: true, rocket_now: true, demae_can: false },
    { group: 0, name: '番茄汤底', key: 'tomato', price: 185, os: false, uber_eats: false, rocket_now: false, demae_can: false },
    { group: 0, name: '菌菇汤底', key: 'mushroom', price: 103, os: false, uber_eats: false, rocket_now: false, demae_can: false },
    { group: 1, name: '1杯', key: 'quantity', price: 300, os: false, uber_eats: false, rocket_now: true, demae_can: false },
    { group: 2, name: 'A', key: 'same-a', price: 0, os: true, uber_eats: true, rocket_now: false, demae_can: true },
    { group: 2, name: 'A', key: 'same-b', price: 2, os: true, uber_eats: true, rocket_now: true, demae_can: true },
    { group: 3, name: '未来选项', key: '', price: 0, os: true, uber_eats: true, rocket_now: true, demae_can: true }
  ];
  const targets = [{ kind: 'item', targetId: ids.item, brandId: ids.brand, label: '独立汤底', groupKey: '', aliases: [] }];
  const stateByKey = new Map();
  stateByKey.set(`item:${ids.item}`, { os: true, uber_eats: true, rocket_now: false, demae_can: true });
  await db.query('insert into menu_catalog_items(id,brand_id,name,base_price) values ($1,$2,$3,880)', [ids.item, ids.brand, '独立汤底']);
  await db.query("insert into menu_store_settings(brand_id,store_id,menu_catalog_item_id,is_available,stock_status,status_note,updated_at) values ($1,$2,$3,true,'available','original',now()-interval '1 hour')", [ids.brand, ids.store, ids.item]);
  await db.query('insert into menu_uber_objects(source_id,source_key,kind,uber_id,target_id,source_payload) values ($1,$2,$3,$4,$5,$6)', [ids.source, `item:${uuid(640)}`, 'item', uuid(640), ids.item, JSON.stringify({ name: '独立汤底', price: 880 })]);
  for (const [index, definition] of definitions.entries()) {
    const id = uuid(1000 + index);
    const group = groups[definition.group];
    const sourceKey = `option:${uuid(620 + definition.group)}:${uuid(641 + index)}`;
    await db.query('insert into menu_options(id,option_group_id,option_key,name,external_id,price_delta,sort_order) values ($1,$2,$3,$4,$5,$6,$7)', [id, group.id, definition.key, definition.name, uuid(641 + index), definition.price, index]);
    await db.query("insert into menu_option_store_settings(brand_id,store_id,menu_option_id,is_available,stock_status,status_note,updated_at) values ($1,$2,$3,$4,$5,'original',now()-interval '1 hour')", [ids.brand, ids.store, id, definition.os, definition.os ? 'available' : 'unavailable']);
    await db.query('insert into menu_uber_objects(source_id,source_key,kind,uber_id,parent_uber_id,target_id,source_payload) values ($1,$2,$3,$4,$5,$6,$7)', [ids.source, sourceKey, 'option', uuid(641 + index), uuid(620 + definition.group), id, JSON.stringify({ name: definition.name, price: definition.price })]);
    targets.push({ kind: 'option', targetId: id, brandId: ids.brand, label: definition.name, groupKey: group.key, aliases: [] });
    stateByKey.set(`option:${id}`, definition);
  }
  for (const [index, target] of targets.entries()) {
    for (const [platformIndex, platform] of platforms.entries()) {
      const externalIds = platform === 'uber_eats' ? [`legacy-ignored-${index}`]
        : platform === 'rocket_now' ? [target.kind === 'item' ? `sub_checkbox_1652419_${10000000 + index}` : `sub_checkbox_1467440_${7000000 + index}`]
        : [`itemList_410649${String(100 + index).padStart(8, '0')}${target.kind === 'option'}`];
      if (platform === 'rocket_now' && target.targetId === uuid(1004)) externalIds.push(`sub_checkbox_1467440_${7100000 + index}`);
      for (const externalId of externalIds) await db.query('insert into menu_platform_object_mappings(brand_id,external_platform_id,target_type,target_id,external_id,external_parent_id) values ($1,$2,$3,$4,$5,$6)', [ids.brand, uuid(100 + platformIndex), target.kind, target.targetId, externalId, platform === 'rocket_now' ? '1467440' : '0011']);
    }
  }
  const service = load('lib/inventory-manual-sync.ts');
  const mappings = load('lib/inventory-platform-object-mappings.ts');
  const optionScope = load('lib/store-menu-sales-options.ts');
  const hints = load('lib/inventory-write-recovery-hints.ts');
  const run = async (runId) => (await db.query('select * from menu_inventory_sync_runs where id=$1', [runId])).rows[0];
  const commands = async (runId) => (await db.query("select * from local_bridge_commands where coalesce(payload->>'fullSyncRunId',payload->>'syncRunId')=$1 order by platform,created_at,id", [runId])).rows;
  const stock = async () => copy(await Promise.all([
    db.query('select * from menu_store_settings order by store_id,menu_catalog_item_id'),
    db.query('select * from menu_option_store_settings order by store_id,menu_option_id'),
    db.query('select * from menu_inventory_availability_blocks order by store_id,target_kind,target_id,inventory_key'),
    db.query('select * from menu_platform_availability_settings order by store_id,target_kind,target_id,platform')
  ]).then((results) => results.map((result) => result.rows)));
  const content = async () => copy(await Promise.all([
    db.query('select * from menu_uber_sources order by id'), db.query('select * from menu_uber_objects order by source_key'),
    db.query('select * from menu_catalog_items order by id'), db.query('select * from menu_option_groups order by id'), db.query('select * from menu_options order by id')
  ]).then((results) => results.map((result) => result.rows)));
  async function start() {
    const options = await optionScope.loadStoreMenuSalesOptions(ids.store);
    const scoped = [targets[0], ...options.map((option) => targets.find((target) => target.targetId === option.id))];
    assert.equal(scoped.length, targets.length, 'All option groups must reach the real sync service');
    assert.ok(scoped.every(Boolean));
    return service.startUberAvailabilitySync(ids.store, scoped, ids.employee);
  }
  async function completeAudit(command, modifier) {
    const result = {
      targetCount: command.payload.targets.length, capturedAt: new Date().toISOString(),
      items: command.payload.targets.map((target) => {
        const isAvailable = stateByKey.get(`${target.kind}:${target.targetId}`)[command.platform];
        const basis = 'external_id';
        const externalIds = target.knownExternalIds;
        const row = { kind: target.kind, targetId: target.targetId, found: true, isAvailable, status: isAvailable ? 'available' : 'sold_out' };
        // Uber capture supplies aggregate identity-bound rows. Normal Demae DOM
        // audits supply exact wrappers, not an invented native-stock proof.
        return command.platform === 'uber_eats' ? row : { ...row,
          externalIds, nativeMatchBasis: basis, nativeObservations: externalIds.map((externalId) => ({
            externalId, ...(command.platform === 'rocket_now' ? { physicalId: externalId.split('_').at(-1) } : {}),
            found: true, isAvailable, matchBasis: basis
          })) };
      })
    };
    modifier?.(result);
    await db.query("update local_bridge_commands set status='succeeded',result=$2,completed_at=now(),updated_at=now() where id=$1", [command.id, JSON.stringify(result)]);
    return result;
  }
  async function preview(modifiers = {}) {
    const started = await start();
    let uberCommand;
    let uberResult;
    for (const command of await commands(started.runId)) {
      const result = await completeAudit(command, modifiers[command.platform]);
      if (command.platform === 'uber_eats') { uberCommand = command; uberResult = result; }
    }
    await service.applyUberAvailabilitySync(ids.store, uberCommand.payload, uberResult);
    return { ...started, details: (await run(started.runId)).details };
  }
  const writeCommands = async (runId) => (await commands(runId)).filter((command) => command.command_type === 'set_inventory_availability');
  const confirm = (state, overrides = {}) => service.confirmUberAvailabilitySync(ids.store, state.runId, {
    referencePlatform: state.details.referencePlatform, previewRevision: state.details.previewRevision, ...overrides
  });
  const select = async (state, platform) => {
    await service.setInventorySyncReference(ids.store, state.runId, platform, state.details.previewRevision);
    return { ...state, details: (await run(state.runId)).details };
  };
  return { db, ids, targets, groups, stateByKey, statements, load, service, mappings, hints, start, preview, run, commands, stock, content,
    writeCommands, confirm, select, nextId: () => uuid(++sequence), wakes: () => wakeCount,
    setSession: (value) => { session = value; }, setPermitted: (value) => { permitted = value; } };
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function withFixture(operation) {
  const f = await fixture();
  try { await operation(f); } finally { await f.db.close(); }
}

test('fresh full sync stores Uber-default intent and complete all-option reads, but requires confirmation for writes', async () => withFixture(async (f) => {
  const before = await f.stock();
  const contentBefore = await f.content();
  const started = await f.start();
  const queued = await f.commands(started.runId);
  assert.equal(queued.length, 3);
  assert.ok(queued.every((command) => command.command_type === 'audit_inventory'));
  assert.equal(queued.find((command) => command.platform === 'uber_eats').payload.targets.length, f.targets.length);
  assert.ok(queued.find((command) => command.platform === 'uber_eats').payload.targets.every((target) => target.knownExternalIds.every((id) => !id.startsWith('legacy-ignored-'))));
  const state = await f.run(started.runId);
  assert.equal(state.details.authority, 'uber_eats');
  assert.equal(state.details.referencePlatform, 'uber_eats');
  assert.deepEqual(await f.stock(), before);
  assert.deepEqual(await f.content(), contentBefore);
  assert.equal((await f.writeCommands(started.runId)).length, 0);
}));

test('changing a readable reference rebuilds preview and token without changing stock, source content or queuing writes', async () => withFixture(async (f) => {
  const state = await f.preview();
  const before = await f.stock();
  const contentBefore = await f.content();
  assert.match(state.details.previewRevision, /^[0-9a-f-]{36}$/i);
  const changed = await f.select(state, 'rocket_now');
  assert.equal(changed.details.referencePlatform, 'rocket_now');
  assert.equal(changed.details.authority, 'uber_eats');
  assert.notEqual(changed.details.previewRevision, state.details.previewRevision);
  assert.equal(changed.details.previewAt, state.details.previewAt, 'Switching reference must not renew the original read TTL');
  assert.equal((await f.writeCommands(state.runId)).length, 0);
  assert.deepEqual(await f.stock(), before);
  assert.deepEqual(await f.content(), contentBefore);
  assert.ok(changed.details.referencePreview.length > 0);
  assert.equal(changed.details.referencePreview.find((target) => target.targetId === uuid(1000)).referenceAvailable, true);
}));

test('confirmed Rocket reference updates OS and other differing platforms, never writes Rocket and keeps exact permanent Uber IDs', async () => withFixture(async (f) => {
  const contentBefore = await f.content();
  const state = await f.select(await f.preview(), 'rocket_now');
  await f.confirm(state);
  const commands = await f.writeCommands(state.runId);
  assert.ok(commands.some((command) => command.platform === 'uber_eats'));
  assert.ok(commands.some((command) => command.platform === 'demae_can'));
  assert.ok(commands.every((command) => command.platform !== 'rocket_now'));
  const currentMappings = await f.mappings.loadInventoryPlatformExternalIdMap(f.ids.store, f.targets);
  for (const command of commands) {
    assert.equal(command.payload.referencePlatform, 'rocket_now');
    assert.equal(command.payload.availabilityAuthority, 'uber_eats');
    assert.equal(command.payload.syncSource, 'store');
    assert.equal(command.payload.soldOutMode, 'indefinite');
    assert.equal(command.payload.verifyAvailability, true);
    for (const target of command.payload.targets) {
      assert.deepEqual([...target.knownExternalIds].sort(), [...f.mappings.inventoryPlatformExternalIds(currentMappings, command.platform, target)].sort());
      assert.equal(command.payload.isAvailable, f.stateByKey.get(`${target.kind}:${target.targetId}`).rocket_now);
    }
  }
  const optionRows = (await f.db.query('select menu_option_id::text as id,is_available as available from menu_option_store_settings order by menu_option_id')).rows;
  for (const target of f.targets.filter((target) => target.kind === 'option')) assert.equal(optionRows.find((row) => row.id === target.targetId).available, f.stateByKey.get(`option:${target.targetId}`).rocket_now);
  assert.equal((await f.db.query('select is_available from menu_store_settings where menu_catalog_item_id=$1', [f.ids.item])).rows[0].is_available, false);
  assert.equal((await f.run(state.runId)).details.osApplied, true);
  assert.deepEqual(await f.content(), contentBefore);
  const persisted = copy(await f.commands(state.runId));
  await f.confirm(state);
  assert.deepEqual(copy(await f.commands(state.runId)), persisted, 'Repeated receipt must not enqueue duplicate writes');
}));

test('old preview token, old reference and unbound legacy confirmation cannot apply a switched run', async () => withFixture(async (f) => {
  const initial = await f.preview();
  const state = await f.select(initial, 'rocket_now');
  const stockBefore = await f.stock();
  const runBefore = copy(await f.run(state.runId));
  await assert.rejects(f.confirm(initial));
  await assert.rejects(f.confirm(state, { referencePlatform: 'uber_eats' }));
  await assert.rejects(f.service.setInventorySyncReference(f.ids.store, state.runId, 'demae_can', initial.details.previewRevision));
  await assert.rejects(f.service.confirmUberAvailabilitySync(f.ids.store, state.runId));
  assert.equal((await f.writeCommands(state.runId)).length, 0);
  assert.deepEqual(await f.stock(), stockBefore);
  assert.deepEqual(copy(await f.run(state.runId)), runBefore);
}));

test('a later batch defaults to Uber instead of carrying over a prior Rocket selection', async () => withFixture(async (f) => {
  const first = await f.select(await f.preview(), 'rocket_now');
  await f.confirm(first);
  await f.db.query("update local_bridge_commands set status='succeeded',completed_at=now() where command_type='set_inventory_availability'");
  const second = await f.start();
  assert.equal((await f.run(second.runId)).details.referencePlatform, 'uber_eats');
  assert.equal((await f.run(first.runId)).details.referencePlatform, 'rocket_now');
  assert.equal((await f.writeCommands(second.runId)).length, 0);
}));

test('switching back to Uber does not revive unbound legacy confirmation for this run', async () => withFixture(async (f) => {
  const initial = await f.preview();
  const rocket = await f.select(initial, 'rocket_now');
  const backToUber = await f.select(rocket, 'uber_eats');
  const before = await f.stock();
  assert.equal(backToUber.details.referencePlatform, 'uber_eats');
  assert.equal(backToUber.details.referenceSelectionChanged, true);
  await assert.rejects(f.service.confirmUberAvailabilitySync(f.ids.store, backToUber.runId));
  assert.deepEqual(await f.stock(), before);
  assert.equal((await f.writeCommands(backToUber.runId)).length, 0);
  await f.confirm(backToUber);
  assert.ok((await f.writeCommands(backToUber.runId)).every((command) => command.platform !== 'uber_eats'));
}));

test('never-switched Uber default preserves the legacy confirmation contract', async () => withFixture(async (f) => {
  const state = await f.preview();
  await f.service.confirmUberAvailabilitySync(f.ids.store, state.runId);
  assert.equal((await f.run(state.runId)).details.osApplied, true);
  assert.ok((await f.writeCommands(state.runId)).every((command) => command.platform !== 'uber_eats'));
}));

test('reference switching and confirmation do not extend an expired read or bypass concurrent work', async () => withFixture(async (f) => {
  const state = await f.preview();
  await f.db.query("update menu_inventory_sync_runs set details=details || jsonb_build_object('previewAt',(now()-interval '11 minutes')::text) where id=$1", [state.runId]);
  const expired = { ...state, details: (await f.run(state.runId)).details };
  const before = await f.stock();
  await assert.rejects(f.select(expired, 'rocket_now'));
  await assert.rejects(f.confirm(expired));
  assert.deepEqual(await f.stock(), before);
  assert.equal((await f.writeCommands(state.runId)).length, 0);
  await f.db.query("update menu_inventory_sync_runs set details=details || jsonb_build_object('previewAt',now()::text) where id=$1", [state.runId]);
  await f.db.query("insert into local_bridge_commands(store_id,platform,command_type,idempotency_key,status) values ($1,'rocket_now','publish_menu_changes','concurrent-publication','processing')", [f.ids.store]);
  const busy = { ...state, details: (await f.run(state.runId)).details };
  await assert.rejects(f.select(busy, 'rocket_now'));
  await assert.rejects(f.confirm(busy));
  assert.deepEqual(await f.stock(), before);
  assert.equal((await f.writeCommands(state.runId)).length, 0);
}));

test('missing or conflicting physical observations and unknown unselected destinations block reference changes', async () => {
  for (const failure of ['missing_physical', 'mixed_physical', 'duplicate_physical', 'foreign_physical', 'unknown_destination']) await withFixture(async (f) => {
    const state = await f.preview({
      [failure === 'unknown_destination' ? 'demae_can' : 'rocket_now']: (result) => {
        const row = result.items.find((item) => item.targetId === uuid(1004));
        if (failure === 'missing_physical') row.nativeObservations = row.nativeObservations.slice(0, 1);
        if (failure === 'mixed_physical') row.nativeObservations[1].isAvailable = !row.isAvailable;
        if (failure === 'duplicate_physical') row.nativeObservations[1] = { ...row.nativeObservations[0] };
        if (failure === 'foreign_physical') row.nativeObservations[0].physicalId = '99999999';
        if (failure === 'unknown_destination') { row.found = false; row.isAvailable = null; row.status = 'not_found'; }
      }
    });
    const before = await f.stock();
    const runBefore = copy(await f.run(state.runId));
    await assert.rejects(f.select(state, 'rocket_now'));
    assert.deepEqual(await f.stock(), before);
    assert.deepEqual(copy(await f.run(state.runId)), runBefore);
    assert.equal((await f.writeCommands(state.runId)).length, 0);
  });
});

test('mapping drift after preview stops confirmation instead of resolving by a same name', async () => withFixture(async (f) => {
  const state = await f.select(await f.preview(), 'rocket_now');
  const before = await f.stock();
  await f.db.query("update menu_uber_objects set uber_id=$2 where source_id=$1 and target_id=$3", [f.ids.source, uuid(800), uuid(1000)]);
  await assert.rejects(f.confirm(state));
  assert.deepEqual(await f.stock(), before);
  assert.equal((await f.writeCommands(state.runId)).length, 0);
}));

test('existing inventory blocks and explicit overrides require acknowledgment before a reference can restore them', async () => withFixture(async (f) => {
  await f.db.query("insert into menu_inventory_availability_blocks(store_id,brand_id,target_kind,target_id,inventory_key,source_label,created_at,updated_at) values ($1,$2,'option',$3,'linked-stock','protect',now()-interval '1 hour',now()-interval '1 hour')", [f.ids.store, f.ids.brand, uuid(1000)]);
  await f.db.query("insert into menu_platform_availability_settings(brand_id,store_id,target_kind,target_id,platform,availability,created_at,updated_at) values ($1,$2,'option',$3,'uber_eats','unavailable',now()-interval '1 hour',now()-interval '1 hour')", [f.ids.brand, f.ids.store, uuid(1004)]);
  const state = await f.select(await f.preview(), 'rocket_now');
  const before = await f.stock();
  await assert.rejects(f.confirm(state));
  assert.deepEqual(await f.stock(), before);
  assert.equal((await f.writeCommands(state.runId)).length, 0);
  await f.confirm(state, { acknowledgeInventoryConflicts: true });
  assert.equal((await f.db.query('select count(*)::int as count from menu_inventory_availability_blocks')).rows[0].count, 0);
  assert.equal((await f.db.query('select count(*)::int as count from menu_platform_availability_settings')).rows[0].count, 0);
  assert.ok((await f.writeCommands(state.runId)).some((command) => command.platform === 'uber_eats'));
}));

test('an actual command insertion failure rolls back OS, conflict clearing and applied receipt atomically', async () => withFixture(async (f) => {
  await f.db.query("insert into menu_inventory_availability_blocks(store_id,brand_id,target_kind,target_id,inventory_key,created_at,updated_at) values ($1,$2,'option',$3,'rollback-protect',now()-interval '1 hour',now()-interval '1 hour')", [f.ids.store, f.ids.brand, uuid(1000)]);
  const state = await f.select(await f.preview(), 'rocket_now');
  const before = await f.stock();
  const runBefore = copy(await f.run(state.runId));
  await f.db.exec("alter table local_bridge_commands add constraint test_reject_inventory_write check(command_type <> 'set_inventory_availability') not valid");
  await assert.rejects(f.confirm(state, { acknowledgeInventoryConflicts: true }));
  assert.deepEqual(await f.stock(), before);
  assert.deepEqual(copy(await f.run(state.runId)), runBefore);
  assert.equal((await f.writeCommands(state.runId)).length, 0);
  assert.equal((await f.db.query('select count(*)::int as count from menu_inventory_operation_locks')).rows[0].count, 0);
}));

test('Demae reference skips exact excluded or verified-staged rows instead of treating them as available', async () => {
  for (const policy of ['excluded', 'staged']) await withFixture(async (f) => {
    if (policy === 'excluded') {
      const key = `option:${uuid(621)}:${uuid(645)}`;
      await f.db.query("update menu_uber_sources set publish_config=jsonb_set(publish_config,'{demae_can,excludedSourceKeys}',$2::jsonb) where id=$1", [f.ids.source, JSON.stringify([key])]);
      await f.db.query('delete from menu_platform_object_mappings where external_platform_id=$1 and target_id=$2', [uuid(102), uuid(1004)]);
    }
    const initial = await f.preview(policy === 'staged' ? {
      demae_can: (result) => {
        const row = result.items.find((item) => item.targetId === uuid(1004));
        Object.assign(row, { isAvailable: null, status: 'staged', stagingVerified: true, nativeObservations: [] });
      }
    } : {});
    const state = await f.select(initial, 'demae_can');
    await f.confirm(state);
    const commands = await f.writeCommands(state.runId);
    assert.ok(commands.length > 0);
    assert.ok(commands.every((command) => command.platform !== 'demae_can'));
    assert.ok(commands.every((command) => command.payload.targets.every((target) => target.targetId !== uuid(1004))));
    assert.equal((await f.db.query('select is_available from menu_option_store_settings where menu_option_id=$1', [uuid(1004)])).rows[0].is_available, false);
  });
});

test('Demae DOM proof without invented physical fields can be selected using exact merchant-scoped wrappers', async () => withFixture(async (f) => {
  const contentBefore = await f.content();
  const state = await f.select(await f.preview(), 'demae_can');
  await f.confirm(state);
  const commands = await f.writeCommands(state.runId);
  assert.ok(commands.some((command) => command.platform === 'uber_eats'));
  assert.ok(commands.some((command) => command.platform === 'rocket_now'));
  assert.ok(commands.every((command) => command.platform !== 'demae_can'));
  for (const target of f.targets.filter((target) => target.kind === 'option')) {
    assert.equal((await f.db.query('select is_available from menu_option_store_settings where menu_option_id=$1', [target.targetId])).rows[0].is_available,
      f.stateByKey.get(`option:${target.targetId}`).demae_can);
  }
  assert.deepEqual(await f.content(), contentBefore);
}));

test('Demae merchant drift and foreign native-stock physical identity cannot authorize a reference', async () => {
  for (const defect of ['merchant_drift', 'merchant_empty', 'merchant_ambiguous', 'native_stock_wrong_physical']) await withFixture(async (f) => {
    const state = await f.preview(defect === 'native_stock_wrong_physical' ? { demae_can: (result) => {
      for (const row of result.items) {
        row.nativeMatchBasis = 'native_stock';
        for (const observation of row.nativeObservations) {
          observation.matchBasis = 'native_stock';
          observation.physicalId = '99999999';
        }
      }
    } } : {});
    if (defect === 'merchant_drift') await f.db.query("update menu_uber_sources set publish_config=jsonb_set(publish_config,'{demae_can,merchantId}','\"410650\"'::jsonb) where id=$1", [f.ids.source]);
    if (defect === 'merchant_empty') await f.db.query("update menu_uber_sources set publish_config=jsonb_set(publish_config,'{demae_can,merchantId}','\"\"'::jsonb) where id=$1", [f.ids.source]);
    if (defect === 'merchant_ambiguous') {
      // Defensive corrupted-state fixture: schema normally has one source per
      // brand, but ambiguity must never choose the first merchant silently.
      await f.db.query('insert into menu_uber_sources(id,brand_id,store_id,uber_store_uuid,publish_config) values ($1,$2,$3,$4,$5)', [
        f.nextId(), f.ids.brand, f.ids.store, uuid(601), JSON.stringify({ demae_can: { merchantId: '410650' } })
      ]);
    }
    const before = await f.stock();
    await assert.rejects(f.select(state, 'demae_can'));
    assert.deepEqual(await f.stock(), before);
    assert.equal((await f.writeCommands(state.runId)).length, 0);
  });
});

test('real operation lease and foreign run identity cannot be bypassed by a reference request', async () => withFixture(async (f) => {
  const state = await f.preview();
  const before = await f.stock();
  const token = f.nextId();
  await f.db.query("insert into menu_inventory_operation_locks values ($1,$2,now()+interval '5 minutes')", [f.ids.store, token]);
  await assert.rejects(f.select(state, 'rocket_now'));
  await assert.rejects(f.confirm(state));
  assert.equal((await f.db.query('select token::text from menu_inventory_operation_locks where store_id=$1', [f.ids.store])).rows[0].token, token);
  assert.deepEqual(await f.stock(), before);
  assert.equal((await f.writeCommands(state.runId)).length, 0);
  await f.db.query('delete from menu_inventory_operation_locks where store_id=$1', [f.ids.store]);
  await assert.rejects(f.service.setInventorySyncReference(f.ids.otherStore, state.runId, 'rocket_now', state.details.previewRevision));
  await assert.rejects(f.service.confirmUberAvailabilitySync(f.ids.otherStore, state.runId, { referencePlatform: 'uber_eats', previewRevision: state.details.previewRevision }));
  assert.deepEqual(await f.stock(), before);
  assert.equal((await f.writeCommands(state.runId)).length, 0);
}));

test('missing reference mappings do not become a same-name fallback or partial write batch', async () => withFixture(async (f) => {
  await f.db.query('delete from menu_platform_object_mappings where external_platform_id=$1 and target_id=$2', [uuid(101), uuid(1005)]);
  const state = await f.preview();
  const before = await f.stock();
  await assert.rejects(f.select(state, 'rocket_now'));
  await assert.rejects(f.confirm(state));
  assert.deepEqual(await f.stock(), before);
  assert.equal((await f.writeCommands(state.runId)).length, 0);
}));

test('Rocket observations may change group prefix only when every exact physical identity remains unchanged', async () => withFixture(async (f) => {
  const initial = await f.preview({ rocket_now: (result) => {
    for (const item of result.items) {
      item.externalIds = item.externalIds.map((id) => id.replace(/^sub_checkbox_\d+_/, 'sub_checkbox_3_'));
      for (const observation of item.nativeObservations) observation.externalId = observation.externalId.replace(/^sub_checkbox_\d+_/, 'sub_checkbox_3_');
    }
  } });
  const state = await f.select(initial, 'rocket_now');
  await f.confirm(state);
  assert.ok((await f.writeCommands(state.runId)).every((command) => command.platform !== 'rocket_now'));
  assert.equal((await f.run(state.runId)).details.osApplied, true);
}));

test('changing even a physically-equivalent saved mapping requires a fresh preview', async () => withFixture(async (f) => {
  const state = await f.select(await f.preview(), 'rocket_now');
  const before = await f.stock();
  await f.db.query("update menu_platform_object_mappings set external_id=regexp_replace(external_id,'^sub_checkbox_[0-9]+_','sub_checkbox_3_') where external_platform_id=$1 and target_id=$2", [uuid(101), uuid(1000)]);
  await assert.rejects(f.confirm(state));
  assert.deepEqual(await f.stock(), before);
  assert.equal((await f.writeCommands(state.runId)).length, 0);
}));

test('a freshly presented preview cannot make an expired selected-platform audit current', async () => {
  for (const dateField of ['updated_at', 'capturedAt']) await withFixture(async (f) => {
    const state = await f.preview();
    if (dateField === 'updated_at') await f.db.query("update local_bridge_commands set updated_at=now()-interval '11 minutes' where platform='rocket_now' and payload->>'fullSyncRunId'=$1", [state.runId]);
    else await f.db.query("update local_bridge_commands set result=result||jsonb_build_object('capturedAt',(now()-interval '11 minutes')::text) where platform='rocket_now' and payload->>'fullSyncRunId'=$1", [state.runId]);
    const before = await f.stock();
    await assert.rejects(f.select(state, 'rocket_now'));
    assert.deepEqual(await f.stock(), before);
    assert.equal((await f.writeCommands(state.runId)).length, 0);
  });
});

test('changing comparison receipt or selected-source exclusion after binding prevents confirmation', async () => {
  for (const mutation of ['audit_result', 'source_exclusion']) await withFixture(async (f) => {
    const state = await f.select(await f.preview(), 'rocket_now');
    const before = await f.stock();
    if (mutation === 'audit_result') await f.db.query("update local_bridge_commands set result=result||jsonb_build_object('changedAfterBinding',true) where platform='demae_can' and payload->>'fullSyncRunId'=$1", [state.runId]);
    else await f.db.query("update menu_uber_sources set publish_config=jsonb_set(publish_config,'{rocket_now,excludedSourceKeys}',$2::jsonb) where id=$1", [f.ids.source, JSON.stringify([`option:${uuid(620)}:${uuid(641)}`])]);
    await assert.rejects(f.confirm(state));
    assert.deepEqual(await f.stock(), before);
    assert.equal((await f.writeCommands(state.runId)).length, 0);
  });
});

test('an applied run still rejects wrong reference/token and cannot overwrite a newer local action', async () => withFixture(async (f) => {
  const state = await f.select(await f.preview(), 'rocket_now');
  await f.confirm(state);
  await f.db.query("update menu_option_store_settings set is_available=false,stock_status='unavailable',status_note='newer local action',updated_at=now() where menu_option_id=$1", [uuid(1000)]);
  const before = await f.stock();
  const commandsBefore = copy(await f.commands(state.runId));
  await assert.rejects(f.confirm(state, { referencePlatform: 'uber_eats' }));
  await assert.rejects(f.confirm(state, { previewRevision: f.nextId() }));
  await f.confirm(state);
  assert.deepEqual(await f.stock(), before);
  assert.deepEqual(copy(await f.commands(state.runId)), commandsBefore);
}));

test('platform-only restoration conflict requires acknowledgment even when OS already matches the reference', async () => withFixture(async (f) => {
  for (const platform of ['demae_can', 'uber_eats']) await f.db.query("insert into menu_platform_availability_settings(brand_id,store_id,target_kind,target_id,platform,availability,created_at,updated_at) values ($1,$2,'option',$3,$4,'unavailable',now()-interval '1 hour',now()-interval '1 hour')", [f.ids.brand, f.ids.store, uuid(1001), platform]);
  const state = await f.select(await f.preview(), 'rocket_now');
  const originalOption = copy((await f.db.query('select * from menu_option_store_settings where menu_option_id=$1', [uuid(1001)])).rows);
  const before = await f.stock();
  await assert.rejects(f.confirm(state));
  assert.deepEqual(await f.stock(), before);
  await f.confirm(state, { acknowledgeInventoryConflicts: true });
  assert.deepEqual(copy((await f.db.query('select * from menu_option_store_settings where menu_option_id=$1', [uuid(1001)])).rows), originalOption);
  assert.deepEqual((await f.db.query('select platform from menu_platform_availability_settings where target_id=$1 order by platform', [uuid(1001)])).rows, [{ platform: 'uber_eats' }]);
  assert.ok((await f.writeCommands(state.runId)).some((command) => command.platform === 'demae_can' && command.payload.isAvailable === true && command.payload.targets.some((target) => target.targetId === uuid(1001))));
}));

function apiPost(f, body) {
  const route = f.load('app/api/store/display/kitchen/inventory/route.ts');
  return route.POST(new Request('https://test.invalid/api/store/display/kitchen/inventory', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId: f.ids.store, ...body })
  }));
}

test('actual full-sync API reads every option group and records reads only before confirmation', async () => withFixture(async (f) => {
  const before = await f.stock();
  const response = await apiPost(f, { action: 'full_sync' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  const commands = await f.commands(body.runId);
  assert.equal(commands.length, 3);
  assert.ok(commands.every((command) => command.command_type === 'audit_inventory'));
  assert.deepEqual(commands.find((command) => command.platform === 'uber_eats').payload.targets.map((target) => target.targetId).sort(), f.targets.map((target) => target.targetId).sort());
  assert.deepEqual(await f.stock(), before);
}));

test('actual reference API binds refreshed token, rejects stale confirmation and applies only the confirmed reference', async () => withFixture(async (f) => {
  const initial = await f.preview();
  const stockBefore = await f.stock();
  let response = await apiPost(f, { action: 'set_full_sync_reference', runId: initial.runId, referencePlatform: 'rocket_now', previewRevision: initial.details.previewRevision });
  assert.equal(response.status, 200);
  const changed = await response.json();
  assert.equal(changed.ok, true);
  assert.equal(changed.referencePlatform, 'rocket_now');
  assert.notEqual(changed.previewRevision, initial.details.previewRevision);
  assert.deepEqual(await f.stock(), stockBefore);
  response = await apiPost(f, { action: 'confirm_full_sync', runId: initial.runId, referencePlatform: 'uber_eats', previewRevision: initial.details.previewRevision });
  assert.equal(response.status, 409);
  assert.equal((await f.writeCommands(initial.runId)).length, 0);
  response = await apiPost(f, { action: 'confirm_full_sync', runId: initial.runId, referencePlatform: changed.referencePlatform, previewRevision: changed.previewRevision });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.ok((await f.writeCommands(initial.runId)).some((command) => command.platform === 'uber_eats'));
  assert.ok((await f.writeCommands(initial.runId)).every((command) => command.platform !== 'rocket_now'));
}));

test('actual API rejects unauthenticated, out-of-store and malformed reference requests without SQL', async () => withFixture(async (f) => {
  const count = f.statements.length;
  const body = { action: 'set_full_sync_reference', runId: f.nextId(), referencePlatform: 'rocket_now', previewRevision: f.nextId() };
  f.setSession(null);
  assert.equal((await apiPost(f, body)).status, 401);
  assert.equal((await apiPost(f, { ...body, action: 'confirm_full_sync' })).status, 401);
  assert.equal(f.statements.length, count);
  f.setSession({ id: f.ids.employee, name: 'Scoped operator', role: 'store_manager' });
  f.setPermitted(false);
  assert.equal((await apiPost(f, body)).status, 400);
  assert.equal((await apiPost(f, { ...body, action: 'confirm_full_sync' })).status, 400);
  assert.equal(f.statements.length, count);
  f.setPermitted(true);
  assert.equal((await apiPost(f, { ...body, storeId: f.ids.otherStore })).status, 400);
  assert.equal((await apiPost(f, { ...body, referencePlatform: 'foundr1' })).status, 409);
  assert.equal((await apiPost(f, { ...body, previewRevision: undefined })).status, 409);
  assert.equal(f.statements.length, count);
  assert.equal((await f.db.query('select count(*)::int as count from local_bridge_commands')).rows[0].count, 0);
}));

async function addIntent(f, options = {}) {
  const runId = options.runId || f.nextId();
  const storeId = options.storeId || f.ids.store;
  const targetId = options.targetId || uuid(1000);
  const isAvailable = options.isAvailable ?? true;
  const createdAt = options.createdAt || new Date(Date.now() - 300000).toISOString();
  await f.db.query(`insert into menu_inventory_sync_runs(id,store_id,run_type,action,source,details,created_at)
    values ($1,$2,'availability_change',$3,$4,$5,$6)`, [runId, storeId,
    options.action || (isAvailable ? 'available' : 'unavailable'), options.source || 'store',
    JSON.stringify({ persistOverall: options.persistOverall !== false }), createdAt]);
  for (const platform of options.platforms || platforms) {
    const commandId = f.nextId();
    const status = platform === 'uber_eats' ? options.uberStatus || 'failed' : options.destinationStatus || 'succeeded';
    const payload = { syncRunId: runId, isAvailable,
      targets: [{ kind: 'option', targetId, label: options.label || 'A' }] };
    await f.db.query(`insert into local_bridge_commands(id,store_id,platform,command_type,idempotency_key,payload,status,result,created_at,updated_at)
      values ($1,$2,$3,'set_inventory_availability',$4,$5,$6,$7,$8,$8)`, [
      commandId, options.commandStoreId || storeId, platform, `intent:${commandId}`, JSON.stringify(payload), status,
      JSON.stringify({ outcome: platform === 'uber_eats' ? '' : options.outcome || 'applied' }), createdAt
    ]);
  }
  return runId;
}

const recoveryRead = (targetId = uuid(1000), isAvailable = false) => [{ kind: 'option', targetId, label: 'A', isAvailable }];

test('recovery advisory uses latest exact Store intent and opposite current Uber observation, without changing facts', async () => withFixture(async (f) => {
  await addIntent(f);
  const before = copy((await f.db.query('select * from local_bridge_commands order by id')).rows);
  const stockBefore = await f.stock();
  const statementCount = f.statements.length;
  const hints = copy(await f.hints.loadInventoryWriteRecoveryHints(f.ids.store, recoveryRead()));
  assert.deepEqual(hints, [{ kind: 'option', targetId: uuid(1000), label: 'A', isAvailable: true, successfulPlatforms: ['demae_can', 'rocket_now'] }]);
  assert.equal(f.statements.length, statementCount + 1);
  assert.match(f.statements.at(-1).text, /^\s*with\b/);
  assert.deepEqual(copy((await f.db.query('select * from local_bridge_commands order by id')).rows), before);
  assert.deepEqual(await f.stock(), stockBefore);
  assert.deepEqual(copy(await f.hints.loadInventoryWriteRecoveryHints(f.ids.store, recoveryRead(uuid(1000), true))), [], 'An identical current read needs no warning');
  assert.deepEqual(copy(await f.hints.loadInventoryWriteRecoveryHints(f.ids.store, recoveryRead(uuid(1001)))), [], 'Same label is not target identity');
  assert.deepEqual(copy(await f.hints.loadInventoryWriteRecoveryHints(f.ids.otherStore, recoveryRead())), []);
}));

test('latest new intent or a successful/pending Uber retry suppresses an older failed-write suggestion', async () => {
  for (const change of ['new_intent', 'retry_succeeded', 'retry_pending']) await withFixture(async (f) => {
    const runId = await addIntent(f);
    assert.equal((await f.hints.loadInventoryWriteRecoveryHints(f.ids.store, recoveryRead())).length, 1);
    if (change === 'new_intent') await addIntent(f, { isAvailable: false, uberStatus: 'pending', createdAt: new Date(Date.now() - 1000).toISOString() });
    else {
      const commandId = f.nextId();
      await f.db.query(`insert into local_bridge_commands(id,store_id,platform,command_type,idempotency_key,payload,status,created_at,updated_at)
        values ($1,$2,'uber_eats','set_inventory_availability',$3,$4,$5,now(),now())`, [
        commandId, f.ids.store, `retry:${commandId}`, JSON.stringify({ syncRunId: runId, isAvailable: true, targets: recoveryRead().map(({ kind, targetId }) => ({ kind, targetId })) }),
        change === 'retry_succeeded' ? 'succeeded' : 'pending'
      ]);
    }
    assert.deepEqual(copy(await f.hints.loadInventoryWriteRecoveryHints(f.ids.store, recoveryRead())), []);
  });
});

test('override-only, non-Store, no-success, not-applicable, wrong-store and stale intents are not recovery truth', async () => {
  for (const options of [
    { action: 'platform_override' }, { persistOverall: false }, { source: 'system' },
    { destinationStatus: 'failed' }, { outcome: 'not_applicable' }, { commandStoreId: uuid(2) },
    { createdAt: new Date(Date.now() - 31 * 86400000).toISOString() }
  ]) await withFixture(async (f) => {
    await addIntent(f, options);
    assert.deepEqual(copy(await f.hints.loadInventoryWriteRecoveryHints(f.ids.store, recoveryRead())), []);
  });
});
