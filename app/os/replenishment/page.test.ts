import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { replenishmentText } from "./copy.ts";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const storeA = id(1), storeB = id(2), productId = id(10), demandId = id(20), buyerId = id(30);
const demand = (overrides: Record<string, unknown> = {}) => ({
  id: demandId, storeId: storeA, storeName: "A店", product: { id: productId, name: "同じ商品・500g袋", unit: "袋", isOrderable: true },
  status: "open", version: 1, quantity: null, unit: "袋", note: "", deferredUntil: null, createdAt: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:00:00Z",
  sources: [], events: [], orders: [], openOrders: [], inventory: [], openItemIds: [], progress: "reported", ...overrides
});
const payload = (storeId = storeA, overrides: Record<string, unknown> = {}) => ({ stores: [{ id: storeA, name: "A店" }, { id: storeB, name: "B店" }], storeId, demands: [demand({ storeId })], products: [{ id: productId, name: "同じ商品・500g袋", unit: "袋", isOrderable: true }], operator: { id: id(31), name: "管理者A" }, canReport: true, canManage: true, buyers: [{ id: buyerId, name: "購入担当A" }], ...overrides });

function harness(search = `?storeId=${storeA}`, language: "ja" | "zh-Hans" | "zh-Hant" = "ja") {
  const exports: Record<string, any> = {};
  const states: any[] = [], refs: any[] = [], memos: any[] = [], effects: any[] = [];
  let stateIndex = 0, refIndex = 0, memoIndex = 0, effectIndex = 0;
  let pendingEffects: Array<() => void> = [], serial = 90;
  const requests: Array<{ url: string; body: any; method: string; resolve: (response: Response) => void; reject: (error: Error) => void }> = [];
  const storage = new Map<string, string>();
  const listeners = new Map<string, () => void>();
  const location = { search, href: `https://example.test/os/replenishment${search}` };
  const react = {
    useState(initial: any) { const i = stateIndex++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], (next: any) => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; },
    useRef(initial: any) { return refs[refIndex++] ??= { current: initial }; },
    useMemo(callback: () => unknown, deps: any[]) { const i = memoIndex++; if (!memos[i] || deps.some((value, j) => value !== memos[i].deps[j])) memos[i] = { deps, value: callback() }; return memos[i].value; },
    useCallback(callback: () => unknown, deps: any[]) { return react.useMemo(() => callback, deps); },
    useEffect(callback: () => void, deps: any[]) { const i = effectIndex++; if (!effects[i] || deps.some((value, j) => value !== effects[i][j])) pendingEffects.push(callback); effects[i] = deps; }
  };
  const translate = (value: string) => value;
  const css = new Proxy({}, { get: (_, name) => String(name) });
  const modules: Record<string, any> = {
    react, "react/jsx-runtime": { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) }, "lucide-react": {},
    "../components/ActionNotice": { useActionNotice: () => ({ notice: null, showNotice() {}, clearNotice() {} }) },
    "../components/MobileNavMenu": {}, "../components/OsNavList": { canonicalNavItems: [] }, "../components/UserBadge": {},
    "../components/OsTranslationProvider": { useOsTranslation: () => ({ language, t: translate }) },
    "./copy": { replenishmentText }, "./replenishment.module.css": { default: css }
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL("./page.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, {
    exports, URL, URLSearchParams, Intl, Date,
    crypto: { randomUUID: () => id(serial++) },
    window: { location, sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) }, addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name), history: { state: null, replaceState: (_: unknown, __: string, url: URL) => { location.search = url.search; location.href = String(url); } } },
    fetch: (url: string, options?: any) => new Promise<Response>((resolve, reject) => requests.push({ url, method: options?.method || "GET", body: options?.body ? JSON.parse(options.body) : null, resolve, reject })),
    require: (name: string) => { if (!(name in modules)) throw new Error(`Unmocked dependency ${name}`); return modules[name]; }
  });
  return {
    requests, storage, location,
    render() { stateIndex = refIndex = memoIndex = effectIndex = 0; pendingEffects = []; const tree = exports.default(); pendingEffects.forEach(fn => fn()); return tree; },
    async respond(index: number, body: unknown, status = 200) { requests[index].resolve(Response.json(body, { status })); await new Promise(resolve => setTimeout(resolve, 0)); },
    async fail(index: number) { requests[index].reject(new Error("Network unavailable")); await new Promise(resolve => setTimeout(resolve, 0)); },
    navigate(search: string) { location.search = search; location.href = `https://example.test/os/replenishment${search}`; listeners.get("popstate")?.(); }
  };
}
function elements(tree: any, predicate: (element: any) => boolean): any[] {
  if (!tree || typeof tree !== "object") return [];
  const children = Array.isArray(tree) ? tree : tree.props?.children ?? [];
  return [...(!Array.isArray(tree) && predicate(tree) ? [tree] : []), ...[children].flat().flatMap(child => elements(child, predicate))];
}
function text(tree: any): string {
  if (tree === null || tree === undefined || typeof tree === "boolean") return "";
  if (typeof tree !== "object") return String(tree);
  return [Array.isArray(tree) ? tree : tree.props?.children ?? []].flat().map(text).join("");
}
const button = (tree: any, label: string) => elements(tree, element => element.type === "button" && text(element) === label)[0];
const field = (tree: any, label: string) => {
  const direct = elements(tree, element => element.props?.["aria-label"] === label && ["input", "select", "textarea"].includes(element.type))[0];
  if (direct) return direct;
  const parent = elements(tree, element => element.type === "label" && text(element).startsWith(label))[0];
  return elements(parent, element => ["input", "select", "textarea"].includes(element.type))[0];
};
const update = (page: ReturnType<typeof harness>, label: string, value: string) => field(page.render(), label).props.onChange({ target: { value } });
function selectDemand(page: ReturnType<typeof harness>) { elements(page.render(), element => element.type === "input" && element.props.type === "checkbox")[0].props.onChange({ target: { checked: true } }); }

