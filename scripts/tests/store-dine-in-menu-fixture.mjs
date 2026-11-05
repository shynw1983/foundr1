// Test-only PostgreSQL fixture. It never reads DATABASE_URL or invokes a live service.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPrintDocumentFixture } from './pos-print-document-fixture.mjs';

export const fixtureUuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export async function createDineInMenuFixture(source) {
  source = resolve(source);
  const f = await createPrintDocumentFixture(source);
  const { db, ids, state, modules, sql } = f;
  sql.query = (text, values=[]) => ({ text, values, then(onResolve,onReject) {
    const result = state.failPattern?.test(text) ? Promise.reject(new Error('fixture persistence failure')) : db.query(text,values).then(result=>result.rows);
    return result.then(onResolve,onReject);
  } });
  Object.assign(ids, {
    secondBrand: fixtureUuid(3001), otherBrand: fixtureUuid(3002), drink: fixtureUuid(3003), hiddenItem: fixtureUuid(3004),
    premiumGroup: fixtureUuid(3005), beef: fixtureUuid(3006), pork: fixtureUuid(3007), hiddenOption: fixtureUuid(3008), category: fixtureUuid(3009),
    unavailableItem: fixtureUuid(3010), otherItem: fixtureUuid(3011), source: fixtureUuid(3012), categoryDrink: fixtureUuid(3013),
    pseudoItem: fixtureUuid(3014), outsiderOption: fixtureUuid(3015), legacyGroup: fixtureUuid(3016), legacyOption: fixtureUuid(3017)
  });
  state.permitted = true;
  state.inventoryCalls = [];
  modules['role-permissions'] = { roleHasPermission: async role => state.permitted && ['owner','manager','store_owner','store_manager'].includes(role) };
  modules['store-order-access'] = {
    getStoreOrderAccess: async () => ({ stores: [{ id: ids.store, name: '桜並木 isolated' }], allStores: false, role: state.session?.role, canCancelOrders: true }),
    getScopedStoreFilter: (_, id) => !id || id === ids.store ? ids.store : '__forbidden__'
  };
  Object.assign(modules['inventory-order-usage'], {
    markInventoryOrderReady: async (...args) => state.inventoryCalls.push({ type: 'ready', args }),
    safeSyncInventoryOrderUsage: async (...args) => state.inventoryCalls.push({ type: 'sync', args })
  });
  modules['store-staff-presence'] = { applyStaffPresenceGateToPublicOperation: async (_id, operation) => operation };
  modules['store-reservation-windows'] = { getStoreReservationWindowsForCurrentBusinessDay: async () => [], getStoreReservationWindowsForDate: async () => [] };
  const schema = readFileSync(resolve(source, 'db/schema.sql'), 'utf8');
  const stripRefs = text => text.replace(/references\s+[\w.]+\s*\([^)]*\)(?:\s+on\s+delete\s+(?:cascade|set\s+null|restrict|no\s+action))?/gi, '');
  for (const table of ['menu_categories', 'menu_catalog_item_option_groups', 'menu_uber_sources', 'menu_platform_availability_settings', 'store_operations']) {
    const create = schema.match(new RegExp(`create table if not exists ${table} \\([\\s\\S]*?\\n\\);`));
    assert.ok(create, table);
    await db.exec(stripRefs(create[0]));
    for (const alter of schema.matchAll(new RegExp(`alter table ${table} add column[^;]*;`, 'g'))) await db.exec(stripRefs(alter[0]));
  }
  await db.exec(readFileSync(resolve(source, 'db/migrations/20261016_pos_menu_settings.sql'), 'utf8'));
  await db.query(`update stores set name='桜並木 isolated' where id=$1`, [ids.store]);
  await db.query(`update store_brands set pos_pricing_mode='weight',pos_weight_unit='g',pos_weight_unit_price=4 where store_id=$1`, [ids.store]);
  await db.query(`update menu_catalog_items set name='量り売り麻辣湯',display_names='{"en":"Original bowl","zh":"原名"}',variable_schema='{"posWeightPricing":{"unit":"g","unitPrice":4},"testSpecification":"50g portions"}' where id=$1`, [ids.menu]);
  await db.query(`update menu_option_groups set name='スープ',display_names='{"en":"Original soup"}',rule_json='{"minSelections":1,"maxSelections":1}' where id=$1`, [ids.optionGroup]);
  await db.query(`update menu_options set name='麻辣味',display_names='{"en":"Original spicy"}' where id=$1`, [ids.option]);
  await db.exec(`
    insert into brands(id,name,brand_type) values('${ids.secondBrand}','第二ブランド','restaurant'),('${ids.otherBrand}','未許可ブランド','restaurant');
    insert into store_brands(store_id,brand_id,pos_pricing_mode,pos_weight_unit_price) values('${ids.store}','${ids.secondBrand}','fixed',4),('${ids.other}','${ids.otherBrand}','fixed',4);
    insert into menu_categories(id,brand_id,name) values('${ids.category}','${ids.brand}','麻辣湯'),('${ids.categoryDrink}','${ids.brand}','ドリンク');
    update menu_catalog_items set category='麻辣湯' where id='${ids.menu}';
    insert into menu_catalog_items(id,brand_id,name,item_kind,category,base_price,sort_order) values
      ('${ids.drink}','${ids.brand}','お茶','drink','ドリンク',400,200),
      ('${ids.hiddenItem}','${ids.brand}','非公開商品','fixed_product','麻辣湯',300,300),
      ('${ids.unavailableItem}','${ids.brand}','品切れ商品','fixed_product','麻辣湯',500,400),
      ('${ids.otherItem}','${ids.otherBrand}','他店商品','fixed_product','他店',700,500),
      ('${ids.pseudoItem}','${ids.brand}','食材一覧（こちら商品ではありません）','information','麻辣湯',0,600);
    insert into menu_store_settings(brand_id,store_id,menu_catalog_item_id,pos_enabled,price_override,is_available) values
      ('${ids.brand}','${ids.store}','${ids.menu}',true,777,true),
      ('${ids.brand}','${ids.store}','${ids.unavailableItem}',true,null,false);
    insert into menu_option_groups(id,brand_id,group_key,name,selection_type,rule_json,sort_order) values
      ('${ids.premiumGroup}','${ids.brand}','premium','厨房追加食材','multiple','{"minSelections":0,"maxSelections":5,"portionGrams":50}',20),
      ('${ids.legacyGroup}','${ids.brand}','custom-counter-key','カウンター指定食材','multiple','{"minSelections":0,"maxSelections":3}',30);
    insert into menu_options(id,option_group_id,option_key,name,display_names,price_delta,sort_order) values
      ('${ids.beef}','${ids.premiumGroup}','beef','牛筋 50g','{"en":"Beef tendon 50g"}',500,1),
      ('${ids.pork}','${ids.premiumGroup}','pork','豚軟骨 50g','{}',550,2),
      ('${ids.hiddenOption}','${ids.premiumGroup}','hidden','非公開食材 50g','{}',333,3),
      ('${ids.legacyOption}','${ids.legacyGroup}','legacy','店頭指定食材 50g','{}',100,1);
    insert into menu_pos_settings(store_id,brand_id,item_id,visible,price_override) values
      ('${ids.store}','${ids.brand}','${ids.menu}',true,600),
      ('${ids.store}','${ids.brand}','${ids.hiddenItem}',false,null);
    insert into menu_pos_settings(store_id,brand_id,group_id,visible) values('${ids.store}','${ids.brand}','${ids.premiumGroup}',true);
    insert into menu_pos_settings(store_id,brand_id,option_id,visible,price_override) values
      ('${ids.store}','${ids.brand}','${ids.beef}',true,650),
      ('${ids.store}','${ids.brand}','${ids.hiddenOption}',false,null);
    insert into menu_uber_sources(id,brand_id,store_id,uber_store_uuid,enabled) values('${ids.source}','${ids.brand}','${ids.store}','isolation-only',true);
  `);
  const masterSnapshot = async () => {
    const output = {};
    for (const table of ['menu_catalog_items','menu_option_groups','menu_options','menu_categories','menu_store_settings','menu_option_store_settings','menu_pos_settings','menu_uber_sources','store_brands']) {
      output[table] = (await db.query(`select to_jsonb(t) as row from ${table} t order by to_jsonb(t)::text`)).rows.map(row => row.row);
    }
    return JSON.parse(JSON.stringify(output));
  };
  async function installMigration() {
    const migration = readFileSync(resolve(source, 'db/migrations/20261020_store_dine_in_menu.sql'), 'utf8');
    await db.exec(migration); await db.exec(migration);
    return migration;
  }
  const admin = () => f.load('app/api/os/menus/dine-in/route.ts');
  const getMenu = (storeId=ids.store, brandId=ids.brand) => admin().GET(f.request(`/api/os/menus/dine-in?storeId=${storeId}&brandId=${brandId}`));
  const mutateMenu = (body, headers={}) => admin().POST(f.request('/api/os/menus/dine-in', { storeId: ids.store, brandId: ids.brand, ...body }, headers));
  return { ...f, masterSnapshot, installMigration, getMenu, mutateMenu, admin, reloadPos: () => f.reload('app/api/store/pos/route.ts'), sql };
}
