import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";

function load(path: string, modules: Record<string, unknown> = {}) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, {
    exports, Buffer, Response, Request, URL, Headers, TextEncoder, TextDecoder, atob, btoa,
    crypto: crypto.webcrypto, process: { env: { AUTH_SECRET: "theme-test" } },
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected theme dependency: ${name}`);
      return modules[name];
    }
  });
  return exports;
}
const palette = load("./store-theme.ts");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const employee = (role: string) => ({ id: id(1), sessionId: id(2), role, name: "Operator", loginId: "operator", sessionVersion: 1 });

function fixture(options: { allStores?: boolean; ids?: string[]; granted?: boolean; rows?: unknown[]; brand?: {name:string;logoUrl:string;primaryColor:string} | null } = {}) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  let permissionChecks = 0;
  const settings = load("./store-theme-settings.ts", {
    "node:crypto": crypto, "./store-theme": palette,
    "./store-display-brand": {getStoreDisplayBrand:async () => options.brand ?? null},
    "./api-auth": { getSessionStoreScope: async () => ({ allStores: options.allStores ?? false, storeIds: options.ids ?? [id(3)] }) },
    "./role-permissions": { roleHasPermission: async (_role: string, key: string) => { permissionChecks++; assert.equal(key, "store.theme.manage"); return options.granted ?? false; } },
    "./db": { sql: async (parts: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: parts.join("?"), values });
      return options.rows ?? [{ id: id(3), name: "Store A" }];
    } }
  }) as unknown as typeof import("./store-theme-settings");
  return { settings, calls, permissionChecks: () => permissionChecks };
}

test("only authorized management roles can manage Store themes, even if staff/terminal receive stale grants", async () => {
  const granted = fixture({ granted: true });
  for (const role of ["owner", "manager", "store_owner", "store_manager"]) assert.equal(await granted.settings.canManageStoreTheme(employee(role)), true, role);
  for (const role of ["staff", "store_terminal", "supplier", "", "OWNER"]) assert.equal(await granted.settings.canManageStoreTheme(employee(role)), false, role);
  assert.equal(granted.permissionChecks(), 4);
  for (const role of ["manager", "store_owner", "store_manager"]) assert.equal(await fixture().settings.canManageStoreTheme(employee(role)), false, role);
});

test("theme context selects a verified active scoped store and rejects malformed, inactive or out-of-scope targets", async () => {
  const f = fixture({ rows: [{ id: id(3), name: "Store A" }, { id: id(4), name: "Store B" }], ids: [id(3), id(4)] });
  assert.equal((await f.settings.getStoreThemeAccess(employee("staff"))).storeId, id(3));
  assert.equal((await f.settings.getStoreThemeAccess(employee("staff"), id(4))).storeName, "Store B");
  assert.match(f.calls[0].text, /status = 'active'[\s\S]*id::text = any/);
  assert.deepEqual(f.calls[0].values[0], [id(3), id(4)]);
  await assert.rejects(f.settings.getStoreThemeAccess(employee("owner"), id(99)), (error: unknown) => (error as {status:number}).status === 403);
  const noStores = fixture({ ids: [] });
  await assert.rejects(noStores.settings.getStoreThemeAccess(employee("staff")), (error: unknown) => (error as {status:number}).status === 403);
  assert.equal(noStores.calls.length, 0);
  const owner = fixture({ allStores: true });
  await assert.rejects(owner.settings.getStoreThemeAccess(employee("owner"), "bad-id"), (error: unknown) => (error as {status:number}).status === 400);
  assert.equal(owner.calls.length, 0);
  await assert.rejects(owner.settings.getStoreThemeAccess(employee("owner"), id(99)), (error: unknown) => (error as {status:number}).status === 403);
  assert.match(owner.calls[0].text, /where status = 'active'/);
});

test("theme reads stay in their own Store module and safely fall back for missing or malformed saved values", async () => {
  const empty = fixture({ rows: [] });
  const defaultValue = await empty.settings.getStoreThemeSettings(id(3));
  assert.equal(defaultValue.theme.primaryColor, "#245d49");
  assert.equal(defaultValue.revision, null);
  assert.equal(defaultValue.updatedAt, null);
  assert.equal(empty.calls[0].values[0], `store:${id(3)}`);
  assert.equal(empty.calls[0].values[1], "store_theme");
  assert.equal(defaultValue.target,"operations");
  assert.equal(defaultValue.theme.mode,"custom");
  assert.equal(defaultValue.brand,null);
  const saved = fixture({ rows: [{ settings: { primaryColor: "#7A3399", revision: "old", paletteVersion: 1 }, updatedAt: new Date("2026-10-18T00:00:00Z") }] });
  const value = await saved.settings.getStoreThemeSettings(id(3));
  assert.equal(value.theme.primaryColor, "#7a3399");
  assert.equal(value.revision, "old");
  assert.equal(value.updatedAt, "2026-10-18T00:00:00.000Z");
  assert.equal((await fixture({ rows: [{settings: { primaryColor: "url(evil)" }, updatedAt: null}] }).settings.getStoreThemeSettings(id(3))).theme.primaryColor, "#245d49");
});

test("each display has an independent module and brand default without inheriting the operations color", async () => {
  for (const [target,moduleKey,color] of [["pickup","store_theme_pickup","#c30d23"],["customer","store_theme_customer","#262827"],["courier","store_theme_courier","#262827"]]) {
    const f=fixture({rows:[]}),context=await f.settings.getStoreThemeSettings(id(3),target);
    assert.equal(context.target,target);
    assert.equal(context.theme.mode,"brand");
    assert.equal(context.theme.primaryColor,color);
    assert.equal(context.brand,null);
    assert.equal(context.revision,null);
    assert.equal(f.calls.length,1);
    assert.equal(f.calls[0].values[1],moduleKey);
  }
});

test("brand themes dynamically resolve their logo color and custom themes retain color with current brand metadata", async () => {
  const brand={name:"Example",logoUrl:"/brand.svg",primaryColor:"#993355"};
  const branded=fixture({brand,rows:[{settings:{mode:"brand",primaryColor:"#ffffff",revision:"brand-revision"},updatedAt:null}]});
  const context=await branded.settings.getStoreThemeSettings(id(3),"pickup");
  assert.equal(context.theme.primaryColor,brand.primaryColor);
  assert.equal(context.theme.mode,"brand");
  assert.equal(context.brand?.name,brand.name);
  assert.equal(context.brand?.primaryColor,brand.primaryColor);
  const custom=await fixture({brand,rows:[{settings:{mode:"custom",primaryColor:"#334499",revision:"custom-revision"},updatedAt:null}]}).settings.getStoreThemeSettings(id(3),"customer");
  assert.equal(custom.theme.primaryColor,"#334499");
  assert.equal(custom.theme.mode,"custom");
  assert.equal(custom.brand?.primaryColor,brand.primaryColor);
  const operations=await fixture({brand,rows:[{settings:{primaryColor:"#334499",revision:"legacy-revision"},updatedAt:null}]}).settings.getStoreThemeSettings(id(3));
  assert.equal(operations.theme.mode,"custom");
  assert.equal(operations.theme.primaryColor,"#334499");
  assert.equal(operations.brand,null);
});

test("unknown explicit targets and invalid modes cannot query or write any theme record", async () => {
  const f=fixture({rows:[]});
  for(const target of [null,"","Operations","store_theme","constructor","__proto__",["pickup"],{},true]) {
    await assert.rejects(f.settings.getStoreThemeSettings(id(3),target),(error:unknown)=>(error as {code:string}).code==="invalid_target");
    await assert.rejects(f.settings.saveStoreThemeSettings({storeId:id(3),target,mode:"custom",primaryColor:"#334499",expectedRevision:null,actorId:id(1),request:new Request("https://example.test")}),(error:unknown)=>(error as {code:string}).code==="invalid_target");
  }
  for(const [target,mode] of [["operations","brand"],["pickup",undefined],["customer",null],["courier","invalid"]]) {
    await assert.rejects(f.settings.saveStoreThemeSettings({storeId:id(3),target,mode,primaryColor:"#334499",expectedRevision:null,actorId:id(1),request:new Request("https://example.test")}),(error:unknown)=>(error as {code:string}).code==="invalid_mode");
  }
  assert.equal(f.calls.length,0);
});

test("brand saves persist the mode without freezing a logo color and audit the exact target/module", async () => {
  const f=fixture({rows:[]});
  await f.settings.saveStoreThemeSettings({storeId:id(3),target:"pickup",mode:"brand",primaryColor:"#abcdef",expectedRevision:null,actorId:id(1),request:new Request("https://example.test")});
  assert.equal(f.calls.length,1);
  const call=f.calls[0];
  const saved=call.values.map(value=>{try{return typeof value==="string"&&value.startsWith("{")?JSON.parse(value):null;}catch{return null;}}).find(value=>value?.revision);
  assert.equal(saved.mode,"brand");
  assert.equal("primaryColor" in saved,false);
  assert.ok(call.values.includes("store_theme_pickup"));
  assert.ok(call.values.includes("pickup"));
  assert.match(call.text,/'target',[\s\S]*'moduleKey',/);
});

test("persistence issues one parameterized CAS with an atomic audit and does not silently retry conflicts", async () => {
  const f = fixture({ rows: [] });
  const result = await f.settings.saveStoreThemeSettings({ storeId: id(3), primaryColor: "#9944AA", expectedRevision: "original", actorId: id(1), request: new Request("https://example.test/api/store/theme") });
  assert.equal(result, null);
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.match(call.text, /on conflict \(scope_key, module_key\)[\s\S]*is not distinct from/);
  assert.match(call.text, /with previous as materialized[\s\S]*saved as[\s\S]*audited as[\s\S]*insert into os_audit_logs[\s\S]*from saved cross join audited/);
  assert.match(call.text, /exists \(select 1 from stores where id = [\s\S]*status = 'active'\)/);
  assert.match(call.text, /'oldTheme'[\s\S]*'newTheme'[\s\S]*'previousRevision'[\s\S]*'changedAt'/);
  const serialized = call.values.find(value => typeof value === "string" && value.startsWith('{"primaryColor":"#9944aa"')) as string;
  assert.ok(serialized);
  assert.match(JSON.parse(serialized).revision, /^[a-f0-9-]{36}$/);
  assert.equal(call.text.includes("#9944aa"), false);
  assert.equal(call.text.includes(id(1)), false);
});

test("theme permission defaults to owner, and forbidden grants are removed from staff/terminal permissions", async () => {
  const permissions = load("./role-permissions.ts", { "./db": { sql: async () => [{ permissionKey: "store.theme.manage", isEnabled: true }] } }) as unknown as typeof import("./role-permissions");
  for (const role of ["owner", "manager", "store_owner", "store_manager", "staff", "store_terminal"]) {
    assert.equal(permissions.getDefaultPermissionsForRole(role).has("store.theme.manage"), role === "owner", role);
    const expected = ["owner", "manager", "store_owner", "store_manager"].includes(role);
    assert.equal((await permissions.getPermissionsForRole(role)).has("store.theme.manage"), expected, role);
    assert.equal(permissions.normalizePermissionKeys(role, ["store.theme.manage"]).includes("store.theme.manage"), expected, role);
  }
  assert.equal(permissions.isLockedRolePermission("owner", "store.theme.manage"), true);
  assert.deepEqual(Array.from(permissions.getNavPathsForPermissions(["store.theme.manage"])), ["/store/settings/appearance"]);
});

test("theme save authorization reads fresh grants and rejects revocation despite a previously allowed cached permission", async () => {
  let granted = true;
  let permissionReads = 0;
  const permissions = load("./role-permissions.ts", { "./db": {sql:async () => {
    permissionReads++;
    return [{permissionKey:"store.theme.manage",isEnabled:granted}];
  }} }) as unknown as typeof import("./role-permissions");
  const settings = load("./store-theme-settings.ts", {
    "node:crypto":crypto,"./store-theme":palette,"./role-permissions":permissions,
    "./store-display-brand":{getStoreDisplayBrand:async () => null},
    "./api-auth":{getSessionStoreScope:async () => ({allStores:false,storeIds:[id(3)]})},
    "./db":{sql:async () => [{id:id(3),name:"Store A"}]}
  }) as unknown as typeof import("./store-theme-settings");
  assert.equal((await settings.getStoreThemeAccess(employee("manager"))).canManageTheme,true);
  assert.equal(permissionReads,1);
  granted = false;
  assert.equal((await settings.getStoreThemeAccess(employee("manager"))).canManageTheme,true);
  assert.equal(permissionReads,1);
  assert.equal((await settings.getStoreThemeAccess(employee("manager"),id(3),{freshPermissions:true})).canManageTheme,false);
  assert.equal(permissionReads,2);
  assert.equal((await permissions.getPermissionsForRole("manager")).has("store.theme.manage"),false);
  assert.equal(permissionReads,2);
});

test("proxy opens only the exact appearance route for personal store managers and leaves staff/operations restrictions intact", async () => {
  const auth = load("./auth.ts", { "node:crypto": crypto }) as unknown as typeof import("./auth");
  const policy = load("./store-inventory-policy.ts");
  const NextResponse = {
    next: () => ({ kind: "next" }),
    redirect: (url: URL) => ({ kind: "redirect", pathname: url.pathname }),
    json: (_body: unknown, init: ResponseInit) => ({ kind: "json", status: init.status })
  };
  const proxy = load("../proxy.ts", { "next/server": { NextResponse }, "./lib/store-inventory-policy": policy }).default as (request: unknown) => Promise<{kind:string;pathname?:string}>;
  async function visit(role: string, path: string) {
    const url = new URL(`https://example.test${path}`) as URL & {clone:()=>URL};
    url.clone = () => new URL(url.href);
    const proof = auth.createSessionToken(employee(role));
    return proxy({ nextUrl: url, method: "GET", headers: new Headers(), cookies: { get: () => ({value: proof}) } });
  }
  for (const role of ["store_owner", "store_manager"]) {
    assert.equal((await visit(role, "/store/settings/appearance")).kind, "next");
    for (const path of ["/store/settings", "/store/settings/appearance/other", "/store/settings/appearance-extra", "/store/orders", "/store/pos"]) {
      assert.equal((await visit(role, path)).pathname, "/store/inventory", `${role}:${path}`);
    }
    assert.equal((await visit(role, "/store/inventory")).kind, "next");
  }
  assert.equal((await visit("staff", "/store/settings/appearance")).pathname, "/store/inventory");
});

