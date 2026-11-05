// Execute the actual notification route SQL and shared business-day predicate
// against isolated PostgreSQL. Only CURRENT_TIMESTAMP is bound to a test clock.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as businessDay from '../../lib/inventory-sync-business-day.ts';

const {PGlite} = await import(process.env.FOUNDR1_PGLITE_MODULE || process.env.PGLITE_MODULE || '@electric-sql/pglite');
const code = ts.transpileModule(readFileSync('app/api/notifications/route.ts', 'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText;
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
const dailyHours = (open='11:00',close='22:00') => Object.fromEntries(['mon','tue','wed','thu','fri','sat','sun'].map(day=>[day,{open,close,closed:false}]));

async function fixture(now='2026-10-19T15:00:00+09:00') {
  const db = new PGlite();
  await db.exec(`create table stores(id uuid primary key,name text,external_id text,business_hours jsonb not null default '{}');
    create table local_bridge_commands(id uuid primary key,store_id uuid references stores(id),command_type text not null default 'set_inventory_availability',status text default 'failed',created_at timestamptz not null);
    create table os_notifications(id uuid primary key,recipient_employee_id uuid not null,notification_type text,title text,message text,href text,source_key text,read_at timestamptz,created_at timestamptz not null);`);
  let clock=now, employeeId=id(200), authenticated=true;
  const queries=[];
  async function execute(query,values) {
    queries.push(query);
    assert.match(query,/\bCURRENT_TIMESTAMP\b/,'both route reads use the real shared business-day predicate');
    const bound=query.replaceAll('CURRENT_TIMESTAMP','$2::timestamptz');
    return (await db.query(bound,[...values,clock])).rows;
  }
  const sql=Object.assign(async(parts,...values)=>execute(parts.reduce((all,part,index)=>all+part+(index<values.length?`$${index+1}`:''),''),values),{query:execute});
  const exports={};
  runInNewContext(code,{exports,Response,require:name=>{
    if(name.endsWith('/api-auth'))return{requireOsSession:async()=>authenticated?{id:employeeId}:null};
    if(name.endsWith('/db'))return{sql};
    if(name.endsWith('/inventory-sync-business-day'))return businessDay;
    throw Error(`Unexpected route dependency: ${name}`);
  }});
  return {db,queries,setNow:value=>{clock=value;},setEmployee:value=>{employeeId=id(value);},setAuthenticated:value=>{authenticated=value;},
    store:async(number,hours=dailyHours())=>db.query('insert into stores(id,name,external_id,business_hours) values($1,$2,$3,$4)',[id(number),`Store ${number}`,`merchant-${number}-not-json`,JSON.stringify(hours)]),
    command:async(number,store,createdAt)=>db.query('insert into local_bridge_commands(id,store_id,created_at) values($1,$2,$3)',[id(number),id(store),createdAt]),
    notice:async(number,{employee=200,type='inventory_sync_attention',command,sourceKey,createdAt='2026-10-19T14:00:00+09:00',readAt=null}={})=>db.query(
      'insert into os_notifications(id,recipient_employee_id,notification_type,title,message,href,source_key,created_at,read_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id(number),id(employee),type,`Notice ${number}`,`Message ${number}`,'/store/menu',sourceKey??(command?`inventory-sync:${id(command)}`:''),createdAt,readAt]),
    get:()=>exports.GET(), snapshot:async()=>JSON.stringify({notices:(await db.query('select * from os_notifications order by id')).rows,commands:(await db.query('select * from local_bridge_commands order by id')).rows}),close:()=>db.close()};
}

test('notification visibility authenticates before querying the database',async()=>{
  const f=await fixture();try{f.setAuthenticated(false);assert.equal((await f.get()).status,403);assert.deepEqual(f.queries,[]);}finally{await f.close();}
});

test('recently created old-operation notices are hidden without changing other types, read state, records or account isolation',async()=>{
  const f=await fixture();try{
    await f.store(1);
    await f.command(101,1,'2026-10-18T19:00:00+09:00');await f.command(102,1,'2026-10-19T10:00:00+09:00');
    await f.notice(1001,{command:101,createdAt:'2026-10-19T14:59:00+09:00'});
    await f.notice(1002,{command:102});
    await f.notice(1003,{type:'store_confirmation_required',command:101,createdAt:'2026-10-01T12:00:00+09:00'});
    await f.notice(1004,{type:null,createdAt:'2026-09-01T12:00:00+09:00'});
    await f.notice(1005,{command:102,readAt:'2026-10-19T14:01:00+09:00'});
    await f.notice(1006,{employee:201,command:102});
    await f.notice(1007,{sourceKey:'inventory-sync:not-a-valid-uuid'});
    await f.notice(1008,{command:999});
    const before=await f.snapshot();const body=await(await f.get()).json();
    assert.deepEqual(body.notifications.map(row=>row.id).sort(),[id(1002),id(1003),id(1004)]);assert.equal(body.unreadCount,3);
    assert.equal(await f.snapshot(),before,'GET neither marks notices read nor edits historical commands');
    f.setEmployee(201);const other=await(await f.get()).json();assert.deepEqual(other.notifications.map(row=>row.id),[id(1006)]);assert.equal(other.unreadCount,1);
  }finally{await f.close();}
});

test('each store applies the shared overnight business date including the closing minute and next-day rollover',async()=>{
  const f=await fixture('2026-10-19T01:00:00+09:00');try{
    await f.store(1,{weekly:dailyHours('11:00','02:00')});await f.store(2,dailyHours());
    const commands=[[101,1,'2026-10-18T23:00:00+09:00'],[102,1,'2026-10-19T00:30:00+09:00'],[103,1,'2026-10-18T01:00:00+09:00'],[104,2,'2026-10-18T23:00:00+09:00'],[105,2,'2026-10-19T00:30:00+09:00'],[106,1,'2026-10-19T02:01:00+09:00']];
    for(const[number,store,date]of commands){await f.command(number,store,date);await f.notice(number+1000,{command:number});}
    for(const now of ['2026-10-19T01:00:00+09:00','2026-10-19T02:00:59+09:00']){
      f.setNow(now);const body=await(await f.get()).json();assert.deepEqual(body.notifications.map(row=>row.id).sort(),[id(1101),id(1102),id(1105)]);assert.equal(body.unreadCount,3);
    }
    f.setNow('2026-10-19T02:01:00+09:00');const next=await(await f.get()).json();assert.deepEqual(next.notifications.map(row=>row.id).sort(),[id(1105),id(1106)]);assert.equal(next.unreadCount,2);
  }finally{await f.close();}
});

test('the limited list and full unread count share the same visibility rule when more than twenty notices remain',async()=>{
  const f=await fixture();try{
    await f.store(1);
    for(let n=0;n<24;n++){await f.command(100+n,1,'2026-10-19T10:00:00+09:00');await f.notice(1000+n,{command:100+n,createdAt:`2026-10-19T13:${String(n).padStart(2,'0')}:00+09:00`});}
    for(let n=0;n<7;n++){await f.command(200+n,1,'2026-10-18T12:00:00+09:00');await f.notice(2000+n,{command:200+n,createdAt:'2026-10-19T14:59:00+09:00'});}
    for(let n=0;n<3;n++)await f.notice(3000+n,{type:'unrelated_notice',createdAt:'2026-09-01T12:00:00+09:00'});
    await f.notice(4000,{employee:201,type:'unrelated_notice'});
    const before=await f.snapshot();const body=await(await f.get()).json();assert.equal(body.notifications.length,20);assert.equal(body.unreadCount,27);
    assert.ok(body.notifications.every(row=>!Array.from({length:7},(_,n)=>id(2000+n)).includes(row.id)));
    assert.equal(await f.snapshot(),before);
  }finally{await f.close();}
});

test('24-hour stores show rolling notices across midnight and expire both list and count at the same original-operation boundary',async()=>{
  const f=await fixture('2026-10-19T00:30:00+09:00');try{
    await f.store(1,{weekly:Object.fromEntries(Object.entries(dailyHours()).map(([day,value])=>[day,{...value,open24Hours:true}]))});
    const commands=[[101,'2026-10-18T00:30:00+09:00'],[102,'2026-10-18T23:59:59+09:00'],[103,'2026-10-18T00:29:59+09:00']];
    for(const[number,date]of commands){await f.command(number,1,date);await f.notice(number+1000,{command:number,createdAt:'2026-10-19T00:29:00+09:00'});}
    const before=await f.snapshot();const body=await(await f.get()).json();
    assert.deepEqual(body.notifications.map(row=>row.id).sort(),[id(1101),id(1102)]);assert.equal(body.unreadCount,2);
    f.setNow('2026-10-19T00:30:01+09:00');const next=await(await f.get()).json();
    assert.deepEqual(next.notifications.map(row=>row.id),[id(1102)]);assert.equal(next.unreadCount,1);
    assert.equal(await f.snapshot(),before,'rolling expiry preserves notices and original commands');
  }finally{await f.close();}
});
