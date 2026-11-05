import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as crypto from 'node:crypto';
import ts from 'typescript';
import * as policy from './google-business-hours-policy.ts';
const {PGlite}=await import(process.env.PGLITE_MODULE || '../outputs/inventory-reference-implementation-20261014/test-deps/node_modules/@electric-sql/pglite/dist/index.js');
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const shift=(date='2099-11-01',start='11:30',end='21:30')=>({workDate:date,scheduledStart:start,scheduledEnd:end});
const rules={preparationMinutes:30,cleanupMinutes:30};
const plain=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
function load(file:string,deps:Record<string,unknown>,env:Record<string,string>={}) {
  const exports:Record<string,unknown>={};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
    {exports,process:{env},Response,Request,Headers,URL,URLSearchParams,AbortSignal,Buffer,Date,Intl,console,require:(name:string)=>{if(!(name in deps))throw new Error(name);return deps[name];}});
  return exports as any;
}
test('staffing union, split service, offsets, midnight and explicit closure rules',()=>{
  const periods=policy.deriveSpecialHours([shift(),shift('2099-11-01','15:00','23:00')],rules,'2099-11');
  assert.deepEqual(periods[0].openTime,{hours:12,minutes:0});
  assert.deepEqual(periods[0].closeTime,{hours:22,minutes:30});
  const split=policy.deriveSpecialHours([shift('2099-11-01','10:00','14:00'),shift('2099-11-01','17:00','22:00')],rules,'2099-11');
  assert.equal(split.length,2);
  const overnight=policy.deriveSpecialHours([shift('2099-11-30','18:00','02:00')],rules,'2099-11');
  assert.equal(policy.dateKey(overnight[0].endDate!),'2099-12-01');
  assert.deepEqual(overnight[0].closeTime,{hours:1,minutes:30});
  assert.equal(policy.deriveSpecialHours([],rules,'2099-11').length,0);
  assert.equal(policy.deriveSpecialHours([],rules,'2099-11',['2099-11-02'])[0].closed,true);
  assert.throws(()=>policy.deriveSpecialHours([shift()],rules,'2099-11',['2099-11-01']));
  assert.throws(()=>policy.deriveSpecialHours([shift('2099-11-01','20:00','02:00'),shift('2099-11-02','00:30','03:00')],rules,'2099-11'));
  for(const bad of [shift('2099-11-01','10:00','10:00'),shift('2099-11-01','23:45','00:15')])assert.throws(()=>policy.deriveSpecialHours([bad],rules,'2099-11'));
  assert.throws(()=>policy.deriveSpecialHours([shift()],{preparationMinutes:-1,cleanupMinutes:0},'2099-11'));
  assert.throws(()=>policy.parseDate('2099-02-30'));
});
test('manual exceptions and deletion conflict; unrelated dates preserved; normalized Google readback',()=>{
  const desired=policy.deriveSpecialHours([shift()],rules,'2099-11');
  const manual=policy.deriveSpecialHours([shift('2099-11-01','10:00','15:00')],rules,'2099-11');
  const holiday=policy.deriveSpecialHours([],rules,'2099-11',['2099-11-03']);
  assert.throws(()=>policy.mergeSpecialHours(manual,desired,{}),policy.HoursConflict);
  assert.throws(()=>policy.mergeSpecialHours([],desired,{'2099-11-01':manual}),policy.HoursConflict);
  assert.equal(policy.mergeSpecialHours([...manual,...holiday],desired,{'2099-11-01':manual}).periods.length,2);
  const normalized=desired.map(period=>({...period,endDate:undefined,closed:false,openTime:{...period.openTime,seconds:0,nanos:0}}));
  assert.equal(policy.canonicalPeriods(desired),policy.canonicalPeriods(normalized));
});
async function fixture() {
  const db=new PGlite();
  await db.exec(`create table stores(id uuid primary key,status text default 'active');create table employees(id uuid primary key);create table employee_sessions(id uuid primary key);
    create table timecard_shift_publications(id uuid primary key default gen_random_uuid(),store_id uuid,schedule_month text,note text,published_by uuid,published_at timestamptz default now());
    create table timecard_shifts(store_id uuid,work_date date,scheduled_start time,scheduled_end time);
    insert into stores(id)values('${id(1)}'),('${id(2)}');insert into employees values('${id(10)}');insert into employee_sessions values('${id(20)}');`);
  const migration=readFileSync(new URL('../db/migrations/20261031_google_business_hours.sql',import.meta.url),'utf8');
  await db.exec(migration);await db.exec(migration);
  await db.exec(readFileSync(new URL('../db/migrations/20261031_shift_confirmation_periods.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../db/migrations/20261101_store_business_calendar.sql',import.meta.url),'utf8'));
  function sql(strings:TemplateStringsArray,...values:unknown[]) {
    const query=strings.reduce((text,part,index)=>text+(index?`$${index}`:'')+part,'');
    let pending:Promise<any>|undefined;
    return {then:(resolve:any,reject:any)=> (pending??=db.query(query,values).then((result:any)=>result.rows)).then(resolve,reject)};
  }
  sql.transaction=async(queries:any[])=>{await db.exec('begin');try{const results=[];for(const query of queries)results.push(await query);await db.exec('commit');return results;}catch(error){await db.exec('rollback');throw error;}};
  let live:policy.GbpPeriod[]=[];let patchCount=0;let loseResponse=false;
  const client={googleAccessToken:async()=> 'synthetic-token',getGoogleLocation:async()=>({regularHours:{periods:[{}]},specialHours:{specialHourPeriods:plain(live)}}),patchGoogleHours:async(_token:string,_name:string,periods:policy.GbpPeriod[])=>{patchCount++;live=plain(periods);if(loseResponse){loseResponse=false;throw new Error('unknown network response');}}};
  const service=load('./google-business-hours.ts',{'node:crypto':crypto,'./db':{sql},'./google-business-client':client,'./google-business-hours-policy':policy});
  return {db,sql,service,client,getLive:()=>live,setLive:(periods:policy.GbpPeriod[])=>{live=periods;},patchCount:()=>patchCount,loseResponse:()=>{loseResponse=true;}};
}
test('real access helper checks session, role, module permission, store scope and active store; origin rejects missing/cross origin',async()=>{
  let session:any=null;let allowed=true;let permitted=true;let active=true;
  const access=load('./google-business-access.ts',{'./api-auth':{requireOsSession:async()=>session,canAccessStore:async()=>allowed},'./role-permissions':{getPermissionsForRole:async()=>new Set(permitted?['module.timecard']:[])},'./db':{sql:async()=>active?[{}]:[]}});
  assert.equal((await access.requireGoogleBusinessAccess(id(1))).error.status,401);
  session={id:id(10),role:'staff'};assert.equal((await access.requireGoogleBusinessAccess(id(1))).error.status,403);
  session.role='store_owner';allowed=false;assert.equal((await access.requireGoogleBusinessAccess(id(1))).error.status,403);
  allowed=true;permitted=false;assert.equal((await access.requireGoogleBusinessAccess(id(1))).error.status,403);
  permitted=true;active=false;assert.equal((await access.requireGoogleBusinessAccess(id(1))).error.status,404);
  active=true;assert.equal((await access.requireGoogleBusinessAccess(id(1))).session.role,'store_owner');
  assert.equal(access.googleBusinessSameOrigin(new Request('https://test.invalid/api',{method:'POST'})),false);
  assert.equal(access.googleBusinessSameOrigin(new Request('https://test.invalid/api',{method:'POST',headers:{origin:'https://evil.invalid'}})),false);
  assert.equal(access.googleBusinessSameOrigin(new Request('https://test.invalid/api',{method:'POST',headers:{origin:'https://test.invalid'}})),true);
});
test('credentials encrypted with store binding; altered ciphertext fails authentication',()=>{
  const client=load('./google-business-client.ts',{'node:crypto':crypto},{GOOGLE_BUSINESS_CLIENT_ID:'synthetic',GOOGLE_BUSINESS_CLIENT_SECRET:'synthetic',GOOGLE_BUSINESS_REDIRECT_URI:'https://test.invalid/api/os/google-business/oauth',GOOGLE_BUSINESS_TOKEN_KEY:'ab'.repeat(32)});
  const cipher=client.sealGoogleSecret('private-refresh-token',id(1));
  assert.equal(cipher.includes('private-refresh-token'),false);
  assert.equal(client.openGoogleSecret(cipher,id(1)),'private-refresh-token');
  assert.throws(()=>client.openGoogleSecret(cipher,id(2)));
  assert.throws(()=>client.openGoogleSecret(`00${cipher.slice(2)}`,id(1)));
});
test('settings/retry handlers exercise scoped persistence, stale revision, foreign job and OAuth state replay',async()=>{
  const f=await fixture();
  const session={id:id(10),sessionId:id(20),role:'store_owner'};
  const headers={'content-type':'application/json',origin:'https://test.invalid'};
  const access={requireGoogleBusinessAccess:async(storeId:string)=>storeId===id(1)?{session}:{error:Response.json({error:'scope'},{status:403})},gbpJson:(body:unknown,status=200)=>Response.json(body,{status}),googleBusinessSameOrigin:(request:Request)=>request.headers.get('origin')===new URL(request.url).origin};
  const audit={writeAuditLog:async()=>{}};
  const client={...f.client,googleBusinessConfig:()=>({clientId:'synthetic',redirectUri:'https://test.invalid/api/os/google-business/oauth'}),listGoogleLocations:async()=>[{name:'locations/100',title:'Synthetic Store'}],sealGoogleSecret:(value:string)=>`encrypted-${value}`,openGoogleSecret:()=> 'synthetic-verifier',gbpScope:'business-scope',exchangeGoogleToken:async()=>({access_token:'synthetic',refresh_token:'private',scope:'business-scope'})};
  const route=load('../app/api/os/google-business/route.ts',{'node:crypto':crypto,'../../../../lib/google-business-access':access,'../../../../lib/google-business-client':client,'../../../../lib/google-business-hours-policy':policy,'../../../../lib/db':{sql:f.sql},'../../../../lib/google-business-hours-dispatch':{dispatchGoogleHours:()=>{}},'../../../../lib/audit-log':audit});
  const post=(body:unknown,origin='https://test.invalid')=>route.POST(new Request('https://test.invalid/api/os/google-business',{method:'POST',headers:{...headers,origin},body:JSON.stringify(body)}));
  try {
    const initial={storeId:id(1),action:'save',revision:0,enabled:false,locationName:'',...rules};
    assert.equal((await post(initial,'https://evil.invalid')).status,403);
    assert.equal((await post({...initial,storeId:id(2)})).status,403);
    assert.equal((await post(initial)).status,200);
    assert.equal((await post(initial)).status,409,'stale creation cannot overwrite');
    await f.db.exec(`update google_business_connections set token_ciphertext='synthetic'`);
    assert.equal((await post({...initial,revision:1,locationName:'locations/100',enabled:true})).status,200);
    const stored=(await f.db.query('select * from google_business_connections')).rows[0];assert.equal(stored.enabled,true);assert.equal(stored.preparation_minutes,null,'Google connection no longer owns conversion rules');
    for (const date of ['2099-11-01','2099-11-02']) {
      const periods=policy.deriveSpecialHours([shift(date)],rules,'2099-11');
      await f.db.query(`with day as (
        insert into timecard_schedule_days(store_id,work_date,business_status,confirmed_at,business_periods)
        values($1,$2,'open',now(),$3::jsonb) returning *
      ), publication as (
        insert into timecard_shift_publications(store_id,schedule_month,work_date,business_periods)
        select store_id,'2099-11',work_date,business_periods from day returning id
      ) insert into google_business_hours_jobs(publication_id,store_id,schedule_month,connection_revision,location_name,rules,work_date,day_revision)
        select publication.id,day.store_id,'2099-11',$4,'locations/100','{}',day.work_date,day.revision from publication,day`,[id(1),date,JSON.stringify(periods),stored.revision]);
    }
    const unchanged={...initial,revision:stored.revision,locationName:'locations/100',enabled:true};
    assert.equal((await post(unchanged)).status,200);
    assert.equal((await post(unchanged)).status,200);
    assert.equal((await f.db.query('select revision from google_business_connections')).rows[0].revision,stored.revision);
    assert.equal((await f.service.sweepGoogleHours(Date.now()-1)).length,0,'expired budget leaves pending work untouched');
    const results=await f.service.sweepGoogleHours(Date.now()+65000);
    assert.equal(results.length,2,'a single sweep processes both pending dates');
    assert.ok(results.every((result:{status:string})=>result.status==='synced'),'saving identical settings preserves both pending jobs');
    assert.deepEqual(f.getLive().map(period=>policy.dateKey(period.startDate)),['2099-11-01','2099-11-02']);
    const get=await route.GET(new Request(`https://test.invalid/api/os/google-business?storeId=${id(1)}`));assert.equal(JSON.stringify(await get.json()).includes('synthetic'),false,'private tokens never returned');
    const connect=await post({storeId:id(1),action:'connect'});const authUrl=new URL((await connect.json()).url);const state=authUrl.searchParams.get('state');assert.equal(authUrl.searchParams.get('code_challenge_method'),'S256');
    const callback=load('../app/api/os/google-business/oauth/route.ts',{'node:crypto':crypto,'next/server':{NextResponse:{redirect:(url:URL)=>Response.redirect(url,307)}},'../../../../../lib/google-business-access':access,'../../../../../lib/google-business-client':client,'../../../../../lib/db':{sql:f.sql},'../../../../../lib/audit-log':audit});
    const request=new Request(`https://test.invalid/api/os/google-business/oauth?state=${state}&code=synthetic`);
    assert.equal((await callback.GET(request)).status,307);
    assert.equal((await callback.GET(request)).status,400,'OAuth state is consumed once');
    const reconnected=(await f.db.query('select * from google_business_connections')).rows[0];assert.equal(reconnected.enabled,false);assert.equal(reconnected.location_name,null,'reconnect requires explicit location choice');
    assert.equal((await post({storeId:id(1),action:'retry',jobId:id(99)})).status,409);
  } finally {await f.db.close();}
});