// Optional local Postgres-compatible engine; never connects to DATABASE_URL.
// Set STORE_THEME_TEST_PGLITE_MODULE to an installed @electric-sql/pglite module.
test("real local SQL preserves isolated themes, admits one concurrent revision, audits old/new values and rolls back audit failure", {
  skip: !process.env.STORE_THEME_TEST_PGLITE_MODULE
}, async () => {
  type LocalDatabase = {
    exec: (text: string) => Promise<unknown>;
    query: <T = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{rows: T[]}>;
    close: () => Promise<void>;
  };
  const modulePath = process.env.STORE_THEME_TEST_PGLITE_MODULE!;
  const { PGlite } = await import(modulePath) as {PGlite: new () => LocalDatabase};
  const db = new PGlite();
  try {
    await db.exec(`
      create table stores (id uuid primary key, name text not null, status text not null);
      create table employees (id uuid primary key);
      create table module_settings (
        id uuid primary key default gen_random_uuid(), scope_key text not null, module_key text not null,
        settings jsonb not null default '{}', updated_by uuid references employees(id),
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(scope_key,module_key)
      );
      create table os_audit_logs (
        id uuid primary key default gen_random_uuid(), actor_employee_id uuid references employees(id),
        action text not null, target_type text, target_id text, metadata jsonb not null default '{}',
        ip_address text, user_agent text, created_at timestamptz not null default now()
      );
    `);
    await db.query("insert into stores values ($1,'Store A','active'),($2,'Store B','active'),($3,'Inactive','inactive')", [id(3),id(4),id(5)]);
    await db.query("insert into employees values ($1)", [id(1)]);
    let currentBrand:{name:string;logoUrl:string;primaryColor:string}|null=null;
    const settings = load("./store-theme-settings.ts", {
      "node:crypto": crypto, "./store-theme": palette,
      "./store-display-brand":{getStoreDisplayBrand:async () => currentBrand},
      "./api-auth": {getSessionStoreScope:async () => ({allStores:false,storeIds:[id(3),id(4),id(5)]})},
      "./role-permissions": {roleHasPermission:async () => true},
      "./db": {sql:async (parts:TemplateStringsArray,...values:unknown[]) => {
        const text = parts.reduce((query,part,index) => query + part + (index < values.length ? `$${index + 1}` : ""), "");
        return (await db.query(text, values)).rows;
      }}
    }) as unknown as typeof import("./store-theme-settings");
    const request = new Request("https://example.test/api/store/theme", {headers:{origin:"https://example.test","user-agent":"local-theme-test","x-forwarded-for":"192.0.2.2"}});
    const save = (primaryColor:string,expectedRevision:string|null,selectedStoreId = id(3)) => settings.saveStoreThemeSettings({storeId:selectedStoreId,primaryColor,expectedRevision,actorId:id(1),request});
    const initial = await Promise.all([save("#993355",null),save("#224499",null)]);
    assert.equal(initial.filter(Boolean).length, 1);
    const first = initial.find(Boolean)!;
    assert.ok(first.revision);
    assert.equal((await settings.getStoreThemeSettings(id(4))).revision, null);
    const writes = await Promise.all([save("#cc8833",first.revision),save("#8855aa",first.revision)]);
    assert.equal(writes.filter(Boolean).length, 1);
    const final = writes.find(Boolean)!;
    assert.notEqual(first.revision, final.revision);
    const persisted = await settings.getStoreThemeSettings(id(3));
    assert.equal(persisted.revision, final.revision);
    assert.equal(persisted.theme.primaryColor, final.theme.primaryColor);
    assert.equal(await save("#000000",first.revision), null);
    assert.equal(await save("#000000","deleted-revision",id(4)), null);
    assert.equal(await save("#000000",null,id(5)), null);
    await assert.rejects(settings.getStoreThemeAccess(employee("owner"),id(5)),(error:unknown)=>(error as {status:number}).status===403);
    const logs = (await db.query<{metadata:{oldTheme:{primaryColor:string};newTheme:{primaryColor:string};revision:string;changedAt:string};actor_employee_id:string;ip_address:string}>("select * from os_audit_logs order by created_at, id")).rows;
    assert.equal(logs.length, 2);
    const updated = logs.find(log => log.metadata.revision === final.revision)!;
    assert.equal(updated.metadata.oldTheme.primaryColor, first.theme.primaryColor);
    assert.equal(updated.metadata.newTheme.primaryColor, final.theme.primaryColor);
    assert.ok(updated.metadata.changedAt);
    assert.equal(updated.actor_employee_id,id(1));
    assert.equal(updated.ip_address,"192.0.2.2");
    await db.exec("alter table os_audit_logs add constraint theme_audit_test_failure check (action <> 'store.theme.updated') not valid");
    await assert.rejects(save("#117733", final.revision));
    assert.equal((await settings.getStoreThemeSettings(id(3))).revision, final.revision);
    assert.equal((await db.query("select id from os_audit_logs")).rows.length, 2);
    await db.exec("alter table os_audit_logs drop constraint theme_audit_test_failure");

    // Distinct targets in one store do not contend on the same record/revision.
    const displayWrites=await Promise.all((["pickup","customer","courier"] as const).map((target,index)=>settings.saveStoreThemeSettings({
      storeId:id(3),target,mode:"custom",primaryColor:["#993355","#334499","#227744"][index],expectedRevision:null,actorId:id(1),request
    })));
    assert.equal(displayWrites.filter(Boolean).length,3);
    assert.equal((await settings.getStoreThemeSettings(id(3))).revision,final.revision);
    const operationStored=(await db.query<{settings:Record<string,unknown>}>("select settings from module_settings where scope_key=$1 and module_key='store_theme'",[`store:${id(3)}`])).rows[0].settings;
    const pickup=displayWrites[0]!;
    assert.equal(await settings.saveStoreThemeSettings({storeId:id(3),target:"customer",mode:"custom",primaryColor:"#112233",expectedRevision:pickup.revision,actorId:id(1),request}),null);
    const brandSaved=await settings.saveStoreThemeSettings({storeId:id(3),target:"pickup",mode:"brand",expectedRevision:pickup.revision,actorId:id(1),request});
    assert.equal(brandSaved?.theme.primaryColor,"#c30d23");
    assert.equal(brandSaved?.theme.mode,"brand");
    const brandStored=(await db.query<{settings:Record<string,unknown>}>("select settings from module_settings where scope_key=$1 and module_key='store_theme_pickup'",[`store:${id(3)}`])).rows[0].settings;
    assert.equal("primaryColor" in brandStored,false);
    currentBrand={name:"Brand A",logoUrl:"/brand-a.svg",primaryColor:"#a11528"};
    const resolved=await settings.getStoreThemeSettings(id(3),"pickup");
    assert.equal(resolved.theme.primaryColor,"#a11528");
    assert.equal(resolved.revision,brandSaved?.revision);
    currentBrand={name:"Brand B",logoUrl:"/brand-b.svg",primaryColor:"#226644"};
    const updatedBrand=await settings.getStoreThemeSettings(id(3),"pickup");
    assert.equal(updatedBrand.theme.primaryColor,"#226644");
    assert.equal(updatedBrand.brand?.name,"Brand B");
    assert.equal(updatedBrand.revision,brandSaved?.revision);
    const customCustomer=await settings.getStoreThemeSettings(id(3),"customer");
    assert.equal(customCustomer.theme.primaryColor,"#334499");
    assert.equal(customCustomer.brand?.primaryColor,"#226644");
    currentBrand=null;
    assert.equal((await settings.getStoreThemeSettings(id(3),"pickup")).brand,null);
    assert.equal((await settings.getStoreThemeSettings(id(3),"pickup")).theme.primaryColor,"#c30d23");
    assert.deepEqual((await db.query<{settings:Record<string,unknown>}>("select settings from module_settings where scope_key=$1 and module_key='store_theme'",[`store:${id(3)}`])).rows[0].settings,operationStored);
    const displayAudit=(await db.query<{metadata:{target:string;moduleKey:string}}>("select metadata from os_audit_logs where metadata->>'revision'=$1",[brandSaved?.revision])).rows[0];
    assert.equal(displayAudit.metadata.target,"pickup");
    assert.equal(displayAudit.metadata.moduleKey,"store_theme_pickup");

    let role = "staff";
    const route = load("../app/api/store/theme/route.ts", {
      "../../../../lib/api-auth": {requireOsSession:async () => employee(role)},
      "../../../../lib/store-theme":palette,
      "../../../../lib/store-theme-settings":settings
    }) as unknown as typeof import("../app/api/store/theme/route");
    for (const forbidden of ["staff","store_terminal"]) {
      role = forbidden;
      for(const target of ["operations","pickup","customer","courier"]) {
        const response = await route.POST(new Request("https://example.test/api/store/theme", {
          method:"POST",headers:{origin:"https://example.test","content-type":"application/json"},
          body:JSON.stringify({storeId:id(3),target,mode:"custom",primaryColor:"#001122",expectedRevision:final.revision})
        }));
        assert.equal(response.status,403,`${forbidden}:${target}`);
        assert.equal((await response.json()).code,"theme_permission",`${forbidden}:${target}`);
      }
    }
    assert.equal((await settings.getStoreThemeSettings(id(3))).revision, final.revision);
  } finally {
    await db.close();
  }
});
