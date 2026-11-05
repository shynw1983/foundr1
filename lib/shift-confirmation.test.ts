import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as crypto from 'node:crypto';
import ts from 'typescript';
import * as policy from './shift-confirmation-policy.ts';
import * as hours from './google-business-hours-policy.ts';
const {PGlite}=await import(process.env.PGLITE_MODULE||'../outputs/inventory-reference-implementation-20261014/test-deps/node_modules/@electric-sql/pglite/dist/index.js');
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
function load(file:string,deps:Record<string,unknown>,clock:typeof Date=Date){const exports:Record<string,unknown>={};runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,process:{env:{}},Response,Request,Headers,URL,Date:clock,Intl,console,require:(name:string)=>{if(!(name in deps))throw new Error(name);return deps[name];}});return exports as any;}
async function fixture(){
 const db=new PGlite();
 await db.exec(`create table stores(id uuid primary key,status text default 'active',shift_first_half_submission_deadline_day int default 25,shift_second_half_submission_deadline_day int default 10,shift_submission_deadline_time time default '23:59');
 create table employees(id uuid primary key,status text default 'active',role text default 'owner');create table employee_sessions(id uuid primary key);create table employee_scopes(employee_id uuid,scope_type text,store_id uuid);create table employee_work_stores(employee_id uuid,store_id uuid);
 create table timecard_shifts(id uuid primary key default gen_random_uuid(),store_id uuid,work_date date,scheduled_start time,scheduled_end time,employee_id uuid,note text,break_minutes integer,created_by uuid,updated_at timestamptz);
 create table timecard_shift_publications(id uuid primary key default gen_random_uuid(),store_id uuid,schedule_month text,note text,published_by uuid,published_at timestamptz default now());
 insert into stores(id)values('${id(1)}'),('${id(2)}');insert into employees(id)values('${id(10)}');insert into employee_sessions values('${id(20)}');insert into employee_work_stores values('${id(10)}','${id(1)}');`);
 for(const name of ['20261031_google_business_hours.sql','20261031_shift_confirmation_periods.sql','20261101_store_business_calendar.sql']){const source=readFileSync(new URL(`../db/migrations/${name}`,import.meta.url),'utf8');await db.exec(source);await db.exec(source);}
 function sql(strings:TemplateStringsArray,...values:unknown[]){const query=strings.reduce((text,part,index)=>text+(index?`$${index}`:'')+part,'');let pending:Promise<any>|undefined;return {then:(resolve:any,reject:any)=>(pending??=db.query(query,values).then((result:any)=>result.rows)).then(resolve,reject)};}
 sql.transaction=async(queries:any[])=>{await db.exec('begin');try{const result=[];for(const query of queries)result.push(await query);await db.exec('commit');return result;}catch(error){await db.exec('rollback');throw error;}};
 await db.exec(`insert into google_business_connections(store_id,preparation_minutes,cleanup_minutes,enabled)values('${id(1)}',30,30,false)`);
 const notifications:any[]=[];
 const confirmation=load('./shift-confirmation.ts',{'./db':{sql},'./shift-confirmation-policy':policy,'./google-business-hours-policy':hours,'./web-push':{createOsNotification:async(input:any)=>{notifications.push(input);}}});
 let live:hours.GbpPeriod[]=[],patches=0,loseResponse=false;
 const client={googleAccessToken:async()=> 'synthetic',getGoogleLocation:async()=>({regularHours:{periods:[{}]},specialHours:{specialHourPeriods:clone(live)}}),patchGoogleHours:async(_token:string,_name:string,periods:hours.GbpPeriod[])=>{live=clone(periods);patches++;if(loseResponse){loseResponse=false;throw new Error('lost response');}}};
 const worker=load('./google-business-hours.ts',{'node:crypto':crypto,'./db':{sql},'./google-business-client':client,'./google-business-hours-policy':hours});
 async function enable(){await db.exec(`update google_business_connections set token_ciphertext='synthetic',location_name='locations/100',enabled=true where store_id='${id(1)}';`);}
 async function shift(date='2099-11-01',start='11:30',end='21:30'){await db.query('insert into timecard_shifts(store_id,work_date,scheduled_start,scheduled_end)values($1,$2,$3,$4)',[id(1),date,start,end]);}
 return {db,sql,confirmation,worker,enable,shift,notifications,patches:()=>patches,live:()=>live,setLive:(value:hours.GbpPeriod[])=>{live=value;},lose:()=>{loseResponse=true;}};
}
test('half-month boundaries, independent configurable cutoff, February, submission ordering and unset defaults',()=>{
 const settings={autoConfirm:true,firstDay:31,firstTime:'23:59',secondDay:13,secondTime:'20:00'};
 assert.equal(policy.schedulePeriod('2028-02-second_half').endDate,'2028-02-29');
 assert.equal(policy.schedulePeriod('2027-02-second_half').dates.length,13);
 assert.equal(policy.confirmationDeadline(policy.schedulePeriod('2027-03-first_half'),settings),'2027-02-28T23:59:00+09:00');
 assert.equal(policy.confirmationDeadline(policy.schedulePeriod('2028-03-first_half'),settings),'2028-02-29T23:59:00+09:00');
 assert.equal(policy.confirmationDeadline(policy.schedulePeriod('2027-01-first_half'),settings),'2026-12-31T23:59:00+09:00');
 assert.equal(policy.confirmationDeadline(policy.schedulePeriod('2027-01-first_half'),{...settings,firstDay:0}),'2027-01-01T23:59:00+09:00');
 assert.throws(()=>policy.assertAfterSubmission({...settings,firstDay:25},{firstDay:25,secondDay:10,time:'23:59'}));
 assert.doesNotThrow(()=>policy.assertAfterSubmission(settings,{firstDay:25,secondDay:10,time:'23:59'}));
 assert.throws(()=>policy.validateConfirmationSettings({...settings,firstDay:null}));
 assert.doesNotThrow(()=>policy.validateConfirmationSettings({autoConfirm:false,firstDay:null,firstTime:null,secondDay:null,secondTime:null}));
});
test('confirm only selected half, preserve pending blank dates, infer staffing as open, explicitly confirmed closed dates only',async()=>{
 const f=await fixture();try{
  await f.enable();await f.shift();await f.shift('2099-11-16');
  await f.confirmation.saveScheduleDayStatus(id(1),'2099-11-03','closed',0,id(10));
  const result=await f.confirmation.confirmSchedulePeriod(id(1),'2099-11-first_half',id(10));
  assert.equal(result.confirmed,2);assert.equal(result.queued,2);
  const days=await f.confirmation.readScheduleDays(id(1),'2099-11-first_half');
  assert.equal(days[0].businessStatus,'open');assert.ok(days[0].confirmedAt);assert.equal(days[1].businessStatus,'pending');assert.equal(days[1].confirmedAt,null);
  assert.equal((await f.db.query("select * from timecard_schedule_days where work_date='2099-11-16'")).rows.length,0,'other half untouched');
  assert.equal((await f.db.query("select * from timecard_schedule_days where work_date='2099-11-02'")).rows.length,0,'unknown empty date not frozen as explicitly pending');
  await f.worker.runGoogleHoursJob(id(1));await f.worker.runGoogleHoursJob(id(1));
  assert.equal(f.live().length,2);assert.equal(f.live().find(p=>hours.dateKey(p.startDate)==='2099-11-03')?.closed,true);
  assert.equal((await f.db.query("select count(*)::int n from google_business_hours_jobs where status='synced'")).rows[0].n,2,'one date never supersedes another date');
 }finally{await f.db.close();}
});
test('timing changes, closure and reopening require confirmation before Google sync',async()=>{
 const f=await fixture();try{
  await f.enable();await f.shift();await f.confirmation.confirmScheduleDay(id(1),'2099-11-01',id(10));await f.worker.runGoogleHoursJob(id(1));
  await f.db.exec("update timecard_shifts set scheduled_end='22:30'");
  assert.equal((await f.db.query('select needs_refresh from timecard_schedule_days')).rows[0].needs_refresh,true);
  const refresh=await f.confirmation.reconcileScheduleMutation(id(1),['2099-11-01'],id(10));assert.equal(refresh.queued,0);
  assert.equal((await f.confirmation.confirmScheduleDay(id(1),'2099-11-01',id(10))).queued,true);
  await f.worker.runGoogleHoursJob(id(1));assert.equal(f.live()[0].closeTime?.hours,22);
  await f.db.exec('delete from timecard_shifts');
  const missing=await f.confirmation.reconcileScheduleMutation(id(1),['2099-11-01'],id(10));assert.ok(missing.warning.includes('営業時間の変更'));
  const record=(await f.db.query('select business_status,needs_refresh from timecard_schedule_days')).rows[0];assert.equal(record.business_status,'open');assert.equal(record.needs_refresh,true);
  const writes=f.patches();await f.worker.runGoogleHoursJob(id(1));assert.equal(f.patches(),writes);assert.equal(f.live()[0].closed,undefined);
  await f.confirmation.confirmScheduleDay(id(1),'2099-11-01',id(10));
  await f.worker.runGoogleHoursJob(id(1));assert.equal(f.live()[0].closed,true);
  await f.shift('2099-11-01','12:30','20:30');await f.confirmation.refreshChangedScheduleDays(id(1));
  await f.confirmation.confirmScheduleDay(id(1),'2099-11-01',id(10));
  await f.worker.runGoogleHoursJob(id(1));assert.equal(f.live()[0].openTime?.hours,13);assert.equal(f.live()[0].closeTime?.hours,20);
 }finally{await f.db.close();}
});
test('explicit pending with staff is not confirmed; unchanged hours/employee swap avoid dirty work; invalid staffed closure stops sync',async()=>{
 const f=await fixture();try{
  await f.enable();await f.shift();await f.confirmation.saveScheduleDayStatus(id(1),'2099-11-01','pending',0,id(10));
  assert.equal((await f.confirmation.confirmScheduleDay(id(1),'2099-11-01',id(10))).confirmed,false);
  const pending=(await f.db.query('select revision from timecard_schedule_days')).rows[0];
  await f.confirmation.saveScheduleDayStatus(id(1),'2099-11-01','open',pending.revision,id(10));await f.confirmation.confirmScheduleDay(id(1),'2099-11-01',id(10));
  await f.db.exec(`update timecard_shifts set employee_id='${id(10)}',note='swap'`);
  assert.equal((await f.db.query('select needs_refresh from timecard_schedule_days')).rows[0].needs_refresh,false);
  const open=(await f.db.query('select revision from timecard_schedule_days')).rows[0];
  const closed=await f.confirmation.saveScheduleDayStatus(id(1),'2099-11-01','closed',open.revision,id(10));assert.equal(closed.confirmed,false);
  await f.worker.runGoogleHoursJob(id(1));assert.equal(f.patches(),0,'stale queued open hours blocked');
  await assert.rejects(()=>f.confirmation.saveScheduleDayStatus(id(1),'2099-11-01','open',open.revision,id(10)));
 }finally{await f.db.close();}
});
test('automatic cutoff confirms ready dates only, later staffing can be confirmed, notifications bounded by keys',async()=>{
 const f=await fixture();try{
  await f.shift();await f.shift('2099-11-16');
  await f.db.exec(`insert into timecard_schedule_settings(store_id,auto_confirm,first_day,first_time,second_day,second_time,preparation_minutes,cleanup_minutes,updated_by)values('${id(1)}',true,28,'20:00',13,'20:00',30,30,'${id(10)}')`);
  await f.confirmation.sweepScheduleConfirmations(new Date('2099-10-28T10:59:00Z'));
  assert.equal((await f.db.query('select count(*)::int n from timecard_schedule_days where confirmed_at is not null')).rows[0].n,0);
  await f.confirmation.sweepScheduleConfirmations(new Date('2099-10-28T11:01:00Z'));
  assert.equal((await f.db.query('select count(*)::int n from timecard_schedule_days where confirmed_at is not null')).rows[0].n,1);
  assert.equal((await f.db.query("select count(*)::int n from timecard_schedule_days where work_date='2099-11-16'")).rows[0].n,0);
  await f.shift('2099-11-02');await f.confirmation.sweepScheduleConfirmations(new Date('2099-10-28T11:05:00Z'));
  assert.equal((await f.db.query('select count(*)::int n from timecard_schedule_days where confirmed_at is not null')).rows[0].n,2);
  assert.ok(f.notifications.some(n=>n.sourceKey?.includes('2099-11-first_half')));
 }finally{await f.db.close();}
});
test('immutable daily publication, same-day latest wins, unknown PATCH result recovers, manual Google exceptions protected',async()=>{
 const f=await fixture();try{
  await f.enable();await f.shift();await f.confirmation.confirmScheduleDay(id(1),'2099-11-01',id(10));
  await f.db.exec("update timecard_shifts set scheduled_end='22:30'");await f.confirmation.confirmScheduleDay(id(1),'2099-11-01',id(10));
  f.lose();assert.equal((await f.worker.runGoogleHoursJob(id(1))).status,'failed');const count=f.patches();
  await f.db.exec("update google_business_hours_jobs set next_attempt_at=now() where status='failed'");
  assert.equal((await f.worker.runGoogleHoursJob(id(1))).status,'synced');assert.equal(f.patches(),count);
  assert.equal((await f.db.query("select count(*)::int n from google_business_hours_jobs where status='superseded'")).rows[0].n,1);
  f.setLive(hours.deriveSpecialHours([], {preparationMinutes:30,cleanupMinutes:30},'2099-11',['2099-11-01']));
  await f.db.exec("update timecard_shifts set scheduled_end='23:00'");await f.confirmation.confirmScheduleDay(id(1),'2099-11-01',id(10));
  assert.equal((await f.worker.runGoogleHoursJob(id(1))).status,'conflict');assert.equal(f.patches(),count);
 }finally{await f.db.close();}
});
test('actual period API rejects foreign scope/stale settings/wrong-half dates and saves manual confirmation settings',async()=>{
 const f=await fixture();try{
  const access={requireGoogleBusinessAccess:async(storeId:string)=>storeId===id(1)?{session:{id:id(10)}}:{error:Response.json({error:'scope'},{status:403})},gbpJson:(body:unknown,status=200)=>Response.json(body,{status}),googleBusinessSameOrigin:(request:Request)=>request.headers.get('origin')===new URL(request.url).origin};
  const dispatched: string[]=[];
  const api=load('../app/api/timecard/schedule-confirmation/route.ts',{'../../../../lib/db':{sql:f.sql},'../../../../lib/google-business-hours-dispatch':{dispatchGoogleHours:(storeId:string,queued:boolean|number)=>{if(queued)dispatched.push(storeId);}},'../../../../lib/audit-log':{writeAuditLog:async()=>{}},'../../../../lib/google-business-access':access,'../../../../lib/shift-confirmation':f.confirmation,'../../../../lib/shift-confirmation-policy':policy});
  const post=(body:any,origin='https://test.invalid')=>api.POST(new Request('https://test.invalid/api',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({storeId:id(1),period:'2099-11-first_half',...body})}));
  assert.equal((await post({action:'confirm_period'},'https://evil.invalid')).status,403);
  assert.equal((await post({action:'confirm_period',storeId:id(2)})).status,403);
  assert.equal((await post({action:'set_day',date:'2099-11-16',status:'closed',revision:0})).status,400);
  const settings={autoConfirm:true,firstDay:28,firstTime:'20:00',secondDay:13,secondTime:'20:00'};
  assert.equal((await post({action:'save_settings',settings,revision:0})).status,200);
  assert.equal((await post({action:'save_settings',settings,revision:0})).status,409);
  assert.equal((await f.confirmation.readConfirmationSettings(id(1))).autoConfirm,false,'legacy settings cannot enable scheduled confirmation');
  assert.equal((await post({action:'save_settings',settings:{...settings,autoConfirm:false,firstDay:25},revision:1})).status,200,'automatic confirmation can always be disabled');
  assert.equal((await post({action:'set_business_day',date:'2099-11-05',status:'open',hoursSource:'manual',intervals:[],revision:0})).status,400);
  assert.equal((await post({action:'set_business_day',date:'2099-11-05',status:'open',hoursSource:'manual',intervals:[{workDate:'2099-11-05',scheduledStart:'12:00',scheduledEnd:'20:00'}],revision:0})).status,200);
  assert.equal((await post({action:'set_business_day',date:'2099-11-05',status:'closed',hoursSource:'manual',revision:0})).status,400,'stale formal calendar edit rejected');
  const response=await api.GET(new Request(`https://test.invalid/api?storeId=${id(1)}&period=2099-11-first_half`));assert.equal(response.status,200);assert.equal((await response.json()).summary.pending,15);
  await f.enable();await f.shift();
  assert.equal((await post({action:'confirm_day',date:'2099-11-01'})).status,200);
  assert.deepEqual(dispatched,[id(1)],'new confirmed hours dispatch only the selected store');
  assert.equal((await f.worker.runGoogleHoursJob(id(1))).status,'synced');
  assert.equal((await post({action:'confirm_day',date:'2099-11-01'})).status,200);
  assert.deepEqual(dispatched,[id(1)],'same confirmed hours do not dispatch again after Google readback');
 }finally{await f.db.close();}
});
test('overnight boundaries cross half/month edges; change trigger and its revision roll back with raw shift transaction',async()=>{
 const f=await fixture();try{
  await f.shift('2099-11-15','18:00','02:00');
  await f.confirmation.saveScheduleDayStatus(id(1),'2099-11-16','closed',0,id(10));
  const first=await f.confirmation.confirmScheduleDay(id(1),'2099-11-15',id(10));assert.equal(first.confirmed,false);assert.ok(first.reason.includes('翌日'));
  const second=await f.confirmation.confirmScheduleDay(id(1),'2099-11-16',id(10));assert.equal(second.confirmed,false);assert.ok(second.reason.includes('前日'));
  await f.db.exec('delete from timecard_shifts');await f.shift();await f.confirmation.confirmScheduleDay(id(1),'2099-11-01',id(10));
  await f.db.exec("begin;delete from timecard_shifts where work_date='2099-11-01'");
  assert.equal((await f.db.query("select needs_refresh from timecard_schedule_days where work_date='2099-11-01'")).rows[0].needs_refresh,true);
  await f.db.exec('rollback');
  assert.equal((await f.db.query("select needs_refresh from timecard_schedule_days where work_date='2099-11-01'")).rows[0].needs_refresh,false);
 }finally{await f.db.close();}
});
test('a later submission-deadline change blocks automatic confirmation rather than silently confirming too early',async()=>{
 const f=await fixture();try{
  await f.shift();await f.db.exec(`insert into timecard_schedule_settings(store_id,auto_confirm,first_day,first_time,second_day,second_time,preparation_minutes,cleanup_minutes,updated_by)values('${id(1)}',true,28,'20:00',13,'20:00',30,30,'${id(10)}');update stores set shift_first_half_submission_deadline_day=28`);
  await f.confirmation.sweepScheduleConfirmations(new Date('2099-10-28T11:01:00Z'));
  assert.equal((await f.db.query('select count(*)::int n from timecard_schedule_days where confirmed_at is not null')).rows[0].n,0);
  assert.ok(f.notifications.some(item=>item.sourceKey?.includes('settings')));
 }finally{await f.db.close();}
});
test('bulk staffing saves/deletes are atomic; a late failure rolls back shifts and dirty versions',async()=>{
 const f=await fixture();try{
  await f.confirmation.writeScheduleShiftsBulk(id(1),id(10),[{employeeId:id(10),workDate:'2099-11-01',scheduledStart:'11:30',scheduledEnd:'21:30'}]);
  await f.confirmation.confirmScheduleDay(id(1),'2099-11-01',id(10));
  const before=(await f.db.query("select revision from timecard_schedule_days where work_date='2099-11-01'")).rows[0].revision;
  await assert.rejects(()=>f.confirmation.writeScheduleShiftsBulk(id(1),id(10),[
   {employeeId:id(10),workDate:'2099-11-01',scheduledStart:'12:30',scheduledEnd:'20:30'},
   {employeeId:id(10),workDate:'invalid-date',scheduledStart:'12:30',scheduledEnd:'20:30'}
  ]));
  const retained=(await f.db.query("select to_char(scheduled_start,'HH24:MI') start from timecard_shifts where work_date='2099-11-01'")).rows[0];assert.equal(retained.start,'11:30');
  const unchanged=(await f.db.query("select revision,needs_refresh from timecard_schedule_days where work_date='2099-11-01'")).rows[0];assert.equal(unchanged.revision,before);assert.equal(unchanged.needs_refresh,false);
  await f.confirmation.writeScheduleShiftsBulk(id(1),id(10),[{employeeId:id(10),workDate:'2099-11-01'}],true);
  assert.equal((await f.db.query('select count(*)::int n from timecard_shifts')).rows[0].n,0);assert.equal((await f.db.query('select needs_refresh from timecard_schedule_days')).rows[0].needs_refresh,true);
 }finally{await f.db.close();}
});
test('disabling/rescheduling automatic confirmation or changing submission deadlines fences an in-flight automatic write',async()=>{
 const f=await fixture();try{
  await f.shift();await f.db.exec(`insert into timecard_schedule_settings(store_id,auto_confirm,first_day,first_time,second_day,second_time,preparation_minutes,cleanup_minutes)values('${id(1)}',true,28,'20:00',13,'20:00',30,30)`);
  const settings=await f.confirmation.readConfirmationSettings(id(1));
  await f.db.exec('update timecard_schedule_settings set auto_confirm=false,revision=revision+1');
  assert.equal((await f.confirmation.confirmScheduleDay(id(1),'2099-11-01',id(10),'automatic',undefined,undefined,settings)).confirmed,false);
  await f.db.exec('update timecard_schedule_settings set auto_confirm=true');
  assert.equal((await f.confirmation.confirmScheduleDay(id(1),'2099-11-01',id(10),'automatic',undefined,undefined,settings)).confirmed,false,'changed settings revision blocks an older in-flight sweep');
  await f.db.exec('update timecard_schedule_settings set auto_confirm=true,revision=1;update stores set shift_first_half_submission_deadline_day=28');
  assert.equal((await f.confirmation.confirmScheduleDay(id(1),'2099-11-01',id(10),'automatic',undefined,undefined,settings)).confirmed,false);
  assert.equal((await f.db.query('select count(*)::int n from timecard_shift_publications')).rows[0].n,0);
 }finally{await f.db.close();}
});

