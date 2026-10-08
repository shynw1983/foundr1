import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as confirmation from "./procurement-confirmation-policy.ts";
import * as identity from "./product-identity.ts";

function workbench(options: { pending?: unknown; responseStatus?: number } = {}) {
  const functions = [
    "createProcurementTaskItems", "calculateProcurementOrderEstimatedAmount",
    "calculateProcurementOrderCurrentAmount", "calculateProcurementReadyToDeliverAmount",
    "formatProcurementAmountSummary", "readPendingProcurementTaskItems",
    "serverDashboardItemConfirmsPendingItem", "canStartProcurementPurchase", "saveProcurementTaskItem",
    "applyProcurementTaskItemUpdate", "discardRejectedPendingProcurementTaskItem"
  ];
  const source = readFileSync(new URL("../app/os/procurement/page.tsx", import.meta.url), "utf8") + `\nexport { ${functions.join(", ")} };`;
  const modules: Record<string, unknown> = {
    "../../../lib/mock-data": { orders: [], products: [], suppliers: [], productSupplierOptions: [] },
    "../../../lib/product-identity": identity,
    "../components/OsTranslationProvider": {},
    "../../../lib/procurement-confirmation-policy": confirmation
  };
  const requests: Array<Record<string, unknown>> = [];
  let pending = options.pending;
  const exports: Record<string, (...args: any[]) => any> = {};
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, {
    exports, require: (name: string) => modules[name] ?? {},
    window: { localStorage: {
      getItem: () => pending === undefined ? null : JSON.stringify(pending),
      setItem: (_key: string, value: string) => { pending = JSON.parse(value); },
      removeItem: () => { pending = undefined; }
    } },
    fetch: async (_url: string, request: { body: string }) => {
      requests.push(JSON.parse(request.body));
      return { ok: !options.responseStatus || options.responseStatus < 400, status: options.responseStatus ?? 200, json: async () => ({ error: "refresh quantity" }) };
    }
  });
  return Object.assign(exports, { requests });
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "line", orderId: "order", productId: "sku", productName: "商品", unit: "袋", requestedQuantity: 10,
    actualQuantity: null, actualPrice: "100", purchased: true, unavailable: false, supplier: "発注先",
    note: "", priceExceptionNote: "", supplierLocationName: "", deliveryStatus: "pending", ...overrides
  };
}

test("workbench actual quantities remain unknown with or without a public product catalog", () => {
  const page = workbench();
  const orders = [{ id: "order" }];
  const products = [{ id: "sku", name: "商品", referencePrice: 100 }];
  for (const catalog of [[], products]) {
    for (const actualQuantity of [null, undefined]) {
      const items = page.createProcurementTaskItems(orders, catalog, [task({ actualQuantity })]);
      assert.equal(items[0].actualQuantity, null);
      assert.equal(items[0].requestedQuantity, 10);
      assert.equal(items[0].purchased, true);
    }
    assert.equal(page.createProcurementTaskItems(orders, catalog, [task({ actualQuantity: 0 })])[0].actualQuantity, 0);
    assert.equal(page.createProcurementTaskItems(orders, catalog, [task({ actualQuantity: 6.25 })])[0].actualQuantity, 6.25);
  }
});

test("purchased and ready-to-deliver amounts exclude unknown quantities and disclose partial totals", () => {
  const page = workbench();
  const lookup = identity.createProductIdentityLookup([{ id: "sku", name: "商品", referencePrice: 100 }]);
  const items = [task(), task({ id: "known", actualQuantity: 6 })];
  const summary = page.calculateProcurementOrderCurrentAmount(items, lookup);
  assert.equal(summary.amount, 600);
  assert.equal(summary.missingQuantityCount, 1);
  assert.match(page.formatProcurementAmountSummary(summary), /数量未入力 1 件/);
  assert.equal(page.calculateProcurementReadyToDeliverAmount(items, lookup).amount, 600);
  assert.equal(page.calculateProcurementOrderEstimatedAmount([task()], lookup).amount, 1000);
  const unknown = page.calculateProcurementOrderCurrentAmount([task()], lookup);
  assert.equal(unknown.amount, 0);
  assert.equal(page.formatProcurementAmountSummary(unknown), "数量未入力 1 件");
  const unpurchased = page.calculateProcurementOrderCurrentAmount([task({ purchased: false })], lookup);
  assert.equal(unpurchased.amount, 0);
  assert.equal(unpurchased.missingQuantityCount, undefined);
});

