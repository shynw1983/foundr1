// Actual reconciliation route and PostgreSQL persistence; no live database or network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const root = new URL('../../', import.meta.url);
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const ids = { store: uuid(1), forbidden: uuid(2), employee: uuid(3), previous: uuid(4) };
let session = { id: ids.employee, name: 'レジ担当', role: 'store_manager' };
let events = 0;
let groups = 0;
const schema = readFileSync(new URL('db/schema.sql', root), 'utf8');
const stripReferences = source => source.replace(/references\s+[\w.]+\s*\([^)]*\)(?:\s+on\s+delete\s+(?:cascade|set\s+null|restrict|no\s+action))?/gi, '');

for (const table of ['stores', 'employees', 'employee_scopes', 'timecard_punches', 'timecard_shifts', 'pos_cash_sessions', 'pos_cash_movements', 'pos_order_corrections', 'store_customer_orders', 'pos_pickup_counters']) {
  const create = schema.match(new RegExp(`create table if not exists ${table} \\([\\s\\S]*?\\n\\);`));
  assert.ok(create, `Actual schema must contain ${table}`);
  await db.exec(stripReferences(create[0]).replace(/encode\(gen_random_bytes\(24\), 'hex'\)/g, 'gen_random_uuid()::text'));
  for (const alter of schema.matchAll(new RegExp(`alter table ${table} add column[^;]*;`, 'g'))) {
    await db.exec(stripReferences(alter[0]));
  }
}
await db.query('insert into stores(id,name) values($1,$2),($3,$4)', [ids.store, '桜並木 テスト', ids.forbidden, '別店舗']);
await db.query('insert into employees(id,name,role,status) values($1,$2,$3,$4)', [ids.employee, 'レジ担当', 'store_manager', 'active']);
await db.query("insert into employee_scopes(employee_id,scope_type,store_id) values($1,'store',$2)", [ids.employee, ids.store]);
await db.query(`insert into pos_cash_sessions(id,store_id,business_date,status,opening_amount,expected_cash_amount,counted_cash_amount,closed_by,closed_at)
  values($1,$2,'2026-10-18','closed',10000,10000,10000,$3,now())`, [ids.previous, ids.store, ids.employee]);

const sql = Object.assign((parts, ...values) => ({
  text: parts.reduce((text, part, index) => text + part + (index < values.length ? `$${index + 1}` : ''), ''), values,
  then(resolve, reject) { return db.query(this.text, this.values).then(result => result.rows).then(resolve, reject); }
}), { transaction: statements => db.transaction(async connection => {
  const result = []; for (const statement of statements) result.push((await connection.query(statement.text, statement.values)).rows); return result;
}) });
const modules = {
  db: { sql },
  'api-auth': { requireOsSession: async () => session },
  // The existing PIN feature is intentionally off in this opening-cash regression.
  'pos-operator-access': { requirePosOperatorForWrite: async base => ({ ok:true, enabled:false, actor:base, operatorSessionId:null, approver:null, writeGuards:[] }) },
  'pos-operator-credentials': { assertPosOperatorSameOrigin: () => null, posOperatorDatabaseFailure: () => null },
  'store-order-access': {
    getStoreOrderAccess: async () => ({ stores: [{ id: ids.store }] }),
    getScopedStoreFilter: (_access, storeId) => storeId === ids.store ? ids.store : '__forbidden__'
  },
  loyalty: { reverseLoyaltyForRefundedOrder: async () => { throw new Error('Unexpected refund'); } },
  'sales-orders': { syncWebReservationToSalesOrder: async () => { throw new Error('Unexpected sales mutation'); } },
  'order-realtime': { publishStoreOperationalEvent: async () => { events++; } }
};
function load(path) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(path==='app/api/store/pos/reconciliation/route.ts'&&process.env.POS_LATEST_CLOSE_ROUTE?process.env.POS_LATEST_CLOSE_ROUTE:new URL(path, root), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, Request, Response, URL, console, require: name => {
    if (name === 'node:crypto') return require(name);
    const dependency = modules[name.split('/').at(-1)];
    assert.ok(dependency, `Unexpected dependency ${name}`);
    return dependency;
  } });
  return exports;
}
modules['pos-cash-denominations'] = load('lib/pos-cash-denominations.ts');
modules['pos-bowl-data'] = load('lib/pos-bowl-data.ts');
const businessHours = load('lib/store-business-hours.ts');
modules['store-business-hours'] = {
  getStoreCashBusinessDayState: value => businessHours.getStoreCashBusinessDayState(value, new Date('2026-10-28T12:10:00.000Z'))
};
const route = load('app/api/store/pos/reconciliation/route.ts');
const submit = patch => route.POST(new Request('http://test/api/store/pos/reconciliation', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'open', storeId: ids.store, openingBreakdown: { 10000: 2 }, ...patch })
}));
const persisted = async () => (await db.query('select * from pos_cash_sessions order by id')).rows;
const assertUnchanged = async (before, previousEvents) => {
  assert.deepEqual(await persisted(), before);
  assert.equal(events, previousEvents);
};
async function rejected(patch, status, expectedError) {
  const before = await persisted(), previousEvents = events;
  const response = await submit(patch);
  assert.equal(response.status, status, await response.clone().text());
  if (expectedError) assert.equal((await response.json()).error, expectedError);
  await assertUnchanged(before, previousEvents);
  groups++;
}
async function opened(patch, amount, reason) {
  const response = await submit(patch);
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.activeSession.openingAmount, amount);
  assert.equal(body.activeSession.expectedCashAmount, amount);
  assert.equal(body.activeSession.openingNote, reason);
  assert.equal(body.activeSession.openedByName, 'レジ担当');
  assert.equal(body.activeSession.businessDate, '2026-10-19');
  const rows = (await db.query("select * from pos_cash_sessions where status='open'")).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].opening_amount, amount);
  assert.equal(rows[0].expected_cash_amount, amount);
  assert.equal(rows[0].opening_note, reason);
  assert.equal(rows[0].source, 'manual');
  assert.equal(rows[0].opened_by, ids.employee);
  assert.equal(rows[0].store_id, ids.store);
  await db.query("delete from pos_cash_sessions where status='open'");
  assert.equal((await persisted()).length, 1);
  groups++;
}

