import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as units from "../lib/product-unit-conversions.ts";
import * as quickPolicy from "../lib/inventory-quick-policy.ts";
import type { InventoryQuickCheckBasis, InventoryQuickCheckSubmission } from "../lib/inventory-quick-policy.ts";
import type { QuickInventoryItem } from "./QuickInventoryList";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const storeId = id(1);
const keyFor = (store: string) => `foundr1-os:quick-inventory-draft:v1:${store}`;
const basis = (n: number, changes: Partial<InventoryQuickCheckBasis> = {}): InventoryQuickCheckBasis => ({ storeId, productId: id(n + 20), locationId: id(10), stockRevision: 1, quickRevision: 1,
  countUnit: "個", safetyStock: 5, unitConfiguration: { unit: "袋", packageQuantity: 20, packageQuantityUnit: "個", inventoryUnitConversions: [] }, ...changes });
const item = (n: number, changes: Partial<QuickInventoryItem> = {}): QuickInventoryItem => ({ id: id(n), storeId, productName: `P${n}`, locationName: "freezer", exceptionCode: "", exceptionNote: "", quickCheckBasis: basis(n), quickCheck: null, canQuickCheck: true, ...changes });
const draft = (n: number, changes: Partial<InventoryQuickCheckSubmission> = {}): InventoryQuickCheckSubmission => ({ itemId: id(n), status: "low", expectedBasis: basis(n), estimate: { kind: "quantity", quantity: 2.5, purchaseUnit: "袋" }, ...changes });

