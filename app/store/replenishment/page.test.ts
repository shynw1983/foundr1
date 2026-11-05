import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const product = { id: id(2), name: "魚丸", unit: "箱", isOrderable: true };
const order = { orderId: id(10), orderNo: "PO-LINKED", itemId: id(11), status: "delivered", requestedQuantity: 3, unit: "箱", actualQuantity: 2, actualUnit: "袋", receivedQuantity: 1 };
function render(operatorId = id(3)) {
  const exports: Record<string, any> = {};
  const data = {
    storeId: id(1), canReport: true, operator: { id: operatorId }, products: [product],
    demands: [{
      id: id(4), storeId: id(1), storeName: "本店", product, status: "ordered", progress: "partial_received", quantity: 3, unit: "箱", note: "明日までに必要", updatedAt: "2026-10-18T01:00:00Z",
      deferredUntil: null, inventory: [], sources: [{ id: id(7), kind: "inventory", name: "魚丸", locationName: "冷凍庫", stockStatus: "unavailable", quantity: -2, countUnit: "個", lastCountedAt: "2026-10-17T01:00:00Z" }],
      orders: [order], openOrders: [order, { ...order, itemId: id(12), orderNo: "PO-OTHER", receivedQuantity: 0 }],
      events: [{ id: id(8), kind: "report", actorName: "A Staff", note: "残りなし", quantity: 2, unit: "袋", shortageStatus: "unavailable", createdAt: "2026-10-18T00:00:00Z" }]
    }]
  };
  const modules: Record<string, any> = {
    react: { useState: (value: any) => [value, () => {}], useMemo: (fn: () => any) => fn(), useEffect: () => {} },
    "react/jsx-runtime": { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) },
    "../../os/components/OsTranslationProvider": { useOsTranslation: () => ({ t: (s: string) => s, language: "ja" }) },
    "../../../components/useInventoryOperations": { useInventoryReadModel: () => ({ data, loading: false, error: "", load: () => {} }) },
    "../../../lib/product-unit-conversions": { formatInventoryCountQuantity: (quantity: number) => String(quantity) },
    "../components/StoreNavTabs": { StoreNavTabs: "StoreNavTabs" },
    "../components/StoreInventoryOperatorPanel": { StoreInventoryOperatorPanel: "StoreInventoryOperatorPanel" },
    "../components/useStoreInventoryOperator": { useStoreInventoryOperator: () => ({ operator: { id: id(3), name: "A Staff" }, canOperate: true, invalidate() {} }) },
    "../components/useStoreInventoryStore": { useStoreInventoryStore: () => ({ storeId: id(1), storeName: "本店", loading: false, error: "" }) },
    "./StoreReplenishmentReport": { StoreReplenishmentReport: "StoreReplenishmentReport" }
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL("./page.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, require: (name: string) => { if (name.endsWith(".module.css")) return { default: {} }; if (name in modules) return modules[name]; throw new Error(`Unmocked ${name}`); } });
  return exports.default();
}
function elements(tree: any, predicate: (element: any) => boolean): any[] {
  if (!tree || typeof tree !== "object") return [];
  const children = Array.isArray(tree) ? tree : tree.props?.children ?? [];
  return [...(!Array.isArray(tree) && predicate(tree) ? [tree] : []), ...[children].flat().flatMap(child => elements(child, predicate))];
}
const text = (tree: any): string => Array.isArray(tree) ? tree.map(text).join("") : tree && typeof tree === "object" ? text(tree.props?.children) : tree == null ? "" : String(tree);

test("progress keeps historical report units, signed book stock and distinct existing-order facts", () => {
  const tree = render(), content = text(tree);
  assert.match(content, /一部納品/); assert.match(content, /希望数量 2 袋/); assert.doesNotMatch(content, /希望数量 2 箱/);
  assert.match(content, /帳簿在庫 −2 個/); assert.match(content, /実際の購入 2 袋/); assert.match(content, /納品・入庫済み 1 袋/);
  assert.equal(content.split("PO-LINKED").length - 1, 1); assert.equal(content.split("PO-OTHER").length - 1, 1);
  const unrelated = elements(tree, element => element.type === "li" && text(element).startsWith("PO-OTHER"))[0];
  assert.doesNotMatch(text(unrelated), /納品・入庫済み/); assert.match(content, /ない/);
  assert.equal(elements(tree, element => element.type === "a" && String(element.props.href).startsWith("/os")).length, 0);
});

test("a stale operator in the GET projection cannot enable reporting for a different current employee", () => {
  const tree = render(id(99));
  const form = elements(tree, element => element.type === "StoreReplenishmentReport")[0];
  assert.equal(form.props.expectedOperatorId, id(3)); assert.equal(form.props.canOperate, false);
});
