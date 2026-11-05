import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";

const pglitePath = process.env.PGLITE_MODULE || "../outputs/inventory-reference-implementation-20261014/test-deps/node_modules/@electric-sql/pglite/dist/index.js";
const { PGlite } = await import(pglitePath);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const roles = ["owner", "manager", "store_owner", "store_manager", "staff", "store_terminal"];
function load(file: string, dependencies: Record<string, unknown> = {}) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, { exports, Response, Request, Headers, URL, Buffer, TextEncoder, TextDecoder, atob, btoa,
    crypto: crypto.webcrypto, process: { env: { AUTH_SECRET: "isolated-permission-tests" } },
    require(name: string) { if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; }
  });
  return exports;
}
const hours = load("./store-business-hours.ts") as unknown as typeof import("./store-business-hours");
const policy = load("./store-settings-policy.ts", { "./store-business-hours": hours }) as unknown as typeof import("./store-settings-policy");
const workbench = load("./store-inventory-policy.ts");

async function fixture() {
  const db = new PGlite();
  await db.exec(`create table role_permissions(role text,permission_key text,is_enabled boolean,updated_at timestamptz default now(),primary key(role,permission_key));
    create table employees(id uuid primary key, role text);
    create table employee_scopes(employee_id uuid,scope_type text,store_id uuid);
    create table employee_work_stores(employee_id uuid,store_id uuid);
    create table stores(id uuid primary key,name text,status text default 'active',updated_at timestamptz default now(),business_hours jsonb default '{}',reservation_note text default '',
      weather_location_name text default '',weather_latitude numeric,weather_longitude numeric,attendance_location_enabled boolean default false,
      attendance_latitude numeric,attendance_longitude numeric,attendance_radius_meters int default 100,attendance_accuracy_threshold_meters int default 100,
      payment_account text default 'preserved-secret',company_id uuid,payroll_closing_day int default 25, payroll_cycle_type text default 'specified_day', prescribed_monthly_work_minutes int default 10428, social_insurance_prefecture text default '福岡県', social_insurance_deduction_timing text default 'next_month', shift_first_half_submission_deadline_day int default 25, shift_second_half_submission_deadline_day int default 10, shift_submission_deadline_time time default '18:00');
    insert into stores(id,name) values('${id(1)}','Local'),('${id(2)}','Other');
    insert into employees values('${id(10)}','store_owner'),('${id(11)}','staff'),('${id(12)}','staff'),('${id(13)}','staff');
    insert into employee_scopes values('${id(10)}','store','${id(1)}'),('${id(11)}','store','${id(1)}'),('${id(12)}','store','${id(1)}'),('${id(12)}','store','${id(2)}');
    insert into employee_work_stores values('${id(11)}','${id(1)}'),('${id(13)}','${id(2)}');`);
  const queries: string[] = [];
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, "");
    queries.push(query);
    return (await db.query(query, values)).rows;
  };
  const permissions = load("./role-permissions.ts", { "./db": { sql } }) as unknown as typeof import("./role-permissions");
  const state = { session: { id: id(10), role: "store_owner", name: "Local Owner", loginId: "local", sessionVersion: 1 } as import("./auth").EmployeeSession | null };
  const apiAuth = {
    requireOsSession: async () => state.session,
    getSessionStoreScope: async () => ({ allStores: state.session?.role === "owner" || state.session?.role === "manager", storeIds: [id(1)] })
  };
  const staff = load("./staff-admin-access.ts", { "./api-auth": apiAuth, "./role-permissions": permissions, "./db": { sql } }) as unknown as typeof import("./staff-admin-access");
  const audits: unknown[] = [];
  const route = load("../app/api/stores/scoped-settings/route.ts", {
    "../../../../lib/api-auth": apiAuth, "../../../../lib/role-permissions": permissions, "../../../../lib/db": { sql },
    "../../../../lib/audit-log": { writeAuditLog: async (input: unknown) => { audits.push(input); } },
    "../../../../lib/store-settings-policy": policy, "../../../../lib/store-business-hours": hours
  }) as unknown as typeof import("../app/api/stores/scoped-settings/route");
  return { db, sql, permissions, staff, state, route, audits, queries };
}

