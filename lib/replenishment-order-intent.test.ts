import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as policy from "./replenishment-order-intent.ts";
import * as orderLocks from "./replenishment-order-locks.ts";
import * as orderTemplateDraft from "./order-template-draft.ts";

const ids = Object.fromEntries(["store", "otherStore", "product", "otherProduct", "employee", "item"].map((key, index) => [key, `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`]));
const intent = { storeId: ids.store, productIds: [ids.product] };
const context = { ...intent, expectedOpenItemIds: [], additionalOrderConfirmed: false };

test("deep links require exact UUIDs and preserve multiple distinct SKU targets", () => {
  const params = new URLSearchParams({ replenishStoreId: ids.store });
  [ids.otherProduct, ids.product, ids.product].forEach((id) => params.append("replenishProductId", id));
  assert.deepEqual(policy.readReplenishmentOrderIntent(params).intent, { storeId: ids.store, productIds: [ids.product, ids.otherProduct] });
  assert.equal(policy.readReplenishmentOrderIntent(new URLSearchParams()).intent, null);
  assert.ok(policy.readReplenishmentOrderIntent(new URLSearchParams({ replenishStoreId: "name", replenishProductId: ids.product })).error);
});

test("prefill never substitutes a hidden, stopped or out-of-scope SKU with a same-name product", () => {
  const stores = [{ id: ids.store, name: "A" }];
  const publicProduct = { id: ids.otherProduct, name: "same", orderableStoreIds: [ids.store] };
  assert.ok("error" in policy.resolveReplenishmentPrefill(intent, stores, [publicProduct]));
  assert.ok("error" in policy.resolveReplenishmentPrefill(intent, stores, [{ ...publicProduct, id: ids.product, orderableStoreIds: [] }]));
  assert.ok("error" in policy.resolveReplenishmentPrefill({ ...intent, storeId: ids.otherStore }, stores, [publicProduct]));
  assert.equal((policy.resolveReplenishmentPrefill(intent, stores, [{ ...publicProduct, id: ids.product }]) as { products: unknown[] }).products.length, 1);
});

test("source submissions require explicit quantities, exact targets and extra-order acknowledgement", () => {
  for (const quantity of ["", null, undefined, 0, -1, 1.2, 1000, "foo"]) {
    assert.ok(policy.validateReplenishmentOrderSubmission(context, { ...intent, quantities: [quantity] }));
  }
  assert.equal(policy.validateReplenishmentOrderSubmission(context, { ...intent, quantities: ["2"] }), null);
  assert.ok(policy.validateReplenishmentOrderSubmission(context, { ...intent, productIds: [ids.otherProduct], quantities: [2] }));
  const waiting = { ...context, expectedOpenItemIds: [ids.item] };
  assert.ok(policy.validateReplenishmentOrderSubmission(waiting, { ...intent, quantities: [2] }));
  assert.equal(policy.validateReplenishmentOrderSubmission({ ...waiting, additionalOrderConfirmed: true }, { ...intent, quantities: [2] }), null);
  assert.equal(policy.readReplenishmentOrderContext("invalid"), null);
  assert.deepEqual(policy.readReplenishmentOrderContext(JSON.stringify(context)), context);
  assert.equal(policy.isOpenReplenishmentOrderItem("received", "PO-TEST"), false);
  assert.equal(policy.isOpenReplenishmentOrderItem("requested", "RCPT-TEST"), false);
  assert.equal(policy.isOpenReplenishmentOrderItem("purchased", "PO-TEST"), true);
});

