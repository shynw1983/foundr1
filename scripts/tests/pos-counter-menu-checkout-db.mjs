// Exercise real POS GET/POST, order SQL and receipt persistence on isolated PostgreSQL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDineInMenuFixture, fixtureUuid as uuid } from './store-dine-in-menu-fixture.mjs';

const f = await createDineInMenuFixture(process.cwd());
const { db, ids, state } = f;
const pos = f.reloadPos();
const json = async (response, status = 200) => {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
};
const readPos = async (suffix = '') => json(await pos.GET(f.request(`/api/store/pos?storeId=${ids.store}${suffix}`)));
const migration = readFileSync('db/migrations/20261107_pos_counter_menu_policy.sql', 'utf8');
let operation = 9900;
const edit = async (menu, change) => json(await f.mutateMenu({ revision: menu.revision, operationId: uuid(operation++), ...change }));
const checks = [];
const check = name => checks.push(name);
const savePolicy = policy => db.query('update pos_store_settings set counter_menu_policy=$1::jsonb where store_id=$2', [JSON.stringify(policy), ids.store]);
const selection = (group, option) => ({ groupId: group.id, optionIds: [option.id] });
const orderBody = async (orderType, items, patch = {}) => {
  const current = await readPos();
  return { ...f.baseBody, offlineClientOrderId: uuid(operation++), discountPresetKey: '', orderType,
    posFulfillmentPolicyVersion: 1, dineInAssociationVersion: 1, posMenuRevision: current.posMenuRevision,
    dineInMenuRevision: current.dineInMenuRevision, counterMenuPolicyRevision: current.counterMenuPolicyRevision,
    cashTenderedAmount: 5000, items, ...patch };
};
const writeOrder = async (orderType, items, patch = {}, status = 200) => {
  const body = await orderBody(orderType, items, patch);
  return { body, result: await json(await pos.POST(f.request('/api/store/pos', body)), status) };
};
const rows = async (id) => (await db.query(`select id::text,menu_catalog_item_id::text,measured_quantity::float,amount::int,customizations
  from store_customer_order_items where order_id=$1 order by sort_order`, [id])).rows;
const receipt = async (id) => (await db.query("select payload from pos_print_documents where order_id=$1 and kind='receipt'", [id])).rows[0].payload;

