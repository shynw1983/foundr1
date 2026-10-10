import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as units from "../lib/product-unit-conversions.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const recipe = { id: id(10), name: "底料", brandId: id(2), kind: "production", targetType: null, targetId: null, outputProductId: id(4), currentVersionId: id(11), version: 1, status: "active", snapshot: { basis: "serving", inputs: [{ productId: id(3), quantity: 2, unit: "kg", mode: "exact" }], output: { productId: id(4), quantity: 10, unit: "kg" } } };
const item = (n: number, productId: string) => ({ id: id(n), storeId: id(1), productId, productName: productId === id(4) ? "底料" : "原料", locationId: id(8), locationName: "庫位", countUnit: "kg", stockQuantity: 20, stockRevision: 2, currentConversion: { purchaseUnit: "kg", countUnit: "kg", unitsPerPurchase: 1 }, stockConversionSnapshot: { purchaseUnit: "kg", countUnit: "kg", unitsPerPurchase: 1 } });
const production = (items = [item(20, id(3)), item(21, id(4))]) => ({ store: { id: id(1), name: "A" }, recipes: [recipe], inventoryItems: items, recent: [], transfers: [], canProduce: true, canTransfer: false, canReceive: false });
const products = [id(3), id(4)].map(productId => ({ id: productId, name: productId, unit: "kg", packageQuantity: null, packageQuantityUnit: "", inventoryUnitConversions: [] }));
const menuRecipe = { ...recipe, kind: "menu", targetType: "item", targetId: id(9), outputProductId: null, snapshot: { basis: "serving", inputs: [{ productId: id(3), quantity: 1, unit: "kg", mode: "exact" }] } };
const recipeResponse = (recipes: any[] = [menuRecipe], canManage = true) => ({ recipes, products, menuTargets: [{ id: id(9), type: "item", name: "小章魚", brandId: id(2) }], brands: [{ id: id(2), name: "A" }], canManage });

function harness(component: string, props: Record<string, unknown>) {
  const states: any[] = [], refs: any[] = [], effectDeps: any[][] = [], callbacks: any[] = [], cleanups: any[] = [];
  let si = 0, ri = 0, ei = 0, ci = 0, effects: Array<() => void> = [], nonce = 40;
  const requests: Array<{ url: string; payload: any; resolve: (r: Response) => void }> = [], storage = new Map<string, string>();
  const react = {
    useState(initial: any) { const i = si++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], (next: any) => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; },
    useRef(initial: any) { const i = ri++; return refs[i] ??= { current: initial }; },
    useCallback(fn: any, next: any[]) { const i = ci++; const prev = callbacks[i]; if (!prev || next.some((v, n) => v !== prev.deps[n])) callbacks[i] = { fn, deps: next }; return callbacks[i].fn; },
    useEffect(fn: () => any, next: any[]) { const i = ei++; if (!effectDeps[i] || next.some((v, n) => v !== effectDeps[i][n])) effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); effectDeps[i] = next; }
  };
  const modules: Record<string, any> = { react, "react/jsx-runtime": { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) }, "../app/os/components/OsTranslationProvider": { useOsTranslation: () => ({ t: (s: string) => s, language: "ja" }) }, "../lib/product-unit-conversions": units, "./InventoryOperations.module.css": { default: {} } };
  modules["./product-unit-conversions"] = units;
  const globals = { AbortController, URLSearchParams, crypto: { randomUUID: () => id(nonce++) }, window: { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } }, fetch: (url: string, options?: any) => new Promise<Response>(resolve => requests.push({ url, payload: options?.body ? JSON.parse(options.body) : null, resolve })) };
  const load = (key: string, file: string) => { const exports: Record<string, any> = {}; runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, { ...globals, exports, require(name: string) { if (!(name in modules)) throw new Error(`Unmocked ${name}`); return modules[name]; } }); modules[key] = exports; return exports; };
  load("../lib/inventory-recipe-policy", "../lib/inventory-recipe-policy.ts");
  modules["./inventory-recipe-policy"] = modules["../lib/inventory-recipe-policy"];
  load("../lib/inventory-production-policy", "../lib/inventory-production-policy.ts");
  load("../lib/inventory-order-usage-policy", "../lib/inventory-order-usage-policy.ts");
  load("./useInventoryOperations", "./useInventoryOperations.ts");
  load("./InventoryRecipeEditor", "./InventoryRecipeEditor.tsx");
  load("./OrderUsageSourceMapper", "./OrderUsageSourceMapper.tsx");
  const exports = component === "InventoryRecipeEditor" ? modules["./InventoryRecipeEditor"] : load(`./${component}`, `./${component}.tsx`);
  return { requests, storage, exports, props,
    render(next = props) { si = ri = ei = ci = 0; effects = []; const tree = exports[component](next); const run = effects; run.forEach(fn => fn()); return tree; },
    async respond(index: number, body: any, status = 200) { requests[index].resolve(Response.json(body, { status })); await new Promise(resolve => setTimeout(resolve, 0)); }
  };
}
function elements(tree: any, predicate: (e: any) => boolean): any[] { if (!tree || typeof tree !== "object") return []; const children = Array.isArray(tree) ? tree : tree.props?.children ?? []; return [...(!Array.isArray(tree) && predicate(tree) ? [tree] : []), ...[children].flat().flatMap(child => elements(child, predicate))]; }
function text(tree: any): string { if (Array.isArray(tree)) return tree.map(text).join(""); if (tree && typeof tree === "object") return text(tree.props?.children); return tree === undefined || tree === null ? "" : String(tree); }
const field = (tree: any, name: string) => elements(tree, e => e.props?.name === name)[0];
const button = (tree: any, label: string) => elements(tree, e => e.type === "button" && text(e).includes(label))[0];
const change = (tree: any, name: string, value: string) => field(tree, name).props.onChange({ target: { value } });
const check = (tree: any, name: string) => field(tree, name).props.onChange({ target: { checked: true } });
const submit = (tree: any) => elements(tree, e => e.type === "form")[0].props.onSubmit({ preventDefault() {} });
const open = (tree: any) => elements(tree, e => e.type === "details")[0].props.onToggle({ currentTarget: { open: true } });