function ordersPageHarness(saved: unknown) {
  const source = readFileSync(new URL("../app/os/orders/page.tsx", import.meta.url), "utf8") + "\nexport const testFunctions = { readSavedNewOrderDraft, syncOrderItemWithProducts, createOrderItemDraftFromProduct };";
  const exports: Record<string, unknown> = {};
  const modules: Record<string, unknown> = {
    react: {}, "react/jsx-runtime": {}, "lucide-react": {},
    "../components/UserBadge": {}, "../components/MobileNavMenu": {}, "../components/OsNavList": {},
    "../components/ActionNotice": {}, "../components/useModalHistory": {},
    "../components/currentEmployeeStore": { loadCurrentEmployee: async () => null }, "../../../components/StockReceiptPanel": {}, "./OrderTemplatesPanel": {}, "../../../lib/order-template-draft": orderTemplateDraft,
    "../../../lib/mock-data": { orders: [], products: [], stores: [] },
    "../../../lib/number-input": {}, "../../../lib/product-identity": {},
    "../../../lib/procurement-confirmation-policy": {}, "../../../lib/replenishment-order-intent": policy
  };
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, {
    exports, URLSearchParams,
    window: { localStorage: { getItem: () => JSON.stringify(saved) } },
    require: (name: string) => { if (!(name in modules)) throw new Error(`Unmocked dependency ${name}`); return modules[name]; }
  });
  return exports.testFunctions as Record<string, (...args: any[]) => any>;
}

test("saved replenishment quantities stay blank and source SKU identity survives catalog refresh", () => {
  const line = { id: 1, productId: ids.product, productName: "source", category: "food", subcategory: "A", quantity: null, unit: "袋", replenishment: true };
  const page = ordersPageHarness({ store: "A", note: "keep this", items: [line], replenishmentIntent: intent });
  const saved = page.readSavedNewOrderDraft();
  assert.equal(saved.items[0].quantity, null);
  assert.equal(saved.note, "keep this");
  assert.equal(saved.replenishmentIntent.storeId, ids.store);
  const synced = page.syncOrderItemWithProducts(saved.items[0], [{ id: ids.otherProduct, name: "same", unit: "個" }]);
  assert.equal(synced.productId, ids.product);
  assert.equal(synced.quantity, null);
  const invalid = ordersPageHarness({ store: "A", items: [{ ...line, quantity: "bad" }] }).readSavedNewOrderDraft();
  assert.equal(invalid.items[0].quantity, null);
  assert.equal(page.createOrderItemDraftFromProduct({ id: ids.otherProduct, name: "manual" }).quantity, 1);
  const templateSaved = ordersPageHarness({ store: "A", items: [{ ...line, replenishment: false, fromTemplate: true, quantity: 3 }] }).readSavedNewOrderDraft();
  assert.equal(templateSaved.items[0].fromTemplate, true);
  const templateSynced = page.syncOrderItemWithProducts(templateSaved.items[0], [{ id: ids.otherProduct, name: "same", unit: "個" }]);
  assert.equal(templateSynced.productId, ids.product);
  assert.equal(templateSynced.quantity, 3);
});

