// Shared test-only isolated PostgreSQL harness. Never imports production lib/db,
// reads DATABASE_URL, or performs external HTTP/native calls.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

export async function createPrintDocumentFixture(source) {
  source = resolve(source);
  const require = createRequire(resolve(source, 'package.json'));
  const ts = require('typescript');
  let pgliteModule;
  try { pgliteModule = require.resolve('@electric-sql/pglite'); }
  catch { pgliteModule = process.env.FOUNDR1_PGLITE_MODULE || '/private/tmp/foundr1-print-test-deps-20261018/node_modules/@electric-sql/pglite/dist/index.js'; }
  const { PGlite } = await import(pathToFileURL(pgliteModule).href);
  const db = new PGlite();
  const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const ids = { store: uuid(1), other: uuid(2), brand: uuid(3), employee: uuid(4), menu: uuid(5), register: uuid(6), employee2: uuid(7), optionGroup: uuid(8), option: uuid(9), station: uuid(10), device: uuid(11) };
  const state = { session: { id: ids.employee, name: 'Tester', role: 'store_manager', sessionId: uuid(20) }, failPattern: null, errors: [], externalCalls: 0 };
  const stripRefs = text => text.replace(/references\s+[\w.]+\s*\([^)]*\)(?:\s+on\s+delete\s+(?:cascade|set\s+null|restrict|no\s+action))?/gi, '');
  const schema = readFileSync(resolve(source, 'db/schema.sql'), 'utf8');
  const tables = ['stores', 'employees', 'brands', 'store_brands', 'pos_store_settings', 'pos_cash_sessions', 'store_customer_orders', 'store_customer_order_items', 'order_production_tasks', 'pos_cash_movements', 'module_settings', 'menu_catalog_items', 'menu_option_groups', 'menu_options', 'menu_store_settings', 'menu_option_store_settings', 'sales_orders', 'store_tables', 'local_bridge_devices', 'member_coupons', 'store_relay_stations', 'store_relay_devices', 'store_relay_print_jobs', 'store_relay_events', 'employee_scopes', 'timecard_punches', 'timecard_shifts', 'pos_order_corrections', 'pos_refund_events', 'member_accounts', 'loyalty_point_ledger', 'loyalty_stamp_ledger'];
  for (const table of tables) {
    const create = schema.match(new RegExp(`create table if not exists ${table} \\([\\s\\S]*?\\n\\);`));
    assert.ok(create, table); await db.exec(stripRefs(create[0]).replace(/encode\(gen_random_bytes\(24\), 'hex'\)/g, 'gen_random_uuid()::text'));
    for (const alter of schema.matchAll(new RegExp(`alter table ${table} add column[^;]*;`, 'g'))) if (!/pickup_code|preparation_note|order_item_id|handed_off_at/.test(alter[0])) await db.exec(stripRefs(alter[0]));
  }
  await db.exec(`create unique index idx_test_offline on store_customer_orders(offline_client_order_id) where offline_client_order_id is not null;
    create unique index idx_test_task on order_production_tasks(order_id,production_area,production_area_label);`);
  await db.exec(readFileSync(resolve(source, 'db/migrations/20261015_pos_bowl_tickets.sql'), 'utf8'));
  // A real historical paid record proves this additive migration preserves data.
  const historical = uuid(999);
  await db.query(`insert into store_customer_orders(id,pickup_code,pickup_date,pickup_time,status,payment_status,amount) values($1,'07',current_date,'12:00','ready','paid',815)`, [historical]);
  await db.query(`insert into store_customer_order_items(order_id,item_name,quantity,amount) values($1,'歴史注文',1,815)`, [historical]);
  const migration = readFileSync(resolve(source, 'db/migrations/20261020_pos_print_documents.sql'), 'utf8');
  await db.exec(migration); await db.exec(migration);
  const preserved = (await db.query(`select pickup_code,payment_status,amount::int from store_customer_orders where id=$1`, [historical])).rows[0];
  assert.deepEqual(preserved, { pickup_code: '07', payment_status: 'paid', amount: 815 });
  assert.equal((await db.query('select item_name from store_customer_order_items where order_id=$1', [historical])).rows[0].item_name, '歴史注文');
  await db.query('delete from store_customer_order_items where order_id=$1', [historical]); await db.query('delete from store_customer_orders where id=$1', [historical]);
  await db.exec(`insert into stores(id,name) values('${ids.store}','清水 isolated test'),('${ids.other}','Other');
    insert into employees(id,name,role) values('${ids.employee}','Tester','store_manager'),('${ids.employee2}','Another terminal','store_terminal');
    insert into brands(id,name,brand_type) values('${ids.brand}','まぁ麻','restaurant');
    insert into store_brands(store_id,brand_id,pos_pricing_mode,pos_weight_unit_price) values('${ids.store}','${ids.brand}','fixed',4);
    insert into menu_catalog_items(id,brand_id,name,item_kind,base_price) values('${ids.menu}','${ids.brand}','原メニュー 麻辣湯','buildable_product',815);
    insert into menu_option_groups(id,brand_id,menu_catalog_item_id,group_key,name,selection_type) values('${ids.optionGroup}','${ids.brand}','${ids.menu}','soup','原スープ','single');
    insert into menu_options(id,option_group_id,option_key,name,price_delta) values('${ids.option}','${ids.optionGroup}','original','原麻辣味',0);
    insert into pos_cash_sessions(id,store_id,business_date,status,opening_amount) values('${ids.register}','${ids.store}',current_date,'open',10000);
    insert into pos_store_settings(store_id,printer_settings) values('${ids.store}','{"enabled":false,"receiptEnabled":false,"kitchenEnabled":false,"receiptTemplate":{"footerMessage":"原レシート注記"},"kitchenTicketTemplate":{"customMessage":"原厨房注記"}}'::jsonb);`);

  async function execute(statement, connection) {
    if (state.failPattern && state.failPattern.test(statement.text)) throw new Error('fixture persistence failure');
    return (await connection.query(statement.text, statement.values)).rows;
  }
  function sql(parts, ...values) {
    let text = '', bound = [];
    for (let i = 0; i < parts.length; i++) {
      text += parts[i]; if (i >= values.length) continue;
      const value = values[i];
      if (value && typeof value === 'object' && value.__fixtureUnsafe) text += value.text;
      else { bound.push(value); text += `$${bound.length}`; }
    }
    return { text, values: bound, then(resolve, reject) { return execute(this, db).then(resolve, reject); } };
  }
  sql.query = (text, values = []) => ({ text, values, then(resolve, reject) { return execute(this, db).then(resolve, reject); } });
  sql.unsafe = text => ({ __fixtureUnsafe: true, text });
  sql.transaction = statements => db.transaction(async connection => {
    const results = [];
    for (const statement of statements) results.push(await execute(statement, connection));
    return results;
  });
  const modules = {};
  const loaded = new Map();
  const contextConsole = { ...console, error: (...args) => state.errors.push(args.map(String).join(' ')) };
  function load(path) {
    const absolute = resolve(source, path);
    if (loaded.has(absolute)) return loaded.get(absolute);
    const exports = {}; loaded.set(absolute, exports);
    const code = ts.transpileModule(readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(code, { exports, Request, Response, URL, structuredClone, performance, console: contextConsole, Error, Date, setTimeout, clearTimeout, process: { env: { NODE_ENV: 'test' } }, require: name => {
      if (name === 'node:crypto') return require(name);
      if (name === 'next/server') return { after() {} };
      if (name === 'server-only') return {};
      const key = name.split('/').at(-1);
      if (key === 'db') return { sql };
      if (modules[key]) return modules[key];
      if (name.startsWith('.')) return load(resolve(dirname(absolute), name) + (name.endsWith('.ts') ? '' : '.ts'));
      throw new Error(`Missing test dependency ${name} in ${path}`);
    } }, { filename: absolute });
    return exports;
  }
  modules['api-auth'] = { requireOsSession: async () => state.session };
  modules.auth = { hashPassword() { throw new Error('Password hashing outside print fixture'); }, verifyPassword() { throw new Error('Password verification outside print fixture'); } };
  modules['store-order-access'] = { getStoreOrderAccess: async () => ({ stores: [{ id: ids.store }], canCancelOrders: true }), getScopedStoreFilter: (_, id) => !id || id === ids.store ? ids.store : '__forbidden__' };
  modules['customer-orders'] = { createPickupCode: () => `D${Math.random().toString(16).slice(2, 8)}`, findCustomerOrderById: async () => null };
  // This fixture has no member-exchange coupons; loyalty side effects stay local stubs.
  modules.loyalty = { reconcilePosRefundLoyalty: async () => null, isMemberExchangeCoupon: () => false, resolveMemberForOrder: async () => null, awardLoyaltyForPaidOrder: async () => null, reverseLoyaltyForRefundedOrder: async () => null, reverseLoyaltyForRefundedOrderItem: async () => null };
  modules['order-realtime'] = { publishCustomerOrderEvent: async () => {} };
  modules['sales-orders'] = { syncWebReservationToSalesOrder: async () => {} };
  modules['store-dining-sessions'] = { syncDiningSessionFromProduction: async () => {}, markDiningOrdersPaid: async () => {} };
  modules['inventory-order-usage'] = { markInventoryOrderReady: async () => {}, safeSyncInventoryOrderUsage: async () => {} };
  modules['production-estimate'] = { calculateProductionEstimateMinutes: () => 10 };
  modules['maamaa-production-rules'] = { normalizeMaamaaProductionReferenceSettings: () => ({}), localizeMaamaaProductionSummary: text => text, localizeMaamaaCustomerLabel: text => text };
  modules['maamaa-production-summary'] = { buildMaamaaProductionItemLines: () => [] };
  modules['pos-operator-access'] = { requirePosOperatorForWrite: async base => ({ ok: true, enabled: false, actor: base, operatorSessionId: null, approver: null, writeGuards: [] }) };
  // Same-origin checks use the actual credentials module, with password work stubbed.
  modules['pos-operator-credentials'] = load('lib/pos-operator-credentials.ts');
  const checkout = load('app/api/store/pos/route.ts');
  const documents = load('app/api/store/pos/print-documents/route.ts');
  const transactions = load('app/api/store/pos/transactions/route.ts');
  const baseBody = { storeId: ids.store, bowlTicketVersion: 1, printDocumentVersion: 1, printMode: 'deferred', orderType: 'takeout', paymentMethod: 'cash', cashTenderedAmount: 2000, offlineClientOrderId: uuid(100), discountPresetKey: 'student_20', receiptRequested: false, note: '原注文メモ', items: [{ menuCatalogItemId: ids.menu, quantity: 1, preparationNote: '原この杯メモ', selectedOptions: [{ groupId: ids.optionGroup, optionIds: [ids.option] }] }] };
  function request(path, body, headers = {}) {
    return new Request(`http://isolated.test${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'http://isolated.test', ...headers }, body: JSON.stringify(body) } : { headers });
  }
  const postCheckout = patch => checkout.POST(request('/api/store/pos', { ...baseBody, ...patch }));
  const getQueue = suffix => documents.GET(request(`/api/store/pos/print-documents?storeId=${ids.store}${suffix ? `&${suffix}` : ''}`));
  const mutate = (body, headers) => documents.POST(request('/api/store/pos/print-documents', { storeId: ids.store, ...body }, headers));
  const refund = body => transactions.POST(request('/api/store/pos/transactions', { storeId: ids.store, ...body }));
  const counts = async () => (await db.query(`select
    (select count(*)::int from store_customer_orders) as orders,
    (select count(*)::int from store_customer_order_items) as items,
    (select count(*)::int from order_production_tasks) as tasks,
    (select count(*)::int from pos_print_documents) as documents,
    (select count(*)::int from pos_print_document_operations) as operations,
    (select count(*)::int from store_relay_print_jobs) as relay_jobs`)).rows[0];
  const reload = path => { loaded.clear(); return load(path); };
  return { db, ids, state, sql, load, reload, modules, baseBody, request, postCheckout, getQueue, mutate, refund, counts, migration, historicalPreserved: preserved, pgliteModule };
}