function input(revision: string) {
  return { storeId: id(1), revision, businessHours: hours.defaultBusinessHours, reservationNote: "Local note", attendanceAddress: "Local address",
    attendanceLocationEnabled: true, attendanceLatitude: 33.5, attendanceLongitude: 130.4, attendanceRadiusMeters: 100, attendanceAccuracyThresholdMeters: 100 };
}
const patch = (body: unknown) => new Request("https://example.test/api/stores/scoped-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("scoped store settings persist only allowed fields, preserve headquarters settings, and reject cross-store and stale writes", async () => {
  const f = await fixture();
  try {
    const read = await (await f.route.GET()).json();
    assert.equal(read.stores.length, 1);
    assert.equal(read.stores[0].id, id(1));
    assert.equal(read.stores[0].payment_account, undefined);
    const body = input(read.stores[0].revision);
    assert.equal((await f.route.PATCH(patch({ ...body, storeId: id(2) }))).status, 403);
    assert.equal((await f.route.PATCH(patch({ ...body, payrollClosingDay: 1 }))).status, 400);
    assert.equal((await f.route.PATCH(patch(body))).status, 200);
    const rows = await f.db.query("select reservation_note,payment_account,payroll_closing_day from stores where name='Local'");
    assert.equal(rows.rows[0].reservation_note, "Local note");
    assert.equal(rows.rows[0].payment_account, "preserved-secret");
    assert.equal(rows.rows[0].payroll_closing_day, 25);
    assert.equal(f.audits.length, 1);
    assert.equal((await f.route.PATCH(patch(body))).status, 409);
    await f.db.exec(`delete from employee_scopes where employee_id='${id(10)}'`);
    const reread = await (await f.route.GET()).json();
    assert.equal((await f.route.PATCH(patch(input(reread.stores[0].revision)))).status, 409, "write must recheck current assignment even if scope snapshot is stale");
  } finally { await f.db.close(); }
});

test("store settings respect saved permission revocation, read-only access, anonymous sessions and restricted roles", async () => {
  const f = await fixture();
  try {
    const read = await (await f.route.GET()).json();
    await f.db.exec("insert into role_permissions values ('store_owner','stores.manageSettings',false,now())");
    assert.equal((await (await f.route.GET()).json()).canEdit, false);
    assert.equal((await f.route.PATCH(patch(input(read.stores[0].revision)))).status, 403);
    assert.ok(await f.staff.requireStaffAdminSession());
    await f.db.exec("insert into role_permissions values ('store_owner','staff.manage',false,now())");
    assert.equal(await f.staff.requireStaffAdminSession(), null, "staff management revocation bypasses cached grants");
    for (const role of ["staff", "store_terminal"]) {
      f.state.session!.role = role;
      assert.equal((await f.route.GET()).status, 403);
      assert.equal((await f.route.PATCH(patch(input(read.stores[0].revision)))).status, 403);
    }
    f.state.session = null;
    assert.equal((await f.route.GET()).status, 401);
    assert.equal((await f.route.PATCH(patch(input(read.stores[0].revision)))).status, 401);
  } finally { await f.db.close(); }
});

test("store settings validation rejects invalid hours, incomplete geofences and headquarters field injection", () => {
  const valid = input("revision");
  for (const field of ["companyId", "name", "brands", "paymentAccount", "payrollClosingDay", "secretKey"]) assert.throws(() => policy.parseScopedStoreSettings({ ...valid, [field]: "injected" }));
  assert.throws(() => policy.parseScopedStoreSettings({ ...valid, businessHours: { ...valid.businessHours, mon: { open: "29:99", close: "20:00", closed: false } } }));
  assert.throws(() => policy.parseScopedStoreSettings({ ...valid, attendanceLatitude: null }));
  assert.throws(() => policy.parseScopedStoreSettings({ ...valid, attendanceLongitude: 181 }));
  assert.throws(() => policy.parseScopedStoreSettings({ ...valid, attendanceRadiusMeters: 1 }));
  assert.equal(policy.parseScopedStoreSettings(valid).storeId, id(1));
});

test("restricted personal roles cannot call Store reception or availability writes hidden from their workbench", async () => {
  for (const file of ["../app/api/store/operations/route.ts", "../app/api/store/menu-settings/route.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const role of [null, "staff", "store_manager"]) {
      const dependencies: Record<string, unknown> = Object.fromEntries(Array.from(source.matchAll(/from\s+["']([^"']+)["']/g), match => [match[1], {}]));
      dependencies["next/server"] = { NextResponse: Response };
      dependencies["../../../../lib/api-auth"] = { requireOsSession: async () => role ? { role } : null };
      dependencies["../../../../lib/store-inventory-policy"] = workbench;
      const route = load(file, dependencies) as unknown as { PATCH(request: Request): Promise<Response> };
      const response = await route.PATCH(patch({ storeId: id(1), reservationsEnabled: false }));
      assert.equal([401, 403].includes(response.status), true, `${file}:${role}`);
    }
  }
});

