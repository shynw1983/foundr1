// Actual settings handlers against isolated PostgreSQL. No live store or network.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const root = new URL('../../', import.meta.url);
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const storeId = uuid(1), otherStoreId = uuid(2), employeeId = uuid(3);
let session = { id: employeeId, role: 'store_manager' };
let checks = 0;
const schema = readFileSync(new URL('db/schema.sql', root), 'utf8');
const strip = text => text.replace(/references\s+[\w.]+\s*\([^)]*\)(?:\s+on\s+delete\s+(?:cascade|set\s+null|restrict|no\s+action))?/gi, '');
for (const table of ['stores', 'employees', 'brands', 'store_brands', 'pos_store_settings', 'pos_customer_display_states']) {
  const create = schema.match(new RegExp(`create table if not exists ${table} \\([\\s\\S]*?\\n\\);`));
  assert.ok(create, table);
  await db.exec(strip(create[0]));
  for (const alter of schema.matchAll(new RegExp(`alter table ${table} add column[^;]*;`, 'g'))) await db.exec(strip(alter[0]));
}
// This sentinel also verifies that baseline clients preserve a separately owned
// settings column added by a later feature; it exists only in the test database.
await db.exec("alter table pos_store_settings add column if not exists operator_settings jsonb not null default '{}'::jsonb");
const sql = Object.assign((parts, ...values) => ({
  text: parts.reduce((text, part, index) => text + part + (index < values.length ? `$${index + 1}` : ''), ''), values,
  then(resolve, reject) { return db.query(this.text, this.values).then(result => result.rows).then(resolve, reject); }
}), { transaction: statements => db.transaction(async connection => {
  const results = [];
  for (const statement of statements) results.push((await connection.query(statement.text, statement.values)).rows);
  return results;
}) });
const modules = {
  db: { sql }, 'api-auth': { requireOsSession: async () => session },
  'role-permissions': { roleHasPermission: async role => role === 'store_manager' },
  'store-order-access': { getStoreOrderAccess: async () => ({ stores: [{ id: storeId, name: 'Test' }] }), getScopedStoreFilter: (_, id) => id === storeId ? id : '__forbidden__' },
  'order-realtime': { publishPosCustomerDisplayEvent: async () => {} },
  'pos-operator-credentials': { posOperatorDatabaseFailure: () => null },
  'pos-operator-policy': { normalizePosOperatorSettings: value => value }
};
function load(path, append = '') {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, root), 'utf8') + append, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, Request, Response, URL, console, require: name => name === 'node:crypto' ? require(name) : modules[name.split('/').at(-1)] ?? {} });
  return exports;
}
for (const name of ['pos-pickup-ticket-copy', 'pos-printer', 'pos-customer-display', 'pos-scale-filter', 'pos-scale-tare', 'pos-fulfillment-settings']) {
  if (existsSync(new URL(`lib/${name}.ts`, root))) modules[name] = load(`lib/${name}.ts`);
}
const route = load('app/api/os/pos/settings/route.ts');
const storeRoute = load('app/api/store/pos/route.ts', '\nexports.fixtureGetPosSettings = getPosSettings;');
const plain = value => JSON.parse(JSON.stringify(value));
const stored = async () => (await db.query('select * from pos_store_settings where store_id=$1', [storeId])).rows[0];
const post = async (patch, expected = 200) => {
  const response = await route.POST(new Request('https://fixture.local/api/os/pos/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId, ...patch }) }));
  const body = await response.json();
  assert.equal(response.status, expected, JSON.stringify(body));
  return body;
};
const pass = label => { checks++; console.log(`PASS ${label}`); };
try {
  await db.query('insert into stores(id,name) values($1,$2),($3,$4)', [storeId, 'Test', otherStoreId, 'Other']);
  await db.query('insert into employees(id,name,role) values($1,$2,$3)', [employeeId, 'Manager', 'store_manager']);
  const defaults = { enabled: false, overdueMinutes: 15 };
  const supportsDocumentCopies = 'receiptCopies' in modules['pos-printer'].normalizePosPrinterSettings(null);
  const normalize = modules['pos-fulfillment-settings'].normalizePosFulfillmentWorkspaceSettings;
  for (const value of [null, undefined, [], true, 'bad', { enabled: 'true', overdueMinutes: 0 }, { overdueMinutes: Infinity }]) assert.deepEqual(plain(normalize(value)), defaults);
  assert.deepEqual(plain(await storeRoute.fixtureGetPosSettings('')).fulfillmentWorkspace, defaults);
  assert.deepEqual(plain(await storeRoute.fixtureGetPosSettings(storeId)).fulfillmentWorkspace, defaults);
  pass('unconfigured stores default off; malformed stored values cannot enable workspace or create invalid timeouts');

  const printer = { enabled: true, receiptCopies: 3, receiptPrinter: { host: '192.0.2.1' }, extraExisting: 'preserved' };
  await db.query('insert into pos_store_settings(store_id,printer_settings,customer_display_media_settings,scale_tare_settings,scale_filter_settings,operator_settings) values($1,$2,$3,$4,$5,$6)',
    [storeId, printer, { keep: 'display' }, { keep: 'tare' }, { keep: 'filter' }, { enabled: true, idleMinutes: 10 }]);
  const before = await stored();
  session = null; await post({ section: 'fulfillment', fulfillmentWorkspace: { enabled: true, overdueMinutes: 12 } }, 401);
  session = { id: employeeId, role: 'staff' }; await post({ section: 'fulfillment', fulfillmentWorkspace: { enabled: true, overdueMinutes: 12 } }, 403);
  session = { id: employeeId, role: 'store_manager' }; await post({ storeId: otherStoreId, section: 'fulfillment', fulfillmentWorkspace: { enabled: true, overdueMinutes: 12 } }, 403);
  for (const value of [null, [], {}, { enabled: 'true', overdueMinutes: 12 }, { enabled: true, overdueMinutes: '12' }, { enabled: true, overdueMinutes: 0 }, { enabled: true, overdueMinutes: 121 }, { enabled: true, overdueMinutes: 1.5 }]) {
    await post({ section: 'fulfillment', fulfillmentWorkspace: value }, 400);
  }
  assert.deepEqual(await stored(), before);
  pass('authentication, management permission, store scope and invalid inputs reject without writing');

  const enabled = { enabled: true, overdueMinutes: 12 };
  const saved = await post({ section: 'fulfillment', fulfillmentWorkspace: enabled, printerSettings: { enabled: false }, scaleTareSettings: null });
  let row = await stored();
  assert.deepEqual(row.printer_settings, { ...printer, fulfillmentWorkspace: enabled });
  for (const key of ['customer_display_media_settings', 'scale_tare_settings', 'scale_filter_settings', 'operator_settings']) assert.deepEqual(row[key], before[key]);
  assert.deepEqual(saved.settings.fulfillmentWorkspace, enabled);
  assert.deepEqual(plain(await storeRoute.fixtureGetPosSettings(storeId)).fulfillmentWorkspace, enabled);
  const read = await route.GET(new Request(`https://fixture.local/api/os/pos/settings?storeId=${storeId}`));
  assert.equal(read.status, 200); assert.deepEqual((await read.json()).settings.fulfillmentWorkspace, enabled);
  pass('isolated workspace write preserves every existing printer field, display, scale and operator setting; both actual readers agree');

  const legacyPrinter = { enabled: true, receiptEnabled: false, receiptPrinter: { host: '192.0.2.2' } };
  for (const patch of [{ section: 'printing', printerSettings: legacyPrinter }, { section: 'devices', printerSettings: legacyPrinter, customerDisplayMediaSettings: { mode: 'default' } }, { printerSettings: legacyPrinter },
    { section: 'printing', printerSettings: { ...legacyPrinter, fulfillmentWorkspace: { enabled: false, overdueMinutes: 20 } } }]) {
    await post(patch); row = await stored();
    assert.deepEqual(row.printer_settings.fulfillmentWorkspace, enabled);
    if (supportsDocumentCopies) assert.equal(row.printer_settings.receiptCopies, 3);
    assert.deepEqual(row.operator_settings, before.operator_settings);
  }
  pass('legacy printing, devices and full saves plus stale nested workspace copies cannot reset enabled store choice');

  await post({ printerSettings: legacyPrinter, fulfillmentWorkspace: { enabled: false, overdueMinutes: 25 } });
  row = await stored(); assert.deepEqual(row.printer_settings.fulfillmentWorkspace, { enabled: false, overdueMinutes: 25 });
  if (supportsDocumentCopies) assert.equal(row.printer_settings.receiptCopies, 3);
  await post({ section: 'fulfillment', fulfillmentWorkspace: enabled });
  assert.deepEqual((await stored()).printer_settings.fulfillmentWorkspace, enabled);
  pass('explicit save-all and dedicated workspace save update enabled and timeout while retaining existing document copies');

  await db.query('delete from pos_store_settings where store_id=$1', [storeId]);
  await post({ section: 'fulfillment', fulfillmentWorkspace: enabled });
  assert.deepEqual((await stored()).printer_settings, { fulfillmentWorkspace: enabled });
  assert.deepEqual(plain(await storeRoute.fixtureGetPosSettings(storeId)).fulfillmentWorkspace, enabled);
  pass('first workspace save creates minimal settings without requiring prior printer configuration');
  console.log(`PASS ${checks} actual fulfillment settings PostgreSQL groups`);
} finally { await db.close(); }
