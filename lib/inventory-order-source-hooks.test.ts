import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Query = { text: string; values: unknown[] };
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const orderId = uuid(1), storeId = uuid(2), brandId = uuid(3), menuId = uuid(4), groupId = uuid(5), optionId = uuid(6);
function load(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, {
    exports, Response, Request, Date, Intl, URL, console, process: { env: {} },
    require: (name: string) => {
      const key = name.split("/").at(-1)!;
      if (!(key in dependencies)) throw new Error(`Unexpected source dependency ${name}`);
      return dependencies[key];
    }
  });
  return exports;
}
function dependencies(sql: unknown, events: string[], options: { readyOptions?: unknown[] } = {}) {
  return {
    db: { sql }, crypto: { randomUUID: () => uuid(7) },
    "inventory-order-usage": { markInventoryOrderReady: async (id: string, opts?: unknown) => {
      events.push(`ready:${id}`);
      options.readyOptions?.push(opts);
    } },
    "sales-orders": { syncWebReservationToSalesOrder: async (id: string) => events.push(`sales:${id}`) },
    "order-production": { ensureProductionTasksForOrder: async () => events.push("kitchen") },
    "order-realtime": { publishCustomerOrderEvent: async () => events.push("published") },
    "store-payment-accounts": {},
    "customer-orders": { createPickupCode: () => "D-TEST", findCustomerOrderById: async () => ({ id: orderId }), refundCustomerOrderPayment: async () => ({ok: true, refundId: "refund"}) },
    "api-auth": { requireOsSession: async () => ({id: uuid(8), name: "Staff", role: "staff"}) },
    "store-order-access": { getStoreOrderAccess: async () => ({stores: [{id: storeId}]}), getScopedStoreFilter: () => storeId },
    "pos-catalog-policy": { isPosSellableItem: () => true },
    "pos-printer": { normalizePosPrinterSettings: () => ({}) },
    "store-dining-sessions": { markDiningOrdersPaid: async () => undefined },
    "loyalty": {
      resolveMemberForOrder: async () => null, awardLoyaltyForPaidOrder: async () => null,
      reverseLoyaltyForRefundedOrderItem: async () => undefined, reverseLoyaltyForRefundedOrder: async () => undefined
    },
    server: { after: () => undefined },
    "store-order-shortage-rules": { calculateShortageRefundAmount: () => 0, canHandleShortageAsSeparateOption: () => true }
  };
}
function jsonValue(query: Query, column: string) {
  const fields = query.text.match(/insert into store_customer_order_items\s*\(([\s\S]*?)\)\s*values/)![1].split(",").map((value) => value.trim());
  return query.values[fields.indexOf(column)];
}

function webHarness(failItem = 0) {
  const events: string[] = [];
  let items = 0;
  const sql = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const text = parts.join("?");
    if (text.includes("insert into store_customer_orders")) { events.push("order"); return [{id: orderId}]; }
    if (text.includes("insert into store_customer_order_items")) {
      items += 1;
      if (items === failItem) throw new Error("item write failed");
      events.push(`item:${items}`);
    }
    return [];
  };
  const module = load("./customer-orders.ts", dependencies(sql, events));
  const item = { menuCatalogItemId: menuId, itemName: "Tea", sizeKey: "", sizeLabel: "", temperature: "", sweetness: "", ice: "", optionKey: "", optionLabel: "", toppingKeys: [], toppingLabels: [], amount: 200 };
  return {events, create: () => module.createCustomerOrder({brandId, storeId, pickupCode: "N-TEST", pickupDate: "2026-10-11", pickupTime: "12:00", amount: 400, customerSummary: {}, drink: "Tea", size: "", temperature: "", sweetness: "", ice: "", option: "", toppings: "", items: [item, item]})};
}
test("web readiness follows all source rows and precedes sales synchronization", async () => {
  const h = webHarness();
  await h.create();
  assert.deepEqual(h.events, ["order", "item:1", "item:2", `ready:${orderId}`, `sales:${orderId}`]);
  const incomplete = webHarness(2);
  await assert.rejects(incomplete.create(), /item write failed/);
  assert.deepEqual(incomplete.events, ["order", "item:1"]);
});