test("recipe CAS conflict preserves draft and explicit reload installs the fresh immutable version", async () => {
  const h = harness("InventoryRecipeEditor", { targetType: "item", targetId: id(9) }); h.render(); await h.respond(0, recipeResponse()); h.render(); let tree = h.render();
  change(tree, "recipeName", "changed"); tree = h.render(); submit(tree);
  assert.equal(h.requests[1].payload.expectedVersionId, id(11)); await h.respond(1, { error: "stale" }, 409); tree = h.render();
  assert.equal(field(tree, "recipeName").props.value, "changed"); assert.equal(button(tree, "新しい版を保存").props.disabled, true);
  button(tree, "入力を破棄して最新の配合を読み込む").props.onClick(); await h.respond(2, recipeResponse([{ ...menuRecipe, name: "fresh", currentVersionId: id(12), version: 2 }])); tree = h.render();
  assert.equal(field(tree, "recipeName").props.value, "fresh"); submit(tree); assert.equal(h.requests[3].payload.expectedVersionId, id(12));
});
test("explicit no-consumption recipe saves empty inputs; missing recipe never becomes a zero rule automatically", async () => {
  const h = harness("InventoryRecipeEditor", { targetType: "item", targetId: id(9), defaultName: "temperature" }); h.render(); await h.respond(0, recipeResponse([])); h.render(); let tree = h.render();
  assert.equal(field(tree, "recipeNoConsumption").props.checked, false); check(tree, "recipeNoConsumption"); tree = h.render(); submit(tree);
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[1].payload.snapshot.inputs)), []); assert.equal(h.requests[1].payload.targetId, id(9)); assert.equal(h.requests[1].payload.expectedVersionId, null);
});
test("recipe readers see existing relationships without management controls, and a target switch hides old data", async () => {
  const h = harness("InventoryRecipeEditor", { targetType: "item", targetId: id(9) }); h.render(); await h.respond(0, recipeResponse([{ ...menuRecipe, name: "PRIVATE RECIPE" }], false)); let tree = h.render();
  assert.equal(elements(tree, e => e.type === "form").length, 0); assert.match(text(tree), /PRIVATE RECIPE/);
  tree = h.render({ targetType: "item", targetId: id(99) }); assert.equal(text(tree).includes("PRIVATE RECIPE"), false);
});
test("manufacturing starts with standard estimates, exact mode requires an explicit measured amount", async () => {
  const h = harness("ManufacturingPanel", { storeId: id(1) }); let tree = h.render(); assert.equal(h.requests.length, 0); open(tree); h.render(); await h.respond(0, production()); tree = h.render();
  change(tree, "productionRecipeId", recipe.id); tree = h.render(); assert.equal(field(tree, "productionOutputQuantity").props.value, ""); assert.equal(field(tree, "productionInputLocation-0").props.value, id(20));
  change(tree, "productionOutputQuantity", "5"); tree = h.render(); check(tree, "productionConfirmed"); tree = h.render(); assert.equal(button(tree, "今回の仕込みを登録").props.disabled, false); submit(tree);
  const body = h.requests[1].payload; assert.equal(body.inputs[0].mode, "estimate"); assert.equal(body.inputs[0].quantity, 1); assert.equal(body.outputQuantity, 5); assert.equal(body.recipeVersionId, id(11));
  await h.respond(1, { error: "bad" }, 400); tree = h.render(); change(tree, "productionInputMode-0", "exact"); tree = h.render(); assert.equal(field(tree, "productionInputQuantity-0").props.value, ""); check(tree, "productionConfirmed"); tree = h.render(); assert.equal(button(tree, "今回の仕込みを登録").props.disabled, true);
});
test("manufacturing ambiguous locations are not selected, failed submissions replay the identical nonce and payload", async () => {
  const h = harness("ManufacturingPanel", { storeId: id(1) }); open(h.render()); h.render(); await h.respond(0, production([item(20, id(3)), item(22, id(3)), item(21, id(4))])); let tree = h.render(); change(tree, "productionRecipeId", recipe.id); tree = h.render(); assert.equal(field(tree, "productionInputLocation-0").props.value, "");
  change(tree, "productionInputLocation-0", id(20)); tree = h.render(); change(tree, "productionOutputQuantity", "5"); tree = h.render(); check(tree, "productionConfirmed"); tree = h.render(); submit(tree); const sent = JSON.stringify(h.requests[1].payload);
  await h.respond(1, { error: "temporary" }, 503); tree = h.render(); button(tree, "同じ内容で再送").props.onClick(); assert.equal(JSON.stringify(h.requests[2].payload), sent); assert.equal(h.storage.size, 1);
  await h.respond(2, { error: "stale" }, 409); await h.respond(3, production()); tree = h.render(); assert.equal(field(tree, "productionOutputQuantity").props.value, "5"); assert.equal(h.storage.size, 0); assert.equal(button(tree, "今回の仕込みを登録").props.disabled, true);
});
test("dispatch is explicitly in transit; receiving uses actual arrival confirmation and current target revision", async () => {
  const h = harness("ManufacturingPanel", { storeId: id(1) }); open(h.render()); h.render();
  const transfer = { id: id(60), sourceStoreId: id(99), targetStoreId: id(1), productId: id(4), productName: "底料", targetInventoryItemId: id(21), quantity: 3, receivedQuantity: 0, remainingQuantity: 3, unit: "kg", status: "in_transit", supplyPriceJpy: null };
  await h.respond(0, { ...production(), canReceive: true, transfers: [transfer] }); let tree = h.render(); assert.equal(field(tree, `transferReceiveQuantity-${id(60)}`).props.value, ""); assert.equal(button(tree, "今回の受取を登録して入庫").props.disabled, true);
  button(tree, "未受取分の数量を入力").props.onClick(); tree = h.render(); elements(tree, e => e.type === "input" && e.props.type === "checkbox").at(-1).props.onChange({ target: { checked: true } }); tree = h.render(); button(tree, "今回の受取を登録して入庫").props.onClick();
  assert.equal(h.requests[1].payload.action, "transfer_receive"); assert.equal(h.requests[1].payload.quantity, 3); assert.equal(h.requests[1].payload.expectedTargetStockRevision, 2);
});
test("forecast null and negative balances remain visible; no data request before expanded; scope switch hides old stock", async () => {
  const h = harness("InventoryUsagePanel", { storeId: id(1) }); let tree = h.render(); assert.equal(h.requests.length, 0); open(tree); h.render();
  await h.respond(0, { selectedStoreId: id(1), items: [{ inventoryItemId: id(20), productName: "特殊原料", locationName: "A", countUnit: "個", anchor: null, receivedQuantity: null, orderDeductedQuantity: null, bookExpectedQuantity: -2, forecastQuantity: null, dailyUsage: null, daysRemaining: null, confidence: "unknown", issueReasons: ["anchor_missing"], coverage: { mappedServings: 2, unmappedOrders: 1 }, asOf: "2026-10-11T00:00:00Z", forecastSource: "none" }], recentReconciliations: [] });
  await h.respond(1, { settings: { storeId: id(1), enabled: false, enabledFrom: null, triggerMode: "preparation", revision: 0 }, locations: [], issues: [], recentUsage: [], canManage: false }); h.render(); tree = h.render(); assert.match(text(tree), /−2 個/); assert.match(text(tree), /未確認/); assert.equal(field(tree, "usageEnabled").props.disabled, true);
  tree = h.render({ storeId: id(98) }); assert.equal(text(tree).includes("特殊原料"), false);
});
test("settings conflict preserves the selected trigger and only explicit reload accepts current revision", async () => {
  const h = harness("InventoryUsagePanel", { storeId: id(1) }); open(h.render()); h.render(); await h.respond(0, { items: [], recentReconciliations: [] });
  const response = { settings: { storeId: id(1), enabled: false, enabledFrom: null, triggerMode: "preparation", revision: 0 }, locations: [], issues: [], recentUsage: [], canManage: true };
  await h.respond(1, response); h.render(); let tree = h.render(); change(tree, "usageTriggerMode", "confirmed_sale"); tree = h.render(); check(tree, "usageConfirmed"); tree = h.render(); button(tree, "注文連動の設定を保存").props.onClick(); assert.equal(h.requests[2].payload.expectedRevision, 0);
  await h.respond(2, { error: "stale" }, 409); tree = h.render(); assert.equal(field(tree, "usageTriggerMode").props.value, "confirmed_sale"); assert.equal(button(tree, "注文連動の設定を保存").props.disabled, true);
  button(tree, "入力を破棄して最新の設定を読み込む").props.onClick(); await h.respond(3, { ...response, settings: { ...response.settings, revision: 3, triggerMode: "preparation" } }); tree = h.render(); assert.equal(field(tree, "usageTriggerMode").props.value, "preparation"); check(tree, "usageConfirmed"); tree = h.render(); button(tree, "注文連動の設定を保存").props.onClick(); assert.equal(h.requests[4].payload.expectedRevision, 3);
});