test("direct SKU links keep the selected store; late responses from another store never replace it", async () => {
  const page = harness(`?storeId=${storeA}&productId=${productId}`);
  page.render();
  assert.equal(page.requests[0].url, `/api/os/replenishment?storeId=${storeA}`);
  page.navigate(`?storeId=${storeB}&productId=${productId}`);
  await page.respond(1, payload(storeB));
  await page.respond(0, payload(storeA));
  assert.equal(field(page.render(), "店舗").props.value, storeB);
  assert.match(text(page.render()), /B店/);
  assert.equal(field(page.render(), "商品名・店舗・メモを検索").props.value, productId);
});

test("quantity stays unknown until explicitly entered, and a version conflict preserves the entered draft", async () => {
  const page = harness(); page.render(); await page.respond(0, payload());
  assert.equal(field(page.render(), "同じ商品・500g袋 発注数量").props.value, "");
  update(page, "同じ商品・500g袋 発注数量", "4");
  button(page.render(), "変更を保存").props.onClick();
  assert.equal(page.requests[1].body.expectedVersion, 1);
  await page.respond(1, { error: "依頼または商品の単位が変わりました。更新して確認してください。" }, 409);
  await page.respond(2, payload(storeA, { demands: [demand({ version: 2, quantity: 8 })] }));
  const tree = page.render();
  assert.equal(field(tree, "同じ商品・500g袋 発注数量").props.value, "4");
  assert.equal(button(tree, "変更を保存").props.disabled, true);
  button(tree, "内容を確認して再編集").props.onClick();
  button(page.render(), "変更を保存").props.onClick();
  assert.equal(page.requests[3].body.expectedVersion, 2);
  assert.equal(page.requests[3].body.quantity, 4);
});

test("changed purchase units clear the old draft quantity only after explicit review", async () => {
  const page = harness(); page.render(); await page.respond(0, payload());
  update(page, "同じ商品・500g袋 発注数量", "4");
  button(page.render(), "更新").props.onClick();
  await page.respond(1, payload(storeA, { demands: [demand({ version: 2, product: { id: productId, name: "同じ商品・500g袋", unit: "箱", isOrderable: true }, unit: "箱" })] }));
  assert.equal(field(page.render(), "同じ商品・500g袋 発注数量").props.value, "4");
  button(page.render(), "内容を確認して再編集").props.onClick();
  assert.equal(field(page.render(), "同じ商品・500g袋 発注数量").props.value, "");
});

test("order creation requires buyer, date and extra-order acknowledgment, then an explicit final confirmation", async () => {
  const page = harness(); page.render(); await page.respond(0, payload(storeA, { demands: [demand({ openItemIds: [id(40)] })] }));
  selectDemand(page); update(page, "同じ商品・500g袋 発注数量", "3"); update(page, "購入担当", buyerId); update(page, "希望納品日", "2026-10-20");
  assert.equal(button(page.render(), "発注内容を確認").props.disabled, true);
  const acknowledgment = elements(page.render(), element => element.type === "input" && element.props.type === "checkbox")[1];
  acknowledgment.props.onChange({ target: { checked: true } });
  button(page.render(), "発注内容を確認").props.onClick();
  assert.equal(page.requests.length, 1, "opening the preview must not create an order");
  button(page.render(), "発注を確定する").props.onClick();
  assert.equal(page.requests[1].body.action, "create_order");
  assert.equal(page.requests[1].body.expectedActorId, id(31));
  assert.equal(page.requests[1].body.items[0].quantity, 3);
  assert.deepEqual(page.requests[1].body.items[0].expectedOpenItemIds, [id(40)]);
  assert.equal(page.requests[1].body.additionalOrderConfirmed, true);
  await page.fail(1);
  button(page.render(), "同じ内容で結果を確認").props.onClick();
  assert.deepEqual(page.requests[2].body, page.requests[1].body, "unknown outcome must retry the same immutable request and idempotency key");
});