test('formal business calendar owns hours; confirmed manual changes sync without staffing and survive schedule edits, including explicit staffed closure',async()=>{
 const f=await fixture();try{
  await f.enable();await f.shift();await f.confirmation.confirmScheduleDay(id(1),'2099-11-01',id(10));
  let day=(await f.confirmation.readScheduleDays(id(1),'2099-11-first_half'))[0];
  assert.equal(day.businessPeriods[0].openTime.hours,12);assert.equal(day.suggestedPeriods[0].closeTime.hours,21);
  await f.confirmation.saveBusinessDay(id(1),day.workDate,'open','manual',[{workDate:day.workDate,scheduledStart:'13:00',scheduledEnd:'20:00'}],day.revision,id(10));
  await f.confirmation.confirmScheduleDay(id(1),day.workDate,id(10));
  await f.worker.runGoogleHoursJob(id(1));assert.equal(f.live()[0].openTime?.hours,13);assert.equal(f.live()[0].closeTime?.hours,20);
  await f.db.exec('delete from timecard_shifts');await f.confirmation.refreshChangedScheduleDays(id(1));
  await f.worker.runGoogleHoursJob(id(1));assert.equal(f.live()[0].openTime?.hours,13,'staff removal cannot replace a manual exception');
  day=(await f.confirmation.readScheduleDays(id(1),'2099-11-first_half'))[0];assert.equal(day.ready,true);assert.equal(day.hoursSource,'manual');
  await f.shift();day=(await f.confirmation.readScheduleDays(id(1),'2099-11-first_half'))[0];
  await f.confirmation.saveBusinessDay(id(1),day.workDate,'closed','manual',[],day.revision,id(10));
  await f.confirmation.confirmScheduleDay(id(1),day.workDate,id(10));
  await f.worker.runGoogleHoursJob(id(1));assert.equal(f.live()[0].closed,true,'explicit manual closure can coexist with an internal shift');
  await assert.rejects(()=>f.confirmation.saveBusinessDay(id(1),day.workDate,'open','manual',[],day.revision,id(10)));
  assert.equal((await f.db.query('select business_status from timecard_schedule_days')).rows[0].business_status,'closed');
 }finally{await f.db.close();}
});
test('Google reads immutable formal periods only; manual split/overnight validation and returning to schedule suggestions',async()=>{
 const f=await fixture();try{
  await f.enable();await f.shift();await f.confirmation.confirmScheduleDay(id(1),'2099-11-01',id(10));
  await f.db.exec(`update timecard_shift_publications set shift_snapshot='[]';update google_business_hours_jobs set rules='{}',closed_dates='[]'`);
  assert.equal((await f.worker.runGoogleHoursJob(id(1))).status,'synced');assert.equal(f.live()[0].openTime?.hours,12,'worker must not recalculate from raw staffing or Google settings');
  let day=(await f.confirmation.readScheduleDays(id(1),'2099-11-first_half'))[0];
  await f.confirmation.saveBusinessDay(id(1),day.workDate,'open','manual',[{workDate:day.workDate,scheduledStart:'12:00',scheduledEnd:'15:00'},{workDate:day.workDate,scheduledStart:'17:00',scheduledEnd:'02:00'}],day.revision,id(10));
  await f.confirmation.confirmScheduleDay(id(1),day.workDate,id(10));
  await f.worker.runGoogleHoursJob(id(1));assert.equal(f.live().length,2);assert.equal(hours.dateKey(f.live()[1].endDate!),'2099-11-02');
  await f.confirmation.saveBusinessDay(id(1),'2099-11-02','closed','manual',[],0,id(10));
  assert.equal((await f.confirmation.confirmScheduleDay(id(1),'2099-11-02',id(10))).confirmed,false,'formal overnight service blocks conflicting closure');
  day=(await f.confirmation.readScheduleDays(id(1),'2099-11-first_half'))[0];
  await f.confirmation.saveBusinessDay(id(1),day.workDate,'open','schedule',[],day.revision,id(10));
  await f.confirmation.confirmScheduleDay(id(1),day.workDate,id(10));
  await f.worker.runGoogleHoursJob(id(1));assert.equal(f.live().length,1);assert.equal(f.live()[0].closeTime?.hours,21);
 }finally{await f.db.close();}
});
test('independent calendar works without Google authorization; unset conversion rules do not guess final hours',async()=>{
 const f=await fixture();try{
  await f.db.exec('delete from google_business_connections');await f.shift();
  assert.equal((await f.confirmation.confirmScheduleDay(id(1),'2099-11-01',id(10))).confirmed,false);
  const revision=(await f.db.query('select revision from timecard_schedule_days')).rows[0].revision;
  await f.confirmation.saveBusinessDay(id(1),'2099-11-01','open','manual',[{workDate:'2099-11-01',scheduledStart:'12:00',scheduledEnd:'20:00'}],revision,id(10));
  assert.equal((await f.confirmation.confirmScheduleDay(id(1),'2099-11-01',id(10))).confirmed,true);
  assert.equal((await f.db.query('select count(*)::int n from google_business_hours_jobs')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('calendar migration preserves old records, refreshes legacy confirmations once, and never restores deliberately cleared offsets',async()=>{
 const f=await fixture();try{
  await f.enable();await f.shift();await f.confirmation.confirmScheduleDay(id(1),'2099-11-01',id(10));
  await f.db.exec(`update timecard_schedule_days set business_periods=null,needs_refresh=false;insert into timecard_schedule_settings(store_id,preparation_minutes,cleanup_minutes)values('${id(1)}',null,null)`);
  const migration=readFileSync(new URL('../db/migrations/20261101_store_business_calendar.sql',import.meta.url),'utf8');await f.db.exec(migration);
  const first=(await f.db.query('select revision,needs_refresh,shift_snapshot,confirmed_at from timecard_schedule_days')).rows[0];
  assert.equal(first.needs_refresh,true);assert.ok(first.confirmed_at);assert.equal(first.shift_snapshot.length,1);
  await f.db.exec(migration);assert.equal((await f.db.query('select revision from timecard_schedule_days')).rows[0].revision,first.revision);
  assert.equal((await f.confirmation.readConfirmationSettings(id(1))).preparationMinutes,null,'explicit unset must not fall back to old Google offsets');
  assert.equal((await f.confirmation.confirmScheduleDay(id(1),'2099-11-01',id(10))).confirmed,false);
 }finally{await f.db.close();}
});

test('reviewed half-month closes implicit empty dates, preserves explicit pending and rejects a changed closure preview',async()=>{
 const f=await fixture();try{
  await f.enable();
  await f.confirmation.saveScheduleDayStatus(id(1),'2099-11-03','pending',0,id(10));
  const days=await f.confirmation.readScheduleDays(id(1),'2099-11-first_half');
  const review=Object.fromEntries(days.map(day=>[day.workDate,f.confirmation.scheduleDayReviewKey(day)]));
  await f.shift('2099-11-02');
  const result=await f.confirmation.confirmSchedulePeriod(id(1),'2099-11-first_half',id(10),'manual',undefined,undefined,undefined,review);
  assert.equal(result.confirmed,12);
  assert.deepEqual(Array.from(result.unresolved),['2099-11-01','2099-11-02','2099-11-03']);
  const confirmed=await f.confirmation.readScheduleDays(id(1),'2099-11-first_half');
  assert.equal(confirmed[3].businessPeriods[0].closed,true);
  assert.equal(confirmed[1].confirmedAt,null);
  assert.equal(confirmed[2].confirmedAt,null);
 }finally{await f.db.close();}
});

test('employee submission, versioned manager approval and withdrawal preserve the published roster until reviewed',async()=>{
 const f=await fixture();
 try{
  await f.db.exec(`alter table employees add column staff_category text default 'human'; alter table stores add column name text;
    create table timecard_shift_requests(id uuid primary key default gen_random_uuid(),store_id uuid,employee_id uuid,request_type text,status text default 'open',target_shift_id uuid,work_date date,title text,note text,reviewed_by uuid,reviewed_at timestamptz,review_note text,created_by uuid,updated_at timestamptz default now());
    create table timecard_shift_request_windows(id uuid primary key default gen_random_uuid(),request_id uuid references timecard_shift_requests(id) on delete cascade,work_date date,available_start time,available_end time,preference text,note text,created_at timestamptz default now());
    create table timecard_shift_request_candidates(id uuid primary key,request_id uuid,employee_id uuid,status text,approved_by uuid,approved_at timestamptz);`);
  const fixedDate = class extends Date { constructor(value?: string | number){super(value??'2099-10-24T03:00:00Z');} };
  let role='staff';
  const route=load('../app/api/timecard/shift-requests/route.ts',{
   '../../../../lib/google-business-hours-dispatch':{dispatchGoogleHours:()=>{}},
   '../../../../lib/google-business-access':{requireGoogleBusinessAccess:async()=>({})},
   '../../../../lib/shift-confirmation':f.confirmation,'../../../../lib/shift-confirmation-policy':policy,
   '../../../../lib/store-business-hours':{},'../../../../lib/timecard':{},
   '../../../../lib/api-auth':{requireOsSession:async()=>({id:id(10),role,name:'Fixture'}),canAccessStore:async()=>true},
   '../../../../lib/audit-log':{writeAuditLog:async()=>{}},'../../../../lib/db':{sql:f.sql},
   '../../../../lib/web-push':{createOsNotification:async()=>{}},
  },fixedDate);
  const post=(body:Record<string,unknown>)=>route.POST(new Request('https://test.invalid/api',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify({storeId:id(1),...body})}));
  const submit=(entries:unknown[],submissionStart='2099-11-01')=>post({action:'create_availability_period',submissionStart,entries});
  const day={workDate:'2099-11-01',preference:'available',availableStart:'11:30',availableEnd:'21:30'};
  const state=async()=> (await f.db.query('select id,status,request_type,updated_at::text as version from timecard_shift_requests')).rows[0] as any;
  const approve=(r:any,start='11:30')=>post({action:'review_request',requestId:r.id,requestVersion:r.version,approvedStart:start,approvedEnd:'21:30'});
  const shiftCount=async()=>Number((await f.db.query('select count(*) as n from timecard_shifts')).rows[0].n);
  assert.equal((await submit([day])).status,200);
  const first=await state();
  assert.equal((await submit([],'2099-10-16')).status,409);
  assert.equal((await state()).version,first.version);
  role='owner';
  assert.equal((await approve(first)).status,200);
  assert.equal(await shiftCount(),1);
  assert.equal((await approve(first)).status,409);
  role='staff';
  assert.equal((await submit([{...day,availableStart:'12:30'}])).status,200);
  assert.equal(await shiftCount(),1,'changing a hope does not delete an approved shift');
  const changed=await state();
  role='owner';
  assert.equal((await approve(first)).status,409,'stale manager view cannot approve');
  assert.equal((await approve(changed,'12:30')).status,200);
  assert.equal(await shiftCount(),1);
  role='staff';
  assert.equal((await submit([])).status,200);
  assert.equal(await shiftCount(),1,'a withdrawal waits for manager approval');
  const cancellation=await state();
  assert.equal(cancellation.request_type,'day_off');
  role='owner';
  assert.equal((await approve(cancellation)).status,200);
  assert.equal(await shiftCount(),0);
 }finally{await f.db.close();}
});
