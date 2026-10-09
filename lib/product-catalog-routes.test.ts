import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as catalogPolicy from "./product-catalog-policy.ts";
import * as numberInput from "./number-input.ts";
import * as replenishmentIntent from "./replenishment-order-intent.ts";
import * as replenishmentLocks from "./replenishment-order-locks.ts";
import * as productUnitConversions from "./product-unit-conversions.ts";
import { randomUUID } from "node:crypto";

test("a hidden catalog price remains unknown without crashing product formatting", () => {
  const source = readFileSync(new URL("../app/os/products/page.tsx", import.meta.url), "utf8")
    + "\nexport { parseReferencePrice, formatProductUnitPrice };";
  const exports: Record<string, (...args: any[]) => any> = {};
  const modules: Record<string, unknown> = {
    "../../../lib/number-input": numberInput,
    "../../../lib/product-catalog-policy": catalogPolicy,
    "../../../lib/mock-data": { products: [], suppliers: [], stores: [], brands: [] }
  };
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, { exports, require: (name: string) => modules[name] ?? {} });
  assert.equal(exports.parseReferencePrice(null), 0);
  assert.equal(exports.parseReferencePrice(undefined), 0);
  assert.equal(exports.formatProductUnitPrice({ referencePrice: null, unit: "袋", variantName: "1kg" }), "未設定");
});

type Query = { text: string; values: unknown[] };
type Handlers = Record<string, (request: Request) => Promise<Response>>;

