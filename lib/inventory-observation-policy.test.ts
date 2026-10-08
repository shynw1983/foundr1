import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as policy from "./inventory-observation-policy.ts";

test("shortage observations remain actionable when counts are unknown or older than the observation", () => {
  for (const currentQuantity of [null, 8]) {
    for (const exceptionCode of ["low", "out"]) {
      assert.equal(policy.inventoryNeedsOrder({ currentQuantity, safetyStock: 1, exceptionCode }), true);
    }
  }
  assert.equal(policy.inventoryNeedsOrder({ currentQuantity: null, safetyStock: 1, exceptionCode: "" }), false);
  assert.equal(policy.inventoryNeedsOrder({ currentQuantity: 1, safetyStock: 1, exceptionCode: "" }), true);
  assert.equal(policy.inventoryNeedsOrder({ currentQuantity: 8, safetyStock: 1, exceptionCode: "quality" }), false);
});

test("an absent or malformed count is never converted to zero", () => {
  for (const value of [null, undefined, "", "  ", false, [], {}, "0x10", "1.234", -1, Infinity, 10_000_000_000]) {
    assert.equal(policy.normalizeInventoryCount(value), null, String(value));
  }
  for (const [value, expected] of [[0, 0], ["0", 0], [" 2.75 ", 2.75], [".5", 0.5], [5, 5]] as const) {
    assert.equal(policy.normalizeInventoryCount(value), expected);
  }
  assert.equal(policy.inventoryCountException(0, 1), "out");
  assert.equal(policy.inventoryCountException(0.5, 1), "low");
  assert.equal(policy.inventoryCountException(6.25, 1), "");
});

type Query = { text: string; values: unknown[] };

function routeHarness(options: {
  allowed?: boolean;
  productAllowed?: boolean;
  transactionFails?: boolean;
  visibleIdsByStore?: Record<string, string[]>;
  currentCountUnit?: string;
  currentSafetyStock?: number;
} = {}) {
  const queries: Query[] = [];
  const transactions: Array<Promise<unknown>[]> = [];
  const catalogCalls: Array<{ action: "read" | "configure"; storeId: string; productId?: string }> = [];
  const countState = { unit: options.currentCountUnit ?? "袋", quantity: 8, writes: 0 };
  const sql = Object.assign((parts: TemplateStringsArray, ...values: unknown[]) => {
    const text = parts.join("?");
    queries.push({ text, values });
    if (text.includes("with counted as")) {
      if (options.transactionFails) return Promise.reject(new Error("history insert failed"));
      if (values[6] !== countState.unit) return Promise.resolve([]);
      countState.quantity = Number(values[0]);
      countState.writes += 1;
      return Promise.resolve([{
        itemId: "item", quantity: countState.quantity, countUnit: countState.unit,
        exceptionCode: policy.inventoryCountException(countState.quantity, options.currentSafetyStock ?? 1)
      }]);
    }
    if (text.includes('count_unit as "countUnit", safety_stock')) {
      return Promise.resolve([{ id: "item", storeId: "store", productId: "product", countUnit: "袋", safetyStock: 1 }]);
    }
    if (text.includes("select id, unit from products") || text.includes("from inventory_locations")) {
      return Promise.resolve([{ id: "product", unit: "袋" }]);
    }
    if (text.includes('coalesce(products.storage_type, \'\') as "storageType"')) {
      return Promise.resolve([{ id: "product", name: "通常商品" }, { id: "other", name: "別店舗商品" }, { id: "hidden", name: "非公開商品" }]);
    }
    if (text.includes('exception_code as "exceptionCode"') && text.includes("and exception_code in")) {
      return Promise.resolve([{ id: "item", exceptionCode: "" }, { id: "other", exceptionCode: "low" }]);
    }
    return Promise.resolve([]);
  }, {
    transaction: async (statements: Array<Promise<unknown>>) => {
      transactions.push(statements);
      if (options.transactionFails) throw new Error("history insert failed");
      return Promise.all(statements);
    }
  });
  const modules: Record<string, unknown> = {
    "../../../lib/api-auth": {
      requireOsSession: async () => ({ id: "employee", role: "staff" }),
      canAccessStore: async () => options.allowed !== false,
      getSessionStoreScope: async () => ({ allStores: true, storeIds: [] })
    },
    "../../../lib/db": { sql },
    "../../../lib/role-permissions": { roleHasPermission: async () => true },
    "../../../lib/inventory-observation-policy": policy,
    "../../../lib/product-catalog-access": {
      getVisibleProductIdsForStore: async (_session: unknown, storeId: string) => {
        catalogCalls.push({ action: "read", storeId });
        return options.visibleIdsByStore?.[storeId] ?? ["product"];
      },
      assertProductViewableAtStore: async (_session: unknown, storeId: string, productId: string) => {
        catalogCalls.push({ action: "configure", storeId, productId });
        return options.productAllowed === false
          ? { ok: false, status: 403, error: "この店舗では商品を利用できません。" }
          : { ok: true };
      }
    }
  };
  const exports: Record<string, (request: Request) => Promise<Response>> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/inventory/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, Response, URL, require: (name: string) => modules[name] });
  const post = (body: Record<string, unknown>) => exports.POST(new Request("https://example.test/api/inventory", {
    method: "POST", body: JSON.stringify({ storeId: "store", itemId: "item", ...body })
  }));
  return {
    post, queries, transactions, catalogCalls, countState,
    get: (storeId = "store") => exports.GET(new Request(`https://example.test/api/inventory?storeId=${encodeURIComponent(storeId)}`))
  };
}

