// Isolated Store identity integration tests. Never reads DATABASE_URL or a live database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import * as crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const ts = require(process.env.FOUNDR1_TYPESCRIPT_MODULE || 'typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const root = new URL('../../', import.meta.url), db = new PGlite();
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ids = Object.fromEntries(['store','otherStore','inactiveStore','owner','manager','store_owner','store_manager','staff','otherStaff','sameStoreStaff','terminal','otherTerminal','initialStaff','initialManager','supplier','noPassword'].map((key,index) => [key,uuid(index+1)]));
const cookieJar = new Map(), statements = [], sqlFailures = [], expectedSqlFailures = [], audit = [], groups = [];
const environment = {AUTH_SECRET:'isolated-store-identity-pglite', NODE_ENV:'production'};
let clockNow = Date.now();
let databaseFault = null, expectingDatabaseFailure = false;
class ClockDate extends Date { static now() { return clockNow; } }
async function execute(statement,connection = db) {
  statements.push(statement.text);
  try {
    if(databaseFault==='success-before'&&statement.text.includes("set action='store.inventory_operator_attempt_succeeded'"))await connection.query('select 1/0');
    const result=await connection.query(statement.text,statement.values);
    if(databaseFault==='lock-after'&&statement.text.includes('pg_advisory_xact_lock'))await connection.query('select 1/0');
    if(databaseFault==='counter-after'&&statement.text.includes('with quota as materialized'))await connection.query('select 1/0');
    return result.rows;
  } catch (error) {
    (expectingDatabaseFailure ? expectedSqlFailures : sqlFailures).push({message:error.message,text:statement.text});throw error;
  }
}
const sql = Object.assign((parts,...values) => ({
  text:parts.reduce((text,part,index) => text+part+(index<values.length ? `$${index+1}` : ''),''),values,
  then(resolve,reject) {return execute(this).then(resolve,reject);}
}),{transaction:queries => db.transaction(async connection => {
  const result=[];for(const query of queries)result.push(await execute(query,connection));return result;
})});
const headers = {cookies:async () => ({get:name => cookieJar.has(name) ? {value:cookieJar.get(name)} : undefined})};
const modules = {'node:crypto':crypto,'next/headers':headers};
function load(path, overrides = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path,root),'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText, {exports,Buffer,Response,Request,URL,Date:ClockDate,process:{env:environment},require:name => {
    if (name in overrides) return overrides[name];
    if (name === './db' || name.endsWith('/db')) return {sql};
    if (name === './audit-log' || name.endsWith('/audit-log')) return {writeAuditLog:async record => audit.push(record)};
    const key = name.replace(/^.*\/lib\//,'./');
    if (name in modules) return modules[name];
    if (key in modules) return modules[key];
    throw new Error(`Unexpected isolated Store identity dependency ${name}`);
  }});
  return exports;
}
const auth = modules['./auth'] = load('lib/auth.ts');
const policy = modules['./store-inventory-policy'] = load('lib/store-inventory-policy.ts');
const tokens = modules['./store-inventory-operator-token'] = load('lib/store-inventory-operator-token.ts');
const permissions = modules['./role-permissions'] = load('lib/role-permissions.ts');
const apiAuth = modules['./api-auth'] = load('lib/api-auth.ts');
modules['./employee-sessions'] = load('lib/employee-sessions.ts');
const access = modules['./store-inventory-access'] = load('lib/store-inventory-access.ts');
const operator = load('app/api/store/inventory/operator/route.ts');
const login = load('app/api/auth/login/route.ts');
const rows = async (text,values = []) => (await db.query(text,values)).rows;
const sessionIds = new Map();
function baseCookie(role) {
  return auth.createSessionToken({id:ids[role],name:role,loginId:role,role:role==='terminal'||role==='otherTerminal' ? 'store_terminal' : role,
    sessionVersion:1,sessionId:sessionIds.get(role)});
}
function useBase(role = 'terminal') {
  cookieJar.clear();cookieJar.set(auth.authCookieName,baseCookie(role));
}
function request(method,body = {},options = {}) {
  const requestHeaders = new Headers({'content-type':'application/json','x-forwarded-for':options.ip ?? '192.0.2.1'});
  if (options.origin !== null) requestHeaders.set('origin',options.origin ?? 'https://example.test');
  if (options.fetchSite) requestHeaders.set('sec-fetch-site',options.fetchSite);
  return new Request('https://example.test/api/store/inventory/operator'+(method==='GET' ? `?storeId=${options.storeId ?? ids.store}` : ''),{
    method,headers:requestHeaders,...(method==='GET' ? {} : {body:JSON.stringify({storeId:ids.store,...body})})
  });
}
const post = (body = {},options = {}) => operator.POST(request('POST',body,options));
async function expectError(response,status,code) {
  assert.equal(response.status,status,await response.clone().text());
  if (code) assert.equal((await response.json()).code,code);
  assert.equal(response.headers.get('cache-control'),'no-store, max-age=0');
}
async function expectAccessError(storeId,action,status,code) {
  const result = await access.requireStoreInventoryAccess(storeId,action);
  assert.equal(result.ok,false);
  await expectError(result.response,status,code);
}
function installProof(response) {
  const cookie=response.headers.get('set-cookie');
  assert.ok(cookie?.startsWith(`${tokens.storeInventoryOperatorCookieName}=`));
  cookieJar.set(tokens.storeInventoryOperatorCookieName,cookie.split(';')[0].slice(tokens.storeInventoryOperatorCookieName.length+1));
  return cookie;
}
async function authenticate(loginId = 'staff', options = {}) {
  const response=await post({loginId,password:'Password123',...options.body},options);
  assert.equal(response.status,200,await response.clone().text());
  installProof(response);return response;
}
async function group(label,run) {
  await ageAttempts();
  await run();groups.push(label);console.log(`PASS ${groups.length}: ${label}`);
}
async function ageAttempts() {
  await rows("update os_audit_logs set created_at=now()-interval '11 minutes' where action='store.inventory_operator_attempt'");
}
async function quotaRows(sessionId=sessionIds.get('terminal'),onlyPending=false) {
  return rows(`select id::text,actor_employee_id::text as actor,action,metadata,created_at::text as created
    from os_audit_logs where metadata->>'terminalSessionId'=$1
      and action ${onlyPending ? "= 'store.inventory_operator_attempt'" : "in ('store.inventory_operator_attempt','store.inventory_operator_attempt_succeeded')"}
      and created_at>now()-interval '10 minutes' order by created_at,id`,[sessionId]);
}

