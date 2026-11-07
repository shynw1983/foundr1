// Actual OS POS settings handlers against an isolated in-process PostgreSQL. No live database or device access.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDineInMenuFixture, fixtureUuid } from './store-dine-in-menu-fixture.mjs';

const source = resolve(process.argv[2] || process.cwd());
const output = resolve(process.argv[3] || 'outputs/pos-counter-menu-settings-db');
await mkdir(output, { recursive: true });
const fixture = await createDineInMenuFixture(source);
const { db, ids, state, sql, request, load } = fixture;
const route = load('app/api/os/pos/settings/route.ts');
const path = '/api/os/pos/settings';
const checks = [];
const read = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const get = async (id = ids.store, status = 200) => read(await route.GET(request(`${path}?storeId=${id}&section=counterMenuPolicy`)), status);
const post = async (body, status = 200, headers) => read(await route.POST(request(path, { storeId: ids.store, ...body }, headers)), status);
const policy = (enabled, standard = [], restricted = []) => ({ sharedMenuForTakeout: enabled, standardTaxCategoryIds: standard, takeoutRestrictedCategoryIds: restricted });
const command = (snapshot, next) => ({ section: 'counterMenuPolicy', counterMenuPolicy: next, counterMenuPolicyRevision: snapshot.revision, counterMenuRevision: snapshot.menuRevision });
const persisted = async () => (await db.query('select to_jsonb(p) as row from pos_store_settings p where store_id=$1', [ids.store])).rows[0].row;
const general = { section: 'general', dineInEnabled: true, takeoutEnabled: true, dineInTaxRate: 10, takeoutTaxRate: 8, priceTaxMode: 'tax_included', posBrandSettings: [] };