test("an exception records its actor and unit without renewing the actual-count timestamp", async () => {
  const { post, queries, transactions } = routeHarness();
  assert.equal((await post({ action: "exception", exceptionCode: "low" })).status, 200);
  const update = queries.find((query) => query.text.includes("update inventory_items"));
  assert.ok(update);
  assert.ok(!update.text.includes("last_counted_at"));
  assert.ok(!update.text.includes("last_counted_by"));
  const history = queries.find((query) => query.text.includes("insert into inventory_checks"));
  assert.ok(history?.text.includes("count_unit"));
  assert.ok(history?.values.includes("employee"));
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].length, 2);
});

test("batch shortage changes preserve count freshness and snapshot units", async () => {
  const { post, queries, transactions } = routeHarness();
  assert.equal((await post({ action: "batch_low_stock", lowItemIds: ["item"], clearLowItemIds: ["other"] })).status, 200);
  const updates = queries.filter((query) => query.text.includes("update inventory_items"));
  assert.equal(updates.length, 2);
  for (const update of updates) assert.ok(!update.text.includes("last_counted"));
  for (const history of queries.filter((query) => query.text.includes("insert into inventory_checks"))) {
    assert.ok(history.text.includes("current_quantity, count_unit, 'exception'"));
  }
  assert.equal(transactions[0].length, 4);
});

test("confirmed counts and history save together, while invalid quantities and other stores cannot write", async () => {
  const { post, queries, transactions } = routeHarness();
  const response = await post({ action: "count", quantity: "6.25", countUnit: "袋" });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).count, { itemId: "item", quantity: 6.25, countUnit: "袋", exceptionCode: "" });
  const update = queries.find((query) => query.text.includes("update inventory_items"));
  assert.ok(update?.text.includes("last_counted_at = now()"));
  const history = queries.find((query) => query.text.includes("insert into inventory_checks"));
  assert.ok(history?.values.includes(6.25));
  assert.ok(history?.text.includes("product_id, current_quantity, count_unit"));
  assert.ok(history?.text.includes("from counted"));
  assert.equal(transactions.length, 0);
  const invalid = routeHarness();
  assert.equal((await invalid.post({ action: "count", quantity: "" })).status, 400);
  assert.equal(invalid.transactions.length, 0);
  const denied = routeHarness({ allowed: false });
  assert.equal((await denied.post({ action: "count", quantity: 3 })).status, 403);
  assert.equal(denied.queries.length, 0);
  const failure = routeHarness({ transactionFails: true });
  await assert.rejects(failure.post({ action: "count", quantity: 3, countUnit: "袋" }), /history insert failed/);
});