test("manual manager requests may leave quantity unknown and preserve a request ID for network retry", async () => {
  const page = harness(); page.render(); await page.respond(0, payload());
  button(page.render(), "需要を追加").props.onClick(); update(page, "正確なSKUを選択", productId); update(page, "報告メモ", "週末の追加需要");
  button(page.render(), "需要を保存").props.onClick();
  assert.equal(page.requests[1].body.quantity, null);
  await page.fail(1);
  button(page.render(), "需要を保存").props.onClick();
  assert.equal(page.requests[2].body.requestId, page.requests[1].body.requestId);
});

test("OS language selection translates new operational labels and validation errors", async () => {
  const page = harness(`?storeId=${storeA}`, "zh-Hans"); page.render(); await page.respond(0, payload());
  assert.ok(button(page.render(), "新增需求"));
  assert.match(text(page.render()), /数量待定|不自动推测采购量/);
  assert.equal(replenishmentText("zh-Hant", "依頼または商品の単位が変わりました。更新して確認してください。"), "需求或商品單位已變更，請重新整理並核對。");
});

test("pending orders recover only after the authenticated original actor and store are established", async () => {
  const page = harness();
  const pending = { body: { action: "create_order", storeId: storeA, expectedActorId: id(31), requestId: id(50), buyerId, deadline: "2026-10-20", additionalOrderConfirmed: false, items: [{ demandId, expectedVersion: 1, quantity: 2, unit: "袋", expectedOpenItemIds: [] }] }, names: [{ id: demandId, name: "同じ商品・500g袋" }], storeName: "A店", buyerName: "購入担当A", attempted: true };
  page.storage.set(`foundr1-os:replenishment-order:v2:${id(31)}:${storeA}`, JSON.stringify(pending));
  assert.equal(elements(page.render(), element => element.props?.role === "dialog").length, 0, "cached writes must not recover before authentication");
  await page.respond(0, payload(storeA, { operator: { id: id(32), name: "管理者B" } }));
  assert.equal(elements(page.render(), element => element.props?.role === "dialog").length, 0, "a different employee must not inherit the order");
  button(page.render(), "更新").props.onClick(); await page.respond(1, payload());
  assert.equal(elements(page.render(), element => element.props?.role === "dialog").length, 1);
  button(page.render(), "同じ内容で結果を確認").props.onClick();
  assert.deepEqual(page.requests[2].body, pending.body);
});

test("manager judgment shows each storage unit separately and includes ordinary existing purchase orders", async () => {
  const page = harness(); page.render();
  const order = { orderId: id(61), orderNo: "PO-TEST", itemId: id(60), status: "purchased", requestedQuantity: 3, unit: "袋", actualQuantity: null, actualUnit: null, receivedQuantity: 0 };
  await page.respond(0, payload(storeA, { demands: [demand({ inventory: [
    { id: id(70), locationName: "冷凍庫A", quantity: 2, countUnit: "袋", safetyStock: 4, lastCountedAt: null, quickStatus: null, quickCheckedAt: null },
    { id: id(71), locationName: "冷蔵庫B", quantity: 7, countUnit: "個", safetyStock: 10, lastCountedAt: null, quickStatus: "low", quickCheckedAt: "2026-10-18T00:00:00Z" }
  ], orders: [order], openOrders: [order], openItemIds: [order.itemId] })] }));
  const tree = page.render();
  assert.match(text(tree), /冷凍庫A現在庫 2 袋/);
  assert.match(text(tree), /冷蔵庫B現在庫 7 個/);
  assert.equal(elements(tree, element => element.type === "a" && element.props.href === "/os/procurement?order=PO-TEST").length, 1, "linked and ordinary open lists must not duplicate the same stable purchase detail");
  assert.match(text(tree), /実購 数量未記録/);
  assert.match(text(tree), /入庫 数量未記録/);
});

test("unsaved judgment notes must be saved before issuing, and switched identities keep the original unknown retry", async () => {
  const page = harness(); page.render(); await page.respond(0, payload());
  selectDemand(page); update(page, "同じ商品・500g袋 発注数量", "3"); update(page, "購入担当", buyerId); update(page, "希望納品日", "2026-10-20");
  update(page, "判断メモ", "数量を追加");
  assert.equal(button(page.render(), "発注内容を確認").props.disabled, true);
  update(page, "判断メモ", "");
  button(page.render(), "発注内容を確認").props.onClick(); button(page.render(), "発注を確定する").props.onClick();
  await page.fail(1);
  const originalKey = [...page.storage.keys()][0];
  button(page.render(), "同じ内容で結果を確認").props.onClick();
  await page.respond(2, { error: "操作する従業員が変わりました。発注内容を確認し直してください。", code: "actor_changed" }, 409);
  await page.respond(3, payload(storeA, { operator: { id: id(32), name: "管理者B" } }));
  assert.ok(page.storage.has(originalKey), "a switched account cannot discard the original employee's unknown attempt");
  assert.equal(elements(page.render(), element => element.props?.role === "dialog").length, 0);
});