const checks=[];const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const get=(date='',store=ids.store)=>route.GET(new Request('http://test/api/store/pos/reconciliation?storeId='+store+(date?'&date='+date:'')));
async function add(id,date,closed,amount,store=ids.store){await db.query(`insert into pos_cash_sessions(id,store_id,business_date,status,opening_amount,counted_cash_amount,closed_by,opened_at,closed_at) values($1,$2,$3,'closed',10000,$4,$5,'2026-10-27T03:00:00Z',$6)`,[uuid(id),store,date,amount,ids.employee,closed]);}
async function check(name,fn){await fn();checks.push({name,passed:true});console.log('PASS',name);}
try{
 await db.query('delete from pos_cash_sessions');await add(200,'2026-10-27','2026-10-28T08:17:10.315922Z',10000);await add(201,'2026-10-28','2026-10-28T12:03:31.89422Z',15000);await add(202,'2026-10-28','2026-10-28T13:00:00Z',90000,ids.forbidden);await add(203,'2026-10-29','2026-10-28T14:00:00Z',80000);await add(204,'2026-10-28',null,70000);await add(205,'2026-10-28','2026-10-28T15:00:00Z',null);
 await check('same-day21:03 close wins over previous-business-day17:17; other stores/future dates/incomplete closes excluded',async()=>{const before=await persisted(),body=await json(await get());assert.equal(body.previousClosedSession.id,uuid(201));assert.equal(body.previousClosedSession.countedCashAmount,15000);assert.equal(body.previousClosedSession.closedByName,'レジ担当');assert.deepEqual(await persisted(),before);assert.equal(events,0);});
 await check('historical report keeps its business-date boundary',async()=>{const body=await json(await get('2026-10-27'));assert.equal(body.previousClosedSession.id,uuid(200));});
 await check('actual closing timestamp wins over business-date ordering for a delayed previous-day close',async()=>{await add(206,'2026-10-27','2026-10-28T12:06:00Z',13000);assert.equal((await json(await get())).previousClosedSession.id,uuid(206));await db.query('delete from pos_cash_sessions where id=$1',[uuid(206)]);});
 await check('reopening on the same day rejects an unexplained amount based on the old close',async()=>{const before=await persisted();await json(await submit({openingBreakdown:{10000:1}}),400);assert.deepEqual(await persisted(),before);assert.equal(events,0);});
 await check('reopening accepts the latest counted balance; POST carries the same close and active-session opening remains authoritative',async()=>{const body=await json(await submit({openingBreakdown:{10000:1,5000:1}}));assert.equal(body.activeSession.openingAmount,15000);assert.equal(body.activeSession.businessDate,'2026-10-28');assert.equal(body.previousClosedSession.id,uuid(201));const read=await json(await get());assert.equal(read.activeSession.id,body.activeSession.id);assert.equal(read.previousClosedSession.id,uuid(201));await db.query("delete from pos_cash_sessions where status='open'");});
 await check('store scope and authentication cannot expose other closes',async()=>{const before=await persisted();await json(await get('',ids.forbidden),403);const original=session;session=null;await json(await get(),401);session=original;assert.deepEqual(await persisted(),before);});
 await check('no valid closed sessions yields null without creating records',async()=>{await db.query('delete from pos_cash_sessions where id=any($1::uuid[])',[[uuid(200),uuid(201)]]);const before=await persisted();assert.equal((await json(await get())).previousClosedSession,null);assert.deepEqual(await persisted(),before);});
 console.log(JSON.stringify({passed:true,checks,productionWrites:0}));
}finally{await db.close();}