const batch = { purchaseUnit: "袋", contentQuantity: 3, contentUnit: "kg", countUnit: "kg", stockQuantityPerPurchase: 3 };
const template = { ...batch, id: id(80), productId: id(3), name: "3kg袋", status: "active", supplierId: null, updatedAt: "2026-10-11 00:00:00+00" };
test("template saving is HQ-only, duplicate names require an explicit existing target and CAS timestamp", async () => {
  const h = harness("BatchPackagingTemplateSaver", { storeId: id(1), productId: id(3), packaging: batch }); h.render(); await h.respond(0, { canManage: true, templates: [template] }); let tree = h.render();
  change(tree, "packagingTemplateName", template.name); tree = h.render(); assert.equal(button(tree, "包装テンプレートを保存").props.disabled, true); assert.equal(h.requests.length, 1);
  change(tree, "packagingTemplateSaveTarget", template.id); tree = h.render(); button(tree, "選んだ包装テンプレートを更新").props.onClick(); assert.equal(h.requests[1].payload.id, template.id); assert.equal(h.requests[1].payload.expectedUpdatedAt, template.updatedAt);
  const readonly = harness("BatchPackagingTemplateSaver", { storeId: id(1), productId: id(3), packaging: batch }); readonly.render(); await readonly.respond(0, { canManage: false, templates: [template] }); assert.equal(readonly.render(), null);
});
test("template creation preserves UUID/name/full batch snapshot through uncertain retry even if incoming props change", async () => {
  const props = { storeId: id(1), productId: id(3), packaging: batch };
  const h = harness("BatchPackagingTemplateSaver", props); h.render(); await h.respond(0, { canManage: true, templates: [] }); let tree = h.render(); change(tree, "packagingTemplateName", "new"); tree = h.render(); button(tree, "包装テンプレートを保存").props.onClick(); const sent = JSON.stringify(h.requests[1].payload); assert.equal(h.requests[1].payload.id, undefined); assert.ok(h.requests[1].payload.requestId);
  await h.respond(1, { error: "temporary" }, 503); tree = h.render({ ...props, packaging: { ...batch, contentQuantity: 5, stockQuantityPerPurchase: 5 } }); assert.equal(field(tree, "packagingTemplateName").props.disabled, true); button(tree, "同じ内容で再送").props.onClick(); assert.equal(JSON.stringify(h.requests[2].payload), sent);
});
test("template conflict retains the name and original timestamp until explicit snapshot review", async () => {
  const h = harness("BatchPackagingTemplateSaver", { storeId: id(1), productId: id(3), packaging: batch }); h.render(); await h.respond(0, { canManage: true, templates: [template] }); let tree = h.render(); change(tree, "packagingTemplateSaveTarget", template.id); tree = h.render(); change(tree, "packagingTemplateName", "draft-name"); tree = h.render(); button(tree, "選んだ包装テンプレートを更新").props.onClick(); await h.respond(1, { error: "stale" }, 409);
  const latest = { ...template, updatedAt: "2026-10-11 01:00:00+00" }; await h.respond(2, { canManage: true, templates: [latest] }); tree = h.render(); assert.equal(field(tree, "packagingTemplateName").props.value, "draft-name"); assert.equal(button(tree, "選んだ包装テンプレートを更新").props.disabled, true);
  button(tree, "最新の保存先を確認しました").props.onClick(); await h.respond(3, { canManage: true, templates: [latest] }); tree = h.render(); button(tree, "選んだ包装テンプレートを更新").props.onClick(); assert.equal(h.requests[4].payload.expectedUpdatedAt, latest.updatedAt); assert.equal(h.requests[4].payload.name, "draft-name"); assert.notEqual(h.requests[4].payload.requestId, h.requests[1].payload.requestId);
});

