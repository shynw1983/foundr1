import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as policy from "./procurement-confirmation-policy.ts";
import * as numberInput from "./number-input.ts";
import { isHeadquarterCatalogRole } from "./product-catalog-policy.ts";
import * as orderLocks from "./replenishment-order-locks.ts";

const deliveredItem = { currentStatus: "delivered", requestedQuantity: 10 };
const expectedQuantity = { productId: "product", unit: "袋", actualQuantity: 6, requestedQuantity: 10 };
const expectedPrice = { productId: "product", unit: "袋", actualPrice: 125, referencePrice: 100 };

test("new and previous confirmation requests preserve the original quantity and price", () => {
  assert.deepEqual(policy.resolveProcurementFeedbackConfirmation({ itemId: "item", confirmFeedbackKind: "quantity", expectedConfirmation: expectedQuantity }, deliveredItem), { kind: "quantity", expectedSnapshot: expectedQuantity });
  assert.deepEqual(policy.resolveProcurementFeedbackConfirmation({ itemId: "item", clearActualPrice: true }, deliveredItem), { kind: "price" });
  assert.deepEqual(policy.resolveProcurementFeedbackConfirmation({ itemId: "item", actualQuantity: 10 }, deliveredItem), { kind: "quantity" });
  const actual = { actualQuantity: 6, actualPrice: "125", quantityFeedbackConfirmed: false, priceFeedbackConfirmed: false };
  const confirmed = policy.applyProcurementFeedbackConfirmation(policy.applyProcurementFeedbackConfirmation(actual, "quantity"), "price");
  assert.equal(confirmed.actualQuantity, 6);
  assert.equal(confirmed.actualPrice, "125");
  assert.equal(actual.quantityFeedbackConfirmed, false);
  assert.equal(confirmed.quantityFeedbackConfirmed, true);
  assert.equal(confirmed.priceFeedbackConfirmed, true);
});

test("confirmation cannot accompany quantity, price, supplier or purchase-state changes", () => {
  for (const mutation of [{ actualQuantity: 10 }, { actualPrice: "0" }, { purchased: false }, { supplier: "other" }, { historyCorrection: true }]) {
    const decision = policy.resolveProcurementFeedbackConfirmation({ itemId: "item", confirmFeedbackKind: "price", ...mutation }, deliveredItem);
    assert.ok(decision && "error" in decision);
  }
  assert.ok("error" in policy.resolveProcurementFeedbackConfirmation({ itemId: "item", clearActualPrice: true, actualQuantity: 10 }, deliveredItem)!);
  assert.equal(policy.resolveProcurementFeedbackConfirmation({ itemId: "item", purchased: true, actualQuantity: 10 }, deliveredItem), null);
  assert.equal(policy.resolveProcurementFeedbackConfirmation({ itemId: "item", historyCorrection: true, actualQuantity: 10 }, deliveredItem), null);
  const staleLegacy = policy.resolveProcurementFeedbackConfirmation({ itemId: "item", actualQuantity: 4 }, deliveredItem);
  assert.ok(staleLegacy && "error" in staleLegacy);
  assert.equal(staleLegacy.status, 409);
  assert.equal(policy.resolveProcurementFeedbackConfirmation({ itemId: "item", actualQuantity: 4 }, { ...deliveredItem, currentStatus: "requested" }), null);
});

test("unrecorded actual quantities remain unknown and demand does not become purchased quantity", () => {
  for (const actualQuantity of [undefined, null, "", "  ", false, {}, -1, NaN]) {
    const metric = policy.getProcurementQuantityMetrics({ status: "購入済み", requestedQuantity: 10, actualQuantity });
    assert.equal(metric.purchasedQuantity, null);
    assert.equal(metric.requestedQuantity, 10);
    assert.equal(metric.missingPurchasedQuantity, true);
  }
  assert.equal(policy.getProcurementQuantityMetrics({ status: "未購入", requestedQuantity: 10, actualQuantity: 10 }).purchasedQuantity, null);
  assert.equal(policy.getProcurementQuantityMetrics({ status: "購入不可", requestedQuantity: 10, actualQuantity: 0 }).purchasedQuantity, null);
  assert.equal(policy.getProcurementQuantityMetrics({ status: "納品済み", requestedQuantity: 10, actualQuantity: 6 }).purchasedQuantity, 6);
  assert.equal(policy.normalizeRecordedProcurementQuantity(0), 0);
});

