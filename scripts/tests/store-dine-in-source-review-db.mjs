// Actual management, public-menu, POS and immutable-print handlers on isolated
// PostgreSQL/PGlite. No production credentials, external HTTP or device calls.
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createDineInMenuFixture, fixtureUuid as uuid } from './store-dine-in-menu-fixture.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, values) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), values[i + 1]]);
  return pairs;
}, []));
const source = resolve(args.source || process.cwd());
const output = resolve(args.output || 'outputs/store-dine-in-source-review-db');
await mkdir(output, { recursive: true });
const files = ['lib/store-dine-in-menu-policy.ts', 'lib/store-dine-in-menu.ts', 'lib/store-dine-in-source-review.ts', 'app/api/os/menus/dine-in/route.ts', 'app/api/store/pos/route.ts', 'scripts/tests/store-dine-in-source-review-db.mjs'];
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(resolve(source, file))).digest('hex')])));
const inputHashes = await hashes();
const f = await createDineInMenuFixture(source);
const { db, ids, state } = f;
await f.installMigration();
let operation = 72000, sale = 73000;
const results = [];
const json = async (response, status = 200) => {
  response = await response;
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
};
const read = () => json(f.getMenu());
const edit = (menu, command, status = 200) => json(f.mutateMenu({ revision: menu.revision, operationId: uuid(operation++), ...command }), status);
const clone = value => JSON.parse(JSON.stringify(value));
const item = (menu, id) => menu.catalog.items.find(row => row.sourceItemId === id);
const option = (menu, id) => menu.catalog.optionGroups.flatMap(group => group.options).find(row => row.sourceOptionId === id);
const entry = (menu, kind, sourceId, targetId) => {
  const row = menu.sourceReview.entries.find(row => row.kind === kind && row.sourceId === sourceId && (!targetId || row.targetId === targetId));
  assert.ok(row, `${kind} source ${sourceId} ${targetId || ''}`);
  return row;
};
const field = (row, name) => {
  const value = row.fields.find(value => value.field === name);
  assert.ok(value, `${row.kind} ${row.key}: ${name}`);
  return value;
};
const command = (menu, row, decisions) => ({
  action: 'reviewSource', sourceRevision: menu.sourceReview.sourceRevision,
  entryKey: row.key, decisions,
});
const review = (menu, row, decisions, status = 200) => edit(menu, command(menu, row, decisions), status);
const operations = async () => Number((await db.query('select count(*)::int n from store_dine_in_menu_operations')).rows[0].n);
const rawCatalog = async () => (await db.query('select catalog,revision::text from store_dine_in_menus where store_id=$1 and brand_id=$2', [ids.store, ids.brand])).rows[0];
const master = () => f.masterSnapshot();
const publicRoute = f.load('app/api/public/menus/route.ts');
const publicMenu = async store => {
  const value = await json(publicRoute.GET(f.request(`/api/public/menus?brand=${ids.brand}${store ? `&store=${ids.store}` : ''}`)));
  delete value.generatedAt;
  return value;
};
const pos = f.reloadPos();
const posGet = () => json(pos.GET(f.request(`/api/store/pos?storeId=${ids.store}`)));
const checkout = async (items, patch = {}, status = 200) => {
  const current = await posGet();
  return json(pos.POST(f.request('/api/store/pos', {
    ...f.baseBody, offlineClientOrderId: uuid(sale++), discountPresetKey: '',
    orderType: 'eat_in', cashTenderedAmount: 5000, receiptRequested: true,
    posMenuRevision: current.posMenuRevision, dineInMenuRevision: current.dineInMenuRevision,
    items, ...patch,
  })), status);
};
const documents = async orderId => (await db.query('select kind,state,payload from pos_print_documents where order_id=$1 order by sequence', [orderId])).rows;
const orderItems = async orderId => (await db.query('select menu_catalog_item_id::text,item_name,quantity::int,amount::int,customizations from store_customer_order_items where order_id=$1 order by sort_order', [orderId])).rows;
async function check(name, test) {
  await test();
  results.push({ name, passed: true });
  console.log(`PASS ${name}`);
}

