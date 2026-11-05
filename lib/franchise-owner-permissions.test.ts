import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as crypto from "node:crypto";
const pglitePath = process.env.PGLITE_MODULE || "../outputs/inventory-reference-implementation-20261014/test-deps/node_modules/@electric-sql/pglite/dist/index.js";
const { PGlite } = await import(pglitePath);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function load(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, { exports, Response, Request, URL, Buffer, Set, Map,
    require(name: string) { if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; }
  });
  return exports;
}
async function fixture() {
  const db = new PGlite();
  await db.exec(`create table role_permissions(role text,permission_key text,is_enabled boolean,updated_at timestamptz default now(),primary key(role,permission_key));
    create table procedure_books(id uuid primary key,title text);
    create table procedure_book_stores(procedure_book_id uuid,store_id uuid);
    insert into procedure_books values('${id(10)}','Local'),('${id(11)}','Shared'),('${id(12)}','Other'),('${id(13)}','Global');
    insert into procedure_book_stores values('${id(10)}','${id(1)}'),('${id(11)}','${id(1)}'),('${id(11)}','${id(2)}'),('${id(12)}','${id(2)}');`);
  const queries: string[] = [];
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce((result, part, index) => result + (index ? `$${index}` : "") + part, "");
    queries.push(query); return (await db.query(query, values)).rows;
  };
  const permissions = load("./role-permissions.ts", { "./db": { sql } });
  const session = { id: id(100), role: "store_owner" };
  const auth = { requireOsSession: async () => session, getSessionStoreScope: async () => ({ allStores: ["owner", "manager"].includes(session.role), storeIds: [id(1)] }) };
  const deps = { "../../../lib/api-auth": auth, "../../../lib/db": { sql }, "../../../lib/role-permissions": permissions,
    "../../../lib/product-catalog-access": { getProductCatalogAccessSnapshot: async () => ({ visibleProductIds: [] }) } };
  const procedures = load("../app/api/procedures/route.ts", deps);
  return { db, sql, permissions, session, auth, procedures, queries };
}
const request = (method: string, body: unknown) => new Request("https://example.test/api/procedures", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("owner can manage local operations; headquarters and global edits remain unavailable", async () => {
  const f = await fixture(); try {
    const p = await f.permissions.getPermissionsForRole("store_owner");
    for (const key of ["module.pos", "module.analytics", "analytics.manageExpenses", "staff.manage", "pos.manageSettings", "pos.refund", "stores.manageSettings"]) assert.ok(p.has(key), key);
    for (const key of ["module.competitors", "module.masterData", "module.settings", "products.manage", "menus.edit", "settings.managePermissions", "staff.assignHeadquarterRoles", "history.delete"]) assert.ok(!p.has(key), key);
    assert.ok(!(await f.permissions.getPermissionsForRole("store_manager")).has("module.pos"));
  } finally { await f.db.close(); }
});
test("specific headquarters child page cannot be opened through analytics parent grant", async () => {
  const f = await fixture(); try {
    for (const role of ["store_owner", "owner", "manager"]) {
      const paths = new Set<string>(f.permissions.getNavPathsForPermissions(await f.permissions.getPermissionsForRole(role)));
      assert.equal(f.permissions.isPermittedOsPagePath("/os/analytics/sales", paths), true);
      assert.equal(f.permissions.isPermittedOsPagePath("/os/analytics/competitors", paths), role !== "store_owner");
      assert.equal(f.permissions.isPermittedOsPagePath("/os/analytics/competitors/detail", paths), role !== "store_owner");
      assert.equal(f.permissions.isPermittedOsPagePath("/os/settings", paths), role === "owner");
    }
  } finally { await f.db.close(); }
});
test("migration repairs only two owner grants and preserves all other overrides", async () => {
  const f = await fixture(); try {
    await f.db.exec(`insert into role_permissions values('store_owner','module.pos',false,now()),('store_owner','analytics.manageExpenses',false,now()),('store_manager','module.pos',false,now()),('store_owner','pos.refund',false,now());`);
    await f.db.exec(readFileSync(new URL("../db/migrations/20261101_franchise_owner_permissions.sql", import.meta.url), "utf8"));
    assert.equal((await f.db.query(`select count(*)::int as n from role_permissions where is_enabled`)).rows[0].n, 2);
    assert.ok((await f.permissions.getPermissionsForRole("store_owner", { fresh: true })).has("module.pos"));
    assert.ok(!(await f.permissions.getPermissionsForRole("store_owner", { fresh: true })).has("pos.refund"));
  } finally { await f.db.close(); }
});
test("franchise owner cannot edit or delete shared, global or another store's procedures", async () => {
  const f = await fixture(); try {
    for (const target of [11,12,13]) {
      assert.equal((await f.procedures.DELETE(request("DELETE", { id: id(target) }))).status, 403);
      const result = await f.procedures.PUT(request("PUT", { id: id(target), title: "Must not change", storeIds: [id(1)] }));
      assert.equal(result.status, 400);
    }
    assert.equal((await f.db.query("select count(*)::int as n from procedure_books")).rows[0].n,4);
    assert.equal((await f.procedures.DELETE(request("DELETE", { id: id(10) }))).status,200);
  } finally { await f.db.close(); }
});
test("out-of-scope assignment is rejected rather than silently dropping stores", async () => {
  const f = await fixture(); try {
    const response = await f.procedures.POST(request("POST", { title: "Invalid", storeIds: [id(1),id(2)] }));
    assert.equal(response.status,400);
    assert.ok(!f.queries.some(q => /insert into procedure_books/.test(q)));
  } finally { await f.db.close(); }
});
test("global procedure master endpoint denies franchise owner before any write", async () => {
  const f = await fixture(); try {
    const settings = load("../app/api/procedures/settings/route.ts", {
      "../../../../lib/api-auth": f.auth, "../../../../lib/db": { sql: f.sql }, "../../../../lib/role-permissions": f.permissions
    });
    for (const method of ["POST", "PATCH"]) assert.equal((await settings[method](request(method, { kind: "materials", name: "Must not change" }))).status,403);
    assert.equal(f.queries.length,0);
  } finally { await f.db.close(); }
});

test("expense grant persists local expenses and rejects cross-store writes and revoked grants", async () => {
  const f = await fixture(); try {
    await f.db.exec(`create table analytics_expenses(id uuid default gen_random_uuid(), store_id uuid, category text,account_title text,name text,amount numeric,start_month text,end_month text,note text,created_by uuid,updated_by uuid,updated_at timestamptz);`);
    const expenses = load("../app/api/analytics/expenses/route.ts", {
      "../../../../lib/api-auth": { ...f.auth, canAccessStore: async (_: unknown, storeId: string) => storeId === id(1) },
      "../../../../lib/db": { sql: f.sql }, "../../../../lib/role-permissions": f.permissions
    });
    const body = { storeId: id(1),accountTitle:"水道光熱費",name:"本店電気代",amount:12000,startMonth:"2026-11" };
    assert.equal((await expenses.POST(request("POST",body))).status,200);
    assert.equal((await f.db.query("select amount::int from analytics_expenses")).rows[0].amount,12000);
    assert.equal((await expenses.POST(request("POST",{...body,storeId:id(2)}))).status,403);
    await f.db.exec("insert into role_permissions values('store_owner','analytics.manageExpenses',false,now())");
    f.permissions.clearRolePermissionCache();
    assert.equal((await expenses.POST(request("POST",body))).status,403);
    assert.equal((await f.db.query("select count(*)::int as n from analytics_expenses")).rows[0].n,1);
  } finally { await f.db.close(); }
});

test("cash reconciliation returns local ledger totals and blocks another store or an unassigned account", async () => {
  let reads=0; let assigned=true;
  const session={id:id(100),role:"store_owner"};
  const access={allStores:false,storeIds:[id(1)],stores:[{id:id(1),name:"Local"}]};
  const sql=async (strings:TemplateStringsArray,...values:unknown[])=>{
    reads++; const q=strings.join("?");
    if(q.includes('pos_cash_sessions.register_name') && !q.includes("status = 'open'")) return [{id:id(20),storeId:id(1),businessDate:"2026-11-01",status:"closed",openingAmount:10000,expectedCashAmount:15000,countedCashAmount:14900}];
    if(q.includes('as "cashSales"')) return [{cashSales:6000}];
    if(q.includes('as "movementCount"')) return [{cashIn:0,cashOut:1000,movementCount:1}];
    return [];
  };
  const prefix="../../../../../lib/";
  const modules:Record<string,unknown>={
    "pos-operator-access":{},"pos-operator-credentials":{},"api-auth":{requireOsSession:async()=>session},"db":{sql},"loyalty":{},"order-realtime":{},"sales-orders":{},
    "pos-cash-denominations":load("./pos-cash-denominations.ts",{}),
    "store-business-hours":{getStoreCashBusinessDayState:()=>({businessDate:"2026-11-01"})},
    "store-order-access":{getStoreOrderAccess:async()=>assigned?access:{...access,storeIds:[],stores:[]},getScopedStoreFilter:(a:typeof access,storeId:string|null)=>!storeId?null:a.storeIds.includes(storeId)?storeId:"__forbidden__"}
  };
  const route=load("../app/api/store/pos/reconciliation/route.ts",{ "node:crypto":crypto, [prefix+"pos-bowl-data"]:{}, ...Object.fromEntries(Object.entries(modules).map(([key,value])=>[prefix+key,value])) });
  const get=(storeId="")=>route.GET(new Request(`https://example.test/api/store/pos/reconciliation?date=2026-11-01&storeId=${storeId}`));
  const response=await get(id(1));assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.totals.expectedCashAmount,15000);assert.equal(body.totals.countedCashAmount,14900);assert.equal(body.totals.differenceAmount,-100);assert.equal(body.access.canManageCashReconciliation,false);
  reads=0;assert.equal((await get(id(2))).status,403);assert.equal(reads,0);
  assigned=false;assert.equal((await get()).status,403);assert.equal(reads,0);
});

