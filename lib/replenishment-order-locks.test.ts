import assert from "node:assert/strict";
import test from "node:test";
import { createReplenishmentOrderLocks, replenishmentOrderLockKeys } from "./replenishment-order-locks.ts";

test("writers moving a store or replacing a SKU share one deterministic lock order", () => {
  const oldAndNew = [
    { storeId: "store-b", productIds: ["SKU-b", "sku-a", null] },
    { storeId: "store-a", productIds: ["sku-b", "sku-b"] }
  ];
  const keys = replenishmentOrderLockKeys(oldAndNew, "ORDER-A");
  assert.deepEqual(keys, ["purchase-order-items:order-a", "purchase-order:store-a:sku-b", "purchase-order:store-b:sku-a", "purchase-order:store-b:sku-b"]);
  assert.deepEqual(replenishmentOrderLockKeys([...oldAndNew].reverse(), "order-a"), keys);
  const queries = createReplenishmentOrderLocks((parts, ...values) => ({ sql: parts.join("?"), values }), oldAndNew, "order-a");
  assert.deepEqual(queries.map((query) => query.values[0]), keys);
  assert.ok(queries.every((query) => query.sql.includes("pg_advisory_xact_lock")));
  assert.deepEqual(replenishmentOrderLockKeys([{ storeId: "store-a", productIds: [null] }], "order-a"), ["purchase-order-items:order-a"]);
});