const pendingSource = { orderId: id(90), orderNo: "UBER-1", orderSource: "uber_eats", status: "preparing", firstPreparedAt: "2026-10-11T00:00:00Z", identityWarnings: ["unsupported_bridge_identity"], expectedSourceSnapshot: { schema: 1, orderSource: "uber_eats", identityConfidence: "unresolved", items: [], rawItems: [{ quantity: 1 }], issueCodes: ["unsupported_bridge_identity"] }, items: [{ sourceItemId: id(91), rawName: "original name", quantity: 1, rawOptions: [{ name: "original option", quantity: null }] }] };
const mappingData = { settings: { storeId: id(1) }, canManage: true, pendingSources: [pendingSource], menuTargets: [{ id: id(9), name: "original name", brandId: id(2), category: "丸子" }], optionTargets: [{ id: id(92), name: "option", brandId: id(2), groupId: id(93), groupName: "group", menuCatalogItemId: id(9), groupApplicableCategories: [], applicableCategories: [] }, { id: id(94), name: "wrong-parent", brandId: id(2), groupId: id(93), groupName: "group", menuCatalogItemId: id(99), groupApplicableCategories: [], applicableCategories: [] }, { id: id(95), name: "wrong-category", brandId: id(2), groupId: id(93), groupName: "group", menuCatalogItemId: null, groupApplicableCategories: ["飲料"], applicableCategories: [] }] };
test("external mapping never guesses identity or default quantity, filters exact parent/category and keeps option count per serving", () => {
  const h = harness("OrderUsageSourceMapper", { storeId: id(1), data: mappingData }); let tree = h.render(); change(tree, "mappingOrderId", pendingSource.orderId); tree = h.render();
  assert.equal(field(tree, "mappingMenu-0").props.value, ""); assert.equal(field(tree, "mappingQuantity-0").props.value, ""); assert.equal(field(tree, "mappingOptionQuantity-0-0").props.value, "");
  change(tree, "mappingMenu-0", id(9)); tree = h.render(); const options = elements(field(tree, "mappingOption-0-0"), e => e.type === "option"); assert.equal(options.length, 2); assert.equal(text(tree).includes("wrong-parent"), false); assert.equal(text(tree).includes("wrong-category"), false);
  change(tree, "mappingQuantity-0", "2"); tree = h.render(); change(tree, "mappingOption-0-0", id(92)); tree = h.render(); change(tree, "mappingOptionQuantity-0-0", "3"); tree = h.render(); check(tree, "mappingOriginalConfirmed"); tree = h.render(); button(tree, "この原注文の対応付けを保存").props.onClick();
  assert.equal(h.requests[0].payload.mappedItems[0].quantity, 2); assert.equal(h.requests[0].payload.mappedItems[0].options[0].quantity, 3); assert.equal(h.requests[0].payload.confirmOriginalOrder, true); assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].payload.expectedSourceSnapshot)), pendingSource.expectedSourceSnapshot);
});
test("external mapping conflict retains all choices and quantities, while cross-store navigation hides the old raw source", async () => {
  const h = harness("OrderUsageSourceMapper", { storeId: id(1), data: mappingData }); let tree = h.render(); change(tree, "mappingOrderId", pendingSource.orderId); tree = h.render(); change(tree, "mappingMenu-0", id(9)); tree = h.render(); change(tree, "mappingQuantity-0", "2"); tree = h.render(); change(tree, "mappingOption-0-0", id(92)); tree = h.render(); change(tree, "mappingOptionQuantity-0-0", "3"); tree = h.render(); check(tree, "mappingOriginalConfirmed"); tree = h.render(); button(tree, "この原注文の対応付けを保存").props.onClick(); await h.respond(0, { error: "stale" }, 409); tree = h.render(); assert.equal(field(tree, "mappingQuantity-0").props.value, "2"); assert.equal(field(tree, "mappingOption-0-0").props.value, id(92)); assert.equal(button(tree, "この原注文の対応付けを保存").props.disabled, true);
  tree = h.render({ storeId: id(96), data: mappingData }); assert.equal(tree, null);
});
test("source snapshot changes cannot silently rebase a mapping; unknown raw option quantity stays blank after reference fill", () => {
  const props = { storeId: id(1), data: mappingData }, h = harness("OrderUsageSourceMapper", props); let tree = h.render(); change(tree, "mappingOrderId", pendingSource.orderId); tree = h.render(); button(tree, "原注文と照合して取込数量を入力").props.onClick(); tree = h.render(); assert.equal(field(tree, "mappingQuantity-0").props.value, "1"); assert.equal(field(tree, "mappingOptionQuantity-0-0").props.value, "");
  tree = h.render({ ...props, data: { ...mappingData, pendingSources: [{ ...pendingSource, expectedSourceSnapshot: { ...pendingSource.expectedSourceSnapshot, rawItems: [{ quantity: 4 }] } }] } }); assert.match(text(tree), /原注文または対応付けが変わりました/); assert.equal(field(tree, "mappingQuantity-0").props.value, "1"); assert.equal(button(tree, "この原注文の対応付けを保存").props.disabled, true);
});

