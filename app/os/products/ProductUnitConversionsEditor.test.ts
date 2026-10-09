import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as unitPolicy from "../../../lib/product-unit-conversions.ts";
import { normalizeDecimalInput } from "../../../lib/number-input.ts";

function editorHarness() {
  const source = readFileSync(new URL("./ProductUnitConversionsEditor.tsx", import.meta.url), "utf8");
  const exports: Record<string, any> = {};
  const modules: Record<string, unknown> = {
    "lucide-react": {},
    "react/jsx-runtime": { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) },
    "../components/OsTranslationProvider": { useOsTranslation: () => ({ t: (value: string) => value }) },
    "../../../lib/number-input": { normalizeDecimalInput },
    "../../../lib/product-unit-conversions": unitPolicy,
    "./ProductUnitConversionsEditor.module.css": { default: {} }
  };
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, { exports, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unmocked dependency ${name}`);
    return modules[name];
  } });
  return exports;
}
function elements(tree: any, predicate: (element: any) => boolean): any[] {
  if (!tree || typeof tree !== "object") return [];
  const children = Array.isArray(tree) ? tree : tree.props?.children ?? [];
  return [...(!Array.isArray(tree) && predicate(tree) ? [tree] : []), ...[children].flat().flatMap((child) => elements(child, predicate))];
}

test("free count units and quarter-bag counts coexist, while packaging conflicts are rejected", () => {
  const editor = editorHarness();
  const rows = [{ unit: "個", unitsPerPurchase: "20" }, { unit: "1/4袋", unitsPerPurchase: "4", fractionalDenominator: "4" }];
  assert.deepEqual(JSON.parse(JSON.stringify(editor.normalizeUnitConversionDrafts(rows, { unit: "袋" }))), [
    { unit: "1/4袋", unitsPerPurchase: 4, fractionalDenominator: 4 }, { unit: "個", unitsPerPurchase: 20 }
  ]);
  assert.throws(() => editor.normalizeUnitConversionDrafts(rows, { unit: "袋", packageQuantity: 10, packageQuantityUnit: "個" }), /包装/);
  assert.throws(() => editor.normalizeUnitConversionDrafts([{ unit: "個", unitsPerPurchase: "" }], { unit: "袋" }));
  assert.deepEqual(editor.normalizeUnitConversionDrafts([], { unit: "袋", packageQuantity: 10, packageQuantityUnit: "袋" }), []);
});

test("purchase-unit changes preserve original fraction labels until the operator explicitly reconfirms", () => {
  const editor = editorHarness();
  const rows = [{ unit: "個", unitsPerPurchase: 20 }, { unit: "1/4袋", unitsPerPurchase: 4, fractionalDenominator: 4 }];
  let confirmed: any;
  const tree = editor.default({ product: { unit: "箱" }, rows, requiresReconfirmation: true,
    onChange: () => undefined, onReconfirm: (value: unknown) => { confirmed = value; } });
  assert.equal(elements(tree, (element) => element.type === "input" && element.props.readOnly)[0].props.value, "1/4袋");
  assert.equal(confirmed, undefined);
  assert.throws(() => editor.normalizeUnitConversionDrafts(rows, { unit: "箱" }), /分割/);
  elements(tree, (element) => element.type === "button" && element.props.children === "発注・購入単位と換算を再確認しました")[0].props.onClick();
  const confirmedRows = confirmed as unknown as Array<{ unit: string; unitsPerPurchase: number }>;
  assert.ok(Array.isArray(confirmedRows));
  assert.equal(confirmedRows[1].unit, "1/4箱");
  assert.equal(confirmedRows[1].unitsPerPurchase, 4);
  assert.equal(rows[1].unit, "1/4袋");
  assert.equal(editor.normalizeUnitConversionDrafts(confirmedRows, { unit: "箱" }).find((entry: any) => entry.unit === "個").unitsPerPurchase, 20);
});

test("legacy empty configuration stays empty and the published read-only summary has no management controls", () => {
  const editor = editorHarness();
  const summary = editor.ProductUnitConversionsSummary({ product: { unit: "袋", inventoryUnitConversions: [], packageQuantity: 20, packageQuantityUnit: "個" } });
  assert.equal(elements(summary, (element) => ["input", "button", "select"].includes(element.type)).length, 0);
  assert.equal(elements(summary, (element) => element.type === "small")[0].props.children, "包装規格による換算");
  assert.equal(editor.ProductUnitConversionsSummary({ product: { unit: "袋" }, compact: true }), null);
  assert.deepEqual(editor.normalizeUnitConversionDrafts([], { unit: "袋" }), []);
});
