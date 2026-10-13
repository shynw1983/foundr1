// Run the actual Store routes and their shared option SQL against local Postgres.
// No DATABASE_URL, production command queue, browser or inventory writer is used.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require(process.env.FOUNDR1_TYPESCRIPT_MODULE || 'typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const clone = (value) => JSON.parse(JSON.stringify(value));
const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

async function createFixture() {
  const db = new PGlite();
  const ids = {
    store: uuid(1), otherStore: uuid(2), employee: uuid(3),
    brand: uuid(10), secondBrand: uuid(11), otherBrand: uuid(12),
    item: uuid(20), localItem: uuid(21), otherStoreItem: uuid(22),
    inactiveItem: uuid(23), otherBrandItem: uuid(24)
  };
  const statements = [];
  const syncCalls = [];
  let session = { id: ids.employee, name: 'Scoped Store Tester', role: 'store_manager' };
  let permitted = true;
  const settings = { availability: { targets: { items: true, options: true } } };
  const access = {
    role: session.role, allStores: false, canViewSalesStats: true, canCancelOrders: false,
    canUseAllStoreView: false, stores: [{ id: ids.store, name: '清水店（隔离测试）', businessHours: {} }], storeIds: [ids.store]
  };
  const sql = (parts, ...values) => ({
    text: parts.reduce((text, part, index) => text + part + (index < values.length ? `$${index + 1}` : ''), ''),
    values,
    then(onResolve, onReject) {
      statements.push({ text: this.text, values: clone(this.values) });
      return db.query(this.text, this.values).then((result) => result.rows).then(onResolve, onReject);
    }
  });
  const failWriter = async () => { throw new Error('Unexpected inventory or queue writer in coverage test'); };
  const mocks = {
    'lib/db.ts': { sql },
    'lib/api-auth.ts': { requireOsSession: async () => session },
    'lib/store-order-access.ts': {
      getStoreOrderAccess: async () => access,
      getScopedStoreFilter: (_access, requestedStoreId) => (
        permitted && (!requestedStoreId || requestedStoreId === ids.store) ? ids.store : '__forbidden__'
      )
    },
    'lib/module-settings.ts': { getStoreModuleSettings: async () => clone(settings) },
    'lib/inventory-operation-lock.ts': {
      assertNoWholeStoreSync: failWriter, withInventoryOperationLock: failWriter
    },
    'lib/order-realtime.ts': { publishPublicMenuUpdatedEvent: failWriter },
    'lib/inventory-availability.ts': {
      applyInventoryAvailability: failWriter, loadInventoryAvailabilityTargets: failWriter
    },
    'lib/inventory-command-supersession.ts': { reconcileInventoryCommandsSql: failWriter },
    'lib/local-bridge-realtime.ts': {
      publishBridgeCommandAvailable: failWriter, publishBridgeInventorySyncStarted: failWriter
    },
    'lib/inventory-platform-targets.ts': { projectInventoryTargetsForPlatform: failWriter },
    'lib/inventory-platform-object-mappings.ts': {
      inventoryPlatformExternalIds: failWriter, loadDemaeStagingHints: failWriter,
      loadInventoryPlatformExternalIdMap: failWriter
    },
    'lib/menu-availability-links.ts': { loadLinkedMenuTargets: async () => [] },
    'lib/inventory-manual-sync.ts': {
      startUberAvailabilitySync: async (storeId, targets, employeeId) => {
        syncCalls.push(clone({ storeId, targets, employeeId }));
        return { runId: uuid(5000 + syncCalls.length), stage: 'reading', status: 'pending' };
      },
      confirmUberAvailabilitySync: failWriter
    }
  };
  const modules = new Map();
  function load(path, actualModule = false) {
    if (mocks[path] && !actualModule) return mocks[path];
    if (modules.has(path)) return modules.get(path);
    const absolute = resolve(root, path);
    const exports = {};
    modules.set(path, exports);
    const source = ts.transpileModule(readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    runInNewContext(source, {
      exports, Response, Request, URL, console,
      require: (name) => {
        if (name === 'node:crypto') return require(name);
        if (!name.startsWith('.')) throw new Error(`Unexpected external dependency: ${name}`);
        const target = resolve(dirname(absolute), name);
        const filename = existsSync(target) ? target : `${target}.ts`;
        assert.ok(filename.startsWith(`${root}/`), `Dependency escaped isolated checkout: ${name}`);
        return load(filename.slice(root.length + 1));
      }
    }, { filename: absolute });
    return exports;
  }
  Object.assign(settings, clone(load('lib/module-setting-defaults.ts').defaultStoreModuleSettings));

  await db.exec(`
    create table brands(id uuid primary key, name text not null, status text not null);
    create table store_brands(store_id uuid not null, brand_id uuid not null, primary key(store_id,brand_id));
    create table menu_categories(id uuid primary key, brand_id uuid not null, store_id uuid, name text not null, sort_order integer not null);
    create table menu_catalog_items(
      id uuid primary key, brand_id uuid not null, store_id uuid, external_id text,
      name text not null, display_names jsonb not null default '{}', promotion_prefix text not null default '',
      promotion_prefix_display_names jsonb not null default '{}', category text, variable_schema jsonb not null default '{}',
      image_url text, base_price numeric(12,2), sort_order integer not null, is_active boolean not null
    );
    create table menu_store_settings(
      store_id uuid not null, menu_catalog_item_id uuid not null, website_enabled boolean not null,
      pos_enabled boolean not null, delivery_enabled boolean not null, is_available boolean not null,
      stock_status text not null, price_override numeric(12,2), status_note text not null,
      updated_at timestamptz not null, primary key(store_id,menu_catalog_item_id)
    );
    create table menu_option_groups(
      id uuid primary key, brand_id uuid not null, menu_catalog_item_id uuid, group_key text not null,
      name text not null, display_names jsonb not null default '{}', selection_type text not null,
      rule_json jsonb not null, sort_order integer not null, is_active boolean not null
    );
    create table menu_options(
      id uuid primary key, option_group_id uuid not null, option_key text not null, external_id text,
      name text not null, display_names jsonb not null default '{}', price_delta numeric(12,2),
      sort_order integer not null, is_active boolean not null
    );
    create table menu_option_store_settings(
      store_id uuid not null, menu_option_id uuid not null, is_available boolean not null,
      stock_status text not null, status_note text not null, updated_at timestamptz not null,
      primary key(store_id,menu_option_id)
    );
    create table menu_platform_availability_settings(
      store_id uuid not null, target_kind text not null, target_id uuid not null, platform text not null,
      availability text not null, primary key(store_id,target_kind,target_id,platform)
    );
  `);
  await db.query('insert into brands values ($1,$2,$3),($4,$5,$6),($7,$8,$9)', [
    ids.brand, 'A まぁ麻（隔离测试）', 'active', ids.secondBrand, 'B scoped brand', 'active', ids.otherBrand, 'Other store brand', 'active'
  ]);
  for (const [storeId, brandId] of [[ids.store, ids.brand], [ids.store, ids.secondBrand], [ids.otherStore, ids.otherBrand]]) {
    await db.query('insert into store_brands values ($1,$2)', [storeId, brandId]);
  }
  const groups = [
    { key: 'soup-selection', name: '汤底选择', type: 'single', rule: { minSelect: 1, maxSelect: 1, defaultOptionKey: 'classic' } },
    { key: 'chili-oil', name: '辣油选择', type: 'single', rule: { minSelect: 0, maxSelect: 1 } },
    { key: 'spice', name: '辣度', type: 'single', rule: { minSelect: 1, maxSelect: 1 } },
    { key: 'basic', name: '基础配料', type: 'multiple', rule: { allowQuantity: true, minSelect: 0, maxSelect: 100 } },
    { key: 'option-arbitrary', name: '普通单选', type: 'single', rule: {} },
    { key: 'toppings', name: '单选加料', type: 'single', rule: { allowQuantity: false } },
    { key: '', name: '无 key 分组', type: 'single', rule: { maxSelect: 1 } },
    { key: 'future-2027-unrecognized', name: '将来新增分组', type: 'single', rule: { customRule: 'preserve me' } },
    { key: 'distinct-same-name', name: '同名独立选项', type: 'multiple', rule: { allowQuantity: false, maxSelect: 2 } },
    { key: 'inactive-group', name: '停用组', type: 'single', rule: {}, active: false },
    { key: 'unlinked-brand', name: '其他门店品牌', type: 'single', rule: {}, brandId: ids.otherBrand },
    { key: 'second-brand-options', name: '第二品牌单选', type: 'single', rule: {}, brandId: ids.secondBrand }
  ].map((group, index) => ({ ...group, id: uuid(100 + index), sortOrder: index, brandId: group.brandId || ids.brand }));
  for (const group of groups) {
    await db.query(`insert into menu_option_groups values ($1,$2,null,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9)`, [
      group.id, group.brandId, group.key, group.name, JSON.stringify({ zh: group.name, 'zh-Hans': group.name }), group.type,
      JSON.stringify(group.rule), group.sortOrder, group.active !== false
    ]);
  }
  const options = [
    { group: 0, key: 'classic', name: '经典麻辣烫汤底', price: 0, state: 'available' },
    { group: 0, key: 'bone', name: '药膳牛骨汤底', price: 103, state: 'unavailable' },
    { group: 0, key: 'tomato', name: '浓厚番茄汤底', price: 185, state: 'unavailable' },
    { group: 0, key: 'mushroom', name: '菌菇汤底', price: 103, state: 'low_stock' },
    { group: 1, key: 'oil', name: '辣油', price: 0, state: 'unavailable' },
    { group: 2, key: 'mild', name: '微辣', price: 0 },
    { group: 2, key: 'hot', name: '特辣', price: 0, state: 'unavailable' },
    { group: 3, key: 'quantity', name: '数量配料', price: 200 },
    { group: 4, key: '', name: 'A', price: 0 },
    { group: 5, key: 'single-topping', name: '免费配料', price: null },
    { group: 6, key: 'no-group-key', name: '无 key 选项', price: 0 },
    { group: 7, key: 'new-kind', name: '1杯', price: 300 },
    { group: 8, key: 'duplicate-a', name: '同じ名前', price: 1, sortOrder: 0 },
    { group: 8, key: 'duplicate-b', name: '同じ名前', price: 2, sortOrder: 0 },
    { group: 0, key: 'inactive-option', name: '停用选项', price: 999, active: false },
    { group: 9, key: 'inactive-parent', name: '停用组成员', price: 998 },
    { group: 10, key: 'foreign', name: '其他门店选项', price: 997 },
    { group: 11, key: 'second-brand', name: '第二品牌选项', price: 10 }
  ].map((option, index) => ({ ...option, id: uuid(1000 + index), sortOrder: option.sortOrder ?? index, externalId: `uber-option-${index}` }));
  // Reverse insertion proves tie order comes from SQL, not fixture/native creation order.
  for (const option of [...options].reverse()) {
    await db.query('insert into menu_options values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)', [
      option.id, groups[option.group].id, option.key, option.externalId, option.name,
      JSON.stringify({ zh: option.name, 'zh-Hans': option.name }), option.price, option.sortOrder, option.active !== false
    ]);
    if (option.state) await db.query('insert into menu_option_store_settings values ($1,$2,$3,$4,$5,$6)', [
      ids.store, option.id, option.state !== 'unavailable', option.state, `original ${option.key}`, '2026-10-01T00:00:00Z'
    ]);
  }
  await db.query('insert into menu_option_store_settings values ($1,$2,false,$3,$4,$5)', [
    ids.otherStore, options[7].id, 'unavailable', 'Other store only', '2026-10-01T00:00:00Z'
  ]);
  for (const [storeId, platform, availability] of [
    [ids.store, 'rocket_now', 'unavailable'], [ids.store, 'demae_can', 'available'], [ids.otherStore, 'uber_eats', 'unavailable']
  ]) await db.query('insert into menu_platform_availability_settings values ($1,$2,$3,$4,$5)', [
    storeId, 'option', options[1].id, platform, availability
  ]);
  const items = [
    { id: ids.item, brandId: ids.brand, storeId: null, active: true },
    { id: ids.localItem, brandId: ids.brand, storeId: ids.store, active: true },
    { id: ids.otherStoreItem, brandId: ids.brand, storeId: ids.otherStore, active: true },
    { id: ids.inactiveItem, brandId: ids.brand, storeId: null, active: false },
    { id: ids.otherBrandItem, brandId: ids.otherBrand, storeId: null, active: true }
  ];
  for (const [index, item] of items.entries()) await db.query(`
    insert into menu_catalog_items(id,brand_id,store_id,external_id,name,category,base_price,sort_order,is_active)
    values ($1,$2,$3,$4,$5,'套餐',880,$6,$7)`, [
    item.id, item.brandId, item.storeId, `item-${index}`, `套餐 ${index}`, index, item.active
  ]);
  await db.query('insert into menu_categories values ($1,$2,null,$3,0)', [uuid(50), ids.brand, '套餐']);
  await db.query('insert into menu_store_settings values ($1,$2,true,true,true,false,$3,888,$4,$5)', [
    ids.store, ids.item, 'unavailable', 'Unchanged item state', '2026-10-01T00:00:00Z'
  ]);
  const expectedOptions = [...options.slice(0, 14), options[17]].map((option) => option.id);
  const menu = load('app/api/store/menu-settings/route.ts');
  const kitchen = load('app/api/store/display/kitchen/inventory/route.ts');
  const helper = load('lib/store-menu-sales-options.ts');
  const inventory = load('lib/inventory-availability.ts', true);
  const menuGet = () => menu.GET(new Request(`https://test.invalid/api/store/menu-settings?storeId=${ids.store}`));
  const kitchenGet = (scope = 'all') => kitchen.GET(new Request(`https://test.invalid/api/store/display/kitchen/inventory?storeId=${ids.store}&scope=${scope}`));
  const fullSync = (action = 'full_sync', storeId = ids.store) => kitchen.POST(new Request('https://test.invalid/api/store/display/kitchen/inventory', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId, action })
  }));
  const state = async () => clone(await Promise.all([
    db.query('select * from menu_option_groups order by id'),
    db.query('select * from menu_options order by id'),
    db.query('select * from menu_option_store_settings order by store_id,menu_option_id'),
    db.query('select * from menu_platform_availability_settings order by store_id,target_kind,target_id,platform'),
    db.query('select * from menu_catalog_items order by id'),
    db.query('select * from menu_store_settings order by store_id,menu_catalog_item_id')
  ]).then((results) => results.map((result) => result.rows)));
  return {
    db, ids, options, groups, helper, inventory, expectedOptions, statements, syncCalls, settings,
    menuGet, kitchenGet, fullSync, state,
    setSession: (value) => { session = value; },
    setPermitted: (value) => { permitted = value; },
    originalSession: session
  };
}