type Query = { text: string; values: unknown[] };
function routeHarness(options: { session?: boolean; allowed?: boolean; stale?: boolean; orderable?: boolean; currentStatus?: string; hasPurchaseActual?: boolean; actualQuantity?: number | null; actualPrice?: number | null; requestedQuantity?: number; historyCorrectionAllowed?: boolean } = {}) {
  const queries: Query[] = [];
  let catalogChecks = 0;
  const executeQuery = ({ text, values }: Query) => {
    queries.push({ text, values });
    if (text.includes("with facts as")) {
      const serialized = values.find((value) => typeof value === "string" && value.startsWith("{")) as string | undefined;
      const kind = values.includes("price") ? "price" : "quantity";
      const current = policy.createProcurementConfirmationSnapshot(kind, {
        productId: "product", unit: "袋", requestedQuantity: options.requestedQuantity ?? 10,
        actualQuantity: Object.hasOwn(options, "actualQuantity") ? options.actualQuantity : 6, actualPrice: Object.hasOwn(options, "actualPrice") ? options.actualPrice ?? undefined : 125, referencePrice: 100
      });
      const matches = !serialized || policy.procurementConfirmationSnapshotMatches(JSON.parse(serialized), current);
      return Promise.resolve(options.stale || !matches ? [] : [{ id: "item" }]);
    }
    if (text.includes('as "currentProductId"')) return Promise.resolve([{
      itemId: "item", purchaseOrderId: "order", storeId: "store", currentProductId: "product",
      currentStatus: options.currentStatus ?? "delivered", requestedQuantity: options.requestedQuantity ?? 10,
      currentHasPurchaseActual: options.hasPurchaseActual ?? false,
      currentActualQuantity: Object.hasOwn(options, "actualQuantity") ? options.actualQuantity : 6,
      currentActualPrice: Object.hasOwn(options, "actualPrice") ? options.actualPrice : 125, referencePrice: 100, currentNote: "", requestedUnit: "袋"
    }]);
    if (text.includes('select purchase_orders.store_id::text as "storeId"')) return Promise.resolve([{ storeId: "store" }]);
    if (text.includes("from purchase_orders") && text.includes('brand_id as "brandId"')) return Promise.resolve([{ id: "order", storeId: "store" }]);
    if (text.includes("from products") && text.includes("where products.id::text")) return Promise.resolve([{ id: "replacement", name: "代替商品", unit: "袋" }]);
    return Promise.resolve([]);
  };
  const sql = Object.assign((parts: TemplateStringsArray, ...values: unknown[]) => ({
    text: parts.join("?"), values,
    then(resolve: any, reject: any) { return executeQuery(this).then(resolve, reject); }
  }), { transaction: async (statements: Query[]) => {
    const results = [];
    for (const statement of statements) results.push(await executeQuery(statement));
    return results;
  } });
  const modules: Record<string, unknown> = {
    "../../../../lib/api-auth": {
      requireWritableOsSession: async () => options.session === false ? null : { id: "employee", role: "staff" },
      requireOwnerOsSession: async () => null,
      canAccessStore: async () => options.allowed !== false
    },
    "../../../../lib/db": { sql },
    "../../../../lib/notification-realtime": { publishOsNotificationEvent: async () => undefined },
    "../../../../lib/order-realtime": { publishStoreOperationalEvent: async () => undefined },
    "../../../../lib/role-permissions": { roleHasPermission: async () => options.historyCorrectionAllowed === true },
    "../../../../lib/product-catalog-access": {
      assertProductsOrderable: async () => {
        catalogChecks += 1;
        return options.orderable === false ? { ok: false, status: 403, error: "非公開商品" } : { ok: true };
      }
    },
    "../../../../lib/product-catalog-policy": { isHeadquarterCatalogRole },
    "../../../../lib/procurement-confirmation-policy": policy,
    "../../../../lib/replenishment-order-locks": orderLocks
  };
  const exports: Record<string, (request: Request) => Promise<Response>> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/procurement/items/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, Response, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unmocked route dependency: ${name}`);
    return modules[name];
  } });
  return {
    queries,
    getCatalogChecks: () => catalogChecks,
    post: (body: Record<string, unknown>) => exports.POST(new Request("https://example.test/api/procurement/items", { method: "POST", body: JSON.stringify({ orderId: "order", requestedQuantity: 1, ...body }) })),
    patch: (body: Record<string, unknown>) => exports.PATCH(new Request("https://example.test/api/procurement/items", { method: "PATCH", body: JSON.stringify({ itemId: "item", ...body }) }))
  };
}

test("confirmation API writes only snapshots and audit history, including older clients", async () => {
  for (const body of [{ confirmFeedbackKind: "quantity", expectedConfirmation: expectedQuantity }, { confirmFeedbackKind: "price", expectedConfirmation: expectedPrice }, { clearActualPrice: true }, { actualQuantity: 10 }]) {
    const harness = routeHarness();
    assert.equal((await harness.patch(body)).status, 200);
    const writes = harness.queries.filter((query) => /update |insert into |delete from /i.test(query.text));
    assert.equal(writes.length, 1);
    assert.ok(writes[0].text.includes("price_feedback_confirmation"));
    assert.ok(writes[0].text.includes("quantity_feedback_confirmation"));
    assert.ok(writes[0].text.includes("insert into purchase_exceptions"));
    assert.ok(!/actual_quantity\s*=|actual_price\s*=|requested_quantity\s*=|price_records|delete from purchase_actuals/i.test(writes[0].text));
  }
});

test("a previous client cannot overwrite actual quantity when demand changed after it displayed the confirmation", async () => {
  for (const currentStatus of ["in_delivery", "delivered", "received"]) {
    const harness = routeHarness({ currentStatus, requestedQuantity: 8, actualQuantity: 6 });
    assert.equal((await harness.patch({ actualQuantity: 10 })).status, 409);
    assert.ok(!harness.queries.some((query) => /update |insert into |delete from /i.test(query.text)));
    const currentEditor = routeHarness({ currentStatus, requestedQuantity: 8, actualQuantity: 6 });
    assert.equal((await currentEditor.patch({ purchased: true, actualQuantity: 10 })).status, 200);
    assert.ok(currentEditor.queries.some((query) => query.text.includes("update purchase_order_items")));
  }
});

test("existing hidden or stopped transactions can still confirm, while new additions and replacements require orderability", async () => {
  const existing = routeHarness({ orderable: false });
  assert.equal((await existing.patch({ confirmFeedbackKind: "quantity", expectedConfirmation: expectedQuantity })).status, 200);
  assert.equal(existing.getCatalogChecks(), 0);
  const additional = routeHarness({ orderable: false });
  assert.equal((await additional.post({ productId: "hidden" })).status, 403);
  assert.equal(additional.getCatalogChecks(), 1);
  assert.ok(!additional.queries.some((query) => /update |insert into |delete from /i.test(query.text)));
  const replacement = routeHarness({ orderable: false, currentStatus: "requested" });
  assert.equal((await replacement.patch({ productId: "replacement", purchased: true, supplier: "new source" })).status, 403);
  assert.equal(replacement.getCatalogChecks(), 1);
  assert.ok(!replacement.queries.some((query) => /update |insert into |delete from /i.test(query.text)));
});

test("new purchases require actual quantity before any supplier or purchase write", async () => {
  for (const actualQuantity of [null, -1]) {
    const harness = routeHarness({ currentStatus: "requested", actualQuantity: null });
    assert.equal((await harness.patch({ purchased: true, actualQuantity, supplier: "new source" })).status, 400);
    assert.ok(!harness.queries.some((query) => /update |insert into |delete from /i.test(query.text)));
  }
});

test("a previous workbench cannot invent any unknown actual quantity, while explicit current entry and history correction remain allowed", async () => {
  for (const currentStatus of ["requested", "purchased", "delivered", "received"]) {
    const legacy = routeHarness({ currentStatus, actualQuantity: null, hasPurchaseActual: currentStatus !== "requested" });
    assert.equal((await legacy.patch({ purchased: true, actualQuantity: 10, note: "legacy metadata", supplier: "new source" })).status, 409);
    assert.ok(!legacy.queries.some((query) => /update |insert into |delete from /i.test(query.text)));
    const current = routeHarness({ currentStatus, actualQuantity: null });
    assert.equal((await current.patch({ purchased: true, actualQuantity: 10, actualQuantityRecordedExplicitly: true })).status, 200);
    const unknown = routeHarness({ currentStatus: "delivered", actualQuantity: null });
    assert.equal((await unknown.patch({ purchased: true, actualQuantity: null, note: "keep unknown" })).status, 200);
    const changedDemand = routeHarness({ currentStatus, actualQuantity: null, requestedQuantity: 8 });
    assert.equal((await changedDemand.patch({ purchased: true, actualQuantity: 10, note: "previous demand fallback" })).status, 409);
    assert.ok(!changedDemand.queries.some((query) => /update |insert into |delete from /i.test(query.text)));
  }
  const alreadyKnown = routeHarness({ currentStatus: "delivered", actualQuantity: 6 });
  assert.equal((await alreadyKnown.patch({ purchased: true, actualQuantity: 10 })).status, 200);
  const corrected = routeHarness({ currentStatus: "delivered", actualQuantity: null, historyCorrectionAllowed: true });
  assert.equal((await corrected.patch({ historyCorrection: true, purchased: true, actualQuantity: 10 })).status, 200);
});

test("editing an existing purchase retains recorded quantity and price without inferring demand", async () => {
  const known = routeHarness({ currentStatus: "purchased", actualQuantity: 6, actualPrice: 125 });
  assert.equal((await known.patch({ purchased: true, note: "updated note" })).status, 200);
  const knownInsert = known.queries.find((query) => query.text.includes("insert into purchase_actuals"));
  assert.ok(knownInsert);
  assert.ok(knownInsert.values.includes(6));
  assert.ok(knownInsert.values.includes(125));
  assert.ok(!knownInsert.text.includes("requested_quantity"));
  const unknown = routeHarness({ currentStatus: "delivered", actualQuantity: null, actualPrice: null });
  assert.equal((await unknown.patch({ purchased: true, note: "retained history" })).status, 200);
  const unknownInsert = unknown.queries.find((query) => query.text.includes("insert into purchase_actuals"));
  assert.ok(unknownInsert);
  assert.ok(!unknownInsert.text.includes("requested_quantity"));
  assert.ok(!unknownInsert.values.includes(10));
  assert.ok(!unknown.queries.some((query) => query.text.includes("insert into price_records")));
});

test("an existing purchase record keeps an unknown quantity editable even when the item status is requested", async () => {
  const harness = routeHarness({ currentStatus: "requested", hasPurchaseActual: true, actualQuantity: null });
  assert.equal((await harness.patch({ purchased: true, note: "retained old purchase" })).status, 200);
  const insert = harness.queries.find((query) => query.text.includes("insert into purchase_actuals"));
  assert.ok(insert && !insert.text.includes("requested_quantity"));
});

test("missing login, inaccessible stores, mixed writes and stale feedback cannot confirm or erase facts", async () => {
  const unauthenticated = routeHarness({ session: false });
  assert.equal((await unauthenticated.patch({ confirmFeedbackKind: "price", expectedConfirmation: expectedPrice })).status, 403);
  assert.equal(unauthenticated.queries.length, 0);
  const denied = routeHarness({ allowed: false });
  assert.equal((await denied.patch({ confirmFeedbackKind: "quantity", expectedConfirmation: expectedQuantity })).status, 403);
  assert.ok(!denied.queries.some((query) => /update |insert into |delete from /i.test(query.text)));
  const mixed = routeHarness();
  assert.equal((await mixed.patch({ confirmFeedbackKind: "price", expectedConfirmation: expectedPrice, actualPrice: "0" })).status, 400);
  assert.ok(!mixed.queries.some((query) => /update |insert into |delete from /i.test(query.text)));
  const stale = routeHarness({ stale: true });
  assert.equal((await stale.patch({ confirmFeedbackKind: "quantity", expectedConfirmation: expectedQuantity })).status, 409);
  assert.ok(!stale.queries.some((query) => /actual_quantity\s*=|actual_price\s*=|price_records/i.test(query.text)));
});

test("a quantity or price change after the displayed snapshot rejects confirmation and repeated confirmation uses an idempotent audit", async () => {
  for (const [options, body] of [
    [{ actualQuantity: 7 }, { confirmFeedbackKind: "quantity", expectedConfirmation: expectedQuantity }],
    [{ actualPrice: 140 }, { confirmFeedbackKind: "price", expectedConfirmation: expectedPrice }]
  ] as const) {
    const harness = routeHarness(options);
    assert.equal((await harness.patch(body)).status, 409);
    const query = harness.queries.find((entry) => entry.text.includes("with facts as"));
    assert.ok(query?.text.includes("for update of purchase_order_items"));
    assert.ok(query?.text.includes("from eligible facts"));
    assert.ok(query?.text.includes("facts.price_snapshot ="));
    assert.ok(query?.text.includes("facts.quantity_snapshot ="));
  }
  const repeat = routeHarness();
  const body = { confirmFeedbackKind: "quantity", expectedConfirmation: expectedQuantity };
  assert.equal((await repeat.patch(body)).status, 200);
  assert.equal((await repeat.patch(body)).status, 200);
  const queries = repeat.queries.filter((entry) => entry.text.includes("with facts as"));
  assert.equal(queries.length, 2);
  for (const query of queries) assert.ok(query.text.includes("confirmed.previous_quantity_snapshot is distinct from confirmed.quantity_snapshot"));
  const invalid = routeHarness();
  assert.equal((await invalid.patch({ confirmFeedbackKind: "quantity" })).status, 400);
  assert.ok(!invalid.queries.some((entry) => entry.text.includes("with facts as")));
});

function uiFunctions(path: string, functionNames: string[]) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8") + `\nexport { ${functionNames.join(", ")} };`;
  const exports: Record<string, (...args: any[]) => any> = {};
  const modules: Record<string, unknown> = {
    "../../../lib/mock-data": { orders: [], products: [], stores: [] },
    "../../../lib/number-input": numberInput,
    "../../../lib/procurement-confirmation-policy": policy
  };
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, { exports, require: (name: string) => modules[name] ?? {} });
  return exports;
}

test("history totals retain unknown actual quantities and exclude unpurchased demand from purchased metrics", () => {
  const { createHistoryRows, createPurchaseHistoryRows, createHistoryReportRows } = uiFunctions("../app/os/history/page.tsx", ["createHistoryRows", "createPurchaseHistoryRows", "createHistoryReportRows"]);
  const order = { id: "order", store: "店舗", createdAt: "2026-10-08T00:00:00Z" };
  const rows = createHistoryRows([order], [
    { id: "pending", orderId: "order", productName: "商品", requestedQuantity: 10, actualQuantity: 10, unit: "袋" },
    { id: "unknown", orderId: "order", productName: "商品", requestedQuantity: 10, purchased: true, actualPrice: "100", unit: "袋" },
    { id: "purchased", orderId: "order", productName: "商品", requestedQuantity: 10, actualQuantity: 6, purchased: true, actualPrice: "100", unit: "袋" }
  ], [], []);
  assert.equal(rows[1].actualQuantity, null);
  const purchases = createPurchaseHistoryRows(rows);
  assert.equal(purchases.length, 2);
  assert.equal(purchases.find((row: any) => row.id === "unknown").amount, null);
  assert.equal(purchases.find((row: any) => row.id === "purchased").amount, 600);
  const report = createHistoryReportRows(rows)[0];
  assert.equal(report.totalRequestedQuantity, 30);
  assert.equal(report.totalActualQuantity, 6);
  assert.equal(report.missingPurchasedQuantityCount, 1);
});

test("store feedback stays acknowledged after refresh and a small price difference cannot hide quantity feedback", () => {
  const { createStoreFeedbackItems } = uiFunctions("../app/os/orders/page.tsx", ["createStoreFeedbackItems"]);
  const item = { id: "item", orderId: "order", productName: "商品", actualQuantity: 6, requestedQuantity: 10, actualPrice: "102", referencePrice: 100, unit: "袋", deliveryStatus: "delivered" };
  assert.equal(createStoreFeedbackItems([], [item], []).length, 1);
  assert.equal(createStoreFeedbackItems([], [{ ...item, quantityFeedbackConfirmed: true }], []).length, 0);
  assert.equal(createStoreFeedbackItems([], [{ ...item, actualPrice: "125", priceFeedbackConfirmed: true, quantityFeedbackConfirmed: true }], []).length, 0);
});

test("pending confirmations do not optimistically hide quantities that changed since the user viewed them", () => {
  const { applyPendingStoreConfirmationsToItems } = uiFunctions("../app/os/orders/page.tsx", ["applyPendingStoreConfirmationsToItems"]);
  const item = { id: "item", productId: "product", unit: "袋", requestedQuantity: 10, actualQuantity: 7 };
  const actions = [{ type: "feedback_confirmed", feedback: { itemId: "item", kind: "quantity", expectedConfirmation: expectedQuantity } }];
  assert.equal(applyPendingStoreConfirmationsToItems([item], actions)[0].quantityFeedbackConfirmed, undefined);
  assert.equal(applyPendingStoreConfirmationsToItems([{ ...item, actualQuantity: 6 }], actions)[0].quantityFeedbackConfirmed, true);
});

test("store product picker enforces store IDs and includes the correct brands in a multi-brand store", () => {
  const { getProductsForStore } = uiFunctions("../app/os/orders/page.tsx", ["getProductsForStore"]);
  const stores = [{ id: "store-a", name: "A", brands: ["nanacha", "maamaa"] }];
  const products = [{ name: "allowed", orderableStoreIds: ["store-a"] }, { name: "hidden", orderableStoreIds: ["store-b"] }, { name: "multi", brand: "maamaa" }, { name: "other", brand: "other" }];
  assert.equal(getProductsForStore(products, stores, "A").map((product: any) => product.name).join(","), "allowed,multi");
  assert.equal(getProductsForStore(products, stores, "missing").length, 0);
});