function loadRoute(relativePath: string, modules: Record<string, unknown>): Handlers {
  const exports: Handlers = {};
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, Response, URL, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unmocked route dependency: ${name}`);
    return modules[name];
  } });
  return exports;
}

function writes(queries: Query[]) {
  return queries.filter((query) => /\b(insert|update|delete)\b/i.test(query.text));
}

function ordersHarness(options: {
  productRows: Array<{ id: string; name: string }>;
  denial?: { ok: false; status: number; error: string };
}) {
  const queries: Query[] = [];
  const catalogChecks: Array<{ storeId: string; productIds: string[] }> = [];
  const session = { id: "employee", role: "store_owner" };
  const route = loadRoute("../app/api/orders/route.ts", {
    "../../../lib/api-auth": {
      requireWritableOsSession: async () => session,
      requireOsSession: async () => session,
      canAccessStore: async () => true,
      getSessionStoreScope: async () => ({ allStores: false, storeIds: ["store-a"] })
    },
    "../../../lib/db": { sql: (parts: TemplateStringsArray, ...values: unknown[]) => {
      const text = parts.join("?");
      queries.push({ text, values });
      if (text.includes("from stores")) return Promise.resolve([{ id: "store-a" }]);
      if (text.includes("from products")) return Promise.resolve(options.productRows);
      if (text.includes("lastSequence")) return Promise.resolve([{ lastSequence: 0 }]);
      if (text.includes("insert into purchase_orders")) return Promise.resolve([{ id: "order" }]);
      return Promise.resolve([]);
    } },
    "../../../lib/lark": { sendPurchaseOrderLarkNotification: async () => ({ ok: true, delivered: false }) },
    "../../../lib/notification-realtime": { publishOsNotificationEvent: async () => undefined },
    "../../../lib/role-permissions": { roleHasPermission: async () => false },
    "../../../lib/replenishment-order-intent": replenishmentIntent,
    "../../../lib/replenishment-order-locks": replenishmentLocks,
    "../../../lib/product-catalog-access": { assertProductsOrderable: async (_session: unknown, storeId: string, productIds: string[]) => {
      catalogChecks.push({ storeId, productIds: Array.from(productIds) });
      return options.denial ?? { ok: true };
    } }
  });
  return {
    queries, catalogChecks,
    post: (names: string[], ids: string[] = []) => {
      const body = new FormData();
      body.set("store", "店舗 A");
      names.forEach((name) => body.append("productName", name));
      ids.forEach((id) => body.append("productId", id));
      return route.POST(new Request("https://example.test/api/orders", { method: "POST", body }));
    }
  };
}

test("legacy name-only orders reject duplicate SKU names before creating an order", async () => {
  const harness = ordersHarness({ productRows: [{ id: "sku-a", name: "同名商品" }, { id: "sku-b", name: "同名商品" }] });
  const response = await harness.post(["同名商品"]);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /商品ID/);
  assert.equal(harness.catalogChecks.length, 0);
  assert.equal(writes(harness.queries).length, 0);
});

test("mixed or incomplete product IDs reject the whole order before catalog checks or writes", async () => {
  for (const ids of [["sku-a", ""], ["sku-a"]]) {
    const harness = ordersHarness({ productRows: [{ id: "sku-a", name: "商品 A" }] });
    assert.equal((await harness.post(["商品 A", "商品 B"], ids)).status, 409);
    assert.equal(harness.catalogChecks.length, 0);
    assert.equal(writes(harness.queries).length, 0);
  }
});

test("new orders pass the exact target store and SKU to authorization and return its denial unchanged", async () => {
  const harness = ordersHarness({
    productRows: [{ id: "hidden-sku", name: "非公開商品" }],
    denial: { ok: false, status: 403, error: "この店舗では発注できません。" }
  });
  const response = await harness.post(["非公開商品"], ["hidden-sku"]);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "この店舗では発注できません。" });
  assert.deepEqual(harness.catalogChecks, [{ storeId: "store-a", productIds: ["hidden-sku"] }]);
  assert.equal(writes(harness.queries).length, 0);
});

test("SKU deletion preserves both current inventory and historical stock checks", async () => {
  for (const heldBy of ["inventory_items", "inventory_checks"]) {
    const queries: Query[] = [];
    const route = loadRoute("../app/api/products/route.ts", {
      "../../../lib/api-auth": { requireMasterOsSession: async () => ({ id: "owner", role: "owner" }) },
      "../../../lib/role-permissions": { roleHasPermission: async () => true },
      "../../../lib/product-catalog-policy": catalogPolicy,
      "../../../lib/product-unit-conversions": productUnitConversions,
      "node:crypto": { randomUUID },
      "../../../lib/db": { sql: (parts: TemplateStringsArray, ...values: unknown[]) => {
        const text = parts.join("?");
        queries.push({ text, values });
        if (text.includes("select id::text as id from products")) return Promise.resolve([{ id: "sku-a" }]);
        if (text.includes("count(*)")) return Promise.resolve([{ count: 0 }]);
        if (text.includes("as linked")) return Promise.resolve([{ linked: text.includes(`from ${heldBy}`) }]);
        return Promise.resolve([]);
      } }
    });
    const response = await route.DELETE(new Request("https://example.test/api/products", { method: "DELETE", body: JSON.stringify({ id: "sku-a" }) }));
    assert.equal(response.status, 409, heldBy);
    assert.match((await response.json()).error, /在庫記録/);
    assert.equal(writes(queries).length, 0);
  }
});

test("product photos require an exact path plus publication or an existing own-store relation", async () => {
  const pathname = "products/sku-a.png";
  for (const scenario of [
    { products: [{ id: "sku-a", photoUrl: `/api/products/photo/view?pathname=${encodeURIComponent(pathname)}&v=123` }], public: true, held: false, expected: 200 },
    { products: [{ id: "sku-a", photoUrl: `https://example.private.blob.vercel-storage.com/${pathname}` }], public: false, held: true, expected: 200 },
    { products: [], public: false, held: false, expected: 403 },
    { products: [{ id: "sku-a", photoUrl: `/api/products/photo/view?pathname=${encodeURIComponent(`${pathname}-other`)}&v=123` }], public: true, held: true, expected: 403 }
  ]) {
    let blobReads = 0;
    const queries: Query[] = [];
    const route = loadRoute("../app/api/products/photo/view/route.ts", {
      "@vercel/blob": { get: async () => {
        blobReads += 1;
        return { statusCode: 200, blob: { contentType: "image/png", etag: "test" }, stream: "pixels" };
      } },
      "next/server": { NextResponse: Response },
      "../../../../../lib/api-auth": {
        requireOsSession: async () => ({ id: "employee", role: "store_owner" }),
        canAccessStore: async () => true,
        getSessionStoreScope: async () => ({ allStores: false, storeIds: ["own-store"] })
      },
      "../../../../../lib/product-catalog-policy": catalogPolicy,
      "../../../../../lib/product-catalog-access": { assertProductViewable: async () => ({ ok: scenario.public }) },
      "../../../../../lib/db": { sql: (parts: TemplateStringsArray, ...values: unknown[]) => {
        const text = parts.join("?");
        queries.push({ text, values });
        if (text.includes('photo_url as "photoUrl"')) return Promise.resolve(scenario.products);
        if (text.includes("select 1 where exists")) {
          const storeScopes = values.filter(Array.isArray);
          assert.equal(storeScopes.length, 2);
          assert.ok(storeScopes.every((storeIds) => JSON.stringify(storeIds) === JSON.stringify(["own-store"])));
          return Promise.resolve(scenario.held ? [{}] : []);
        }
        return Promise.resolve([]);
      } }
    });
    const request = { nextUrl: new URL(`https://example.test/api/products/photo/view?pathname=${encodeURIComponent(pathname)}`), headers: new Headers() };
    assert.equal((await route.GET(request as unknown as Request)).status, scenario.expected);
    assert.equal(blobReads, scenario.expected === 200 ? 1 : 0);
    assert.equal(writes(queries).length, 0);
  }
});