function interactiveOrdersHarness(saved: unknown, dashboard: Record<string, unknown>) {
  const source = readFileSync(new URL("../app/os/orders/page.tsx", import.meta.url), "utf8");
  const exports: Record<string, any> = {};
  const state: any[] = [], refs: any[] = [], previousEffects: any[][] = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0;
  let effects: Array<() => void> = [];
  let resolveDashboard!: (response: Response) => void;
  const dashboardResponse = new Promise<Response>((resolve) => { resolveDashboard = resolve; });
  const storage = new Map<string, string>();
  if (saved) storage.set("foundr1-os:new-order-draft", JSON.stringify(saved));
  const params = new URLSearchParams({ replenishStoreId: ids.store, replenishProductId: ids.product });
  const react = {
    useState(initial: any) {
      const index = stateIndex++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (next: any) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
    },
    useRef(initial: any) {
      const index = refIndex++;
      return refs[index] ??= { current: initial };
    },
    useEffect(callback: () => void, deps: any[]) {
      const index = effectIndex++;
      if (!previousEffects[index] || deps.some((value, i) => value !== previousEffects[index][i])) effects.push(callback);
      previousEffects[index] = deps;
    }
  };
  const modules: Record<string, unknown> = {
    react, "react/jsx-runtime": { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) }, "lucide-react": {},
    "../components/UserBadge": {}, "../components/MobileNavMenu": {}, "../components/OsNavList": {},
    "../components/ActionNotice": { useActionNotice: () => ({ notice: null, showNotice: () => undefined, clearNotice: () => undefined }) },
    "../components/useModalHistory": {}, "../../../lib/mock-data": { orders: [], products: [], stores: [] },
    "../components/currentEmployeeStore": { loadCurrentEmployee: async () => null }, "../../../components/StockReceiptPanel": {}, "./OrderTemplatesPanel": {}, "../../../lib/order-template-draft": orderTemplateDraft,
    "../../../lib/number-input": {}, "../../../lib/product-identity": { findProductByIdentity: () => undefined },
    "../../../lib/procurement-confirmation-policy": {}, "../../../lib/replenishment-order-intent": policy
  };
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, {
    exports, URLSearchParams, URL, AbortController,
    window: {
      location: { search: `?${params}` }, addEventListener() {}, removeEventListener() {},
      localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) }
    },
    document: { addEventListener() {}, removeEventListener() {} },
    fetch: (url: string) => url === "/api/dashboard" ? dashboardResponse : Promise.resolve(Response.json({ canCreateOrder: true, openItems: [] })),
    require: (name: string) => { if (!(name in modules)) throw new Error(`Unmocked dependency ${name}`); return modules[name]; }
  });
  function render() {
    stateIndex = refIndex = effectIndex = 0;
    effects = [];
    const tree = exports.default();
    const pendingEffects = effects;
    pendingEffects.forEach((effect) => effect());
    return tree;
  }
  return { render, storage, deliverDashboard: async () => {
    resolveDashboard(Response.json(dashboard));
    await new Promise((resolve) => setTimeout(resolve, 0));
  } };
}

function findElements(tree: any, predicate: (element: any) => boolean): any[] {
  if (!tree || typeof tree !== "object") return [];
  const children = Array.isArray(tree) ? tree : tree.props?.children ?? [];
  return [...(!Array.isArray(tree) && predicate(tree) ? [tree] : []), ...[children].flat().flatMap((child) => findElements(child, predicate))];
}

test("prefill waits for dashboard data and adds blank target only after the operator imports into an existing draft", async () => {
  const dashboard = {
    stores: [{ id: ids.store, name: "A", brands: [] }],
    products: [{ id: ids.product, name: "source", unit: "袋", category: "food", orderableStoreIds: [ids.store] }],
    orders: [], purchaseOrderItems: [], currentUserId: ids.employee
  };
  const clean = interactiveOrdersHarness(null, dashboard);
  clean.render(); clean.render();
  assert.equal(clean.storage.has("foundr1-os:new-order-draft"), false);
  await clean.deliverDashboard();
  clean.render(); clean.render();
  const cleanDraft = JSON.parse(clean.storage.get("foundr1-os:new-order-draft")!);
  assert.equal(cleanDraft.store, "A");
  assert.equal(cleanDraft.items[0].productId, ids.product);
  assert.equal(cleanDraft.items[0].quantity, null);

  const oldLine = { id: 8, productId: ids.otherProduct, productName: "hidden old SKU", quantity: 7, unit: "箱", category: "food", subcategory: "A" };
  const preserved = interactiveOrdersHarness({ store: "A", note: "keep note", items: [oldLine] }, dashboard);
  preserved.render(); preserved.render();
  await preserved.deliverDashboard();
  let tree = preserved.render(); tree = preserved.render();
  const oldDraft = JSON.parse(preserved.storage.get("foundr1-os:new-order-draft")!);
  assert.deepEqual(oldDraft.items.map((item: any) => [item.productId, item.quantity, item.unit]), [[ids.otherProduct, 7, "箱"]]);
  assert.equal(oldDraft.note, "keep note");
  const importButton = findElements(tree, (element) => element.type === "button" && element.props.children === "下書きに補充商品を追加")[0];
  assert.ok(importButton);
  importButton.props.onClick(); preserved.render(); preserved.render();
  const imported = JSON.parse(preserved.storage.get("foundr1-os:new-order-draft")!);
  assert.deepEqual(imported.items.map((item: any) => [item.productId, item.quantity]), [[ids.otherProduct, 7], [ids.product, null]]);
  assert.equal(imported.note, "keep note");

  const otherStoreDraft = interactiveOrdersHarness({ store: "B", note: "B note", items: [oldLine] }, {
    ...dashboard, stores: [...dashboard.stores, { id: ids.otherStore, name: "B", brands: [] }]
  });
  otherStoreDraft.render(); otherStoreDraft.render();
  await otherStoreDraft.deliverDashboard();
  otherStoreDraft.render();
  const otherTree = otherStoreDraft.render();
  findElements(otherTree, (element) => element.type === "button" && element.props.children === "下書きに補充商品を追加")[0].props.onClick();
  otherStoreDraft.render();
  const unchanged = JSON.parse(otherStoreDraft.storage.get("foundr1-os:new-order-draft")!);
  assert.equal(unchanged.store, "B");
  assert.equal(unchanged.note, "B note");
  assert.deepEqual(unchanged.items.map((item: any) => item.productId), [ids.otherProduct]);
});