function harness(initial: Record<string, string> = {}, saveResult: boolean = true) {
  const exports: Record<string, any> = {};
  const state: any[] = [], refs: any[] = [], previousEffects: any[][] = [];
  let si = 0, ri = 0, ei = 0;
  let effects: Array<() => void> = [];
  const storage = new Map(Object.entries(initial));
  const submissions: InventoryQuickCheckSubmission[][] = [];
  let result = saveResult;
  const react = {
    useState(initial: any) { const i = si++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial; return [state[i], (next: any) => { state[i] = typeof next === "function" ? next(state[i]) : next; }]; },
    useRef(initial: any) { const i = ri++; return refs[i] ??= { current: initial }; },
    useEffect(fn: () => void, next: any[]) { const i = ei++; if (!previousEffects[i] || next.some((value, n) => value !== previousEffects[i][n])) effects.push(fn); previousEffects[i] = next; }
  };
  const modules: Record<string, any> = { react, "react/jsx-runtime": { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) }, "lucide-react": {},
    "../app/os/components/OsTranslationProvider": { useOsTranslation: () => ({ t: (s: string) => s, language: "ja" }) },
    "../lib/product-unit-conversions": units, "../lib/inventory-quick-policy": quickPolicy, "./QuickInventoryList.module.css": { default: {} } };
  runInNewContext(ts.transpileModule(readFileSync(new URL("./QuickInventoryList.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) },
      require: (name: string) => { if (!(name in modules)) throw new Error(`Unmocked ${name}`); return modules[name]; } });
  return { storage, submissions, setResult(value: boolean) { result = value; },
    render(items: QuickInventoryItem[], store = storeId, saving = false) { si = ri = ei = 0; effects = []; const tree = exports.QuickInventoryList({ storeId: store, items, saving, onSave: async (checks: InventoryQuickCheckSubmission[]) => { submissions.push(JSON.parse(JSON.stringify(checks))); return result; } }); const run = effects; run.forEach(fn => fn()); return tree; },
    async tick() { await new Promise(resolve => setTimeout(resolve, 0)); }
  };
}
function elements(tree: any, predicate: (e: any) => boolean): any[] { if (!tree || typeof tree !== "object") return []; const children = Array.isArray(tree) ? tree : tree.props?.children ?? []; return [...(!Array.isArray(tree) && predicate(tree) ? [tree] : []), ...[children].flat().flatMap(child => elements(child, predicate))]; }
function text(tree: any): string { if (Array.isArray(tree)) return tree.map(text).join(""); if (tree && typeof tree === "object") return text(tree.props?.children); return tree === undefined || tree === null ? "" : String(tree); }
const button = (tree: any, label: string) => elements(tree, e => e.type === "button" && text(e).includes(label))[0];
const row = (tree: any, n: number) => elements(tree, e => e.props?.["data-quick-item"] === id(n))[0];
const statusButton = (tree: any, n: number, status: string) => elements(row(tree, n), e => e.props?.["data-quick-status"] === status)[0];
const saved = (h: ReturnType<typeof harness>, store = storeId): Record<string, InventoryQuickCheckSubmission> => JSON.parse(h.storage.get(keyFor(store)) ?? "{}");

test("restoring a saved status/estimate never deletes its storage during the first hydration pass", () => {
  const initial = { [id(2)]: draft(2) };
  const h = harness({ [keyFor(storeId)]: JSON.stringify(initial) }); h.render([item(2)]);
  assert.deepEqual(saved(h), initial);
  const tree = h.render([item(2)]);
  assert.equal(statusButton(tree, 2, "low").props["aria-pressed"], true);
  assert.equal(elements(row(tree, 2), e => e.type === "input")[0].props.value, "2.5");
  assert.equal(h.submissions.length, 0);
});

test("bulk enough only fills visible unchosen rows, keeping chosen shortage estimates and hidden drafts", async () => {
  const h = harness({ [keyFor(storeId)]: JSON.stringify({ [id(5)]: draft(5, { status: "out" }) }) }); const items = [item(2), item(3), item(4, { canQuickCheck: false })];
  h.render(items); let tree = h.render(items);
  statusButton(tree, 2, "low").props.onClick(); tree = h.render(items);
  elements(row(tree, 2), e => e.type === "input")[0].props.onChange({ target: { value: "2.5" } }); tree = h.render(items);
  button(tree, "この表示は見ました。残りも足りる").props.onClick(); tree = h.render(items);
  assert.equal(saved(h)[id(2)].status, "low"); assert.equal(saved(h)[id(3)].status, "enough"); assert.equal(saved(h)[id(4)], undefined);
  assert.deepEqual(saved(h)[id(2)].estimate, { kind: "quantity", quantity: 2.5, purchaseUnit: "袋" });
  assert.equal(saved(h)[id(5)].status, "out");
  button(tree, "確認した状態を保存").props.onClick(); await h.tick(); h.render(items);
  assert.deepEqual(h.submissions[0].map(check => check.itemId).sort(), [id(2), id(3)]);
  assert.deepEqual(Object.keys(saved(h)), [id(5)]);
});

test("a saved quantity estimate is preserved when status changes and increment starts at its value", () => {
  const items = [item(2, { quickCheck: { status: "low", checkedAt: "2026-10-09T00:00:00Z", checkedBy: "A", state: "fresh", estimate: { kind: "quantity", quantity: 2.5, purchaseUnit: "袋" } } })];
  const h = harness(); h.render(items); let tree = h.render(items);
  statusButton(tree, 2, "out").props.onClick(); tree = h.render(items);
  assert.deepEqual(saved(h)[id(2)].estimate, { kind: "quantity", quantity: 2.5, purchaseUnit: "袋" });
  button(row(tree, 2), "1単位を追加").props.onClick(); h.render(items);
  assert.deepEqual(saved(h)[id(2)].estimate, { kind: "quantity", quantity: 3.5, purchaseUnit: "袋" });
});

test("bulk re-observation preserves an existing estimate when its purchase unit still matches", () => {
  const items = [item(2, { quickCheck: { status: "enough", checkedAt: "2026-10-09T00:00:00Z", checkedBy: "A", state: "fresh", estimate: { kind: "quantity", quantity: 2.5, purchaseUnit: "袋" } } })];
  const h = harness(); h.render(items); let tree = h.render(items);
  button(tree, "この表示は見ました。残りも足りる").props.onClick(); h.render(items);
  assert.deepEqual(saved(h)[id(2)].estimate, { kind: "quantity", quantity: 2.5, purchaseUnit: "袋" });
});

test("bulk enough preserves already recorded negative statuses, rather than clearing a visible shortage", () => {
  const items = [item(2, { quickCheck: { status: "low", checkedAt: "2026-10-09T00:00:00Z", checkedBy: "A", state: "fresh", estimate: { kind: "quantity", quantity: 2.5, purchaseUnit: "袋" } } }),
    item(3, { quickCheck: { status: "out", checkedAt: "2026-10-09T00:00:00Z", checkedBy: "A", state: "recheck", estimate: null } }), item(4)];
  const h = harness(); h.render(items); let tree = h.render(items);
  button(tree, "この表示は見ました。残りも足りる").props.onClick(); tree = h.render(items);
  assert.equal(statusButton(tree, 2, "low").props["aria-pressed"], true);
  assert.equal(statusButton(tree, 3, "out").props["aria-pressed"], true);
  assert.equal(saved(h)[id(4)].status, "enough");
  if (saved(h)[id(2)]) { assert.equal(saved(h)[id(2)].status, "low"); assert.deepEqual(saved(h)[id(2)].estimate, { kind: "quantity", quantity: 2.5, purchaseUnit: "袋" }); }
  if (saved(h)[id(3)]) assert.equal(saved(h)[id(3)].status, "out");
});

test("changed stock basis blocks save until explicit recheck, while unit change clears estimate and typed buffer", async () => {
  const h = harness(); const items = [item(2)]; h.render(items); let tree = h.render(items);
  statusButton(tree, 2, "low").props.onClick(); tree = h.render(items);
  elements(row(tree, 2), e => e.type === "input")[0].props.onChange({ target: { value: "2.5" } }); tree = h.render(items);
  h.render(items);
  const newer = [item(2, { quickCheckBasis: basis(2, { stockRevision: 2 }) })]; tree = h.render(newer);
  assert.equal(button(tree, "確認した状態を保存").props.disabled, true);
  button(tree, "確認した状態を保存").props.onClick(); await h.tick(); assert.equal(h.submissions.length, 0);
  button(tree, "最新の設定で状態を見直しました").props.onClick(); tree = h.render(newer);
  assert.equal(button(tree, "確認した状態を保存").props.disabled, false);
  assert.deepEqual(saved(h)[id(2)].estimate, { kind: "quantity", quantity: 2.5, purchaseUnit: "袋" });
  const renamed = [item(2, { quickCheckBasis: basis(2, { stockRevision: 2, unitConfiguration: { unit: "箱", packageQuantity: 20, packageQuantityUnit: "個", inventoryUnitConversions: [] } }) })]; tree = h.render(renamed);
  button(tree, "最新の設定で状態を見直しました").props.onClick(); tree = h.render(renamed);
  assert.equal(saved(h)[id(2)].estimate, null);
  assert.equal(elements(row(tree, 2), e => e.type === "input")[0].props.value, "");
});

test("failed saves retain status, estimate and original CAS basis; retry is explicit and successful save clears only submitted drafts", async () => {
  const h = harness({}, false), items = [item(2)]; h.render(items); let tree = h.render(items);
  statusButton(tree, 2, "out").props.onClick(); tree = h.render(items); button(row(tree, 2), "少量").props.onClick(); tree = h.render(items);
  const before = saved(h); button(tree, "確認した状態を保存").props.onClick(); await h.tick(); tree = h.render(items);
  assert.deepEqual(saved(h), before); assert.equal(elements(tree, e => e.props?.role === "alert").length, 1);
  assert.equal(h.submissions[0][0].expectedBasis.stockRevision, 1);
  assert.equal(Object.hasOwn(h.submissions[0][0], "currentQuantity"), false);
  h.setResult(true); button(tree, "確認した状態を保存").props.onClick(); await h.tick(); h.render(items);
  assert.deepEqual(h.submissions[1], h.submissions[0]); assert.deepEqual(saved(h), {});
});

test("an invalid typed estimate cannot save an older hidden value, and clearing the input explicitly removes the estimate", async () => {
  const h = harness(), items = [item(2)]; h.render(items); let tree = h.render(items);
  statusButton(tree, 2, "low").props.onClick(); tree = h.render(items);
  elements(row(tree, 2), e => e.type === "input")[0].props.onChange({ target: { value: "2.5" } }); tree = h.render(items);
  assert.deepEqual(saved(h)[id(2)].estimate, { kind: "quantity", quantity: 2.5, purchaseUnit: "袋" });
  elements(row(tree, 2), e => e.type === "input")[0].props.onChange({ target: { value: "oops" } }); tree = h.render(items);
  assert.equal(button(tree, "確認した状態を保存").props.disabled, true);
  button(tree, "確認した状態を保存").props.onClick(); await h.tick(); assert.equal(h.submissions.length, 0);
  elements(row(tree, 2), e => e.type === "input")[0].props.onChange({ target: { value: "" } }); tree = h.render(items);
  assert.equal(saved(h)[id(2)].estimate, null); assert.equal(button(tree, "確認した状態を保存").props.disabled, false);
});

test("choosing Small replaces an invalid numeric buffer and can be saved as a rough estimate", async () => {
  const h = harness(), items = [item(2)]; h.render(items); let tree = h.render(items);
  statusButton(tree, 2, "low").props.onClick(); tree = h.render(items);
  elements(row(tree, 2), e => e.type === "input")[0].props.onChange({ target: { value: "oops" } }); tree = h.render(items);
  button(row(tree, 2), "少量").props.onClick(); tree = h.render(items);
  assert.equal(elements(row(tree, 2), e => e.type === "input")[0].props.value, "");
  assert.equal(button(tree, "確認した状態を保存").props.disabled, false);
  button(tree, "確認した状態を保存").props.onClick(); await h.tick();
  assert.deepEqual(h.submissions[0][0].estimate, { kind: "small", purchaseUnit: "袋" });
});

test("a late successful save cannot delete a newer same-item draft written by another tab or remount", async () => {
  const h = harness(), items = [item(2)]; h.render(items); let tree = h.render(items);
  statusButton(tree, 2, "low").props.onClick(); tree = h.render(items);
  button(tree, "確認した状態を保存").props.onClick();
  const newer = draft(2, { status: "out", expectedBasis: basis(2, { quickRevision: 2 }) });
  h.storage.set(keyFor(storeId), JSON.stringify({ [id(2)]: newer }));
  await h.tick(); // The original instance need not render again: its parent may already have unmounted it.
  assert.deepEqual(saved(h)[id(2)], newer);
});

test("read-only inventory cannot draft statuses or perform a bulk save", () => {
  const items = [item(2, { canQuickCheck: false })], h = harness(); h.render(items); let tree = h.render(items);
  assert.equal(statusButton(tree, 2, "low").props.disabled, true); statusButton(tree, 2, "low").props.onClick(); tree = h.render(items);
  assert.deepEqual(saved(h), {}); assert.equal(button(tree, "確認した状態を保存"), undefined); assert.equal(h.submissions.length, 0);
});