test("temporary closure management uses the same read and write permissions as the scoped settings form", async () => {
  let canEdit = false;
  let scope = false;
  let writes = 0;
  const route = load("../app/api/os/store-temporary-closures/route.ts", {
    "next/server": { NextResponse: Response },
    "../../../../lib/api-auth": { requireOsSession: async () => ({ id: id(10), role: "store_owner" }), canAccessStore: async () => scope },
    "../../../../lib/role-permissions": { getPermissionsForRole: async () => new Set(["module.storeSettings", ...(canEdit ? ["stores.manageSettings"] : [])]) },
    "../../../../lib/store-temporary-closures": {
      getUpcomingTemporaryClosures: async () => [], getAffectedOrdersForTemporaryClosures: async () => [],
      createTemporaryClosure: async () => { writes++; }, cancelTemporaryClosure: async () => { writes++; }
    }
  }) as unknown as typeof import("../app/api/os/store-temporary-closures/route");
  const request = patch({ action: "create_temporary_closure", storeId: id(1) });
  assert.equal((await route.PATCH(request.clone())).status, 403);
  scope = true;
  assert.equal((await route.GET(new Request(`https://example.test/?storeId=${id(1)}`))).status, 200);
  assert.equal((await route.PATCH(request.clone())).status, 403);
  canEdit = true;
  assert.equal((await route.PATCH(request.clone())).status, 200);
  assert.equal(writes, 1);
});

test("staff hierarchy and complete existing assignments protect headquarters and shared staff", async () => {
  const f = await fixture();
  try {
    for (const role of ["store_owner", "store_manager"]) {
      const access = { session: { ...f.state.session!, role }, permissions: new Set(["staff.manage"]), allStores: false, storeIds: [id(1)] };
      for (const target of roles) {
        const allowed = ["staff", "store_terminal"].includes(target);
        assert.equal(f.staff.canAssignStaffRole(access, target), allowed, `${role} create ${target}`);
        assert.equal(f.staff.canManageTargetRole(access, target), allowed, `${role} edit ${target}`);
      }
      const ids = await f.staff.getManageableStaffIds(access, [id(11), id(12), id(13)]);
      assert.deepEqual(Array.from(ids), [id(11)]);
      assert.equal(f.staff.hasValidScopedStoreSelection(access, [id(1)], [id(2)]), false);
    }
    const manager = { session: { ...f.state.session!, role: "manager" }, permissions: new Set(["staff.manage"]), allStores: true, storeIds: [] };
    assert.equal(f.staff.canManageTargetRole(manager, "manager"), true);
    assert.equal(f.staff.canManageTargetRole(manager, "store_owner"), true);
    assert.equal(f.staff.canManageTargetRole(manager, "owner"), false);
    assert.equal(f.staff.canAssignStaffRole(manager, "manager"), false);
    assert.equal(f.staff.canAssignStaffRole(manager, "store_owner"), true);
    if (existsSync(new URL("./pos-pin-admin-access.ts", import.meta.url))) {
    const pin = load("./pos-pin-admin-access.ts", { "./api-auth": {}, "./role-permissions": {} }) as unknown as { canResetPosPinTarget(access: typeof pinAccess, role: string): boolean };
    const pinAccess = { ...manager, permissions: new Set(["pos.resetPin"]) };
    assert.equal(pin.canResetPosPinTarget(pinAccess, "staff"), true);
    assert.equal(pin.canResetPosPinTarget(pinAccess, "store_owner"), false, "broader employee editing must not widen database PIN-reset policy");
    assert.equal(pin.canResetPosPinTarget(pinAccess, "manager"), false);
    }
  } finally { await f.db.close(); }
});

test("OS routing uses live grants, does not let /os authorize its descendants, and preserves revoked signed-session boundaries", async () => {
  let granted = new Set(["module.orders"]);
  const permissions = load("./role-permissions.ts", { "./db": { sql: async () => [] } }) as unknown as typeof import("./role-permissions");
  const proxy = load("../proxy.ts", {
    "next/server": { NextResponse: { next: () => ({ kind: "next" }), redirect: (url: URL) => ({ kind: "redirect", path: url.pathname }) } },
    "./lib/store-terminal-login-policy": load("./store-terminal-login-policy.ts", {}),
    "./lib/store-inventory-policy": workbench,
    "./lib/role-permissions": { ...permissions, getPermissionsForRole: async () => granted }
  }).default as (request: unknown) => Promise<{ kind: string; path?: string }>;
  const payload = Buffer.from(JSON.stringify({ role: "store_owner", sessionId: id(10), expiresAt: Date.now() + 60000, permittedNavPaths: ["/os", "/os/settings"] })).toString("base64url");
  const token = `${payload}.${crypto.createHmac("sha256", "isolated-permission-tests").update(payload).digest("base64url")}`;
  async function visit(path: string) {
    const url = new URL(`https://example.test${path}`) as URL & { clone(): URL };
    url.clone = () => new URL(url.href);
    return proxy({ nextUrl: url, method: "GET", headers: new Headers(), cookies: { get: () => ({ value: token }) } });
  }
  assert.equal((await visit("/os")).kind, "next");
  assert.equal((await visit("/os/orders")).kind, "next");
  for (const path of ["/os/settings", "/os/stores", "/os/menus", "/os/orders-extra"]) assert.equal((await visit(path)).kind, "redirect", path);
  granted = new Set(["module.storeSettings"]);
  assert.equal((await visit("/os/stores")).kind, "next", "new live grant works without a login refresh");
  assert.equal((await visit("/os/orders")).kind, "redirect", "revocation applies to the existing token");
});