test("literal recipe units are explicitly entered without inventing master conversions; new creation retries immutable UUID/body after reload", async () => {
  const props = { targetType: "item", targetId: id(9), defaultName: "literal" }, h = harness("InventoryRecipeEditor", props);
  const data = { ...recipeResponse([]), products: [{ ...products[0], unit: "袋", inventoryUnitConversions: [] }] };
  h.render(); await h.respond(0, data); h.render(); let tree = h.render(); change(tree, "inputProduct-0", id(3)); tree = h.render(); change(tree, "inputQuantity-0", "2"); tree = h.render();
  assert.equal(field(tree, "inputUnit-0").type, "input"); assert.ok(field(tree, "inputUnit-0").props.list); change(tree, "inputUnit-0", "g"); tree = h.render(); submit(tree);
  const sent = JSON.stringify(h.requests[1].payload); assert.ok(h.requests[1].payload.requestId); assert.equal(h.requests[1].payload.snapshot.inputs[0].unit, "g"); assert.deepEqual(data.products[0].inventoryUnitConversions, []);
  await h.respond(1, { error: "temporary" }, 503); tree = h.render(); assert.equal(field(tree, "recipeName").props.disabled, true); button(tree, "同じ内容で再送").props.onClick(); assert.equal(JSON.stringify(h.requests[2].payload), sent);
  const restored = harness("InventoryRecipeEditor", props); for (const [key, value] of h.storage) restored.storage.set(key, value); restored.render(); await restored.respond(0, data); restored.render(); tree = restored.render(); assert.equal(field(tree, "inputUnit-0").props.value, "g"); assert.equal(field(tree, "inputUnit-0").props.disabled, true); button(tree, "同じ内容で再送").props.onClick(); assert.equal(JSON.stringify(restored.requests[1].payload), sent);
});
test("production recipe output also accepts an explicit literal base unit beyond today's product dropdown", async () => {
  const h = harness("InventoryRecipeEditor", { defaultKind: "production", brandId: id(2), defaultName: "base" }); h.render(); await h.respond(0, { ...recipeResponse([]), products: products.map(product => ({ ...product, unit: "袋" })) }); h.render(); let tree = h.render();
  change(tree, "outputProductId", id(4)); tree = h.render(); change(tree, "standardOutputQuantity", "10"); tree = h.render(); assert.equal(field(tree, "outputUnit").type, "input"); change(tree, "outputUnit", "g"); tree = h.render(); change(tree, "inputProduct-0", id(3)); tree = h.render(); change(tree, "inputQuantity-0", "20"); tree = h.render(); change(tree, "inputUnit-0", "g"); tree = h.render(); submit(tree); assert.equal(h.requests[1].payload.snapshot.output.unit, "g"); assert.equal(h.requests[1].payload.snapshot.inputs[0].unit, "g");
});
test("raw composite specifications remain visible reference text, without generating duplicate mapped options", () => {
  const data = { ...mappingData, pendingSources: [{ ...pendingSource, items: [{ ...pendingSource.items[0], rawOptions: [], rawSpecifications: ["large · hot · extra", "size 100g"] }] }] };
  const h = harness("OrderUsageSourceMapper", { storeId: id(1), data }); let tree = h.render(); change(tree, "mappingOrderId", pendingSource.orderId); tree = h.render(); assert.match(text(tree), /large · hot · extra/); assert.match(text(tree), /size 100g/); assert.equal(field(tree, "mappingOption-0-0"), undefined); assert.equal(field(tree, "mappingQuantity-0").props.value, "");
});
test("weak external preparation time is never copied from import time, future is blocked, explicit time sends a timezone-safe ISO instant", () => {
  const data = { ...mappingData, pendingSources: [{ ...pendingSource, requiresPreparationTime: true, orderedAt: "2026-01-01T00:00:00Z" }] };
  const h = harness("OrderUsageSourceMapper", { storeId: id(1), data }); let tree = h.render(); change(tree, "mappingOrderId", pendingSource.orderId); tree = h.render(); assert.equal(field(tree, "mappingConfirmedPreparedAt").props.value, ""); change(tree, "mappingMenu-0", id(9)); tree = h.render(); change(tree, "mappingQuantity-0", "2"); tree = h.render(); change(tree, "mappingOption-0-0", id(92)); tree = h.render(); change(tree, "mappingOptionQuantity-0-0", "3"); tree = h.render(); check(tree, "mappingOriginalConfirmed"); tree = h.render(); assert.equal(button(tree, "この原注文の対応付けを保存").props.disabled, true);
  change(tree, "mappingConfirmedPreparedAt", "2999-01-01T12:30"); tree = h.render(); check(tree, "mappingOriginalConfirmed"); tree = h.render(); assert.equal(button(tree, "この原注文の対応付けを保存").props.disabled, true); assert.equal(h.requests.length, 0);
  change(tree, "mappingConfirmedPreparedAt", "2026-01-01T12:30"); tree = h.render(); check(tree, "mappingOriginalConfirmed"); tree = h.render(); button(tree, "この原注文の対応付けを保存").props.onClick(); assert.equal(h.requests[0].payload.confirmedPreparedAt, new Date("2026-01-01T12:30").toISOString()); assert.match(h.requests[0].payload.confirmedPreparedAt, /Z$/);
});