test("pending cache and reconciliation never substitute requested quantities or conflate unknown with zero", () => {
  for (const actualQuantity of [null, undefined]) {
    const page = workbench({ pending: { line: { item: task({ actualQuantity }), updatedAt: 1 } } });
    assert.equal(page.readPendingProcurementTaskItems().line.item.actualQuantity, null);
    assert.equal(page.serverDashboardItemConfirmsPendingItem(task({ actualQuantity }), task()), true);
    assert.equal(page.serverDashboardItemConfirmsPendingItem(task({ actualQuantity }), task({ actualQuantity: 0 })), false);
    assert.equal(page.serverDashboardItemConfirmsPendingItem(task({ actualQuantity }), task({ actualQuantity: 10 })), false);
  }
});

test("new purchase confirmation requires a recorded actual quantity while old unknown records are sent unchanged", async () => {
  const page = workbench();
  for (const value of [null, undefined, "", -1]) assert.equal(page.canStartProcurementPurchase(value), false);
  for (const value of [0, 1, 0.5, 6.25]) assert.equal(page.canStartProcurementPurchase(value), true);
  await page.saveProcurementTaskItem(task());
  assert.equal(page.requests[0].actualQuantity, null);
  assert.equal(page.requests[0].actualPrice, "100");
  assert.equal(page.requests[0].purchased, true);
});

test("explicit quantity intent comes from current user input or recorded facts and is never invented for a legacy pending value", async () => {
  const page = workbench({ pending: { line: { item: task({ actualQuantity: 10 }), updatedAt: 1 } } });
  const cached = page.readPendingProcurementTaskItems().line.item;
  assert.equal(cached.actualQuantityRecordedExplicitly, false);
  const metadataOnly = page.applyProcurementTaskItemUpdate(cached, { note: "changed" });
  assert.equal(metadataOnly.actualQuantityRecordedExplicitly, false);
  await page.saveProcurementTaskItem(metadataOnly);
  assert.equal(page.requests[0].actualQuantityRecordedExplicitly, undefined);
  const explicitlyCounted = page.applyProcurementTaskItemUpdate(task(), { actualQuantity: 10 });
  assert.equal(explicitlyCounted.actualQuantityRecordedExplicitly, true);
  await page.saveProcurementTaskItem(explicitlyCounted);
  assert.equal(page.requests[1].actualQuantityRecordedExplicitly, true);
  const recorded = page.createProcurementTaskItems([{ id: "order" }], [], [task({ actualQuantity: 10 })])[0];
  assert.equal(recorded.actualQuantityRecordedExplicitly, true);
  const legacyOverlay = page.createProcurementTaskItems([{ id: "order" }], [], [task({ actualQuantity: 10, actualQuantityRecordedExplicitly: false })])[0];
  assert.equal(legacyOverlay.actualQuantityRecordedExplicitly, false);
  const explicitlyUnavailable = page.applyProcurementTaskItemUpdate(task(), { unavailable: true });
  assert.equal(explicitlyUnavailable.actualQuantity, 0);
  assert.equal(explicitlyUnavailable.actualQuantityRecordedExplicitly, true);
});

test("a rejected legacy pending value is removed for refresh without deleting a newer edit", async () => {
  const page = workbench({ pending: { line: { item: task({ actualQuantity: 10 }), updatedAt: 1 } }, responseStatus: 409 });
  await assert.rejects(page.saveProcurementTaskItem(task({ actualQuantity: 10 })), (error: any) => error.status === 409);
  assert.equal(page.discardRejectedPendingProcurementTaskItem("line", 2), false);
  assert.equal(Object.keys(page.readPendingProcurementTaskItems()).length, 1);
  assert.equal(page.discardRejectedPendingProcurementTaskItem("line", 1), true);
  assert.equal(Object.keys(page.readPendingProcurementTaskItems()).length, 0);
  assert.equal(page.serverDashboardItemConfirmsPendingItem(task({ actualQuantity: 6 }), task()), true);
});