test("scoped roles cannot enable headquarters master permissions even when saved, and migration changes only scoped staff management", async () => {
  const f = await fixture();
  try {
    await f.db.exec("insert into role_permissions values ('store_owner','module.masterData',true,now()),('store_owner','staff.manage',false,now()),('store_owner','pos.refund',false,now())");
    assert.equal((await f.permissions.getPermissionsForRole("store_owner", { fresh: true })).has("module.masterData"), false);
    for (const role of ["store_owner", "store_manager", "staff", "store_terminal"]) assert.equal(f.permissions.normalizePermissionKeys(role, ["stores.manageMasterData"]).includes("stores.manageMasterData"), false);
    await f.db.exec(readFileSync(new URL("../db/migrations/20261028_scoped_store_permissions.sql", import.meta.url), "utf8"));
    const rows = await f.db.query("select permission_key,is_enabled from role_permissions where role='store_owner' order by permission_key");
    assert.equal(rows.rows.find((r: Record<string, unknown>) => r.permission_key === "staff.manage")?.is_enabled, true);
    assert.equal(rows.rows.find((r: Record<string, unknown>) => r.permission_key === "pos.refund")?.is_enabled, false);
  } finally { await f.db.close(); }
});


test("franchise owners and store managers read and save all original payroll settings only within their store", async () => {
  const f = await fixture();
  try {
    for (const role of ["store_owner", "store_manager"]) {
      f.state.session!.role = role;
      const read = await (await f.route.GET()).json();
      const payroll = { ...read.stores[0].payroll, payrollCycleType: "specified_day", payrollClosingDay: 20,
        prescribedMonthlyWorkMinutes: 10380, socialInsurancePrefecture: "東京都", socialInsuranceDeductionTiming: "current_month",
        shiftFirstHalfSubmissionDeadlineDay: 24, shiftSecondHalfSubmissionDeadlineDay: 9, shiftSubmissionDeadlineTime: "17:30" };
      const body = { ...input(read.stores[0].revision), payroll };
      if (role === "store_owner") assert.equal(read.stores[0].payroll.prescribedMonthlyWorkMinutes, 10428);
      for (const bad of [{ payrollClosingDay: 31 }, { shiftFirstHalfSubmissionDeadlineDay: 29 }, { shiftSubmissionDeadlineTime: "25:00" }, { socialInsurancePrefecture: "unknown" }, { prescribedMonthlyWorkMinutes: -1 }, { paymentAccount: "injected" }]) {
        assert.equal((await f.route.PATCH(patch({ ...body, payroll: { ...payroll, ...bad } }))).status, 400);
      }
      assert.equal((await f.route.PATCH(patch({ ...body, storeId: id(2) }))).status, 403);
      assert.equal((await f.route.PATCH(patch(body))).status, 200);
      const after = await (await f.route.GET()).json();
      assert.deepEqual(JSON.parse(JSON.stringify(after.stores[0].payroll)), JSON.parse(JSON.stringify(payroll)));
      assert.equal((await f.route.PATCH(patch(body))).status, 409);
      const other = (await f.db.query("select payroll_closing_day,payment_account from stores where name='Other'")).rows[0];
      assert.equal(other.payroll_closing_day, 25);
      assert.equal(other.payment_account, "preserved-secret");
      const monthEnd = { ...input(after.stores[0].revision), payroll: { ...payroll, payrollCycleType: "month_end", payrollClosingDay: 20, prescribedMonthlyWorkMinutes: null } };
      assert.equal((await f.route.PATCH(patch(monthEnd))).status, 200);
      const final = await (await f.route.GET()).json();
      assert.equal(final.stores[0].payroll.payrollClosingDay, 31);
      assert.equal(final.stores[0].payroll.prescribedMonthlyWorkMinutes, null);
    }
  } finally { await f.db.close(); }
});