function checkoutHarness(platform: "pos" | "table", failItem = 0) {
  const writes: Query[] = [], events: string[] = [];
  let items = 0;
  const sql = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const text = parts.join("?");
    if (/\b(insert|update|delete)\b/.test(text)) writes.push({text, values});
    if (text.includes("from store_tables")) return [{tableId: uuid(9), tableDisplayName: "Table", tableLabel: "1", tableOrderingEnabled: true, storeId, storeName: "Store", brandId, brandName: "nanacha", dineInEnabled: true}];
    if (text.includes("from menu_catalog_items")) return [{id: menuId, brandId, name: "Tea", itemKind: "fixed_product", category: "Tea", price: 200, variableSchema: {}}];
    if (text.includes("from menu_options")) return [{id: optionId, optionKey: "extra", name: "Pearl", groupId, groupKey: "extras", groupName: "Extras", selectionType: "quantity", ruleJson: {limit: 5}, brandId, menuCatalogItemId: menuId, groupApplicableCategories: [], applicableCategories: [], priceDelta: 10}];
    if (text.includes("from pos_cash_sessions")) return [{id: uuid(10)}];
    if (text.includes("insert into store_customer_orders")) { events.push("order"); return [{id: orderId}]; }
    if (text.includes("insert into store_customer_order_items")) {
      items += 1;
      if (items === failItem) throw new Error("item write failed");
      events.push(`item:${items}`);
    }
    return [];
  };
  const module = load(platform === "pos" ? "../app/api/store/pos/route.ts" : "../app/api/public/table-order/orders/route.ts", dependencies(sql, events));
  const body = {
    storeId, orderType: "takeout", paymentMethod: "cash", cashTenderedAmount: 2000,
    token: "table-token", visitKey: "visit-00000000000000",
    items: [0, 1].map(() => ({menuCatalogItemId: menuId, quantity: 3, selectedOptions: [{groupId: "forged-client-label", optionIds: [optionId, optionId]}]}))
  };
  return {writes, events, post: () => module.POST(new Request("https://example.test/checkout", {method: "POST", body: JSON.stringify(body)}))};
}
for (const platform of ["pos", "table"] as const) {
  test(`${platform} persists actual option/group UUIDs and repeated option quantities before readiness`, async () => {
    const h = checkoutHarness(platform);
    assert.equal((await h.post()).status, platform === "pos" ? 200 : 201);
    const items = h.writes.filter((query) => query.text.includes("insert into store_customer_order_items"));
    assert.equal(items.length, 2);
    for (const item of items) {
      const groups = JSON.parse(String(jsonValue(item, "customizations")));
      assert.equal(groups[0].groupId, groupId);
      assert.deepEqual(groups[0].optionIds, [optionId, optionId]);
      assert.deepEqual(groups[0].optionLabels, ["Pearl", "Pearl"]);
      assert.equal(jsonValue(item, "quantity"), 3);
      assert.equal(jsonValue(item, "menu_catalog_item_id"), menuId);
      assert.ok(!String(jsonValue(item, "customizations")).includes("forged-client-label"));
    }
    assert.deepEqual(h.events.slice(0, 4), ["order", "item:1", "item:2", `ready:${orderId}`]);
  });
  test(`${platform} partial item failure cannot mark a paid or unpaid order ready`, async () => {
    const h = checkoutHarness(platform, 2);
    await assert.rejects(h.post(), /item write failed/);
    assert.deepEqual(h.events, ["order", "item:1"]);
  });
}

function shortageHarness(failMutation = false, targetKey = "item") {
  const events: string[] = [], readyOptions: unknown[] = [], writes: Query[] = [];
  const sql = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const text = parts.join("?");
    if (/\b(insert|update|delete)\b/.test(text)) writes.push({text, values});
    if (text.includes("join store_customer_order_items")) return [{orderId, orderSource: "nanacha_web", status: "preparing", paymentStatus: "paid", shortagePreference: "substitute_or_refund", orderAmount: 200, itemId: uuid(11), itemName: "Tea", amount: 200, grossAmount: 200, paidAmount: 200, refundedAmount: 0, refundStatus: "", toppingLabels: ["Pearl"], toppingKeys: ["extra"], customizations: [{groupId, groupName: "Extras", optionIds: [optionId], optionKeys: ["extra"], optionLabels: ["Pearl"], optionPrices: [10]}]}];
    if (text.includes("insert into store_order_shortage_actions")) return [{id: uuid(12)}];
    if (text.includes("inventory_items_ready_at = null")) events.push("invalidate");
    if (text.includes("update store_customer_order_items")) {
      if (failMutation) throw new Error("replacement write failed");
      events.push("replace");
    }
    if (text.includes("count(*)::int as count")) return [{count: 1}];
    return [];
  };
  const module = load("./store-order-shortages.ts", dependencies(sql, events, {readyOptions}));
  return {events, readyOptions, writes, replace: () => module.handleStoreOrderShortage({orderId, orderItemId: uuid(11), targetKey, actionType: "replace", replacementName: "Replacement", employeeId: uuid(8), employeeName: "Staff"})};
}
test("item and option replacements explicitly block unresolved identity rather than retaining guessed ingredient identity", async () => {
  for (const key of ["item", "option:0:0"]) {
    const h = shortageHarness(false, key);
    assert.equal((await h.replace()).ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(h.readyOptions)), [{issueCodes: ["unresolved_replacement"]}]);
    assert.deepEqual(h.events.slice(0, 4), ["invalidate", "replace", `ready:${orderId}`, `sales:${orderId}`]);
  }
  const incomplete = shortageHarness(true);
  await assert.rejects(incomplete.replace(), /replacement write failed/);
  assert.deepEqual(incomplete.events, ["invalidate"]);
  assert.deepEqual(incomplete.readyOptions, []);
});