test("splitting competitor navigation preserves a headquarters analytics opt-out", async () => {
  const f = await fixture(); try {
    await f.db.exec("insert into role_permissions values('manager','module.analytics',false,now())");
    const p=await f.permissions.getPermissionsForRole("manager",{fresh:true});
    assert.equal(p.has("module.competitors"),false);
    const matrix=await f.permissions.getAllRolePermissions();
    assert.equal(matrix.find((row:any)=>row.role==='manager').permissions.find((row:any)=>row.key==='module.competitors').enabled,false);
  } finally { await f.db.close(); }
});

test("procedure reads show shared published books as read-only without disclosing other store names or drafts", async () => {
  const f = await fixture(); try {
    await f.db.exec(`alter table procedure_books add column category text,add column procedure_type text,add column summary text,add column status text default 'published',add column version_number int default 1,add column published_at timestamptz,add column updated_at timestamptz,add column brand_id uuid,add column menu_catalog_item_id uuid;
      create table stores(id uuid,name text);insert into stores values('${id(1)}','Local Store'),('${id(2)}','Secret Other Store');
      create table brands(id uuid,name text);create table menu_catalog_items(id uuid,name text,item_kind text);
      insert into procedure_books(id,title,status) values('${id(14)}','Hidden Shared Draft','draft');
      insert into procedure_book_stores values('${id(14)}','${id(1)}'),('${id(14)}','${id(2)}');`);
    const sql=async(strings:TemplateStringsArray,...values:unknown[])=>{
      // Exercise the actual visibility SQL; unrelated child/master datasets are empty fixtures.
      if(strings.join('').includes('as "canEdit"')) return f.sql(strings,...values);
      return [];
    };
    const route=load("../app/api/procedures/route.ts",{
      "../../../lib/api-auth":f.auth,"../../../lib/db":{sql},"../../../lib/role-permissions":f.permissions,
      "../../../lib/product-catalog-access":{getProductCatalogAccessSnapshot:async()=>({visibleProductIds:[]})}
    });
    const response=await route.GET(new Request('https://example.test/api/procedures?mode=admin'));
    assert.equal(response.status,200);const body=await response.json();
    assert.equal(body.canEdit,true);assert.equal(body.canManageShared,false);
    assert.equal(body.procedures.find((book:any)=>book.id===id(10)).canEdit,true);
    assert.equal(body.procedures.find((book:any)=>book.id===id(11)).canEdit,false);
    assert.equal(body.procedures.find((book:any)=>book.id===id(13)).canEdit,false);
    assert.equal(body.procedures.some((book:any)=>[id(12),id(14)].includes(book.id)),false);
    assert.ok(!JSON.stringify(body).includes('Secret Other Store'));
  } finally { await f.db.close(); }
});