await test('Store option coverage uses actual shared SQL and route code without changing stock, rules or prices', async (t) => {
  const fixture = await createFixture();
  const { ids, options, expectedOptions, helper, settings, statements, syncCalls } = fixture;
  const before = await fixture.state();
  try {
    await t.test('shared SQL includes all active group policies and excludes inactive or out-of-store rows', async () => {
      const rows = clone(await helper.loadStoreMenuSalesOptions(ids.store));
      assert.deepEqual(rows.map((row) => row.id), expectedOptions);
      assert.equal(rows.filter((row) => row.groupKey === 'soup-selection').length, 4);
      assert.ok(rows.some((row) => row.groupKey === 'chili-oil' && row.priceDelta === 0));
      assert.ok(rows.some((row) => row.groupKey === 'spice'));
      assert.ok(rows.some((row) => row.groupKey === 'basic'));
      assert.ok(rows.some((row) => row.groupKey === 'option-arbitrary' && row.optionKey === '' && row.name === 'A'));
      assert.ok(rows.some((row) => row.groupKey === 'toppings' && row.priceDelta === null));
      assert.ok(rows.some((row) => row.groupKey === ''));
      assert.ok(rows.some((row) => row.groupKey === 'future-2027-unrecognized'));
      assert.equal(new Set(rows.map((row) => row.id)).size, expectedOptions.length);
      assert.ok(!rows.some((row) => [options[14].id, options[15].id, options[16].id].includes(row.id)));
    });

    await t.test('menu-settings GET preserves exact IDs, deterministic same-name order and original metadata', async () => {
      const response = await fixture.menuGet();
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body.options.map((row) => row.id), expectedOptions);
      assert.deepEqual(body.options.filter((row) => row.name === '同じ名前').map((row) => [row.id, row.priceDelta]), [
        [options[12].id, 1], [options[13].id, 2]
      ]);
      const bone = body.options.find((row) => row.id === options[1].id);
      assert.equal(bone.groupId, fixture.groups[0].id);
      assert.equal(bone.groupKey, 'soup-selection');
      assert.equal(bone.optionKey, 'bone');
      assert.equal(bone.externalId, options[1].externalId);
      assert.equal(bone.priceDelta, 103);
      assert.deepEqual(bone.groupDisplayNames, { zh: '汤底选择', 'zh-Hans': '汤底选择' });
      assert.deepEqual(bone.displayNames, { zh: '药膳牛骨汤底', 'zh-Hans': '药膳牛骨汤底' });
      assert.equal(bone.isAvailable, false);
      assert.equal(bone.stockStatus, 'unavailable');
      assert.deepEqual(bone.platformAvailability, { rocket_now: 'unavailable', demae_can: 'available' });
      assert.equal(bone.statusNote, 'original bone');
      const mushroom = body.options.find((row) => row.id === options[3].id);
      assert.equal(mushroom.isAvailable, true);
      assert.equal(mushroom.stockStatus, 'low_stock');
      assert.equal(body.options.find((row) => row.id === options[7].id).isAvailable, true, 'Other store settings must not leak');
      assert.deepEqual(body.items.map((row) => row.id), [ids.item]);
      assert.equal(body.items[0].priceOverride, 888);
      assert.equal(body.items[0].stockStatus, 'unavailable');
      if (process.env.FOUNDR1_MENU_OPTIONS_FIXTURE_JSON) {
        const outputPath = resolve(process.env.FOUNDR1_MENU_OPTIONS_FIXTURE_JSON);
        assert.ok((outputPath.startsWith('/private/tmp/') || outputPath.startsWith('/tmp/')) && outputPath.endsWith('.json'),
          'Generated UI fixtures must stay in a temporary JSON artifact');
        writeFileSync(outputPath, `${JSON.stringify(body, null, 2)}\n`);
      }
    });

    await t.test('full_sync and audit send the same complete option UUID scope without name or selection-rule filtering', async () => {
      for (const action of ['full_sync', 'audit']) {
        const response = await fixture.fullSync(action);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).ok, true);
        const call = syncCalls.at(-1);
        assert.equal(call.storeId, ids.store);
        assert.equal(call.employeeId, ids.employee);
        assert.deepEqual(call.targets.filter((target) => target.kind === 'option').map((target) => target.targetId), expectedOptions);
        assert.deepEqual(call.targets.filter((target) => target.kind === 'item').map((target) => target.targetId), [ids.item, ids.localItem]);
        assert.equal(call.targets.filter((target) => target.label === '同じ名前').length, 2);
        assert.equal(call.targets.find((target) => target.targetId === options[8].id).label, 'A');
        assert.equal(call.targets.find((target) => target.targetId === options[10].id).groupKey, '');
        assert.ok(call.targets.every((target) => target.brandId !== ids.otherBrand));
      }
    });

    await t.test('availability targets feature switches still hide Store sections but do not shrink full sync', async () => {
      settings.availability.targets.options = false;
      settings.availability.targets.items = false;
      try {
        const body = await (await fixture.menuGet()).json();
        assert.deepEqual(body.options, []);
        assert.deepEqual(body.items, []);
        assert.equal(body.settings.availability.targets.options, false);
        assert.equal((await fixture.fullSync()).status, 200);
        const call = syncCalls.at(-1);
        assert.deepEqual(call.targets.filter((target) => target.kind === 'option').map((target) => target.targetId), expectedOptions);
        assert.deepEqual(call.targets.filter((target) => target.kind === 'item').map((target) => target.targetId), [ids.item, ids.localItem]);
      } finally {
        settings.availability.targets.options = true;
        settings.availability.targets.items = true;
      }
    });

    await t.test('actual inventory loader selects short and same-name options by stable UUID, never sibling name expansion', async () => {
      for (const option of [options[8], options[11], options[12], options[13]]) {
        const result = clone(await fixture.inventory.loadInventoryAvailabilityTargets(ids.store, ids.brand, 'Stale display label', 'option', option.id));
        assert.equal(result.inventoryKey, `option:${option.id}`);
        assert.equal(result.ingredientLabel, option.name);
        assert.deepEqual(result.targets.map((target) => target.targetId), [option.id]);
        assert.equal(result.targets[0].menuOptionId, option.id);
        assert.equal(result.targets[0].optionKey, option.key);
      }
      const foreign = await fixture.inventory.loadInventoryAvailabilityTargets(ids.store, ids.brand, 'Other', 'option', options[16].id);
      assert.deepEqual(clone(foreign.targets), []);
      const inactive = await fixture.inventory.loadInventoryAvailabilityTargets(ids.store, ids.brand, 'Inactive', 'option', options[14].id);
      assert.deepEqual(clone(inactive.targets), []);
    });

    await t.test('kitchen inventory reads the broadened option scope and preserves unavailable-only default', async () => {
      const allResponse = await fixture.kitchenGet('all');
      assert.equal(allResponse.status, 200);
      const all = await allResponse.json();
      const unavailableResponse = await fixture.kitchenGet('unavailable');
      assert.equal(unavailableResponse.status, 200);
      const unavailable = await unavailableResponse.json();
      const allOptionIds = all.items.filter((row) => row.targetKind === 'option').flatMap((row) => row.targets.map((target) => target.targetId));
      assert.deepEqual([...new Set(allOptionIds)].sort(), [...expectedOptions].sort());
      const sameNameRows = all.items.filter((row) => row.targetKind === 'option' && row.ingredientLabel === '同じ名前');
      assert.equal(sameNameRows.length, 2, 'Independent same-name IDs need separate choices, not name-based expansion');
      assert.deepEqual(sameNameRows.map((row) => row.targets.map((target) => target.targetId)), [[options[12].id], [options[13].id]]);
      const shortName = all.items.find((row) => row.targets.some((target) => target.targetId === options[8].id));
      assert.equal(shortName.ingredientLabel, 'A');
      assert.equal(shortName.impactCount, 1);
      assert.equal(shortName.targets[0].groupKey, 'option-arbitrary');
      assert.equal(allResponse.headers.get('Cache-Control'), 'no-store');
      assert.ok(all.items.some((row) => row.targets.some((target) => target.targetId === options[1].id)));
      assert.ok(all.items.some((row) => row.targets.some((target) => target.targetId === options[3].id)));
      assert.ok(unavailable.items.every((row) => row.isAvailable === false));
      const unavailableOptions = unavailable.items.filter((row) => row.targetKind === 'option').flatMap((row) => row.targets.map((target) => target.targetId));
      assert.deepEqual([...new Set(unavailableOptions)].sort(), [options[1].id, options[2].id, options[4].id, options[6].id].sort());
      assert.ok(!unavailableOptions.includes(options[3].id), 'Low stock remains available');
    });

    await t.test('unauthenticated and forbidden routes run no option SQL and start no sync', async () => {
      const count = statements.length;
      const syncCount = syncCalls.length;
      fixture.setSession(null);
      assert.equal((await fixture.menuGet()).status, 401);
      assert.equal((await fixture.kitchenGet()).status, 401);
      assert.equal((await fixture.fullSync()).status, 401);
      assert.equal(statements.length, count);
      assert.equal(syncCalls.length, syncCount);
      fixture.setSession(fixture.originalSession);
      fixture.setPermitted(false);
      assert.equal((await fixture.menuGet()).status, 403);
      assert.equal((await fixture.kitchenGet()).status, 400);
      assert.equal((await fixture.fullSync()).status, 400);
      assert.equal(statements.length, count);
      assert.equal(syncCalls.length, syncCount);
      fixture.setPermitted(true);
      assert.equal((await fixture.fullSync('full_sync', ids.otherStore)).status, 400);
      assert.equal(statements.length, count);
      assert.equal(syncCalls.length, syncCount);
    });

    await t.test('all reads and full-sync scope preparation leave original selection, prices and stock facts unchanged', async () => {
      assert.deepEqual(await fixture.state(), before);
      assert.ok(statements.length > 0);
      assert.ok(statements.every((statement) => /^\s*select\b/i.test(statement.text)), 'Actual route/helper operations must remain SELECT only');
      assert.ok(statements.some((statement) => statement.text.includes('menu_option_groups.is_active = true')));
      assert.ok(statements.some((statement) => statement.text.includes('menu_options.is_active = true')));
    });
  } finally {
    await fixture.db.close();
  }
});
