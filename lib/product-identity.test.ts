import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as identity from "./product-identity.ts";
import * as procurementConfirmationPolicy from "./procurement-confirmation-policy.ts";

const products = [
  { id: "public", name: "同名商品", productFamilyName: "公開商品族", mainSupplier: "公開発注先" },
  { id: "other", name: "別の商品", productFamilyName: "別の商品族", mainSupplier: "別発注先" }
];

test("a hidden stored SKU cannot inherit a same-name public SKU, while exact IDs remain authoritative", () => {
  assert.equal(identity.findProductByIdentity("hidden", "同名商品", products), undefined);
  assert.equal(identity.findProductByIdentity("public", "過去の名称", products), products[0]);
  const lookup = identity.createProductIdentityLookup(products);
  assert.equal(identity.findProductByIdentityFromLookup("hidden", "同名商品", lookup), undefined);
  assert.equal(identity.findProductByIdentityFromLookup("public", "過去の名称", lookup), products[0]);
});

test("legacy name-only records resolve only a unique matching product", () => {
  assert.equal(identity.findProductByIdentity(undefined, "同名商品", products), products[0]);
  const duplicates = [...products, { ...products[0], id: "public-variant" }];
  assert.equal(identity.findProductByIdentity(undefined, "同名商品", duplicates), undefined);
  const lookup = identity.createProductIdentityLookup(duplicates);
  assert.equal(identity.findProductByIdentityFromLookup(undefined, "同名商品", lookup), undefined);
  assert.equal(identity.findProductByIdentityFromLookup("public-variant", "同名商品", lookup)?.id, "public-variant");
});

test("supplier lookup keys keep stored SKU identity separate from legacy names", () => {
  assert.notEqual(identity.productIdentityKey("public", "同名商品"), identity.productIdentityKey("hidden", "同名商品"));
  assert.notEqual(identity.productIdentityKey("public", "同名商品"), identity.productIdentityKey(undefined, "同名商品"));
});

function procurementHarness() {
  const source = readFileSync(new URL("../app/os/procurement/page.tsx", import.meta.url), "utf8") + `
    export const identityTestFunctions = { createProcurementTaskItems, findProcurementProduct, getAlternativeVariantOptions, getPurchaseUrlForItem };
  `;
  const modules: Record<string, unknown> = {
    "react": {}, "react/jsx-runtime": {}, "lucide-react": {},
    "../components/UserBadge": {}, "../components/MobileNavMenu": {}, "../components/OsNavList": {},
    "../components/ActionNotice": {}, "../components/currentEmployeeStore": {}, "../components/useModalHistory": {},
    "../../../lib/mock-data": { orders: [], products: [], suppliers: [], productSupplierOptions: [] },
    "../../../lib/number-input": {}, "../../../lib/store-polling-client": {},
    "../../../lib/product-identity": identity,
    "../components/OsTranslationProvider": {},
    "../../../lib/procurement-confirmation-policy": procurementConfirmationPolicy
  };
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, { exports, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unmocked procurement dependency: ${name}`);
    return modules[name];
  } });
  return exports.identityTestFunctions as Record<string, (...args: unknown[]) => unknown>;
}

test("existing hidden order lines remain visible with an empty public catalog and no simulated lines are invented", () => {
  const page = procurementHarness();
  const orders = [{ id: "order", items: 2 }];
  const line = { id: "line", orderId: "order", productId: "hidden", productName: "同名商品", unit: "袋", requestedQuantity: 10, actualQuantity: 6, actualPrice: "80", supplier: "実際の発注先" };
  const result = page.createProcurementTaskItems(orders, [], [line]) as Array<Record<string, unknown>>;
  assert.equal(result.length, 1);
  assert.equal(result[0].productId, "hidden");
  assert.equal(result[0].actualQuantity, 6);
  assert.equal(result[0].supplier, "実際の発注先");
  assert.equal(result[0].unit, "袋");
  assert.equal((page.createProcurementTaskItems(orders, products, []) as unknown[]).length, 0);
});

test("hidden SKU lines do not borrow public same-name photos, product families, suppliers or purchase links", () => {
  const page = procurementHarness();
  const item = { id: "line", orderId: "order", productId: "hidden", productName: "同名商品", unit: "袋", requestedQuantity: 2, actualQuantity: 1, supplier: "", note: "" };
  const supplierOptions = [{ productId: "public", product: "同名商品", options: [{ supplier: "公開発注先", role: "メイン", purchaseUrl: "https://example.test/public" }] }];
  assert.equal(page.findProcurementProduct(item, products), undefined);
  assert.equal((page.getAlternativeVariantOptions(item, products) as unknown[]).length, 0);
  assert.equal(page.getPurchaseUrlForItem({ ...item, supplier: "公開発注先" }, supplierOptions), "");
  const tasks = page.createProcurementTaskItems([{ id: "order" }], products, [item]) as Array<Record<string, unknown>>;
  assert.equal(tasks[0].supplier, "");
  assert.equal(tasks[0].productId, "hidden");
});