function routeHarness(sql: unknown, options: { role?: string; moduleAllowed?: boolean; orderable?: boolean } = {}) {
  const source = readFileSync(new URL("../app/api/orders/route.ts", import.meta.url), "utf8");
  const exports: Record<string, unknown> = {};
  const session = { id: ids.employee, role: options.role ?? "owner" };
  const modules: Record<string, unknown> = {
    "../../../lib/api-auth": {
      requireOsSession: async () => session,
      requireWritableOsSession: async () => session.role === "store_terminal" ? null : session,
      canAccessStore: async (_: unknown, storeId: string) => storeId === ids.store,
      getSessionStoreScope: async () => ({ allStores: false, storeIds: [ids.store] })
    },
    "../../../lib/db": { sql },
    "../../../lib/lark": { sendPurchaseOrderLarkNotification: async () => ({ ok: true, delivered: false }) },
    "../../../lib/notification-realtime": { publishOsNotificationEvent: async () => undefined },
    "../../../lib/role-permissions": { roleHasPermission: async () => options.moduleAllowed !== false },
    "../../../lib/product-catalog-access": { assertProductsOrderable: async (_: unknown, storeId: string) => options.orderable === false || storeId !== ids.store
      ? { ok: false, status: 403, error: "denied" } : { ok: true } },
    "../../../lib/replenishment-order-intent": policy,
    "../../../lib/replenishment-order-locks": orderLocks
  };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Response, Request, URL, console,
    require: (name: string) => { if (!(name in modules)) throw new Error(`Unmocked dependency ${name}`); return modules[name]; }
  });
  return exports as { GET: (request: Request) => Promise<Response>; POST: (request: Request) => Promise<Response>; PUT: (request: Request) => Promise<Response> };
}

function orderRequest(source: unknown = context, quantity = "2", unit = "袋") {
  const form = new FormData();
  form.set("store", "A");
  form.set("deadline", "2026-10-10T10:00");
  form.set("productId", ids.product);
  form.set("productName", "SKU");
  form.set("requestedQuantity", quantity);
  form.set("requestedUnit", unit);
  if (source !== undefined) form.set("replenishContext", JSON.stringify(source));
  return new Request("https://example.test/api/orders", { method: "POST", body: form });
}

test("denied replenishment context and store terminals cannot cause DB writes", async () => {
  let calls = 0;
  const sql = () => { calls += 1; throw new Error("Unexpected DB call"); };
  const denied = routeHarness(sql, { moduleAllowed: false });
  assert.equal((await denied.POST(orderRequest())).status, 403);
  assert.equal((await denied.GET(new Request(`https://example.test/api/orders?replenishStoreId=${ids.store}&replenishProductId=${ids.product}`))).status, 403);
  const terminal = routeHarness(sql, { role: "store_terminal" });
  assert.equal((await terminal.POST(orderRequest())).status, 403);
  assert.equal(calls, 0);
});