try {
  await f.installMigration();
  await db.exec('alter table pos_store_settings drop column if exists counter_menu_policy');
  assert.equal((await readPos()).posSettings.counterMenuPolicy.sharedMenuForTakeout, false);
  await db.exec(migration);
  await db.exec(migration);
  let menu = await edit({ revision: '' }, { action: 'initialize' });
  const bowl = menu.catalog.items.find(item => item.sourceItemId === ids.menu);
  const soup = menu.catalog.optionGroups.find(group => group.sourceGroupId === ids.optionGroup);
  const topping = menu.catalog.optionGroups.find(group => group.sourceGroupId === ids.premiumGroup);
  const beef = topping.options.find(option => option.sourceOptionId === ids.beef);
  const bowlLine = { menuCatalogItemId: bowl.id, quantity: 1, measuredQuantity: 250, weightMeasurement: { mode: 'manual_net' },
    selectedOptions: [selection(soup, soup.options[0]), selection(topping, beef)], preparationNote: '重量と食材を確認' };
  const before = await f.counts();
  await writeOrder('takeout', [bowlLine], {}, 400);
  assert.deepEqual(await f.counts(), before);
  check('existing separate policy and pre-migration read keep store-local item out of legacy takeout');

  menu = await edit(menu, { action: 'createCategory', name: '酒類' });
  const beerCategory = menu.catalog.categories.find(category => category.name === '酒類');
  menu = await edit(menu, { action: 'createItem', name: '缶ビール', categoryId: beerCategory.id, itemKind: 'drink', price: 550, pricingMode: 'fixed' });
  const beer = menu.catalog.items.find(item => item.category === '酒類');
  menu = await edit(menu, { action: 'setFulfillmentMode', kind: 'category', targetId: beerCategory.id, fulfillmentMode: 'immediate' });
  menu = await edit(menu, { action: 'createOptionGroup', itemId: bowl.id, name: '同時にお渡し', selectionType: 'single' });
  const group = menu.catalog.optionGroups.find(entry => entry.name === '同時にお渡し');
  menu = await edit(menu, { action: 'linkItemOptions', targetId: group.id, itemIds: [beer.id] });
  const option = menu.catalog.optionGroups.find(entry => entry.id === group.id).options[0];
  const withLinkedBeer = { ...bowlLine, selectedOptions: [...bowlLine.selectedOptions, selection(group, option)] };
  const beerLine = { menuCatalogItemId: beer.id, quantity: 1, selectedOptions: [] };
  const enabled = { sharedMenuForTakeout: true, standardTaxCategoryIds: [beerCategory.id], takeoutRestrictedCategoryIds: [] };
  let sourceBefore = await f.masterSnapshot();
  await savePolicy(enabled);
  const current = await readPos();
  assert.equal(current.posSettings.counterMenuPolicy.sharedMenuForTakeout, true);
  assert.equal(current.counterMenuPolicyRevision, (await readPos('&menuRevisionOnly=1')).counterMenuPolicyRevision);
  assert.equal(current.dineInMenu.items.find(item => item.id === beer.id).counterStandardTax, true);
  assert.equal(current.dineInMenu.optionGroups.find(entry => entry.id === group.id).options[0].counterStandardTax, true);
  assert.ok(current.dineInMenu.items.find(item => item.id === bowl.id));
  assert.ok(!current.dineInMenu.items.some(item => item.sourceItemId === ids.otherItem));
  const dine = (await writeOrder('eat_in', [withLinkedBeer])).result;
  const takeoutRequest = await writeOrder('takeout', [withLinkedBeer]);
  const takeaway = takeoutRequest.result;
  assert.equal(dine.amount, 2200);
  assert.equal(takeaway.amount, dine.amount);
  assert.deepEqual(dine.taxBreakdown, [{ rate: 10, grossAmount: 2200, taxAmount: 200 }]);
  assert.deepEqual(takeaway.taxBreakdown, [{ rate: 8, grossAmount: 1650, taxAmount: 123 }, { rate: 10, grossAmount: 550, taxAmount: 50 }]);
  assert.equal(takeaway.servingTickets.length, 1);
  const takeoutLine = (await rows(takeaway.orderId))[0];
  assert.equal(takeoutLine.measured_quantity, 250);
  assert.equal(takeoutLine.menu_catalog_item_id, ids.menu);
  assert.ok(takeoutLine.customizations.some(choice => choice.linkedItemIds?.includes(beer.sourceItemId) || JSON.stringify(choice).includes(beer.sourceItemId)));
  const mixedReceipt = await receipt(takeaway.orderId);
  assert.deepEqual(mixedReceipt.order.taxBreakdown, takeaway.taxBreakdown);
  assert.equal(mixedReceipt.order.totalAmount, 2200);
  assert.match(mixedReceipt.order.note, /8%.*10%/);
  check('both channels use the same local weighed line and linked modifier, gross unchanged, immutable mixed tax receipt');

  const beerOnly = (await writeOrder('takeout', [beerLine])).result;
  assert.equal(beerOnly.amount, 550);
  assert.equal(beerOnly.hasPreparation, false);
  assert.equal(beerOnly.servingTickets.length, 0);
  assert.deepEqual(beerOnly.taxBreakdown, [{ rate: 10, grossAmount: 550, taxAmount: 50 }]);
  const reduced = (await writeOrder('takeout', [bowlLine])).result;
  assert.deepEqual(reduced.taxBreakdown, [{ rate: 8, grossAmount: 1650, taxAmount: 123 }]);
  check('food-only is reduced rate; alcohol-only is standard and retains immediate handoff');

  // An exchange ticket covers the fixed-price body, not its linked paid drink.
  menu = await edit(menu, { action: 'createItem', name: '固定価格の食事', categoryId: menu.catalog.categories.find(category => category.name === '麻辣湯').id,
    itemKind: 'fixed_product', price: 1000, pricingMode: 'fixed' });
  const meal = menu.catalog.items.find(item => item.name === '固定価格の食事');
  menu = await edit(menu, { action: 'createOptionGroup', itemId: meal.id, name: '食事と一緒に', selectionType: 'single' });
  const mealGroup = menu.catalog.optionGroups.find(entry => entry.name === '食事と一緒に');
  menu = await edit(menu, { action: 'linkItemOptions', targetId: mealGroup.id, itemIds: [beer.id] });
  const mealBeer = menu.catalog.optionGroups.find(entry => entry.id === mealGroup.id).options[0];
  sourceBefore = await f.masterSnapshot();
  const couponId = uuid(operation++), memberId = uuid(operation++);
  await db.query("insert into member_coupons(id,member_id,brand_id,name,issued_source) values($1,$2,$3,'無料券','stamp_campaign')", [couponId, memberId, ids.brand]);
  Object.assign(f.modules.loyalty, {
    resolveMemberForOrder: async input => input.memberId === memberId ? { id: memberId } : null,
    getUsableMemberCoupon: async () => ({ id: couponId, brandId: ids.brand, issuedSource: 'stamp_campaign', name: '無料券' }),
    isMemberExchangeCoupon: coupon => coupon.issuedSource === 'stamp_campaign',
    calculateCouponDiscount: (_coupon, _subtotal, eligible) => Math.max(0, ...eligible)
  });
  const exchange = (await writeOrder('takeout', [{ menuCatalogItemId: meal.id, quantity: 1, selectedOptions: [selection(mealGroup, mealBeer)] }], { couponId, memberId })).result;
  assert.equal(exchange.amount, 550);
  assert.equal(exchange.couponDiscountAmount, 1000);
  assert.deepEqual(exchange.taxBreakdown, [{ rate: 10, grossAmount: 550, taxAmount: 50 }]);
  assert.equal((await db.query('select used_order_id::text as id from member_coupons where id=$1', [couponId])).rows[0].id, exchange.orderId);
  check('exchange voucher covers the food base; paid alcohol retains its full standard-rate gross');

  await savePolicy({ ...enabled, takeoutRestrictedCategoryIds: [beerCategory.id] });
  const restrictedBefore = await f.counts();
  for (const items of [[beerLine], [withLinkedBeer]]) {
    const reject = (await writeOrder('takeout', items, {}, 400)).result;
    assert.equal(reject.code, 'POS_COUNTER_TAKEOUT_RESTRICTED');
  }
  const stale = (await writeOrder('takeout', [bowlLine], { counterMenuPolicyRevision: current.counterMenuPolicyRevision }, 409)).result;
  assert.equal(stale.code, 'POS_COUNTER_MENU_CHANGED');
  await writeOrder('takeout', [bowlLine], { counterMenuPolicyRevision: undefined }, 409);
  await writeOrder('takeout', [bowlLine], { dineInMenuRevision: 'stale' }, 409);
  await writeOrder('takeout', [{ ...bowlLine, menuCatalogItemId: ids.menu }], {}, 400);
  await writeOrder('takeout', [{ ...bowlLine, measuredQuantity: undefined }], {}, 400);
  await writeOrder('other', [bowlLine], {}, 400);
  await writeOrder('takeout', [bowlLine], { storeId: ids.other }, 403);
  assert.deepEqual(await f.counts(), restrictedBefore);
  assert.equal((await writeOrder('eat_in', [beerLine])).result.amount, 550);
  const replay = await json(await pos.POST(f.request('/api/store/pos', takeoutRequest.body)));
  assert.equal(replay.duplicate, true);
  assert.deepEqual(replay.taxBreakdown, takeaway.taxBreakdown);
  assert.deepEqual(await receipt(takeaway.orderId), mixedReceipt);
  check('restricted linked or standalone items and stale or forged requests write nothing; saved receipt replays unchanged');

  const transaction = f.sql.transaction;
  const raceBefore = await f.counts();
  f.sql.transaction = async statements => {
    await savePolicy({ ...enabled, sharedMenuForTakeout: false });
    return transaction(statements);
  };
  try { await writeOrder('takeout', [bowlLine], {}, 409); } finally { f.sql.transaction = transaction; }
  assert.deepEqual(await f.counts(), raceBefore);
  await writeOrder('takeout', [bowlLine], {}, 400);
  check('concurrent switch rolls back sale and disabling returns to legacy separate checkout');

  await savePolicy(enabled);
  const concurrentBody = await orderBody('takeout', [bowlLine]);
  const concurrentBefore = await f.counts();
  let committed;
  f.sql.transaction = async statements => {
    f.sql.transaction = transaction;
    committed = await json(await pos.POST(f.request('/api/store/pos', concurrentBody)));
    await savePolicy({ ...enabled, sharedMenuForTakeout: false });
    return transaction(statements);
  };
  try {
    const raced = await json(await pos.POST(f.request('/api/store/pos', concurrentBody)));
    assert.equal(raced.duplicate, true);
    assert.equal(raced.orderId, committed.orderId);
    assert.equal((await f.counts()).orders, concurrentBefore.orders + 1);
  } finally { f.sql.transaction = transaction; }
  check('a concurrent exact retry committed before the policy switch returns the saved sale instead of inviting a second payment');
  assert.deepEqual(await f.masterSnapshot(), sourceBefore);
  assert.equal(state.externalCalls, 0);
  check('master menu remains unchanged and fixtures use no external service');
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  await db.close();
}
