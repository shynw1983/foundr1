// Actual QR routes, session validation and SQL against disposable PostgreSQL only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
const require = createRequire(process.env.FOUNDR1_TEST_REQUIRE_FROM || import.meta.url);
const ts = require('typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const root = process.cwd(), modules = new Map(), cookieValues = new Map();
const sql = async (parts, ...values) => (await db.query(parts.reduce((query, part, i) => query + part + (i < values.length ? `$${i + 1}` : ''), ''), values)).rows;
function load(file) {
  file = resolve(root, file);
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText, {
    exports, Request, Response, URL, Buffer, console, Date, TextEncoder, TextDecoder,
    crypto: webcrypto, atob, btoa, process: { env: { AUTH_SECRET: 'isolated-terminal-test-only' } },
    require: name => {
      if (name.endsWith('/db')) return { sql };
      if (name === 'next/headers') return { cookies: async () => ({ get: key => cookieValues.has(key) ? { value: cookieValues.get(key) } : undefined }) };
      if (name.endsWith('/role-permissions')) return {
        getPermissionsForRole: async () => new Set(['store.workbench']),
        getNavPathsForPermissions: () => ['/os', '/store']
      };
      if (name.startsWith('.')) return load(resolve(dirname(file), name + '.ts'));
      return require(name);
    }
  });
  return exports;
}
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const storeA = id(1), storeB = id(2), closedStore = id(3), emptyStore = id(4), unconfiguredStore = id(5);
const ownerId = id(10), scopedId = id(11), terminalA = id(20), terminalB = id(21), terminalOther = id(22), disabledId = id(23);
const auth = load('lib/auth.ts'), sessions = load('lib/employee-sessions.ts'), apiAuth = load('lib/api-auth.ts');
const login = load('lib/store-terminal-login.ts');
const approve = load('app/api/store/terminal-login/approve/route.ts');
const status = load('app/api/store/terminal-login/status/route.ts');
const requestRoute = load('app/api/store/terminal-login/request/route.ts');
const proxy = load('proxy.ts').default;
const deviceRequest = name => new Request('https://fixture.test/api/store/terminal-login/request', { method: 'POST', headers: { 'user-agent': name } });
let currentEmployee;
async function signIn(employeeId, role) {
  currentEmployee = { id: employeeId, name: role, loginId: `test-${employeeId}`, role, sessionVersion: 1 };
  await sql`update employees set role = ${role} where id = ${employeeId}`;
  currentEmployee.sessionId = await sessions.createEmployeeSession({ employeeId, role, sessionVersion: 1, surface: 'os', request: deviceRequest('approver') });
  cookieValues.set(auth.authCookieName, auth.createSessionToken(currentEmployee));
}
const getOptions = token => approve.GET(new Request(`https://fixture.test/api/store/terminal-login/approve?token=${token}`));
const post = (token, storeId = storeA, terminalEmployeeId = terminalB) => approve.POST(new Request('https://fixture.test/api/store/terminal-login/approve', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, storeId, terminalEmployeeId })
}));
const poll = (token, device = 'device-a') => status.GET(new Request(`https://fixture.test/api/store/terminal-login/status?token=${token}`, { headers: { 'user-agent': device } }));
async function newQr() {
  const response = await requestRoute.POST(deviceRequest('fixture-device'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.qrCodeDataUrl, /^data:image\/png;base64,/);
  assert.equal(new URL(body.approveUrl).pathname, '/os/store-terminal-login');
  assert.equal(new URL(body.approveUrl).searchParams.get('token'), body.token);
  return body.token;
}
async function pageRequest(role, path = '/os/store-terminal-login?token=fixture-qr') {
  const { NextRequest } = require('next/server');
  const cookie = role ? `${auth.authCookieName}=${auth.createSessionToken({ ...currentEmployee, role })}` : '';
  return proxy(new NextRequest(`https://fixture.test${path}`, { headers: { cookie } }));
}
try {
  await db.exec(`
    create table stores(id uuid primary key,name text,status text default 'active');
    create table employees(id uuid primary key,name text,login_id text,email text,role text,status text default 'active',session_version integer default 1,last_seen_at timestamptz);
    create table employee_scopes(employee_id uuid,scope_type text,store_id uuid);
  `);
  const schema = readFileSync('db/schema.sql', 'utf8');
  for (const table of ['employee_sessions', 'store_terminal_login_requests', 'os_audit_logs']) {
    const statement = schema.match(new RegExp(`create table if not exists ${table} \\([\\s\\S]*?\\n\\);`));
    assert.ok(statement, `schema missing ${table}`);
    await db.exec(statement[0]);
  }
  await sql`insert into stores(id,name,status) values (${storeA},'店舗 A','active'),(${storeB},'店舗 B','active'),(${closedStore},'Closed','inactive'),(${emptyStore},'店舗 C','active'),(${unconfiguredStore},'店舗 D','active')`;
  for (const [employeeId, name, role, storeId, state] of [
    [ownerId,'Owner','owner',null,'active'], [scopedId,'Scoped','store_owner',storeA,'active'],
    [terminalA,'レジ 1','store_terminal',storeA,'active'], [terminalB,'厨房 2','store_terminal',storeA,'active'],
    [terminalOther,'レジ 1','store_terminal',storeB,'active'], [disabledId,'Disabled','store_terminal',storeA,'inactive'],
    [id(24),'Closed terminal','store_terminal',closedStore,'active'], [id(25),'Personal','staff',storeA,'active'],
    [id(26),'Personal only','staff',emptyStore,'active'], [id(27),'Disabled only','store_terminal',emptyStore,'inactive']
  ]) {
    await sql`insert into employees(id,name,login_id,role,status) values (${employeeId},${name},${'test-'+employeeId},${role},${state})`;
    if (storeId) await sql`insert into employee_scopes values (${employeeId},'store',${storeId})`;
  }
  const token = await newQr();
  assert.equal((await getOptions(token)).status, 401);
  assert.equal((await post(token)).status, 401);
  const anonymous = await pageRequest(null);
  assert.equal(new URL(anonymous.headers.get('location')).searchParams.get('next'), '/os/store-terminal-login?token=fixture-qr');
  await signIn(ownerId, 'owner');
  for (const role of ['owner','manager','store_owner','store_manager']) {
    const response = await pageRequest(role);
    assert.equal(response.headers.get('x-middleware-next'), '1', `${role} must reach scanned approval page`);
    const neighbor = await pageRequest(role, '/os/store-terminal-login/unrelated');
    assert.ok(neighbor.headers.get('location'), 'Exception must be exact-path only');
  }
  for (const role of ['staff','store_terminal']) assert.ok((await pageRequest(role)).headers.get('location'));
  const all = await (await getOptions(token)).json();
  assert.equal(all.stores.length, 4);
  assert.deepEqual(all.stores.find(s => s.id === storeA).terminalAccounts.map(t => t.id).sort(), [terminalA,terminalB].sort());
  for (const storeId of [emptyStore, unconfiguredStore]) assert.deepEqual(all.stores.find(s => s.id === storeId).terminalAccounts, []);
  cookieValues.set(apiAuth.osStoreContextCookieName, storeB);
  for (const role of ['owner','manager']) {
    await signIn(ownerId, role);
    assert.deepEqual((await (await getOptions(token)).json()).stores.map(s => s.id), [storeA,storeB,emptyStore,unconfiguredStore], `${role} sees all active stores despite the OS context`);
    const contextQr = await newQr();
    assert.equal((await post(contextQr, closedStore, id(24))).status, 403);
    assert.equal((await post(contextQr, emptyStore, id(27))).status, 400);
    assert.equal((await post(contextQr, unconfiguredStore, terminalB)).status, 400);
    assert.equal((await post(contextQr, storeA, terminalOther)).status, 400);
    assert.equal((await post(contextQr, storeA)).status, 200, `${role} can assign a different store from the OS context`);
    const assigned = await poll(contextQr);
    assert.equal(auth.readSessionToken(assigned.headers.get('set-cookie').split(';')[0].split('=')[1]).id, terminalB);
    await sql`update employee_sessions set revoked_at = now() where employee_id = ${terminalB}`;
  }
  const auditBaseline = (await sql`select count(*)::int as count from os_audit_logs where action = 'auth.store_terminal_qr_approved'`)[0].count;
  for (const role of ['store_owner','store_manager']) {
    await signIn(scopedId, role);
    // A cross-store OS cookie must never widen a scoped user's authority.
    assert.deepEqual((await (await getOptions(token)).json()).stores.map(s => s.id), [storeA]);
    assert.equal((await post(token, storeB, terminalOther)).status, 403);
    assert.equal((await post(token, storeA, terminalOther)).status, 400);
    assert.equal((await post(token, storeA, disabledId)).status, 400);
    assert.equal((await post(token, storeA, id(25))).status, 400);
    assert.equal((await post(token, storeA, '')).status, 400);
    await sql`insert into employee_scopes values (${scopedId},'store',${emptyStore})`;
    assert.deepEqual((await (await getOptions(token)).json()).stores.map(s => s.id), [storeA,emptyStore]);
    assert.equal((await post(token, emptyStore, id(27))).status, 400);
    await sql`delete from employee_scopes where employee_id = ${scopedId} and store_id = ${emptyStore}`;
  }
  cookieValues.delete(apiAuth.osStoreContextCookieName);
  await signIn(scopedId, 'staff');
  assert.equal((await getOptions(token)).status, 403);
  assert.equal((await post(token)).status, 403);
  await signIn(ownerId, 'owner');
  await sql`update employees set status = 'inactive' where id = ${ownerId}`;
  assert.equal((await post(token)).status, 401);
  await sql`update employees set status = 'active' where id = ${ownerId}`;
  const result = await post(token);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).terminalName, '厨房 2');
  const saved = (await sql`select * from store_terminal_login_requests where token_hash = ${login.hashTerminalLoginToken(token)}`)[0];
  assert.equal(saved.terminal_employee_id, terminalB);
  assert.equal(saved.store_id, storeA);
  assert.equal(saved.approved_by, ownerId);
  assert.equal((await sql`select count(*)::int as count from os_audit_logs where action = 'auth.store_terminal_qr_approved'`)[0].count, auditBaseline + 1);
  assert.equal((await post(token)).status, 400);
  const first = await poll(token);
  assert.equal((await first.json()).status, 'authenticated');
  const firstToken = first.headers.get('set-cookie').split(';')[0].split('=')[1];
  assert.equal(auth.readSessionToken(firstToken).id, terminalB);
  assert.equal(auth.readSessionToken(firstToken).role, 'store_terminal');
  assert.equal((await poll(token)).headers.get('set-cookie'), null);
  const secondQr = await newQr();
  assert.equal((await post(secondQr)).status, 200);
  const second = await poll(secondQr, 'device-b');
  const secondToken = second.headers.get('set-cookie').split(';')[0].split('=')[1];
  assert.notEqual(auth.readSessionToken(firstToken).sessionId, auth.readSessionToken(secondToken).sessionId);
  for (const tokenValue of [firstToken,secondToken]) {
    cookieValues.set(auth.authCookieName, tokenValue);
    assert.equal((await apiAuth.requireOsSession()).id, terminalB, 'Both machine sessions stay valid');
  }
  assert.equal((await post(await newQr())).status, 403, 'Device account cannot approve another login');
  await sessions.createEmployeeSession({ employeeId: terminalB, role: 'store_terminal', sessionVersion: 1, surface: 'store', request: deviceRequest('device-c') });
  assert.equal((await sql`select count(*)::int as count from employee_sessions where employee_id = ${terminalB} and revoked_at is null`)[0].count, 3);
  await signIn(ownerId, 'owner');
  const expired = await newQr();
  await sql`update store_terminal_login_requests set expires_at = now() - interval '1 second' where token_hash = ${login.hashTerminalLoginToken(expired)}`;
  assert.equal((await getOptions(expired)).status, 400);
  assert.equal((await post(expired)).status, 400);
  assert.equal((await (await poll(expired)).json()).status, 'expired');
  const changed = await newQr();
  assert.equal((await getOptions(changed)).status, 200);
  await sql`update employees set status = 'inactive' where id = ${terminalA}`;
  assert.equal((await post(changed, storeA, terminalA)).status, 400, 'Account status rechecked after listing');
  assert.equal((await post(changed)).status, 200);
  await sql`update employees set status = 'inactive' where id = ${terminalB}`;
  assert.equal((await poll(changed)).headers.get('set-cookie'), null, 'Disabled account cannot obtain a session');
  console.log('PASS: QR image/link, exact page access for four approver roles, login return path, live session checks, headquarters all-store assignment independent of OS context, scoped cross-store denial, empty active stores visible without eligible accounts, explicit existing account, persistence/audit, one-use QR, expiry, disabled accounts, and multiple simultaneous terminal sessions.');
} finally {
  await db.close();
}
