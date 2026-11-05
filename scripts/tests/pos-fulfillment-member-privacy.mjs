// Execute the actual member history SQL, mapper and public member GET against
// isolated PostgreSQL. No production database, member or network access.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const root = new URL('../../', import.meta.url);
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const memberId = uuid(1), otherMemberId = uuid(2), storeId = uuid(3), maamaaId = uuid(4), nanachaId = uuid(5), itemId = uuid(6), couponId = uuid(7);
const checks = [], queries = [];
const schema = readFileSync(new URL('db/schema.sql', root), 'utf8');
const strip = value => value.replace(/references\s+[\w.]+\s*\([^)]*\)(?:\s+on\s+delete\s+(?:cascade|set\s+null|restrict|no\s+action))?/gi, '')
  .replace(/encode\(gen_random_bytes\(24\), 'hex'\)/g, 'gen_random_uuid()::text');
for (const table of ['stores', 'brands', 'store_customer_orders', 'store_customer_order_items', 'menu_catalog_items', 'member_coupons', 'menu_option_groups', 'menu_options']) {
  const create = schema.match(new RegExp(`create table if not exists ${table} \\([\\s\\S]*?\\n\\);`));
  assert.ok(create, table); await db.exec(strip(create[0]));
  for (const alter of schema.matchAll(new RegExp(`alter table ${table} add column[^;]*;`, 'g'))) await db.exec(strip(alter[0]));
}
const sql = async (parts, ...values) => {
  const text = parts.reduce((text, part, index) => text + part + (index < values.length ? `$${index + 1}` : ''), '');
  queries.push({ text, values });
  return (await db.query(text, values)).rows;
};
const modules = { db: { sql }, email: { sendCouponEmail: async () => { throw new Error('Unexpected email'); } } };
function load(path) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, root), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, URLSearchParams, Request, Response, URL, Date, console, require: name => {
    const key = name.split('/').at(-1);
    assert.ok(modules[key], `Missing privacy fixture dependency ${name}`);
    return modules[key];
  } });
  return exports;
}
modules['customer-display-names'] = load('lib/customer-display-names.ts');
const loyalty = load('lib/loyalty.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const pass = label => { checks.push(label); console.log(`PASS ${label}`); };
const publicSummary = {
  customer: { name: 'お客様', note: '花椒少なめ', preferences: { language: 'en' } },
  maamaa: { heat: 'mild', selectedIngredients: ['beef-tendon'] },
  subtotalAmount: 1000, couponDiscountAmount: 150, couponId, couponCode: 'THANKYOU', couponName: '会員特典',
  serviceType: 'dine_in', pickupTiming: 'scheduled', legacyPublicExtension: { nested: ['preserved', 42] }
};
const internal = {
  posFulfillment: { actor: 'internal-actor-sentinel', baseSession: 'internal-base-session-sentinel', before: { private: 'internal-before-sentinel' } },
  posFulfillmentTasks: { hiddenTask: { actorId: 'internal-task-actor-sentinel', undoToken: 'internal-undo-token-sentinel' } }
};
const forbiddenValues = JSON.stringify(internal).match(/internal-[a-z-]+-sentinel/g);
try {
  await db.query('insert into stores(id,name,customer_display_names) values($1,$2,$3)', [storeId, 'Internal Store', { defaultName: 'Customer Store' }]);
  await db.query("insert into brands(id,name,brand_type) values($1,$2,'malatang'),($3,$4,'drink')", [maamaaId, 'まぁ麻', nanachaId, 'nanacha']);
  await db.query('insert into menu_catalog_items(id,brand_id,name,display_names) values($1,$2,$3,$4)', [itemId, maamaaId, '麻辣湯', { en: 'Malatang', zh: '麻辣烫' }]);
  await db.query('insert into member_coupons(id,member_id,name,coupon_code,display_names) values($1,$2,$3,$4,$5)', [couponId, memberId, '会員特典', 'THANKYOU', { en: 'Member perk' }]);
  const sources = ['store_pos', 'maamaa_web', 'nanacha_web'];
  for (let index = 0; index < sources.length; index++) {
    const id = uuid(20 + index);
    await db.query(`insert into store_customer_orders(id,brand_id,store_id,member_id,pickup_code,order_source,status,payment_status,pickup_date,pickup_time,amount,customer_summary,created_at)
      values($1,$2,$3,$4,$5,$6,'new','paid','2030-10-19','13:00',850,$7,$8)`,
      [id, index === 2 ? nanachaId : maamaaId, storeId, memberId, `A${index}`, sources[index], { ...publicSummary, ...internal }, `2026-10-${19 - index}T03:00:00Z`]);
    await db.query('insert into store_customer_order_items(order_id,menu_catalog_item_id,item_name,quantity,measured_quantity,measured_unit,amount,coupon_discount_amount,coupon_id,topping_labels) values($1,$2,$3,1,250,$4,850,150,$5,$6)',
      [id, itemId, '麻辣湯', 'g', couponId, ['牛すじ']]);
  }
  await db.query(`insert into store_customer_orders(id,store_id,member_id,pickup_code,pickup_date,pickup_time,customer_summary)
    values($1,$2,$3,'OTHER','2030-10-19','13:00',$4)`, [uuid(30), storeId, otherMemberId, { otherMemberPrivate: 'not-your-history', ...internal }]);
  const orders = await loyalty.getMemberOnlineOrderHistory(memberId);
  assert.equal(orders.length, 3);
  for (const order of orders) {
    assert.deepEqual(plain(order.customerSummary), publicSummary);
    const serialized = JSON.stringify(order);
    assert.equal(serialized.includes('posFulfillment'), false);
    for (const value of forbiddenValues) assert.equal(serialized.includes(value), false);
  }
  pass('actual member history SQL excludes both internal fulfillment keys for POS, maamaa and nanacha while preserving every existing customer field');
  for (const order of orders) {
    assert.equal(order.storeName, 'Customer Store'); assert.equal(order.subtotalAmount, 1000);
    assert.equal(order.couponDiscountAmount, 150); assert.equal(order.couponCode, 'THANKYOU'); assert.equal(order.couponName, '会員特典');
    assert.equal(order.itemDetails[0].displayNames.en, 'Malatang'); assert.equal(order.itemDetails[0].measuredQuantity, 250);
    assert.equal(order.itemDetails[0].measuredUnit, 'g'); assert.equal(order.itemDetails[0].couponDisplayNames.en, 'Member perk');
    assert.deepEqual(plain(order.itemDetails[0].toppingLabels), ['牛すじ']);
    assert.equal(order.receiptPdfUrl.includes('/api/public/orders/receipt?'), order.orderSource !== 'store_pos');
  }
  assert.equal(orders.find(order => order.orderSource === 'maamaa_web').canCancel, true);
  assert.equal(orders.find(order => order.orderSource === 'store_pos').canCancel, false);
  pass('coupon totals, structured items, translations, measured portions, customer store names, receipt links and cancellation contracts remain intact');
  const filtered = await loyalty.getMemberOnlineOrderHistory(memberId, { from: '2026-10-18T00:00:00Z', to: '2026-10-20T00:00:00Z', limit: 1 });
  assert.equal(filtered.length, 1); assert.equal(filtered[0].pickupCode, 'A0');
  assert.equal((await loyalty.getMemberOnlineOrderHistory(otherMemberId)).length, 1);
  pass('member ownership, date filters and newest-first limits still apply');
  let authenticated = true;
  modules['member-auth'] = { getMemberSession: async () => authenticated ? { memberId } : null };
  modules.loyalty = { ...loyalty, upsertMember: async () => ({ id: memberId, displayName: 'Member' }),
    issueAutomaticLoyaltyRewardsForMember: async () => {}, getMemberAvailableCoupons: async () => [], getMemberPointHistory: async () => [], getMemberStampCards: async () => [], getActiveMemberAppAnnouncements: async () => [] };
  const memberRoute = load('app/api/public/members/me/route.ts');
  const response = await memberRoute.GET(new Request('https://fixture.local/api/public/members/me'));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const text = await response.text(), body = JSON.parse(text);
  assert.equal(body.orders.length, 3);
  assert.equal(text.includes('posFulfillment'), false); assert.equal(text.includes('not-your-history'), false);
  for (const value of forbiddenValues) assert.equal(text.includes(value), false);
  assert.deepEqual(body.orders[0].customerSummary, publicSummary);
  authenticated = false;
  const denied = await memberRoute.GET(new Request('https://fixture.local/api/public/members/me'));
  assert.equal(denied.status, 401); assert.equal((await denied.json()).member, null);
  pass('real public members/me GET serializes sanitized history; unauthenticated requests retain existing denial behavior');
  const raw = (await db.query('select customer_summary from store_customer_orders where id=$1', [uuid(20)])).rows[0].customer_summary;
  assert.deepEqual(raw, { ...publicSummary, ...internal });
  assert.equal(queries.some(query => /(?:update|insert into|delete from) store_customer_orders/i.test(query.text)), false);
  pass('privacy filtering is read-only and retains complete internal undo and audit metadata in stored orders');
  const out = new URL('outputs/pos-fulfillment-20261019/member-privacy/', root);
  mkdirSync(out, { recursive: true });
  const files = ['lib/loyalty.ts', 'app/api/public/members/me/route.ts', 'scripts/tests/pos-fulfillment-member-privacy.mjs'];
  writeFileSync(new URL('verification.json', out), JSON.stringify({ passed: true, checks, groups: checks.length, productionAccess: false, schemaChanges: false,
    sourceHashes: Object.fromEntries(files.map(path => [path, createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex')])) }, null, 2) + '\n');
  console.log(`PASS ${checks.length} member fulfillment privacy groups`);
} finally { await db.close(); }