test("real PostgreSQL transaction creates once, rejects stale open orders and preserves explicit unit/quantity", {
  skip: !process.env.FOUNDR1_PGLITE_MODULE
}, async () => {
  const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE!);
  const db = new PGlite();
  const sql = Object.assign((parts: TemplateStringsArray, ...values: unknown[]) => ({
    text: parts.reduce((text, part, index) => text + part + (index < values.length ? `$${index + 1}` : ""), ""), values,
    then(resolve: (rows: unknown[]) => void, reject: (error: unknown) => void) {
      return db.query(this.text, this.values).then((result: { rows: unknown[] }) => result.rows).then(resolve, reject);
    }
  }), {
    transaction: (statements: Array<{ text: string; values: unknown[] }>) => db.transaction(async (transaction: any) => {
      const results = [];
      for (const statement of statements) results.push((await transaction.query(statement.text, statement.values)).rows);
      return results;
    })
  });
  try {
    await db.exec(`
      create table stores(id uuid primary key, name text);
      create table employees(id uuid primary key, name text, status text default 'active', lark_open_id text, lark_user_id text);
      create table employee_scopes(employee_id uuid,scope_type text,store_id uuid);
      create table products(id uuid primary key,name text,unit text,brand_scope text default 'common',is_orderable boolean default true,catalog_visibility text default 'internal');
      create table product_brand_usages(product_id uuid,brand_id uuid,is_orderable boolean);
      create table store_brands(store_id uuid,brand_id uuid);
      create table product_catalog_store_grants(product_id uuid,store_id uuid);
      create table purchase_orders(id uuid primary key default gen_random_uuid(),order_no text unique,store_id uuid,deadline_label text,deadline_at timestamptz,requested_item_count integer,priority text,status text,note text,requested_by uuid,assigned_to uuid,replenishment_source jsonb);
      create table purchase_order_items(id uuid primary key default gen_random_uuid(),purchase_order_id uuid,product_id uuid,requested_quantity numeric not null,requested_unit text,status text);
      create table os_notifications(id uuid primary key default gen_random_uuid(),recipient_employee_id uuid,notification_type text,title text,message text,href text,lark_sent_at timestamptz,lark_error text);
      insert into stores values('${ids.store}','A');
      insert into employees(id,name) values('${ids.employee}','Tester');
      insert into products(id,name,unit) values('${ids.product}','SKU','袋');
    `);
    const route = routeHarness(sql);
    const before = async () => JSON.stringify((await db.query("select (select count(*) from purchase_orders) orders,(select count(*) from purchase_order_items) items,(select count(*) from os_notifications) notifications")).rows);
    const emptySnapshot = await before();
    assert.equal((await route.POST(orderRequest(context, ""))).status, 400);
    assert.equal(await before(), emptySnapshot);
    assert.equal((await route.POST(orderRequest(context, "2", "箱"))).status, 409);
    assert.equal(await before(), emptySnapshot);
    assert.equal((await route.POST(orderRequest())).status, 200);
    const afterFirst = await before();
    const facts = (await db.query("select requested_quantity,requested_unit,status from purchase_order_items")).rows[0];
    assert.equal(Number(facts.requested_quantity), 2);
    assert.equal(facts.requested_unit, "袋");
    assert.equal(facts.status, "requested");
    assert.equal((await route.POST(orderRequest())).status, 409);
    assert.equal(await before(), afterFirst);
    const read = await route.GET(new Request(`https://example.test/api/orders?replenishStoreId=${ids.store}&replenishProductId=${ids.product}`));
    const current = await read.json();
    assert.equal(current.openItems.length, 1);
    const confirmed = { ...context, expectedOpenItemIds: current.openItems.map((item: any) => item.itemId), additionalOrderConfirmed: true };
    const unconfirmed = { ...confirmed, additionalOrderConfirmed: false };
    assert.equal((await route.POST(orderRequest(unconfirmed))).status, 400);
    assert.equal(await before(), afterFirst);
    // A hidden/stopped change occurring after the preflight access result is still checked inside the write transaction.
    await db.query("update products set is_orderable=false");
    assert.equal((await route.POST(orderRequest(confirmed))).status, 409);
    assert.equal(await before(), afterFirst);
    await db.query("update products set is_orderable=true");
    assert.equal((await route.POST(orderRequest(confirmed))).status, 200);
    assert.equal(Number((await db.query("select count(*) n from os_notifications")).rows[0].n), 2);
    const sources = (await db.query("select replenishment_source from purchase_orders order by order_no")).rows;
    assert.deepEqual(sources[0].replenishment_source.productIds, [ids.product]);
    assert.equal(sources[1].replenishment_source.additionalOrderConfirmed, true);
    // Receiving changes the expected set and must invalidate an already-reviewed extra order.
    const newRead = await (await route.GET(new Request(`https://example.test/api/orders?replenishStoreId=${ids.store}&replenishProductId=${ids.product}`))).json();
    const stale = { ...confirmed, expectedOpenItemIds: newRead.openItems.map((item: any) => item.itemId) };
    await db.query("update purchase_order_items set status='received'");
    const beforeStale = await before();
    assert.equal((await route.POST(orderRequest(stale))).status, 409);
    assert.equal(await before(), beforeStale);
    // Ordinary manual requests retain legacy quantity normalization and participate in the same atomic write/locks.
    const manual = orderRequest();
    const manualForm = await manual.formData();
    manualForm.delete("replenishContext");
    manualForm.set("requestedQuantity", "");
    const result = await route.POST(new Request("https://example.test/api/orders", { method: "POST", body: manualForm }));
    assert.equal(result.status, 200);
    const manualRow = (await db.query("select requested_quantity,replenishment_source from purchase_order_items join purchase_orders on purchase_orders.id=purchase_order_items.purchase_order_id order by order_no desc limit 1")).rows[0];
    assert.equal(Number(manualRow.requested_quantity), 1);
    assert.equal(manualRow.replenishment_source, null);
    // Keep the transaction policy aligned with franchise publication and brand-specific stops,
    // even when the earlier access helper observed an older configuration.
    const fresh = await (await route.GET(new Request(`https://example.test/api/orders?replenishStoreId=${ids.store}&replenishProductId=${ids.product}`))).json();
    const scopedContext = { ...confirmed, expectedOpenItemIds: fresh.openItems.map((item: any) => item.itemId) };
    const franchise = routeHarness(sql, { role: "store_manager" });
    const beforePolicy = await before();
    assert.equal((await franchise.POST(orderRequest(scopedContext))).status, 409);
    assert.equal(await before(), beforePolicy);
    await db.query("update products set catalog_visibility='selected_stores'");
    assert.equal((await franchise.POST(orderRequest(scopedContext))).status, 409);
    assert.equal(await before(), beforePolicy);
    await db.query("insert into product_catalog_store_grants(product_id,store_id) values($1,$2)", [ids.product, ids.store]);
    await db.query("update products set brand_scope='specific'");
    assert.equal((await franchise.POST(orderRequest(scopedContext))).status, 409);
    assert.equal(await before(), beforePolicy);
    await db.query("insert into store_brands values($1,$2)", [ids.store, ids.otherProduct]);
    await db.query("insert into product_brand_usages values($1,$2,false)", [ids.product, ids.otherProduct]);
    assert.equal((await franchise.POST(orderRequest(scopedContext))).status, 409);
    assert.equal(await before(), beforePolicy);
    await db.query("update product_brand_usages set is_orderable=true");
    assert.equal((await franchise.POST(orderRequest(scopedContext))).status, 200);
  } finally {
    await db.close();
  }
});