test("history reads its saved unit rather than the current inventory unit", async () => {
  const { get, queries } = routeHarness();
  assert.equal((await get()).status, 200);
  const history = queries.find((query) => query.text.includes("inventory_checks.id::text"));
  assert.ok(history?.text.includes('inventory_checks.count_unit as "countUnit"'));
  assert.ok(!history?.text.includes('inventory_items.count_unit as "countUnit"'));
});

test("changing the counting unit invalidates the old numeric snapshot instead of assuming a conversion", async () => {
  const { post, queries } = routeHarness();
  assert.equal((await post({ action: "configure", productId: "product", locationId: "location", countUnit: "箱", safetyStock: 2 })).status, 200);
  const configure = queries.find((query) => query.text.includes("insert into inventory_items"));
  assert.ok(configure);
  for (const field of ["current_quantity", "last_counted_at", "last_counted_by"]) {
    assert.ok(configure.text.includes(`${field} = case`));
    assert.ok(configure.text.includes(`then inventory_items.${field}\n          else null`));
  }
});

test("inventory setup offers the selected store's catalog instead of another accessible store's products", async () => {
  const { get, catalogCalls } = routeHarness({ visibleIdsByStore: { store: ["product"], otherStore: ["other"] } });
  const first = await (await get("store")).json();
  assert.deepEqual(first.products.map((product: { id: string }) => product.id), ["product"]);
  const second = await (await get("otherStore")).json();
  assert.deepEqual(second.products.map((product: { id: string }) => product.id), ["other"]);
  assert.equal(second.selectedStoreId, "otherStore");
  assert.deepEqual(catalogCalls, [{ action: "read", storeId: "store" }, { action: "read", storeId: "otherStore" }]);
});

test("a forged configure request for a hidden product is rejected before configuring inventory", async () => {
  const { post, queries, catalogCalls } = routeHarness({ productAllowed: false });
  const response = await post({ action: "configure", productId: "hidden", locationId: "location", countUnit: "袋" });
  assert.equal(response.status, 403);
  assert.equal(queries.length, 0);
  assert.deepEqual(catalogCalls, [{ action: "configure", storeId: "store", productId: "hidden" }]);
});

test("missing or concurrently changed count units reject stale counts without updating quantity or history", async () => {
  const missingUnit = routeHarness();
  assert.equal((await missingUnit.post({ action: "count", quantity: 6 })).status, 409);
  assert.equal(missingUnit.countState.writes, 0);
  assert.ok(!missingUnit.queries.some((query) => query.text.includes("update inventory_items")));
  const changedUnit = routeHarness({ currentCountUnit: "箱" });
  assert.equal((await changedUnit.post({ action: "count", quantity: 6, countUnit: "袋" })).status, 409);
  assert.equal(changedUnit.countState.writes, 0);
  assert.equal(changedUnit.countState.quantity, 8);
  const countQuery = changedUnit.queries.find((query) => query.text.includes("with counted as"));
  assert.ok(countQuery?.text.includes("and count_unit = ?"));
  assert.ok(countQuery?.text.includes("and store_id = ?::uuid"));
  assert.ok(countQuery?.text.includes("from counted"));
});

test("count shortage classification uses the current database threshold when configuration changes during counting", async () => {
  const { post, queries } = routeHarness({ currentSafetyStock: 10 });
  const response = await post({ action: "count", quantity: 6.25, countUnit: "袋" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).count.exceptionCode, "low");
  const countQuery = queries.find((query) => query.text.includes("with counted as"));
  assert.ok(countQuery?.text.includes("when ?::numeric = 0 then 'out'"));
  assert.ok(countQuery?.text.includes("when ?::numeric <= inventory_items.safety_stock"));
  assert.ok(countQuery?.text.includes("<= inventory_items.safety_stock then 'low'"));
});