try {
  await db.exec(`
    create table stores(id uuid primary key,name text,status text not null default 'active');
    create table employees(id uuid primary key,name text,login_id text,email text,role text,status text default 'active',
      password_hash text,password_must_change boolean default false,session_version integer default 1,last_seen_at timestamptz);
    create table employee_scopes(employee_id uuid references employees(id),scope_type text,store_id uuid references stores(id));
    create table employee_sessions(id uuid primary key default gen_random_uuid(),employee_id uuid references employees(id),session_version integer,
      surface text,user_agent text,ip_address text,created_at timestamptz default now(),last_seen_at timestamptz default now(),
      expires_at timestamptz,revoked_at timestamptz,revoked_reason text);
    create table role_permissions(role text,permission_key text,is_enabled boolean,primary key(role,permission_key));
    insert into stores values('${ids.store}','A','active'),('${ids.otherStore}','B','active'),('${ids.inactiveStore}','Closed','inactive');
  `);
  const productionAuditDdl=readFileSync(new URL('db/schema.sql',root),'utf8').match(/create table if not exists os_audit_logs \([\s\S]*?\n\);/)?.[0];
  assert.ok(productionAuditDdl,'production audit DDL must exist');await db.exec(productionAuditDdl);
  const passwordHash=auth.hashPassword('Password123');
  for (const [key,id] of Object.entries(ids).filter(([key]) => !['store','otherStore','inactiveStore'].includes(key))) {
    const role=key==='terminal'||key==='otherTerminal' ? 'store_terminal' : ['otherStaff','sameStoreStaff','initialStaff','noPassword'].includes(key) ? 'staff' : key==='initialManager' ? 'store_manager' : key;
    await db.query('insert into employees(id,name,login_id,email,role,password_hash,password_must_change) values($1,$2,$2,$3,$4,$5,$6)',
      [id,key,`${key}@test.invalid`,role,key==='noPassword' ? null : passwordHash,key.startsWith('initial')]);
    const sessionId=uuid(100+Object.keys(ids).indexOf(key));sessionIds.set(key,sessionId);
    await db.query(`insert into employee_sessions(id,employee_id,session_version,surface,expires_at) values($1,$2,1,'store',now()+interval '14 days')`,[sessionId,id]);
    if (!['owner','manager'].includes(role)) {
      await db.query("insert into employee_scopes(employee_id,scope_type,store_id) values($1,'store',$2)",[id,key==='otherStaff' ? ids.otherStore : ids.store]);
      await db.query("insert into employee_scopes(employee_id,scope_type,store_id) values($1,'store',$2)",[id,ids.inactiveStore]);
    }
  }

  await group('real personal sessions preserve actual employee identity and both scope/store validation',async () => {
    for (const role of ['owner','manager','store_owner','store_manager','staff']) {
      useBase(role);
      for (const action of ['read','quick_check','count','receipt','exception_report']) {
        const result=await access.requireStoreInventoryAccess(ids.store,action);
        assert.equal(result.ok,true,role+':'+action);assert.equal(result.actor.id,ids[role]);
        assert.equal(result.operator.expiresAt,null);assert.equal(result.baseSession.sessionId,sessionIds.get(role));
        assert.equal(access.assertExpectedStoreInventoryOperator(result,ids[role]),null);
        await expectError(access.assertExpectedStoreInventoryOperator(result,ids.otherStaff),409,'operator_changed');
        await expectError(access.assertExpectedStoreInventoryOperator(result,undefined),409,'operator_changed');
      }
      if (!['owner','manager'].includes(role)) await expectAccessError(ids.otherStore,'count',403,'store_scope');
      await expectAccessError(ids.inactiveStore,'read',404,'store_inactive');
    }
    await expectAccessError('label','read',400,'store_required');
    await expectAccessError(ids.store,'settings',400,'invalid_action');
    cookieJar.clear();await expectAccessError(ids.store,'read',401,'session_required');
  });

  await group('global writable behavior unchanged; Store grant cannot enable a staff OS module',async () => {
    useBase('staff');assert.equal((await apiAuth.requireWritableOsSession()).id,ids.staff);
    useBase('terminal');assert.equal(await apiAuth.requireWritableOsSession(),null);
    for (const key of ['module.inventory','module.products','module.orders','module.procurement']) await db.query('insert into role_permissions values($1,$2,true)',['staff',key]);
    permissions.clearRolePermissionCache();
    const staffPermissions=await permissions.getPermissionsForRole('staff');
    assert.equal(staffPermissions.has('store.inventory'),true);
    for (const key of ['module.inventory','module.products','module.orders','module.procurement']) assert.equal(staffPermissions.has(key),false,key);
    await db.query("insert into role_permissions values('staff','store.inventory',false)");permissions.clearRolePermissionCache();
    useBase('staff');await expectAccessError(ids.store,'read',403,'inventory_permission');
    await db.query("delete from role_permissions where permission_key='store.inventory'");permissions.clearRolePermissionCache();
  });

  await group('terminal reads have no actor and arbitrary employee IDs never authorize a write',async () => {
    useBase();const read=await access.requireStoreInventoryAccess(ids.store,'read');
    assert.equal(read.ok,true);assert.equal(read.actor,null);assert.equal(read.operator,null);
    for (const action of ['quick_check','count','receipt','exception_report']) await expectAccessError(ids.store,action,401,'operator_required');
    await expectError(access.assertExpectedStoreInventoryOperator(read,ids.staff),401,'operator_required');
    const get=await operator.GET(request('GET',{}, {origin:null}));assert.equal(get.status,200);
    assert.deepEqual(await get.json(),{storeId:ids.store,baseRole:'store_terminal',operator:null,canOperate:false,requiresOperatorAuthentication:true});
    await expectError(await post({employeeId:ids.staff,expectedOperatorId:ids.staff}),400,'credentials_required');
    await expectError(await post({loginId:'staff',password:'x'.repeat(501)}),400,'credentials_required');
  });

  await group('operator password verification rejects inactive/unknown/terminal/initial/wrong-store people',async () => {
    useBase();
    for (const [loginId,password,status,code] of [
      ['staff','wrong',401,'operator_credentials'],['missing','Password123',401,'operator_credentials'],
      ['noPassword','Password123',401,'operator_credentials'],['terminal','Password123',401,'operator_credentials'],
      ['initialStaff','Password123',403,'password_change_required'],['initialManager','Password123',403,'password_change_required'],
      ['otherStaff','Password123',403,'operator_store_scope'],['supplier','Password123',401,'operator_credentials']
    ]) await expectError(await post({loginId,password},{ip:`192.0.2.${groups.length+loginId.length}`}),status,code);
    await ageAttempts();
    await db.query("update employees set status='inactive' where id=$1",[ids.staff]);
    await expectError(await post({loginId:'staff',password:'Password123'},{ip:'192.0.2.22'}),401,'operator_credentials');
    await db.query("update employees set status='active' where id=$1",[ids.staff]);
  });

  await group('successful POST authenticates a scoped actor without Staff session or global cookie mutation',async () => {
    useBase();const before=Number((await rows('select count(*) as count from employee_sessions'))[0].count),base=cookieJar.get(auth.authCookieName);
    const response=await authenticate('staff');const context=await response.json(),cookie=response.headers.get('set-cookie');
    assert.equal(context.operator.id,ids.staff);assert.equal(context.baseRole,'store_terminal');assert.equal(context.canOperate,true);
    assert.match(cookie,/Path=\/api; HttpOnly; SameSite=Lax; Max-Age=900; Secure$/);
    assert.equal(cookie.includes(auth.authCookieName+'='),false);assert.equal(cookieJar.get(auth.authCookieName),base);
    assert.equal(Number((await rows('select count(*) as count from employee_sessions'))[0].count),before);
    assert.equal((await apiAuth.requireOsSession()).id,ids.terminal);
    const proof=tokens.readStoreInventoryOperatorToken(cookieJar.get(tokens.storeInventoryOperatorCookieName),clockNow).value;
    assert.equal(proof.terminalEmployeeId,ids.terminal);assert.equal(proof.terminalSessionId,sessionIds.get('terminal'));
    assert.equal(proof.storeId,ids.store);assert.equal(proof.operatorEmployeeId,ids.staff);assert.equal(proof.operatorSessionVersion,1);
    assert.equal(proof.expiresAt,clockNow+900000);
    const write=await access.requireStoreInventoryAccess(ids.store,'receipt');assert.equal(write.ok,true);assert.equal(write.actor.id,ids.staff);
    assert.equal(access.assertExpectedStoreInventoryOperator(write,ids.staff),null);
    await expectError(access.assertExpectedStoreInventoryOperator(write,ids.terminal),409,'operator_changed');
    const refreshed=await operator.GET(request('GET'));assert.equal((await refreshed.json()).operator.id,ids.staff);
    const verification=audit.find(record => record.action==='store.inventory_operator_verified');assert.equal(verification.actorEmployeeId,ids.staff);
    assert.equal(JSON.stringify(verification.metadata).includes('Password'),false);
  });

  await group('strict Origin guards POST/DELETE before authentication or database effects',async () => {
    useBase();
    for (const method of ['POST','DELETE']) for (const options of [{origin:null},{origin:'https://attacker.test'},{origin:'https://example.test',fetchSite:'cross-site'}]) {
      const before=statements.length,auditBefore=audit.length;
      const response=await operator[method](request(method,{loginId:'staff',password:'Password123'},options));
      await expectError(response,403,'invalid_origin');assert.equal(statements.length,before);assert.equal(audit.length,auditBefore);
    }
    const response=await operator.GET(request('GET',{}, {origin:null}));assert.equal(response.status,200);
  });

  await group('operator proof revalidates employee active state, role, version, password and scope',async () => {
    useBase();await authenticate();
    for (const [change,restore] of [
      ["status='inactive'","status='active'"],["role='store_manager'","role='staff'"],
      ['session_version=2','session_version=1'],['password_must_change=true','password_must_change=false']
    ]) {
      await db.query(`update employees set ${change} where id=$1`,[ids.staff]);
      await expectAccessError(ids.store,'count',401,'operator_required');
      const read=await access.requireStoreInventoryAccess(ids.store,'read');assert.equal(read.ok,true);assert.equal(read.actor,null);
      await db.query(`update employees set ${restore} where id=$1`,[ids.staff]);
      assert.equal((await access.requireStoreInventoryAccess(ids.store,'count')).actor.id,ids.staff);
    }
    await db.query("delete from employee_scopes where employee_id=$1 and store_id=$2",[ids.staff,ids.store]);
    await expectAccessError(ids.store,'count',401,'operator_required');
    await db.query("insert into employee_scopes values($1,'store',$2)",[ids.staff,ids.store]);
    await db.query("insert into role_permissions values('staff','store.inventory',false)");permissions.clearRolePermissionCache();
    await expectAccessError(ids.store,'receipt',401,'operator_required');
    await db.query("delete from role_permissions where permission_key='store.inventory'");permissions.clearRolePermissionCache();
    assert.equal((await access.requireStoreInventoryAccess(ids.store,'receipt')).actor.id,ids.staff);
  });

  await group('proof cannot transfer to another parent session/terminal/store; revoked base sessions stop reads',async () => {
    useBase();await authenticate();const proof=cookieJar.get(tokens.storeInventoryOperatorCookieName);
    cookieJar.set(auth.authCookieName,baseCookie('otherTerminal'));
    await expectAccessError(ids.store,'count',401,'operator_required');
    cookieJar.set(auth.authCookieName,baseCookie('terminal'));
    const secondSession=uuid(250);await db.query("insert into employee_sessions(id,employee_id,session_version,surface,expires_at) values($1,$2,1,'store',now()+interval '1 day')",[secondSession,ids.terminal]);
    cookieJar.set(auth.authCookieName,auth.createSessionToken({...auth.readSessionToken(baseCookie('terminal')),sessionId:secondSession}));
    await expectAccessError(ids.store,'count',401,'operator_required');
    cookieJar.set(auth.authCookieName,baseCookie('terminal'));
    await db.query("insert into employee_scopes values($1,'store',$2)",[ids.terminal,ids.otherStore]);
    await expectAccessError(ids.otherStore,'count',401,'operator_required');
    await db.query("delete from employee_scopes where employee_id=$1 and store_id=$2",[ids.terminal,ids.store]);
    await expectAccessError(ids.store,'count',403,'store_scope');
    await db.query("insert into employee_scopes values($1,'store',$2)",[ids.terminal,ids.store]);
    await db.query('update employee_sessions set revoked_at=now() where id=$1',[sessionIds.get('terminal')]);
    await expectAccessError(ids.store,'read',401,'session_required');
    await db.query('update employee_sessions set revoked_at=null where id=$1',[sessionIds.get('terminal')]);
    await db.query('update employees set session_version=2 where id=$1',[ids.terminal]);
    await expectAccessError(ids.store,'read',401,'session_required');
    await db.query('update employees set session_version=1 where id=$1',[ids.terminal]);
    cookieJar.set(tokens.storeInventoryOperatorCookieName,proof);assert.equal((await access.requireStoreInventoryAccess(ids.store,'count')).actor.id,ids.staff);
    useBase('staff');await db.query("update employee_sessions set expires_at=now()-interval '1 day' where id=$1",[sessionIds.get('staff')]);
    await expectAccessError(ids.store,'read',401,'session_required');
    await db.query("update employee_sessions set expires_at=now()+interval '1 day' where id=$1",[sessionIds.get('staff')]);
  });

  await group('15-minute expiration and forged actor claims require reauthentication without changing the base',async () => {
    useBase();await authenticate();const base=cookieJar.get(auth.authCookieName),proof=cookieJar.get(tokens.storeInventoryOperatorCookieName);
    clockNow+=900000;
    await expectAccessError(ids.store,'count',401,'operator_expired');
    const get=await operator.GET(request('GET'));assert.equal((await get.json()).operator,null);
    assert.equal(cookieJar.get(auth.authCookieName),base);
    const [payload,mac]=proof.split('.');const forged={...JSON.parse(Buffer.from(payload,'base64url').toString()),operatorEmployeeId:ids.owner,expiresAt:clockNow+900000};
    cookieJar.set(tokens.storeInventoryOperatorCookieName,`${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${mac}`);
    await expectAccessError(ids.store,'count',401,'operator_required');
    cookieJar.set(auth.authCookieName,base.slice(0,-1)+(base.endsWith('a') ? 'b' : 'a'));
    await expectAccessError(ids.store,'read',401,'session_required');
  });

  await group('DELETE clears only temporary operator proof and changed operator assertion returns 409',async () => {
    useBase();await authenticate();const base=cookieJar.get(auth.authCookieName);
    await authenticate('sameStoreStaff');
    const current=await access.requireStoreInventoryAccess(ids.store,'count');assert.equal(current.actor.id,ids.sameStoreStaff);
    await expectError(access.assertExpectedStoreInventoryOperator(current,ids.staff),409,'operator_changed');
    const response=await operator.DELETE(request('DELETE'));assert.equal(response.status,200);
    const context=await response.json();assert.equal(context.operator,null);assert.equal(context.requiresOperatorAuthentication,true);
    const cookie=response.headers.get('set-cookie');assert.match(cookie,/^foundr1_store_inventory_operator=; Path=\/api; HttpOnly; SameSite=Lax; Max-Age=0; Secure$/);
    assert.equal(cookie.includes(auth.authCookieName),false);assert.equal(cookieJar.get(auth.authCookieName),base);
    cookieJar.delete(tokens.storeInventoryOperatorCookieName);await expectAccessError(ids.store,'count',401,'operator_required');
    assert.equal((await apiAuth.requireOsSession()).id,ids.terminal);
    useBase('staff');await expectError(await post({loginId:'sameStoreStaff',password:'Password123'}),400,'personal_operator');
    const personalDelete=await operator.DELETE(request('DELETE'));assert.equal(personalDelete.status,200);assert.equal((await personalDelete.json()).operator.id,ids.staff);
    assert.equal((await access.requireStoreInventoryAccess(ids.store,'count')).actor.id,ids.staff);
  });

  await group('persistent eight-attempt quota survives cold instances, rotated IPs and concurrent requests',async () => {
    useBase();
    for(let index=0;index<7;index++) {
      const cold=load('app/api/store/inventory/operator/route.ts');
      await expectError(await cold.POST(request('POST',{loginId:'missing',password:'secret-wrong'},{ip:`198.51.100.${index}`})),401,'operator_credentials');
    }
    const coldA=load('app/api/store/inventory/operator/route.ts'),coldB=load('app/api/store/inventory/operator/route.ts');
    const race=await Promise.all([
      coldA.POST(request('POST',{loginId:'missing',password:'secret-wrong'},{ip:'203.0.113.1'})),
      coldB.POST(request('POST',{loginId:'missing',password:'secret-wrong'},{ip:'203.0.113.2'}))
    ]);
    assert.deepEqual(race.map(response => response.status).sort(),[401,429]);
    assert.equal((await quotaRows(undefined,true)).length,8);
    const allAttemptsBeforeBlocked=(await quotaRows()).length;
    const blocked=await load('app/api/store/inventory/operator/route.ts').POST(request('POST',{loginId:'staff',password:'Password123'},{ip:'203.0.113.3'}));
    await expectError(blocked,429,'operator_rate_limited');assert.equal(blocked.headers.get('set-cookie'),null);
    assert.equal((await quotaRows()).length,allAttemptsBeforeBlocked);
    for(const row of await quotaRows()) {
      assert.equal(row.actor,ids.terminal);
      assert.deepEqual(row.metadata,{terminalSessionId:sessionIds.get('terminal'),storeId:ids.store});
      for(const secret of ['password','loginId','token','secret-wrong','missing'])assert.equal(JSON.stringify(row.metadata).includes(secret),false,secret);
    }
    // Independent authenticated sessions have separate quotas; IP is never the identity.
    useBase('otherTerminal');await authenticate('staff',{ip:'203.0.113.3'});
    useBase();await ageAttempts();await authenticate('staff',{ip:'203.0.113.4'});
    assert.equal((await quotaRows(undefined,true)).length,0);
  });

  await group('successful verification excludes only its own attempt and preserves earlier failures',async () => {
    useBase();
    for(let index=0;index<3;index++)await expectError(await post({loginId:'missing',password:'wrong'},{ip:`success-test-${index}`}),401,'operator_credentials');
    const failuresBefore=await quotaRows(undefined,true);
    for(let index=0;index<3;index++)await authenticate('staff',{ip:`success-good-${index}`});
    const failuresAfter=await quotaRows(undefined,true);
    assert.deepEqual(failuresAfter.map(row=>row.id),failuresBefore.map(row=>row.id));
    assert.equal((await quotaRows()).filter(row=>row.action==='store.inventory_operator_attempt_succeeded').length>=3,true);
    for(let index=0;index<5;index++)await expectError(await post({loginId:'missing',password:'wrong'},{ip:`success-test-later-${index}`}),401,'operator_credentials');
    assert.equal((await quotaRows(undefined,true)).length,8);
    const response=await post({loginId:'staff',password:'Password123'},{ip:'yet-another-ip'});
    await expectError(response,429,'operator_rate_limited');assert.equal(response.headers.get('set-cookie'),null);
  });

  await group('real quota lock/counter errors roll back atomically and missing counters fail closed without cookies',async () => {
    useBase();
    for(const fault of ['lock-after','counter-after','success-before']) {
      const before=(await quotaRows(undefined,true)).length,errorsBefore=expectedSqlFailures.length;
      databaseFault=fault;expectingDatabaseFailure=true;
      let response;
      try {response=await post({loginId:'staff',password:'Password123'});}
      finally {databaseFault=null;expectingDatabaseFailure=false;}
      await expectError(response,503,'operator_unavailable');assert.equal(response.headers.get('set-cookie'),null);
      assert.equal(cookieJar.has(tokens.storeInventoryOperatorCookieName),false);
      assert.equal(expectedSqlFailures.length,errorsBefore+1,fault);
      assert.equal((await quotaRows(undefined,true)).length,before+(fault==='success-before' ? 1 : 0),fault);
    }
    const before=(await quotaRows()).length;
    await db.exec('alter table os_audit_logs rename to isolated_audit_counter_unavailable');
    expectingDatabaseFailure=true;let missing;
    try {missing=await post({loginId:'staff',password:'Password123'});}
    finally {expectingDatabaseFailure=false;await db.exec('alter table isolated_audit_counter_unavailable rename to os_audit_logs');}
    await expectError(missing,503,'operator_unavailable');assert.equal(missing.headers.get('set-cookie'),null);
    assert.equal((await quotaRows()).length,before);
    assert.equal(expectedSqlFailures.length,4);
    // Counter restoration permits the normal password path again.
    await authenticate();
  });

  await group('real login/session SQL admits personal Store users without widening staff OS or initial passwords',async () => {
    cookieJar.clear();
    const loginRequest=(loginId,surface='store') => new Request('https://example.test/api/auth/login',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':'203.0.113.50'},body:JSON.stringify({loginId,password:'Password123',surface})});
    for (const role of ['staff','store_manager','store_owner']) {
      const before=Number((await rows('select count(*) as count from employee_sessions'))[0].count);
      const response=await login.POST(loginRequest(role));assert.equal(response.status,200,await response.clone().text());
      const data=await response.json();assert.equal(data.employee.role,role);assert.equal(data.employee.permissions.includes('store.inventory'),true);
      const cookie=response.headers.get('set-cookie');assert.ok(cookie.startsWith(auth.authCookieName+'='));assert.equal(cookie.includes(tokens.storeInventoryOperatorCookieName),false);
      const token=cookie.split(';')[0].slice(auth.authCookieName.length+1),proof=auth.readSessionToken(token);
      assert.equal(proof.id,ids[role]);assert.ok(proof.sessionId);
      assert.equal((await rows('select surface,employee_id::text from employee_sessions where id=$1',[proof.sessionId]))[0].surface,'store');
      assert.equal(Number((await rows('select count(*) as count from employee_sessions'))[0].count),before+1);
      cookieJar.set(auth.authCookieName,token);assert.equal((await access.requireStoreInventoryAccess(ids.store,'count')).actor.id,ids[role]);
      if (role==='staff') for (const forbidden of ['module.inventory','module.orders','module.products','module.procurement']) assert.equal(data.employee.permissions.includes(forbidden),false,forbidden);
    }
    assert.equal((await login.POST(loginRequest('staff','os'))).status,403);
    assert.equal((await login.POST(loginRequest('supplier'))).status,403);
    for (const key of ['initialStaff','initialManager']) {
      const before=Number((await rows('select count(*) as count from employee_sessions'))[0].count);
      const response=await login.POST(loginRequest(key));assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);
      const data=await response.json();assert.equal(data.requiresPasswordChange,true);assert.ok(auth.readPasswordActionToken(data.passwordChangeToken,'initial_change'));
      assert.equal(Number((await rows('select count(*) as count from employee_sessions'))[0].count),before);
    }
    await db.query("insert into role_permissions values('staff','store.inventory',false)");permissions.clearRolePermissionCache();
    const before=Number((await rows('select count(*) as count from employee_sessions'))[0].count);
    const denied=await login.POST(loginRequest('staff'));assert.equal(denied.status,403);assert.equal(denied.headers.get('set-cookie'),null);
    assert.equal(Number((await rows('select count(*) as count from employee_sessions'))[0].count),before);
    await db.query("delete from role_permissions where permission_key='store.inventory'");permissions.clearRolePermissionCache();
  });

  assert.equal(sqlFailures.length,0,JSON.stringify(sqlFailures));
  console.log(`PASS all ${groups.length} isolated Store identity groups (${statements.length} actual SQL statements; ${expectedSqlFailures.length} deliberate database failure cases)`);
} catch (error) {
  console.error(error);if(sqlFailures.length)console.error(JSON.stringify(sqlFailures,null,2));process.exitCode=1;
} finally { await db.close(); }