try {
  const beforePreview = await master();
  await check('preview-is-read-only-and-separates-brand-network-from-effective-pos-source-prices', async () => {
    const preview = await read();
    assert.equal(preview.exists, false);
    assert.match(preview.sourceReview.sourceRevision, /^[a-f0-9]{32}$/);
    assert.equal(preview.source.optionGroups.find(group => group.id === ids.premiumGroup).options.find(row => row.id === ids.beef).priceDelta, 650);
    const sourceBeef = entry(preview, 'option', ids.beef);
    assert.equal(sourceBeef.networkPrice, 500);
    assert.equal(sourceBeef.importPrice, 650);
    assert.equal(sourceBeef.status, 'new');
    const sourceBowl = entry(preview, 'item', ids.menu);
    assert.equal(sourceBowl.networkPrice, 777, 'Website store override is distinct from brand base price');
    assert.equal(field(sourceBowl, 'price').sourceValue.amount, 815);
    assert.equal(field(sourceBowl, 'price').sourceValue.basis, 'fixed');
    assert.equal(field(sourceBowl, 'price').sourceValue.networkAmount, 777);
    assert.equal(field(sourceBowl, 'price').sourceValue.importAmount, 4);
    assert.equal(field(sourceBowl, 'price').sourceValue.importBasis, 'weight');
    assert.equal(field(sourceBowl, 'price').sourceValue.importUnit, 'g');
    assert.equal((await publicMenu(true)).items.find(row => row.id === ids.menu).basePrice, sourceBowl.networkPrice);
    assert.deepEqual(await master(), beforePreview);
    assert.equal((await db.query('select count(*)::int n from store_dine_in_menus')).rows[0].n, 0);
    assert.equal(await operations(), 0);
  });

  let menu = await edit({ revision: '' }, { action: 'initialize' });
  const localDrinkId = item(menu, ids.drink).id;
  const localBeefId = option(menu, ids.beef).id;
  const initialSource = await master();
  const initialPublic = await publicMenu(false), initialPublicStore = await publicMenu(true);
  const initialIds = clone(menu.catalog.items.map(row => ({ id: row.id, sourceItemId: row.sourceItemId })));
  const paid = await checkout([{ menuCatalogItemId: localDrinkId, quantity: 1, selectedOptions: [] }]);
  const originalOrder = await orderItems(paid.orderId), originalDocuments = await documents(paid.orderId);

  await check('new-copy-captures-canonical-baseline-without-repricing-imported-pos-overrides', async () => {
    const beef = entry(menu, 'option', ids.beef, localBeefId);
    assert.equal(field(beef, 'price').sourceValue.amount, 500);
    assert.equal(field(beef, 'price').previousValue.amount, 500);
    assert.equal(field(beef, 'price').localValue.amount, 650);
    assert.equal(field(beef, 'price').changed, false);
    assert.equal(field(beef, 'price').baselineKnown, true);
    assert.equal(option(menu, ids.beef).priceDelta, 650);
    assert.equal(menu.sourceReview.initial, false);
    assert.equal(entry(menu, 'item', ids.drink, localDrinkId).pending, false);
    assert.deepEqual(await master(), initialSource);
  });

  await check('intentional-local-name-and-price-do-not-create-source-update-alerts', async () => {
    menu = await edit(menu, { action: 'rename', kind: 'item', targetId: localDrinkId, name: '店内限定のお茶' });
    menu = await edit(menu, { action: 'setItemPrice', targetId: localDrinkId, price: 450 });
    const drink = entry(menu, 'item', ids.drink, localDrinkId);
    assert.equal(field(drink, 'name').localValue.name, '店内限定のお茶');
    assert.equal(field(drink, 'price').localValue.amount, 450);
    assert.equal(drink.pending, false);
    assert.equal(field(drink, 'name').changed, false);
    assert.equal(field(drink, 'price').changed, false);
    assert.deepEqual(await master(), initialSource);
    assert.deepEqual(await publicMenu(false), initialPublic);
    assert.deepEqual(await publicMenu(true), initialPublicStore);
  });

  await db.query('update menu_catalog_items set name=$1,base_price=$2 where id=$3', ['新版のお茶', 480, ids.drink]);
  const changedSource = await master();
  const changedPublic = await publicMenu(false), changedPublicStore = await publicMenu(true);
  menu = await read();
  await check('upstream-change-discovery-never-saves-or-overwrites-local-menu', async () => {
    const before = await rawCatalog(), count = await operations();
    const drink = entry(menu, 'item', ids.drink, localDrinkId);
    assert.equal(drink.status, 'linked');
    assert.equal(drink.pending, true);
    assert.equal(field(drink, 'name').previousValue.name, 'お茶');
    assert.equal(field(drink, 'name').sourceValue.name, '新版のお茶');
    assert.equal(field(drink, 'name').localValue.name, '店内限定のお茶');
    assert.equal(field(drink, 'price').previousValue.amount, 400);
    assert.equal(field(drink, 'price').sourceValue.amount, 480);
    assert.equal(item(menu, ids.drink).price, 450);
    await read();
    assert.deepEqual(await rawCatalog(), before);
    assert.equal(await operations(), count);
    assert.deepEqual(await master(), changedSource);
  });

  await check('field-level-adopt-and-keep-advance-source-baseline-while-retaining-local-overrides', async () => {
    const previousPos = await posGet();
    menu = await review(menu, entry(menu, 'item', ids.drink, localDrinkId), [{ field: 'name', decision: 'keep' }, { field: 'price', decision: 'adopt' }]);
    assert.equal(item(menu, ids.drink).name, '店内限定のお茶');
    assert.equal(item(menu, ids.drink).price, 480);
    assert.equal(item(menu, ids.drink).priceOverride, 480);
    const drink = entry(menu, 'item', ids.drink, localDrinkId);
    assert.equal(field(drink, 'name').previousValue.name, '新版のお茶');
    assert.equal(field(drink, 'price').previousValue.amount, 480);
    assert.equal(drink.pending, false);
    assert.deepEqual(menu.catalog.items.map(row => ({ id: row.id, sourceItemId: row.sourceItemId })), initialIds);
    assert.deepEqual(await master(), changedSource);
    assert.deepEqual(await publicMenu(false), changedPublic);
    assert.deepEqual(await publicMenu(true), changedPublicStore);
    assert.notEqual((await posGet()).dineInMenuRevision, previousPos.dineInMenuRevision);
    await checkout([{ menuCatalogItemId: localDrinkId, quantity: 1, selectedOptions: [] }], { posMenuRevision: previousPos.posMenuRevision, dineInMenuRevision: previousPos.dineInMenuRevision }, 409);
  });

  await check('adopted-price-reaches-real-pos-and-new-sales-with-historical-reprints-unchanged', async () => {
    const current = await posGet();
    assert.equal(current.dineInMenu.items.find(row => row.id === localDrinkId).priceOverride, 480);
    const next = await checkout([{ menuCatalogItemId: localDrinkId, quantity: 2, selectedOptions: [] }]);
    assert.equal(next.amount, 960);
    assert.equal((await orderItems(next.orderId))[0].amount, 960);
    assert.equal((await documents(next.orderId)).find(row => row.kind === 'receipt').payload.order.totalAmount, 960);
    assert.deepEqual(await orderItems(paid.orderId), originalOrder);
    assert.deepEqual(await documents(paid.orderId), originalDocuments);
  });

  await db.query('update menu_catalog_items set base_price=490 where id=$1', [ids.drink]);
  menu = await read();
  await check('acknowledgement-silences-only-current-source-value-and-later-changes-reappear', async () => {
    assert.equal(field(entry(menu, 'item', ids.drink, localDrinkId), 'price').changed, true);
    const previousPos = await posGet(), previousRevision = menu.revision;
    menu = await review(menu, entry(menu, 'item', ids.drink, localDrinkId), [{ field: 'price', decision: 'keep' }]);
    assert.notEqual(menu.revision, previousRevision, 'Management CAS must observe acknowledgement changes');
    assert.equal((await posGet()).dineInMenuRevision, previousPos.dineInMenuRevision, 'Keep-only metadata must not invalidate an open POS');
    const validOldCart = await checkout([{ menuCatalogItemId: localDrinkId, quantity: 1, selectedOptions: [] }], { posMenuRevision: previousPos.posMenuRevision, dineInMenuRevision: previousPos.dineInMenuRevision });
    assert.equal(validOldCart.amount, 480);
    assert.equal(item(menu, ids.drink).price, 480);
    assert.equal(field(entry(menu, 'item', ids.drink, localDrinkId), 'price').previousValue.amount, 490);
    assert.equal(entry(menu, 'item', ids.drink, localDrinkId).pending, false);
    await db.query('update menu_catalog_items set base_price=500 where id=$1', [ids.drink]);
    menu = await read();
    assert.equal(field(entry(menu, 'item', ids.drink, localDrinkId), 'price').sourceValue.amount, 500);
    assert.equal(field(entry(menu, 'item', ids.drink, localDrinkId), 'price').previousValue.amount, 490);
    assert.equal(field(entry(menu, 'item', ids.drink, localDrinkId), 'price').changed, true);
  });

  await check('exact-operation-replay-does-not-repeat-review-or-ledger-and-altered-body-conflicts', async () => {
    const row = entry(menu, 'item', ids.drink, localDrinkId);
    const body = { revision: menu.revision, operationId: uuid(operation++), ...command(menu, row, [{ field: 'price', decision: 'keep' }]) };
    menu = await json(f.mutateMenu(body));
    const catalog = clone(menu.catalog), count = await operations();
    const replay = await json(f.mutateMenu(body));
    assert.equal(replay.revision, menu.revision);
    assert.deepEqual(replay.catalog, catalog);
    assert.equal(await operations(), count);
    await json(f.mutateMenu({ ...body, decisions: [{ field: 'price', decision: 'adopt' }] }), 409);
  });

  await check('client-cannot-inject-source-values-rewrite-identities-or-adopt-unreviewable-fields', async () => {
    const row = entry(menu, 'option', ids.beef, localBeefId);
    const valid = command(menu, row, [{ field: 'price', decision: 'keep' }]);
    for (const patch of [
      { sourceRevision: '' }, { sourceRevision: 'x'.repeat(32) }, { entryKey: 'unknown' },
      { decisions: [] }, { decisions: [{ field: 'price', decision: 'force' }] },
      { decisions: [{ field: 'unknown', decision: 'keep' }] },
      { decisions: [{ field: 'price', decision: 'keep', value: 1 }] },
      { decisions: [{ field: 'price', decision: 'keep' }, { field: 'price', decision: 'adopt' }] },
      { price: 1 }, { sourceItemId: ids.otherItem }, { sourceValue: 1 },
    ]) await edit(menu, { ...valid, ...patch }, 400);
    await edit(menu, { ...valid, entryKey: `option:${uuid(79999)}` }, 404);
    const before = await rawCatalog();
    await review(menu, row, [{ field: 'memberships', decision: 'adopt' }], 400);
    const weight = entry(menu, 'item', ids.menu, item(menu, ids.menu).id);
    await review(menu, weight, [{ field: 'price', decision: 'adopt' }], 400);
    assert.deepEqual(await rawCatalog(), before);
  });

  await db.query('update menu_option_groups set rule_json=$1::jsonb where id=$2', [JSON.stringify({ minSelections: 0, maxSelections: 5, portionGrams: 60 }), ids.premiumGroup]);
  menu = await read();
  await check('portion-or-structure-change-needs-review-without-silently-changing-50g-local-portions', async () => {
    const beef = entry(menu, 'option', ids.beef, localBeefId);
    const specification = field(beef, 'specification');
    assert.equal(specification.changed, true);
    assert.equal(specification.canAdopt, true);
    const before = clone(option(menu, ids.beef));
    await review(menu, beef, [{ field: 'price', decision: 'adopt' }], 400);
    menu = await review(menu, beef, [{ field: 'specification', decision: 'keep' }]);
    assert.deepEqual(option(menu, ids.beef), before);
    assert.equal(field(entry(menu, 'option', ids.beef, localBeefId), 'specification').changed, false);
    assert.equal(menu.catalog.optionGroups.find(group => group.sourceGroupId === ids.premiumGroup).ruleJson.portionGrams, 50);
    assert.equal(field(entry(menu, 'option', ids.beef, localBeefId), 'price').canAdopt, false);
    menu = await review(menu, entry(menu, 'option', ids.beef, localBeefId), [{ field: 'specification', decision: 'adopt' }]);
    assert.equal(option(menu, ids.beef).sourceGroupRuleJson.portionGrams, 60);
    assert.equal(option(menu, ids.beef).priceDelta, before.priceDelta);
    assert.equal(option(menu, ids.beef).sourceOptionId, before.sourceOptionId);
    assert.equal(option(menu, ids.beef).name, before.name);
    assert.equal(field(entry(menu, 'option', ids.beef, localBeefId), 'price').canAdopt, true);
    assert.equal(option(menu, ids.pork).sourceGroupRuleJson?.portionGrams ?? menu.catalog.optionGroups.find(group => group.sourceGroupId === ids.premiumGroup).ruleJson.portionGrams, 50);
  });

  await check('source-and-catalog-cas-reject-stale-or-racing-review-without-partial-ledger', async () => {
    await db.query('update menu_options set price_delta=price_delta+1 where id=$1', [ids.beef]);
    menu = await read();
    const old = menu;
    await db.query('update menu_options set price_delta=price_delta+1 where id=$1', [ids.beef]);
    const before = await rawCatalog(), count = await operations();
    await review(old, entry(old, 'option', ids.beef, localBeefId), [{ field: 'price', decision: 'keep' }], 409);
    assert.deepEqual(await rawCatalog(), before);
    assert.equal(await operations(), count);
    menu = await read();
    const transaction = f.sql.transaction;
    f.sql.transaction = async statements => {
      await db.query('update menu_options set price_delta=price_delta+1 where id=$1', [ids.beef]);
      return transaction(statements);
    };
    try { await review(menu, entry(menu, 'option', ids.beef, localBeefId), [{ field: 'price', decision: 'keep' }], 409); }
    finally { f.sql.transaction = transaction; }
    assert.deepEqual(await rawCatalog(), before);
    assert.equal(await operations(), count);
    menu = await read();
    const stale = menu;
    menu = await edit(menu, { action: 'rename', kind: 'item', targetId: localDrinkId, name: '手動編集済みのお茶' });
    const afterRename = await rawCatalog(), countAfterRename = await operations();
    await review(stale, entry(stale, 'option', ids.beef, localBeefId), [{ field: 'price', decision: 'keep' }], 409);
    assert.deepEqual(await rawCatalog(), afterRename);
    assert.equal(await operations(), countAfterRename);
  });

  await check('review-rolls-back-catalog-baseline-and-decisions-when-final-operation-write-fails', async () => {
    const before = await rawCatalog(), count = await operations(), sourceBefore = await master();
    state.failPattern = /insert into store_dine_in_menu_operations/;
    try { await review(menu, entry(menu, 'option', ids.beef, localBeefId), [{ field: 'price', decision: 'adopt' }], 500); }
    finally { state.failPattern = null; }
    assert.deepEqual(await rawCatalog(), before);
    assert.equal(await operations(), count);
    assert.deepEqual(await master(), sourceBefore);
    menu = await read();
    assert.equal(field(entry(menu, 'option', ids.beef, localBeefId), 'price').changed, true);
  });

  await check('authentication-scope-csrf-and-terminal-permission-denials-preserve-review-state', async () => {
    const body = { revision: menu.revision, operationId: uuid(operation++), ...command(menu, entry(menu, 'option', ids.beef, localBeefId), [{ field: 'price', decision: 'keep' }]) };
    const before = await rawCatalog(), count = await operations(), session = state.session;
    state.session = null;
    await json(f.getMenu(), 401); await json(f.mutateMenu(body), 401);
    state.session = session;
    state.permitted = false;
    await json(f.getMenu(), 403); await json(f.mutateMenu(body), 403);
    state.permitted = true;
    state.session = { ...session, role: 'store_terminal' };
    await json(f.mutateMenu(body), 403);
    state.session = session;
    await json(f.mutateMenu({ ...body, storeId: ids.other }), 403);
    await json(f.mutateMenu({ ...body, brandId: ids.otherBrand }), 403);
    await json(f.mutateMenu(body, { origin: 'https://foreign.invalid' }), 403);
    await json(f.mutateMenu(body, { 'sec-fetch-site': 'cross-site' }), 403);
    assert.deepEqual(await rawCatalog(), before);
    assert.equal(await operations(), count);
  });

  await check('local-only-and-derived-records-keep-explicit-correspondence-without-name-matching', async () => {
    menu = await edit(menu, { action: 'createCategory', name: '店内ドリンク' });
    const category = menu.catalog.categories.find(row => row.name === '店内ドリンク');
    menu = await edit(menu, { action: 'createItem', categoryId: category.id, itemKind: 'drink', name: '新版のお茶', price: 200 });
    const standalone = menu.catalog.items.find(row => row.name === '新版のお茶');
    assert.equal(entry(menu, 'item', '', standalone.id).status, 'localOnly');
    assert.notEqual(standalone.sourceItemId, ids.drink);
    menu = await edit(menu, { action: 'duplicate', kind: 'item', targetId: localDrinkId, name: '派生ドリンク' });
    const duplicate = menu.catalog.items.find(row => row.name === '派生ドリンク');
    const mapped = entry(menu, 'item', ids.drink, duplicate.id);
    assert.equal(mapped.status, 'linked');
    assert.equal(mapped.sourceName, '新版のお茶');
    assert.notEqual(duplicate.id, localDrinkId);
    assert.equal(mapped.networkPrice, 500);
  });

  await check('selection-rule-adoption-is-bounded-and-does-not-adopt-other-options-portions', async () => {
    const groupId = menu.catalog.optionGroups.find(row => row.sourceGroupId === ids.premiumGroup).id;
    await db.query('update menu_option_groups set rule_json=$1::jsonb where id=$2', [JSON.stringify({ minSelections: 1, maxSelections: 2, portionGrams: 60 }), ids.premiumGroup]);
    menu = await read();
    const groupEntry = entry(menu, 'group', ids.premiumGroup, groupId);
    assert.equal(field(groupEntry, 'rules').canAdopt, true);
    menu = await review(menu, groupEntry, [{ field: 'rules', decision: 'adopt' }]);
    const group = menu.catalog.optionGroups.find(row => row.id === groupId);
    assert.equal(group.ruleJson.minSelections, 1);
    assert.equal(group.ruleJson.maxSelections, 2);
    assert.equal(group.ruleJson.portionGrams, 50, 'Selection-rule review must not implicitly change another option portion');
    assert.equal(field(entry(menu, 'option', ids.pork, option(menu, ids.pork).id), 'specification').localValue.portionGrams, 50);
    await db.query('update menu_option_groups set rule_json=$1::jsonb where id=$2', [JSON.stringify({ minSelections: 99, maxSelections: 99, portionGrams: 60 }), ids.premiumGroup]);
    menu = await read();
    assert.equal(field(entry(menu, 'group', ids.premiumGroup, groupId), 'rules').canAdopt, false);
    const before = await rawCatalog();
    await review(menu, entry(menu, 'group', ids.premiumGroup, groupId), [{ field: 'rules', decision: 'adopt' }], 400);
    assert.deepEqual(await rawCatalog(), before);
    await db.query('update menu_option_groups set selection_type=$1,rule_json=$2::jsonb where id=$3', ['single', JSON.stringify({ minSelections: 2, maxSelections: 2, portionGrams: 60 }), ids.premiumGroup]);
    menu = await read();
    assert.equal(field(entry(menu, 'group', ids.premiumGroup, groupId), 'rules').canAdopt, false, 'Single-choice cannot satisfy a two-choice minimum');
    await review(menu, entry(menu, 'group', ids.premiumGroup, groupId), [{ field: 'rules', decision: 'adopt' }], 400);
    assert.deepEqual(await rawCatalog(), before);
    await db.query('update menu_option_groups set selection_type=$1,rule_json=$2::jsonb where id=$3', ['multiple', JSON.stringify({ minSelections: 0, maxSelections: 5, portionGrams: 60 }), ids.premiumGroup]);
    menu = await read();
    menu = await review(menu, entry(menu, 'group', ids.premiumGroup, groupId), [{ field: 'rules', decision: 'adopt' }]);
  });

  await check('unified-addon-correspondence-retains-each-options-original-group-and-independent-price', async () => {
    const bowl = item(menu, ids.menu);
    const candidates = f.load('lib/store-dine-in-menu-policy.ts').getDineInAddonCandidates(menu.catalog, bowl.id, undefined, menu.source);
    const sources = [ids.beef, ids.legacyOption].map(id => candidates.find(row => row.option.sourceOptionId === id));
    assert.ok(sources.every(Boolean));
    menu = await edit(menu, { action: 'createAddonGroup', itemId: bowl.id, name: '統合した追加食材', optionIds: sources.map(row => row.option.id) });
    const group = menu.catalog.optionGroups.find(row => row.name === '統合した追加食材');
    assert.equal(entry(menu, 'group', '', group.id).status, 'localOnly');
    assert.equal(group.options.length, 2);
    const beef = group.options.find(row => row.sourceOptionId === ids.beef), legacy = group.options.find(row => row.sourceOptionId === ids.legacyOption);
    const beefEntry = entry(menu, 'option', ids.beef, beef.id), legacyEntry = entry(menu, 'option', ids.legacyOption, legacy.id);
    assert.equal(beefEntry.localGroupName, group.name);
    assert.equal(legacyEntry.localGroupName, group.name);
    assert.equal(beefEntry.sourceGroupName, '厨房追加食材');
    assert.equal(legacyEntry.sourceGroupName, 'カウンター指定食材');
    assert.equal(beef.sourceGroupId, ids.premiumGroup);
    assert.equal(legacy.sourceGroupId, ids.legacyGroup);
    assert.equal(beefEntry.importPrice, 650);
    assert.equal(legacyEntry.importPrice, 100);
    assert.equal(field(beefEntry, 'price').changed, true, 'Regrouping must preserve an unread update from an existing local copy');
    assert.equal(field(legacyEntry, 'price').changed, false);
    const originalCopy = clone(option(menu, ids.beef));
    menu = await review(menu, beefEntry, [{ field: 'price', decision: 'adopt' }]);
    assert.equal(menu.catalog.optionGroups.find(row => row.id === group.id).options.find(row => row.id === beef.id).priceDelta, beefEntry.networkPrice);
    assert.deepEqual(option(menu, ids.beef), originalCopy, 'Another local copy keeps its deliberate surcharge');
    const linkedHeatOrSoup = menu.catalog.optionGroups.find(row => row.sourceGroupId === ids.optionGroup);
    assert.ok(item(menu, ids.menu).optionGroupIds.includes(linkedHeatOrSoup.id));
  });

  await db.query('update menu_catalog_items set is_active=false where id=$1', [ids.drink]);
  menu = await read();
  await check('retired-source-is-visible-but-never-removes-local-record-or-bypasses-stock-guards', async () => {
    assert.equal(entry(menu, 'item', ids.drink, localDrinkId).status, 'missing');
    assert.ok(item(menu, ids.drink));
    const before = await rawCatalog();
    await review(menu, entry(menu, 'item', ids.drink, localDrinkId), [{ field: 'availability', decision: 'adopt' }], 400);
    assert.deepEqual(await rawCatalog(), before);
    await checkout([{ menuCatalogItemId: localDrinkId, quantity: 1, selectedOptions: [] }], {}, 400);
    assert.deepEqual(await orderItems(paid.orderId), originalOrder);
    assert.deepEqual(await documents(paid.orderId), originalDocuments);
  });

  await check('new-source-product-can-be-ignored-for-this-revision-or-explicitly-imported-later', async () => {
    const sourceId = uuid(78001);
    await db.query('insert into menu_catalog_items(id,brand_id,name,item_kind,category,base_price) values($1,$2,$3,$4,$5,$6)', [sourceId, ids.brand, '新しい飲料', 'drink', 'ドリンク', 300]);
    menu = await read();
    let candidate = entry(menu, 'item', sourceId);
    assert.equal(candidate.status, 'new');
    assert.equal(candidate.pending, true);
    assert.ok(!menu.catalog.items.some(row => row.sourceItemId === sourceId));
    const previousPos = await posGet();
    menu = await review(menu, candidate, candidate.fields.map(row => ({ field: row.field, decision: 'keep' })));
    candidate = entry(menu, 'item', sourceId);
    assert.equal(candidate.pending, false);
    assert.ok(!menu.catalog.items.some(row => row.sourceItemId === sourceId));
    assert.equal((await posGet()).dineInMenuRevision, previousPos.dineInMenuRevision);
    await db.query('update menu_catalog_items set base_price=350 where id=$1', [sourceId]);
    menu = await read();
    assert.equal(field(entry(menu, 'item', sourceId), 'price').changed, true);
    const sourceBefore = await master();
    menu = await edit(menu, { action: 'importItem', sourceItemId: sourceId });
    assert.equal(item(menu, sourceId).price, 350);
    assert.equal(entry(menu, 'item', sourceId, item(menu, sourceId).id).status, 'linked');
    assert.equal(entry(menu, 'item', sourceId, item(menu, sourceId).id).pending, false);
    assert.deepEqual(await master(), sourceBefore);
  });

  await check('legacy-menu-first-review-is-explicit-and-read-only-until-acknowledged', async () => {
    const stored = await rawCatalog(), legacy = clone(stored.catalog);
    delete legacy.sourceReview;
    await db.query('update store_dine_in_menus set catalog=$1::jsonb where store_id=$2 and brand_id=$3', [JSON.stringify(legacy), ids.store, ids.brand]);
    const before = await rawCatalog(), count = await operations();
    menu = await read();
    assert.equal(menu.sourceReview.initial, true);
    const beef = entry(menu, 'option', ids.beef, localBeefId);
    assert.equal(field(beef, 'price').baselineKnown, false);
    assert.equal(beef.pending, true);
    assert.deepEqual(await rawCatalog(), before);
    assert.equal(await operations(), count);
    const local = clone(option(menu, ids.beef));
    menu = await review(menu, beef, beef.fields.map(row => ({ field: row.field, decision: 'keep' })));
    assert.deepEqual(option(menu, ids.beef), local);
    assert.equal(entry(menu, 'option', ids.beef, localBeefId).pending, false);
    assert.equal(menu.sourceReview.initial, true, 'Reviewing one entry does not finish the remaining initial review');
  });

  await check('initial-bulk-acknowledgement-rejects-stale-source-and-rolls-back-failed-persistence', async () => {
    const stale = menu;
    // One already-reviewed field changes; another product is a current unknown
    // import candidate. The bulk action must distinguish those two situations.
    await db.query('update menu_options set price_delta=price_delta+20 where id=$1', [ids.beef]);
    await db.query('insert into menu_catalog_items(id,brand_id,name,item_kind,category,base_price) values($1,$2,$3,$4,$5,$6)', [uuid(78002), ids.brand, '初回未取込ドリンク', 'drink', 'ドリンク', 390]);
    const before = await rawCatalog(), count = await operations();
    await edit(stale, { action: 'acknowledgeSourceBaseline', sourceRevision: stale.sourceReview.sourceRevision }, 409);
    assert.deepEqual(await rawCatalog(), before);
    assert.equal(await operations(), count);
    menu = await read();
    for (const patch of [{ sourceRevision: '' }, { sourceRevision: 'z'.repeat(32) }, { entryKey: 'item:' + localDrinkId }, { decisions: [{ field: 'name', decision: 'keep' }] }, { price: 1 }, { sourceValue: {} }]) {
      await edit(menu, { action: 'acknowledgeSourceBaseline', sourceRevision: menu.sourceReview.sourceRevision, ...patch }, 400);
    }
    const transaction = f.sql.transaction;
    f.sql.transaction = async statements => {
      await db.query('update menu_catalog_items set base_price=base_price+1 where id=$1', [uuid(78002)]);
      return transaction(statements);
    };
    try { await edit(menu, { action: 'acknowledgeSourceBaseline', sourceRevision: menu.sourceReview.sourceRevision }, 409); }
    finally { f.sql.transaction = transaction; }
    assert.deepEqual(await rawCatalog(), before);
    assert.equal(await operations(), count);
    menu = await read();
    state.failPattern = /insert into store_dine_in_menu_operations/;
    try { await edit(menu, { action: 'acknowledgeSourceBaseline', sourceRevision: menu.sourceReview.sourceRevision }, 500); }
    finally { state.failPattern = null; }
    assert.deepEqual(await rawCatalog(), before);
    assert.equal(await operations(), count);
    menu = await read();
    assert.equal(menu.sourceReview.initial, true);
  });

  await check('initial-bulk-acknowledgement-cannot-overwrite-a-competing-metadata-review', async () => {
    const previousPos = await posGet(), count = await operations(), old = menu;
    const transaction = f.sql.transaction;
    let winner;
    f.sql.transaction = async statements => {
      f.sql.transaction = transaction;
      winner = await review(old, entry(old, 'item', uuid(78002)), [{ field: 'name', decision: 'keep' }]);
      return transaction(statements);
    };
    try { await edit(old, { action: 'acknowledgeSourceBaseline', sourceRevision: old.sourceReview.sourceRevision }, 409); }
    finally { f.sql.transaction = transaction; }
    menu = await read();
    assert.equal(menu.sourceReview.initial, true);
    assert.deepEqual(menu.catalog, winner.catalog);
    assert.equal(menu.revision, winner.revision);
    assert.equal(await operations(), count + 1);
    assert.equal((await posGet()).dineInMenuRevision, previousPos.dineInMenuRevision);
  });

  await check('initial-bulk-acknowledgement-keeps-current-menu-and-known-updates-with-once-only-replay', async () => {
    const stripReview = value => { const next = clone(value); delete next.sourceReview; return next; };
    const before = await rawCatalog(), sourceBefore = await master();
    const publicBefore = await publicMenu(false), publicStoreBefore = await publicMenu(true), posBefore = await posGet();
    const knownBeef = field(entry(menu, 'option', ids.beef, localBeefId), 'price');
    assert.equal(knownBeef.baselineKnown, true);
    assert.equal(knownBeef.changed, true);
    assert.equal(entry(menu, 'item', uuid(78002)).pending, true);
    const count = await operations();
    const body = { revision: menu.revision, operationId: uuid(operation++), action: 'acknowledgeSourceBaseline', sourceRevision: menu.sourceReview.sourceRevision };
    menu = await json(f.mutateMenu(body));
    assert.deepEqual(stripReview(menu.catalog), stripReview(before.catalog));
    assert.notEqual(menu.revision, before.revision);
    assert.equal(menu.sourceReview.initial, false);
    assert.equal((await posGet()).dineInMenuRevision, posBefore.dineInMenuRevision);
    const stillChanged = field(entry(menu, 'option', ids.beef, localBeefId), 'price');
    assert.equal(stillChanged.changed, true);
    assert.deepEqual(stillChanged.previousValue, knownBeef.previousValue);
    assert.equal(entry(menu, 'item', uuid(78002)).status, 'new');
    assert.equal(entry(menu, 'item', uuid(78002)).pending, false);
    assert.ok(!menu.catalog.items.some(row => row.sourceItemId === uuid(78002)));
    assert.deepEqual(menu.sourceReview.entries.filter(row => row.pending).map(row => row.key), [entry(menu, 'option', ids.beef, localBeefId).key]);
    assert.deepEqual(await master(), sourceBefore);
    assert.deepEqual(await publicMenu(false), publicBefore);
    assert.deepEqual(await publicMenu(true), publicStoreBefore);
    assert.deepEqual(await orderItems(paid.orderId), originalOrder);
    assert.deepEqual(await documents(paid.orderId), originalDocuments);
    assert.equal(await operations(), count + 1);
    assert.ok(menu.catalog.sourceReview.decisions.length <= 100);
    const catalog = clone(menu.catalog), revision = menu.revision;
    const replay = await json(f.mutateMenu(body));
    assert.deepEqual(replay.catalog, catalog);
    assert.equal(replay.revision, revision);
    assert.equal(await operations(), count + 1);
    await json(f.mutateMenu({ ...body, sourceRevision: 'f'.repeat(32) }), 409);
  });

  await check('concurrent-metadata-only-review-still-conflicts-under-management-revision-guard', async () => {
    const previousPos = await posGet(), count = await operations(), old = menu;
    const transaction = f.sql.transaction;
    let winner;
    f.sql.transaction = async statements => {
      // A competing request completes after the outer request prepared its JSON,
      // but before its transaction. Its sale-facing aggregate stays identical.
      f.sql.transaction = transaction;
      winner = await review(old, entry(old, 'option', ids.beef, localBeefId), [{ field: 'price', decision: 'keep' }]);
      return transaction(statements);
    };
    try { await review(old, entry(old, 'option', ids.beef, localBeefId), [{ field: 'price', decision: 'keep' }], 409); }
    finally { f.sql.transaction = transaction; }
    menu = await read();
    assert.deepEqual(menu.catalog, winner.catalog);
    assert.equal(menu.revision, winner.revision);
    assert.equal(await operations(), count + 1);
    assert.equal((await posGet()).dineInMenuRevision, previousPos.dineInMenuRevision);
  });

  const sourceHashes = await hashes();
  assert.deepEqual(sourceHashes, inputHashes, 'Runtime source changed while suite was running');
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ passed: results.length, results, source, sourceHashes, inputHashes, noSourceDrift: true, actualApi: true, actualPosPersistence: true, actualPrintSnapshots: true, database: 'isolated PGlite', liveWrites: 0, externalCalls: 0 }, null, 2) + '\n');
  await rm(resolve(output, 'failure.json'), { force: true });
  console.log(JSON.stringify({ passed: results.length, output }));
} catch (error) {
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: error.stack, results, source }, null, 2) + '\n');
  throw error;
} finally {
  await db.close();
}