try {
  await fixture.installMigration();
  const operationalCounts = await fixture.counts();
  // The fixture derives CREATE TABLE from the final schema. Removing the new
  // column here reproduces an existing pre-migration database for this test.
  await db.exec('alter table pos_store_settings drop column counter_menu_policy');
  const original = await persisted();
  const legacy = (await get()).counterMenu;
  assert.equal(legacy.ready, false);
  assert.deepEqual(legacy.policy, policy(false));
  await post(command(legacy, policy(true)), 409);
  assert.deepEqual(await persisted(), original);
  const migration = await readFile(resolve(source, 'db/migrations/20261107_pos_counter_menu_policy.sql'), 'utf8');
  await db.exec(migration); await db.exec(migration);
  const { counter_menu_policy: migrated, ...preserved } = await persisted();
  assert.deepEqual(migrated, {}); assert.deepEqual(preserved, original);
  let current = (await get()).counterMenu;
  assert.equal(current.ready, true); assert.deepEqual(current.policy, policy(false));
  checks.push('pre-migration read remains safe, writes are refused, idempotent migration preserves existing settings and defaults to separate menus');

  const session = state.session;
  state.session = null; await get(ids.store, 401); await post(command(current, policy(true)), 401); state.session = session;
  state.permitted = false;
  assert.equal((await get()).access.canManagePosSettings, false);
  await post(command(current, policy(true)), 403); state.permitted = true;
  await get(ids.other, 403); await post({ ...command(current, policy(true)), storeId: ids.other }, 403);
  await post(command(current, policy(true)), 403, { origin: 'https://foreign.example' });
  await db.query("update stores set status='inactive' where id=$1", [ids.store]);
  await get(ids.store, 403); await post(command(current, policy(true)), 403);
  await db.query("update stores set status='active' where id=$1", [ids.store]);
  assert.deepEqual((await persisted()).counter_menu_policy, {});
  checks.push('anonymous, readonly, cross-store, cross-origin and inactive-store writes do not change policy');

  assert.equal(current.hasEnabledMenu, false); await post(command(current, policy(true)), 400);
  let menu = await read(await fixture.mutateMenu({ action: 'initialize', revision: '', operationId: fixtureUuid(8500) }));
  current = (await get()).counterMenu; assert.equal(current.hasEnabledMenu, true);
  const category = current.categories[0];
  assert.ok(category?.id); assert.equal(category.brandId, ids.brand);
  await post(command(current, policy(true, [ids.otherItem])), 400);
  await post(command(current, policy(true, [], [category.id])), 400);
  await post(command(current, { sharedMenuForTakeout: 'true', standardTaxCategoryIds: [], takeoutRestrictedCategoryIds: [] }), 400);
  assert.deepEqual((await persisted()).counter_menu_policy, {});
  checks.push('enable requires an enabled current menu, strict policy types and permitted category IDs; restricted is a subset of standard');

  await post({ ...general, priceTaxMode: 'tax_excluded' });
  current = (await get()).counterMenu; assert.equal(current.priceTaxMode, 'tax_excluded');
  await post(command(current, policy(true, [category.id], [category.id])), 400);
  await post(general); current = (await get()).counterMenu;
  const activePolicy = policy(true, [category.id], [category.id]);
  const beforeSave = current;
  current = (await post(command(current, activePolicy))).counterMenu;
  assert.deepEqual(current.policy, activePolicy);
  assert.deepEqual((await get()).counterMenu.policy, activePolicy);
  const saved = await persisted();
  await post(command(current, activePolicy));
  assert.deepEqual(await persisted(), saved);
  await post(command(beforeSave, policy(false)), 409);
  assert.deepEqual(await persisted(), saved);
  checks.push('valid policy saves and reads back; tax-included is required; no-op does not rewrite or bump timestamps; stale configuration rejects');

  menu = await read(await fixture.mutateMenu({ action: 'rename', kind: 'category', targetId: category.id, name: '標準税率の飲料', revision: menu.revision, operationId: fixtureUuid(8501) }));
  await post(command(current, policy(false, [category.id], [category.id])), 409);
  current = (await get()).counterMenu;
  assert.equal(current.categories.find(entry => entry.id === category.id).name, '標準税率の飲料');
  assert.deepEqual(current.policy, activePolicy);
  const originalTransaction = sql.transaction;
  sql.transaction = async statements => {
    sql.transaction = originalTransaction;
    await db.query('update pos_store_settings set takeout_tax_rate=7 where store_id=$1', [ids.store]);
    return originalTransaction(statements);
  };
  try { await post(command(current, policy(false, [category.id], [category.id])), 409); }
  finally { sql.transaction = originalTransaction; }
  assert.deepEqual((await persisted()).counter_menu_policy, activePolicy);
  checks.push('category rename retains the same ID; stale menu rejects; a configuration change at the transaction boundary cannot overwrite policy');

  await post({ ...general, counterMenuPolicy: policy(false) });
  assert.deepEqual((await persisted()).counter_menu_policy, activePolicy);
  await post({ ...general, section: undefined, counterMenuPolicy: policy(false) });
  assert.deepEqual((await persisted()).counter_menu_policy, activePolicy);
  await post({ ...general, priceTaxMode: 'tax_excluded' }, 409);
  await post({ ...general, section: undefined, priceTaxMode: 'tax_excluded' }, 409);
  assert.equal((await persisted()).price_tax_mode, 'tax_included');
  assert.deepEqual((await persisted()).counter_menu_policy, activePolicy);
  checks.push('general and legacy full saves cannot erase policy or switch an enabled policy to tax-excluded pricing');

  await read(await fixture.mutateMenu({ action: 'setEnabled', enabled: false, revision: menu.revision, operationId: fixtureUuid(8502) }));
  current = (await get()).counterMenu; assert.equal(current.hasEnabledMenu, false);
  const disabled = policy(false, [category.id], [category.id]);
  await post(command(current, disabled));
  assert.deepEqual((await get()).counterMenu.policy, disabled);
  await post({ ...general, priceTaxMode: 'tax_excluded' });
  assert.deepEqual((await persisted()).counter_menu_policy, disabled);
  assert.deepEqual(await fixture.counts(), operationalCounts);
  checks.push('a missing/disabled menu can be switched back to separate mode without losing selected IDs; no sales, tasks or print side effects');
  await writeFile(resolve(output, 'verification.json'), JSON.stringify({ passed: true, checks }, null, 2) + '\n');
  console.log(`PASS POS counter menu settings: ${checks.length} groups`);
} finally { await db.close(); }
