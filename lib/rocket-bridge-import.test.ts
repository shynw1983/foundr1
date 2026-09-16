import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as rocket from "./rocket-now-bridge.ts";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/rocket-order-snapshots.json", import.meta.url), "utf8"));

function harness(authorized = true, dashboardImport = false) {
  const writes: Array<{text: string; values: unknown[]}> = [];
  const downstream: string[] = [];
  const sql = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const text = parts.join("?");
    if (/\b(insert|update|delete)\b/.test(text)) writes.push({text, values});
    if (text.includes("insert into local_bridge_events")) return [{id: "event"}];
    if (text.includes("from stores")) return [{id: "store"}];
    if (text.includes("from store_sales_sources")) return [{brandId: "brand", brandName: "まぁ麻"}];
    if (text.includes("from store_customer_orders")) return dashboardImport ? [{
      id: "order", status: "new", parserVersion: 5, completeness: 167,
      bridgeItems: [{name: "注文完了率"}], note: "", noteZh: ""
    }] : [];
    if (text.includes("insert into store_customer_orders")) return [{id: "order"}];
    return [];
  };
  const dependencies: Record<string, unknown> = {
    "db": {sql},
    "local-bridge-auth": {authorizeLocalBridge: async () => ({authorized})},
    "customer-orders": {findCustomerOrderById: async () => ({id: "order"})},
    "order-production": {ensureProductionTasksForOrder: async (id: string) => downstream.push(`kitchen:${id}`)},
    "order-realtime": {publishCustomerOrderEvent: async () => downstream.push("realtime")},
    "store-order-push-scheduler": {scheduleBridgeOrderPush: async () => downstream.push("phone-alert")},
    "sales-orders": {syncWebReservationToSalesOrder: async (id: string) => downstream.push(`sales:${id}`)},
    "order-note-translation": {translateOrderNoteToChinese: async () => ""},
    "menu-display-name-matcher": {findMenuDisplayNameCandidate: () => null},
    "rocket-now-bridge": rocket,
    "uber-bridge": {}, "demae-can-bridge": {}
  };
  const exports: {POST?: (request: Request) => Promise<Response>} = {};
  const code = ts.transpileModule(readFileSync(new URL("../app/api/local-bridge/uber-eats/events/route.ts", import.meta.url), "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
  }).outputText;
  runInNewContext(code, {exports, Response, Date, Intl, require: (name: string) => {
    const key = name.split("/").at(-1)!;
    if (!(key in dependencies)) throw Error(name);
    return dependencies[key];
  }});
  const post = (index: number) => exports.POST!(new Request("https://test.invalid/events", {
    method: "POST", body: JSON.stringify({platform: "rocket_now", kind: "accessibility_order",
      storeId: "store", capturedAt: Date.parse(fixtures[index].capturedAt), payload: {nodes: fixtures[index].nodes}})
  }));
  return {post, writes, downstream};
}

test("confirmation/dashboard observation cannot write an order or kitchen task", async () => {
  const h = harness();
  assert.equal((await (await h.post(0)).json()).parseStatus, "incomplete");
  assert.ok(!h.writes.some((write) => write.text.includes("store_customer_orders")));
  assert.deepEqual(h.downstream, []);
});

test("accepted detail persists correct time, amount and four modifiers before kitchen/realtime", async () => {
  const h = harness();
  assert.equal((await (await h.post(2)).json()).parseStatus, "imported");
  const order = h.writes.find((write) => write.text.includes("insert into store_customer_orders"))!;
  assert.ok(order.values.includes("preparing"));
  assert.ok(order.values.includes(3605));
  assert.ok(order.values.includes("02:01"));
  assert.ok(order.values.includes("2026-09-14T17:01:00.000Z"));
  const item = h.writes.find((write) => write.text.includes("insert into store_customer_order_items"))!;
  assert.ok(item.values.some((value) => Array.isArray(value) && value.length === 4 && value.every((label) => typeof label === "string")));
  assert.ok(item.values.includes(3605));
  assert.deepEqual(h.downstream, ["sales:order", "kitchen:order", "phone-alert", "realtime"]);
});

test("real details can replace a dashboard import despite its inflated completeness", async () => {
  const h = harness(true, true);
  assert.equal((await (await h.post(2)).json()).parseStatus, "imported");
  assert.ok(h.writes.some((write) => write.text.includes("insert into store_customer_order_items")));
  const order = h.writes.find((write) => write.text.includes("insert into store_customer_orders"))!;
  assert.match(order.text, /pickup_time = case when/);
  assert.ok(order.values.includes(true));
  const sales = h.writes.find((write) => write.text.includes("update sales_orders"))!;
  assert.deepEqual(sales.values, ["2026-09-14T17:01:00.000Z", "order"]);
});

test("unauthorized snapshot creates neither an event nor an operational order", async () => {
  const h = harness(false);
  assert.equal((await h.post(2)).status, 401);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.downstream, []);
});