function refundHarness(failItemWrite = false) {
  const events: string[] = [];
  const sql = async (parts: TemplateStringsArray) => {
    const text = parts.join("?");
    if (text.includes('as "cashSessionStatus"') && text.includes("limit 1")) return [{id: orderId, storeId, status: "preparing", paymentStatus: "paid", paymentMethod: "cash", amount: 200, cashSessionStatus: "open"}];
    if (text.includes('as "paidAmount"') && text.includes("from store_customer_order_items")) return [{id: uuid(11), quantity: 1, amount: 200, paidAmount: 200, couponDiscountAmount: 0, couponId: "", refundStatus: ""}];
    if (text.includes("inventory_items_ready_at = null")) events.push("invalidate");
    if (text.includes("update store_customer_order_items")) {
      if (failItemWrite) throw new Error("refund item write failed");
      events.push("refund-item"); return [{id: uuid(11)}];
    }
    if (text.includes("select count(*)::int as count")) return [{count: 1}];
    if (text.includes("update store_customer_orders") && !text.includes("inventory_items_ready_at")) events.push("refund-order");
    return [];
  };
  const module = load("../app/api/store/pos/transactions/route.ts", dependencies(sql, events));
  return { events, post: () => module.POST(new Request("https://example.test/refund", {method: "POST", body: JSON.stringify({storeId, orderId, itemIds: [uuid(11)], reason: "Shortage"})})) };
}
test("POS partial-item refund refreshes its source only after item and order writes complete", async () => {
  const h = refundHarness();
  assert.equal((await h.post()).status, 200);
  assert.deepEqual(h.events, ["invalidate", "refund-item", "refund-order", `ready:${orderId}`, `sales:${orderId}`]);
  const failed = refundHarness(true);
  await assert.rejects(failed.post(), /refund item write failed/);
  assert.deepEqual(failed.events, ["invalidate"]);
});

test("table item adjustment invalidates readiness before mutation and restores it only after all source changes", async () => {
  for (const failure of [null, "item", "summary"]) {
    const events: string[] = [];
    const sql = async (parts: TemplateStringsArray) => {
      const text = parts.join("?");
      if (text.includes("inventory_items_ready_at = null")) events.push("invalidate");
      else if (text.includes("update store_customer_order_items")) {
        if (failure === "item") throw new Error("adjustment item failed");
        events.push("item");
      } else if (text.includes("update store_customer_orders")) {
        if (failure === "summary") throw new Error("adjustment summary failed");
        events.push("summary");
      }
      if (text.includes('payment_status as "paymentStatus"') && text.includes("limit 1")) return [{id: orderId, paymentStatus: "unpaid", status: "preparing"}];
      if (text.includes("from store_customer_order_items")) return [{id: uuid(11), name: "Tea", quantity: 2, amount: 400}];
      return [];
    };
    const module = load("../app/api/store/pos/route.ts", dependencies(sql, events));
    const patch = () => module.PATCH(new Request("https://example.test/pos", {
      method: "PATCH", body: JSON.stringify({storeId, orderId, itemId: uuid(11), tableSessionKey: "visit", action: "set_item_quantity", quantity: 2})
    }));
    if (failure) {
      await assert.rejects(patch(), /adjustment .* failed/);
      assert.ok(!events.some((event) => event.startsWith("ready:")));
    } else {
      assert.equal((await patch()).status, 200);
      assert.deepEqual(events.slice(0, 4), ["invalidate", "item", "summary", `ready:${orderId}`]);
    }
  }
});
