// Execute the production reader SQL against isolated PostgreSQL, never DATABASE_URL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require(process.env.FOUNDR1_TYPESCRIPT_MODULE || 'typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const root = new URL('../../', import.meta.url);
const db = new PGlite();
const ids = Object.fromEntries(['store', 'otherStore', 'employee', 'brand', 'sku', 'hidden', 'stopped', 'menu', 'secondMenu', 'recipe', 'option', 'unmapped', 'otherMenu', 'location', 'secondLocation', 'stock', 'unknownStock', 'order', 'otherOrder', 'requested', 'purchased', 'inDelivery', 'delivered', 'received', 'unavailable', 'actual', 'hiddenLine', 'otherLine', 'receiptOrder', 'receiptLine'].map((key, i) => [key, `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`]));
let session = { id: ids.employee, role: 'store_manager' };
let allowed = true;
let canUseOrders = true;
let canEditMenus = false;
let failRead = false;
const statements = [];
const sql = (parts, ...values) => {
  const query = parts.reduce((text, part, i) => text + part + (i < values.length ? `$${i + 1}` : ''), '');
  statements.push(query);
  if (failRead && query.includes('with menu_signals')) return Promise.reject(new Error('simulated unavailable database'));
  return db.query(query, values).then(result => result.rows);
};
function load(path, modules = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, root), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(source, { exports, Response, Request, URL, console, require: name => {
    if (name.endsWith('/api-auth')) return {
      requireOsSession: async () => session,
      requireWritableOsSession: async () => session && ['owner', 'manager', 'store_owner', 'store_manager', 'staff'].includes(session.role) ? session : null,
      getSessionStoreScope: async () => ({ allStores: false, storeIds: allowed ? [ids.store] : [] })
    };
    if (name.endsWith('/db')) return { sql };
    if (name.endsWith('/role-permissions')) return { roleHasPermission: async (_, key) => key === 'module.orders' ? canUseOrders : key === 'menus.edit' ? canEditMenus : false };
    if (name in modules) return modules[name];
    throw new Error(`Unmocked isolated dependency: ${name}`);
  } });
  return exports;
}
try {
  await db.exec(`
    create table stores(id uuid primary key, name text, status text default 'active', business_hours jsonb default '{}'::jsonb);
    create table store_brands(store_id uuid, brand_id uuid);
    create table employees(id uuid primary key);
    create table products(id uuid primary key, name text, unit text, brand_scope text, catalog_visibility text, is_orderable boolean,
      package_quantity numeric, package_quantity_unit text, inventory_unit_conversions jsonb not null default '[]'::jsonb);
    create table product_brand_usages(product_id uuid, brand_id uuid, is_orderable boolean);
    create table product_catalog_store_grants(product_id uuid, store_id uuid);
    create table menu_catalog_items(id uuid primary key, brand_id uuid, store_id uuid, name text, display_names jsonb default '{}'::jsonb, is_active boolean default true);
    create table menu_option_groups(id uuid primary key, brand_id uuid, menu_catalog_item_id uuid, is_active boolean default true);
    create table menu_options(id uuid primary key, option_group_id uuid, name text, display_names jsonb default '{}'::jsonb, is_active boolean default true);
    create table menu_store_settings(store_id uuid, menu_catalog_item_id uuid, is_available boolean, stock_status text, status_note text);
    create table menu_option_store_settings(store_id uuid, menu_option_id uuid, is_available boolean, stock_status text, status_note text);
    create table menu_product_links(menu_catalog_item_id uuid, menu_option_id uuid, product_id uuid);
    create table menu_inventory_availability_blocks(store_id uuid, target_kind text, target_id uuid, inventory_key text);
    create table menu_platform_availability_settings(store_id uuid, target_kind text, target_id uuid, platform text, availability text);
    create table inventory_locations(id uuid primary key, store_id uuid, name text, status text default 'active');
    create table inventory_items(id uuid primary key, store_id uuid, product_id uuid, location_id uuid, count_unit text, current_quantity numeric, safety_stock numeric, exception_code text, exception_note text, last_counted_at timestamptz, status text default 'active', count_conversion_snapshot jsonb);
    create table purchase_orders(id uuid primary key, store_id uuid, order_no text, created_at timestamptz default now());
    create table purchase_order_items(id uuid primary key, purchase_order_id uuid, product_id uuid, status text, requested_quantity numeric, actual_quantity numeric, requested_unit text);
    create table purchase_actuals(id uuid primary key, purchase_order_item_id uuid, actual_quantity numeric, actual_unit text, recorded_at timestamptz default now());
    create table inventory_checks(id uuid primary key);
    create table delivery_batches(id uuid primary key);
    insert into stores(id,name) values('${ids.store}','A'),('${ids.otherStore}','B');
    insert into store_brands values('${ids.store}','${ids.brand}'),('${ids.otherStore}','${ids.brand}');
    insert into products(id,name,unit,brand_scope,catalog_visibility,is_orderable) values('${ids.sku}','Shared SKU','袋','common','brand_stores',true),('${ids.hidden}','Hidden upstream SKU','袋','common','internal',true),('${ids.stopped}','Stopped SKU','袋','common','brand_stores',false);
    insert into menu_catalog_items(id,brand_id,name) values
      ('${ids.menu}','${ids.brand}','Direct menu'),('${ids.secondMenu}','${ids.brand}','Another menu'),
      ('${ids.recipe}','${ids.brand}','Dependent set'),('${ids.unmapped}','${ids.brand}','Needs mapping'),('${ids.otherMenu}','${ids.brand}','Other store menu');
    insert into menu_option_groups(id,brand_id,is_active) values('${ids.brand}','${ids.brand}',true);
    insert into menu_options(id,option_group_id,name) values('${ids.option}','${ids.brand}','Option');
    update menu_catalog_items set display_names='{"en":"Source menu","zh":"来源菜单"}' where id='${ids.menu}';
    insert into menu_store_settings values
      ('${ids.store}','${ids.menu}',true,'low_stock','人工報告'),('${ids.store}','${ids.secondMenu}',false,'unavailable',''),
      ('${ids.store}','${ids.recipe}',false,'unavailable',''),('${ids.store}','${ids.unmapped}',true,'low_stock',''),
      ('${ids.otherStore}','${ids.otherMenu}',true,'low_stock','');
    insert into menu_option_store_settings values('${ids.store}','${ids.option}',true,'low_stock','');
    insert into menu_product_links values('${ids.menu}',null,'${ids.sku}'),('${ids.menu}',null,'${ids.hidden}'),
      ('${ids.secondMenu}',null,'${ids.sku}'),('${ids.recipe}',null,'${ids.stopped}'),(null,'${ids.option}','${ids.stopped}'),('${ids.otherMenu}',null,'${ids.stopped}');
    insert into menu_inventory_availability_blocks values('${ids.store}','item','${ids.secondMenu}','item:${ids.secondMenu}'),('${ids.store}','item','${ids.recipe}','option:${ids.option}');
    insert into menu_platform_availability_settings values('${ids.store}','item','${ids.otherMenu}','uber_eats','unavailable');
    insert into inventory_locations(id,store_id,name) values('${ids.location}','${ids.store}','Cold storage'),('${ids.secondLocation}','${ids.store}','Shelf');
    insert into inventory_items(id,store_id,product_id,location_id,count_unit,current_quantity,safety_stock,exception_code,exception_note,last_counted_at) values
      ('${ids.stock}','${ids.store}','${ids.sku}','${ids.location}','袋',1,2,'low','古い盤点','2026-09-01'),
      ('${ids.unknownStock}','${ids.store}','${ids.sku}','${ids.secondLocation}','箱',null,1,'out','人工欠品',null);
    update inventory_items set count_conversion_snapshot='{"purchaseUnit":"箱","countUnit":"袋","unitsPerPurchase":4}' where id='${ids.stock}';
    insert into purchase_orders(id,store_id,order_no) values('${ids.order}','${ids.store}','PO-TEST'),('${ids.otherOrder}','${ids.otherStore}','PO-OTHER'),('${ids.receiptOrder}','${ids.store}','RCPT-TEST');
    insert into purchase_order_items values
      ('${ids.requested}','${ids.order}','${ids.sku}','requested',9,null,'袋'),('${ids.purchased}','${ids.order}','${ids.sku}','purchased',9,2,'袋'),
      ('${ids.inDelivery}','${ids.order}','${ids.sku}','in_delivery',9,null,'袋'),('${ids.delivered}','${ids.order}','${ids.sku}','delivered',9,null,'袋'),
      ('${ids.received}','${ids.order}','${ids.sku}','received',9,9,'袋'),('${ids.unavailable}','${ids.order}','${ids.sku}','unavailable',9,null,'袋'),
      ('${ids.hiddenLine}','${ids.order}','${ids.hidden}','requested',123,null,'袋'),('${ids.otherLine}','${ids.otherOrder}','${ids.sku}','requested',88,null,'袋'),('${ids.receiptLine}','${ids.receiptOrder}','${ids.sku}','requested',77,null,'袋');
    insert into purchase_actuals values('${ids.actual}','${ids.purchased}',2,'箱',now());
  `);
  await db.exec(readFileSync(new URL('db/migrations/20261009_inventory_receipts.sql', root), 'utf8'));
  await db.exec(readFileSync(new URL('db/migrations/20261009_inventory_quick_checks.sql', root), 'utf8'));
  const unitConversions = load('lib/product-unit-conversions.ts');
  const catalogPolicy = load('lib/product-catalog-policy.ts', { './product-unit-conversions.ts': unitConversions });
  const orderIntent = load('lib/replenishment-order-intent.ts');
  const quickPolicy = load('lib/inventory-quick-policy.ts');
  const policy = load('lib/replenishment-policy.ts', { './product-catalog-policy': catalogPolicy, './replenishment-order-intent': orderIntent, './inventory-quick-policy': quickPolicy });
  const data = load('lib/replenishment-data.ts', { './product-catalog-policy': catalogPolicy, './replenishment-policy': policy, './replenishment-order-intent': orderIntent, './product-unit-conversions': unitConversions, './inventory-quick-policy': quickPolicy });
  const storeAccess = load('lib/store-order-access.ts');
  const route = load('app/api/replenishment/route.ts', { '../../../lib/replenishment-data': data, '../../../lib/store-order-access': storeAccess });
  const get = (storeId = ids.store) => route.GET(new Request(`https://example.test/api/replenishment?storeId=${storeId}`));

  const response = await get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const snapshot = await response.json();
  assert.equal(snapshot.risks.length, 2);
  const risk = snapshot.risks.find(row => row.product.id === ids.sku);
  assert.equal(risk.sources.length, 4);
  assert.equal(risk.sources.find(row => row.id === ids.menu).displayNames.zh, '来源菜单');
  assert.equal(risk.openOrders.length, 4);
  assert.equal(risk.openOrders.find(row => row.itemId === ids.requested).actualQuantity, null);
  assert.equal(risk.openOrders.find(row => row.itemId === ids.purchased).actualUnit, '箱');
  assert.equal(risk.openOrders.find(row => row.itemId === ids.purchased).unit, '袋');
  assert.equal(risk.sources.find(row => row.id === ids.unknownStock).quantity, null);
  assert.equal(risk.sources.find(row => row.id === ids.unknownStock).countConfidence, 'unknown');
  assert.equal(risk.sources.find(row => row.id === ids.stock).countConfidence, 'stale');
  assert.deepEqual(risk.sources.find(row => row.id === ids.stock).purchaseEquivalent, { quantity: 0.25, unit: '箱' });
  assert.equal(risk.sources.find(row => row.id === ids.stock).conversionChanged, true);
  assert.equal(risk.sources.find(row => row.id === ids.unknownStock).purchaseEquivalent, null);
  assert.ok(!snapshot.risks.flatMap(row => row.sources).some(source => source.id === ids.recipe));
  assert.equal(snapshot.unmapped.length, 1);
  assert.equal(snapshot.restrictedSourceCount, 1);
  assert.equal(snapshot.risks.find(row => row.product.id === ids.stopped).blockedReason, 'not_orderable');
  assert.ok(!JSON.stringify(snapshot).includes(ids.hidden));
  assert.ok(!JSON.stringify(snapshot).includes('Hidden upstream SKU'));
  assert.ok(!JSON.stringify(snapshot).includes('PO-OTHER'));
  assert.ok(!statements.some(query => /\b(insert|update|delete)\b/i.test(query)));
  console.log('PASS: real scoped reader SQL, multi-source SKU merge, dependency exclusion, hidden SKU redaction, open demand and actual units');
  const initialPending = risk.pendingReceipts.find(row => row.itemId === ids.received);
  assert.equal(initialPending.actualQuantity, 9);
  assert.equal(initialPending.actualUnit, null);
  assert.equal(initialPending.remainingPurchaseQuantity, null);
  assert.ok(risk.pendingReceipts.some(row => row.itemId === ids.delivered && row.actualQuantity === null));
  await db.query('insert into purchase_actuals values(gen_random_uuid(),$1,9,$2,now())', [ids.received, '袋']);
  let pending = (await (await get()).json()).risks.find(row => row.product.id === ids.sku).pendingReceipts.find(row => row.itemId === ids.received);
  assert.equal(pending.remainingPurchaseQuantity, 9);
  const recordReceipt = async purchaseQuantity => db.query(`
    insert into inventory_stock_receipts(request_id,purchase_order_item_id,purchase_order_id,store_id,product_id,inventory_item_id,
      purchase_quantity,purchase_unit,count_quantity,count_unit,mode,before_stock_quantity,after_stock_quantity,
      conversion_snapshot,source_snapshot,request_payload)
    values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,'袋',$6,'袋','included',1,1,
      '{"purchaseUnit":"袋","countUnit":"袋","unitsPerPurchase":1}'::jsonb,'{}'::jsonb,'{}'::jsonb)
  `, [ids.received, ids.order, ids.store, ids.sku, ids.stock, purchaseQuantity]);
  await recordReceipt(2);
  pending = (await (await get()).json()).risks.find(row => row.product.id === ids.sku).pendingReceipts.find(row => row.itemId === ids.received);
  assert.equal(pending.receivedPurchaseQuantity, 2);
  assert.equal(pending.remainingPurchaseQuantity, 7);
  await recordReceipt(7);
  const fullyPosted = (await (await get()).json()).risks.find(row => row.product.id === ids.sku);
  assert.ok(!fullyPosted.pendingReceipts.some(row => row.itemId === ids.received));
  assert.equal(fullyPosted.sources.length, 4);
  await db.query('update products set unit=$1 where id=$2', ['箱', ids.sku]);
  pending = (await (await get()).json()).risks.find(row => row.product.id === ids.sku).pendingReceipts.find(row => row.itemId === ids.received);
  assert.equal(pending.actualUnit, '袋');
  assert.equal(pending.receivedPurchaseQuantity, 9);
  assert.equal(pending.remainingPurchaseQuantity, null);
  await db.query('update products set unit=$1 where id=$2', ['袋', ids.sku]);
  console.log('PASS: received status is independent from partial/full stock receipts; changed purchase units retain ledger facts and require review');
  await db.exec(`update inventory_items set stock_quantity=1.5,stock_revision=stock_revision+1,last_received_at=now() where id='${ids.stock}';`);
  const bookSnapshot = await (await get()).json();
  const bookSource = bookSnapshot.risks.find(row => row.product.id === ids.sku).sources.find(row => row.id === ids.stock);
  assert.equal(bookSource.quantity, 1.5);
  assert.equal(bookSource.lastCountedQuantity, 1);
  assert.equal(bookSource.stockRevision, 1);
  assert.ok(bookSource.lastReceivedAt);
  assert.equal(bookSource.countConfidence, 'stale');
  assert.deepEqual(bookSource.purchaseEquivalent, { quantity: 0.375, unit: '箱' });
  console.log('PASS: replenishment reads book stock with its snapshot while retaining physical count quantity and freshness');
  await db.exec(`insert into purchase_actuals values(gen_random_uuid(),'${ids.purchased}',3,'kg',now() + interval '1 second');`);
  const changedActuals = await (await get()).json();
  assert.equal(changedActuals.risks.find(row => row.product.id === ids.sku).openOrders.find(row => row.itemId === ids.purchased).actualUnit, null);
  console.log('PASS: mismatched latest actual facts do not reuse an older matching quantity/unit');

  const countBeforeDenied = statements.filter(query => query.includes('with menu_signals')).length;
  assert.equal((await get(ids.otherStore)).status, 403);
  allowed = false;
  assert.equal((await get()).status, 403);
  assert.equal(statements.filter(query => query.includes('with menu_signals')).length, countBeforeDenied);
  allowed = true;
  session = null;
  assert.equal((await get()).status, 401);
  session = { id: ids.employee, role: 'store_terminal' };
  assert.equal((await (await get()).json()).canCreateOrder, false);
  session.role = 'staff';
  canUseOrders = false;
  const staff = await (await get()).json();
  assert.equal(staff.risks.length, 2);
  assert.equal(staff.canCreateOrder, false);
  assert.equal(staff.canManageMenuLinks, false);
  session.role = 'owner'; canUseOrders = true; canEditMenus = true;
  const owner = await (await get()).json();
  assert.equal(owner.canCreateOrder, true);
  assert.equal(owner.canManageMenuLinks, true);
  assert.ok(owner.risks.some(row => row.product.id === ids.hidden));
  console.log('PASS: denied scope before data read, session validation, scoped staff/terminal read, writable order and HQ mapping permissions');

  session.role = 'store_manager';
  failRead = true;
  const failed = await get();
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get('Cache-Control'), 'no-store');
  assert.equal((await failed.json()).risks, undefined);
  failRead = false;
  await db.exec(`delete from menu_store_settings where store_id='${ids.store}'; delete from menu_option_store_settings where store_id='${ids.store}'; update inventory_items set status='inactive' where store_id='${ids.store}';`);
  const empty = await (await get()).json();
  assert.equal(empty.risks.length, 0);
  assert.equal(empty.unmapped.length, 0);
  assert.equal(empty.restrictedSourceCount, 0);
  assert.equal(empty.canManageMenuLinks, false);
  console.log('PASS: failed read remains an error and a new empty read does not reuse previous risk/cache state');

  const secondBrandId = '00000000-0000-4000-8000-000000000099';
  await db.exec(`
    insert into store_brands values('${ids.store}','${secondBrandId}');
    update products set brand_scope='specific',is_orderable=true where id='${ids.stopped}';
    insert into product_brand_usages values('${ids.stopped}','${ids.brand}',true);
    insert into menu_store_settings values('${ids.store}','${ids.recipe}',true,'low_stock','');
  `);
  assert.equal((await (await get()).json()).risks[0].product.id, ids.stopped);
  await db.exec(`update menu_catalog_items set brand_id='${secondBrandId}' where id='${ids.recipe}';`);
  for (const role of ['store_manager', 'owner', 'manager']) {
    session.role = role;
    const movedMenu = await (await get()).json();
    assert.equal(movedMenu.risks.length, 0);
    assert.equal(movedMenu.restrictedSourceCount, 1);
    assert.ok(!JSON.stringify(movedMenu).includes(ids.stopped));
    assert.ok(!JSON.stringify(movedMenu).includes('Stopped SKU'));
  }
  assert.equal(Number((await db.query('select count(*) from menu_product_links where menu_catalog_item_id=$1 and product_id=$2', [ids.recipe, ids.stopped])).rows[0].count), 1);
  console.log('PASS: real menu brand change keeps the relation but hides the mismatched SKU even from HQ roles');

  const canonicalIds = Object.fromEntries(['privateItem', 'inactiveParent', 'globalParent', 'inactiveGroup', 'privateGroup', 'globalGroup', 'inactiveOption', 'privateOption', 'globalOption'].map((key, i) => [key, `00000000-0000-4000-8000-${String(80 + i).padStart(12, '0')}`]));
  await db.exec(`
    insert into menu_catalog_items(id,brand_id,store_id,name,is_active) values
      ('${canonicalIds.privateItem}','${ids.brand}','${ids.store}','Private menu',true),
      ('${canonicalIds.inactiveParent}','${ids.brand}',null,'Retired parent',false),
      ('${canonicalIds.globalParent}','${ids.brand}',null,'Global parent',true);
    insert into menu_store_settings values('${ids.store}','${canonicalIds.privateItem}',true,'low_stock','');
    insert into menu_product_links values('${canonicalIds.privateItem}',null,'${ids.sku}');
    insert into menu_option_groups(id,brand_id,menu_catalog_item_id) values
      ('${canonicalIds.inactiveGroup}','${ids.brand}','${canonicalIds.inactiveParent}'),
      ('${canonicalIds.privateGroup}','${ids.brand}','${canonicalIds.privateItem}'),
      ('${canonicalIds.globalGroup}','${ids.brand}','${canonicalIds.globalParent}');
    insert into menu_options(id,option_group_id,name) values
      ('${canonicalIds.inactiveOption}','${canonicalIds.inactiveGroup}','Retired parent option'),
      ('${canonicalIds.privateOption}','${canonicalIds.privateGroup}','Private parent option'),
      ('${canonicalIds.globalOption}','${canonicalIds.globalGroup}','Canonical option');
    insert into menu_option_store_settings values
      ('${ids.store}','${canonicalIds.inactiveOption}',true,'low_stock',''),
      ('${ids.store}','${canonicalIds.privateOption}',false,'unavailable',''),
      ('${ids.store}','${canonicalIds.globalOption}',true,'low_stock','');
    insert into menu_product_links values(null,'${canonicalIds.globalOption}','${ids.sku}');
  `);
  const canonical = await (await get()).json();
  const canonicalRisk = canonical.risks.find(row => row.product.id === ids.sku);
  assert.equal(canonicalRisk.sources.length, 1);
  assert.equal(canonicalRisk.sources[0].id, canonicalIds.globalOption);
  assert.equal(canonical.unmapped.length, 0);
  for (const key of ['privateItem', 'inactiveOption', 'privateOption']) assert.ok(!JSON.stringify(canonical).includes(canonicalIds[key]));
  assert.ok(!JSON.stringify(canonical).includes('Private menu'));
  assert.ok(!JSON.stringify(canonical).includes('Retired parent option'));
  assert.ok(!JSON.stringify(canonical).includes('Private parent option'));
  console.log('PASS: canonical global source stays visible while private items and inactive/private-parent options are excluded');

  session.role = 'store_manager';
  await db.exec(`update inventory_items set status='active',exception_code='',stock_quantity=1,current_quantity=1,last_counted_at='2026-09-01' where id='${ids.stock}';
    update inventory_items set status='active',exception_code='',stock_quantity=null,current_quantity=null,last_counted_at=null where id='${ids.unknownStock}';`);
  async function saveQuick(itemId,status) {
    await db.query('update inventory_items set quick_revision=quick_revision+1 where id=$1',[itemId]);
    const basisRow=(await db.query(`select items.store_id::text as "storeId",items.product_id::text as "productId",items.location_id::text as "locationId",
      items.stock_revision as "stockRevision",items.quick_revision as "quickRevision",items.count_unit as "countUnit",items.safety_stock::float as "safetyStock",
      products.unit as "purchaseUnit",products.package_quantity::float as "packageQuantity",products.package_quantity_unit as "rawPackageQuantityUnit",
      products.inventory_unit_conversions as "inventoryUnitConversions" from inventory_items items join products on products.id=items.product_id where items.id=$1`,[itemId])).rows[0];
    const basis=quickPolicy.createInventoryQuickCheckBasis(basisRow);
    await db.query('update inventory_items set quick_status=$1,quick_checked_at=now(),quick_checked_by_name=$2,quick_basis=$3::jsonb,quick_superseded_at=null where id=$4',[status,'Tester',JSON.stringify(basis),itemId]);
  }
  await saveQuick(ids.stock,'enough');
  let quickSnapshot=await (await get()).json();
  let quickRisk=quickSnapshot.risks.find(row=>row.product.id===ids.sku);
  assert.equal(quickRisk.sources.length,1);
  assert.equal(quickRisk.sources[0].id,canonicalIds.globalOption);
  await db.query("update inventory_items set quick_checked_at=now()-interval '25 hours' where id=$1",[ids.stock]);
  quickSnapshot=await (await get()).json();
  quickRisk=quickSnapshot.risks.find(row=>row.product.id===ids.sku);
  assert.equal(quickRisk.sources.find(row=>row.id===ids.stock).quickCheck.state,'recheck');
  assert.equal(quickRisk.sources.find(row=>row.id===ids.stock).quantity,1);
  await db.exec(`delete from menu_store_settings where store_id='${ids.store}';delete from menu_option_store_settings where store_id='${ids.store}';
    update inventory_items set stock_quantity=10,stock_revision=stock_revision+1 where id='${ids.stock}';`);
  await saveQuick(ids.unknownStock,'out');
  quickSnapshot=await (await get()).json();
  quickRisk=quickSnapshot.risks.find(row=>row.product.id===ids.sku);
  assert.equal(quickRisk.sources.length,1);assert.equal(quickRisk.sources[0].id,ids.unknownStock);
  assert.equal(quickRisk.sources[0].stockStatus,'unavailable');assert.equal(quickRisk.sources[0].quantity,null);
  assert.equal(quickRisk.sources[0].quickCheck.state,'fresh');assert.equal(quickRisk.sources[0].lastCountedQuantity,null);
  await db.query('update inventory_items set stock_quantity=7,stock_revision=stock_revision+1,last_received_at=now() where id=$1',[ids.unknownStock]);
  quickRisk=(await (await get()).json()).risks[0];
  assert.equal(quickRisk.sources[0].quickCheck.state,'recheck');assert.equal(quickRisk.sources[0].stockStatus,'unavailable');
  assert.equal(quickRisk.sources[0].quantity,7);assert.equal(quickRisk.sources[0].lastCountedQuantity,null);
  await db.query('update inventory_items set quick_superseded_at=now(),current_quantity=7,last_counted_at=now(),stock_revision=stock_revision+1 where id=$1',[ids.unknownStock]);
  assert.equal((await (await get()).json()).risks.length,0);
  console.log('PASS: fresh visual Enough suppresses only its location numeric shortage; explicit menu shortages remain, unknown negative reports survive arrival, and exact counts supersede');
} finally {
  await db.close();
}
