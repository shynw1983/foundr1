// Exercises the actual GET handler and its SQL against disposable PostgreSQL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require(process.env.FOUNDR1_TYPESCRIPT_MODULE || 'typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const root = new URL('../../', import.meta.url);
const db = new PGlite();
const store = '00000000-0000-4000-8000-000000000001';
const otherStore = '00000000-0000-4000-8000-000000000002';
const employee = '00000000-0000-4000-8000-000000000003';
const otherEmployee = '00000000-0000-4000-8000-000000000004';
let session = { id: employee, name: 'Tester', role: 'owner' };
const sql = async (parts, ...values) => (await db.query(parts.reduce((text, part, index) => text + part + (index < values.length ? `$${index + 1}` : ''), ''), values)).rows;
function load(path) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, root), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, {
    exports, Response, Request, URL, console, Date,
    require: name => {
      if (name.endsWith('/db')) return { sql };
      if (name.endsWith('/api-auth')) return {
        requireOsSession: async () => session,
        getSessionStoreScope: async () => ({ allStores: false, storeIds: [store] }),
        canAccessStore: async (_, id) => id === store
      };
      if (name.endsWith('/timecard')) return { getJstMonthLabel: () => '2026-11', getJstDateLabel: () => '2026-10-28' };
      if (name.endsWith('/store-business-hours')) return load('lib/store-business-hours.ts');
      if (name.endsWith('/audit-log')) return { writeAuditLog: async () => { throw new Error('GET must not write audit data'); } };
      if (name.endsWith('/web-push')) return { createOsNotification: async () => { throw new Error('GET must not notify'); } };
      throw new Error(`Unexpected dependency ${name}`);
    }
  });
  return exports;
}
await db.exec(`
create table stores(id uuid primary key,name text,status text default 'active',business_hours jsonb default '{}',shift_request_start_offset_minutes int default 0,shift_request_end_offset_minutes int default 0,shift_first_half_submission_deadline_day int default 28,shift_second_half_submission_deadline_day int default 13,shift_submission_deadline_time time default '23:59');
create table employees(id uuid primary key,name text,role text,status text default 'active',staff_category text default 'regular');
create table employee_work_stores(employee_id uuid,store_id uuid);
create table timecard_shifts(id uuid default gen_random_uuid(),store_id uuid,employee_id uuid,work_date date,scheduled_start time,scheduled_end time,note text,updated_at timestamptz default now());
create table timecard_shift_requests(id uuid primary key default gen_random_uuid(),store_id uuid,employee_id uuid,request_type text default 'availability',status text default 'open',target_shift_id uuid,work_date date,title text default 'Request',note text,review_note text,created_at timestamptz default now(),updated_at timestamptz default now(),reviewed_at timestamptz,reviewed_by uuid);
create table timecard_shift_request_windows(id uuid default gen_random_uuid(),request_id uuid,work_date date,available_start time,available_end time,preference text default 'available',note text);
create table timecard_shift_request_candidates(id uuid,request_id uuid,employee_id uuid,status text,note text,created_at timestamptz);
create table timecard_shift_request_messages(id uuid,request_id uuid,employee_id uuid,message text,created_at timestamptz);
create table timecard_shift_publications(id uuid,store_id uuid,schedule_month text,note text,published_at timestamptz,published_by uuid);
`);
await db.query('insert into stores(id,name) values ($1,$2),($3,$4)',[store,'Local',otherStore,'Other']);
await db.query('insert into employees(id,name,role) values ($1,$2,$3),($4,$5,$6)',[employee,'Tester','staff',otherEmployee,'Other tester','staff']);
await db.query('insert into employee_work_stores values ($1,$2),($3,$2),($3,$4)',[employee,store,otherEmployee,otherStore]);
const dates=['2026-11-01','2026-11-14','2026-11-15','2026-11-16','2026-11-29','2026-11-30','2026-12-01','2027-02-28','2027-03-01','2028-02-29','2028-03-01'];
async function seed(date,storeId=store,employeeId=employee,windowOnly=false) {
 const result=await db.query('insert into timecard_shift_requests(store_id,employee_id,work_date) values ($1,$2,$3) returning id',[storeId,employeeId,windowOnly?null:date]);
 await db.query('insert into timecard_shift_request_windows(request_id,work_date,available_start,available_end) values ($1,$2,$3,$4)',[result.rows[0].id,date,'12:00','21:00']);
 if(!windowOnly) await db.query('insert into timecard_shifts(store_id,employee_id,work_date,scheduled_start,scheduled_end) values ($1,$2,$3,$4,$5)',[storeId,employeeId,date,'12:00','21:00']);
 return result.rows[0].id;
}
for(const date of dates) await seed(date);
const windowOnlyId=await seed('2026-11-15',store,employee,true);
const otherStoreRequestId=await seed('2026-11-15',otherStore,otherEmployee);
await seed('2026-11-15',store,otherEmployee);
const { GET }=load('app/api/timecard/shift-requests/route.ts');
async function read(period,extra='') {
 const response=await GET(new Request(`https://example.test/api/timecard/shift-requests?storeId=${store}&period=${period}${extra}`));
 assert.equal(response.status,200);return response.json();
}
for(const [period,last,next] of [
 ['2026-11-first_half','2026-11-15','2026-11-16'],
 ['2026-11-second_half','2026-11-30','2026-12-01'],
 ['2027-02-second_half','2027-02-28','2027-03-01'],
 ['2028-02-second_half','2028-02-29','2028-03-01']
]) {
 const data=await read(period);
 assert(data.requests.some(r=>r.workDate===last),`${period}: last-day request missing`);
 assert(!data.requests.some(r=>r.workDate===next),`${period}: next period leaked`);
 assert(data.myShifts.some(r=>r.workDate===last),`${period}: last-day shift missing`);
 assert(!data.myShifts.some(r=>r.workDate===next),`${period}: next-period shift leaked`);
 assert(!data.requests.some(r=>r.id===otherStoreRequestId),'another store request leaked');
}
const manager=await read('2026-11-first_half');
assert(manager.requests.some(r=>r.id===windowOnlyId),'window-only last-day request missing');
assert(manager.requests.some(r=>r.employeeId===otherEmployee),'manager cannot see assigned store staff');
session={...session,role:'staff'};
const personal=await read('2026-11-first_half','&selfOnly=1');
assert(personal.requests.some(r=>r.workDate==='2026-11-15'),'staff loses final-day selection on reload');
assert(personal.requests.every(r=>r.employeeId===employee),'another employee request leaked');
assert(personal.myShifts.every(r=>r.employeeId===employee),'another employee shift leaked');
const monthly=await read('2026-11-first_half','&selfOnly=1&shiftRange=month&month=2026-11');
assert(monthly.myShifts.some(r=>r.workDate==='2026-11-30'),'monthly shift range changed');
assert(!monthly.myShifts.some(r=>r.workDate==='2026-12-01'));
session=null;
assert.equal((await GET(new Request('https://example.test/api/timecard/shift-requests'))).status,401);
await db.close();
console.log('PASS: actual GET/PostgreSQL final-day requests and shifts, adjacent-period exclusion, month/leap boundaries, window-only requests, manager/staff scope, monthly shifts and anonymous denial');
