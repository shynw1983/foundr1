import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const product = { id: id(2), name: "魚丸", unit: "袋", isOrderable: true };
const key = (storeId = id(1), employee = id(3)) => `foundr1-store:replenishment-report:v1:${storeId}:${employee}`;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function harness(storage = new Map<string, string>()) {
  const exports: Record<string, any> = {}, states: any[] = [], refs: any[] = [], deps: any[][] = [], cleanups: any[] = [];
  const requests: Array<{ body: any; resolve: (response: Response) => void; reject: (error: Error) => void }> = [];
  let si = 0, ri = 0, ei = 0, nonce = 40, effects: Array<() => void> = [], storageFails = false, recorded = 0, authorization = 0;
  const react = {
    useState(initial: any) { const i = si++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], (next: any) => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; },
    useRef(initial: any) { const i = ri++; return refs[i] ??= { current: initial }; },
    useEffect(fn: () => any, next: any[]) { const i = ei++; if (!deps[i] || next.some((v, n) => v !== deps[i][n])) effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); deps[i] = next; }
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL("./StoreReplenishmentReport.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
  }).outputText, {
    exports, crypto: { randomUUID: () => id(nonce++) },
    window: { localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, value: string) => { if (storageFails) throw new Error("full"); storage.set(k, value); }, removeItem: (k: string) => storage.delete(k) } },
    fetch: (_url: string, options: any) => new Promise<Response>((resolve, reject) => requests.push({ body: JSON.parse(options.body), resolve, reject })),
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) };
      if (name.endsWith("OsTranslationProvider")) return { useOsTranslation: () => ({ t: (s: string) => s }) };
      if (name.endsWith(".module.css")) return { default: {} };
      throw new Error(`Unmocked ${name}`);
    }
  });
  const props = { storeId: id(1), expectedOperatorId: id(3), canOperate: true, products: [product], onRecorded: () => { ++recorded; }, onAuthorizationRequired: () => { ++authorization; } };
  return {
    props, requests, storage,
    render(input = props) { si = ri = ei = 0; effects = []; const tree = exports.StoreReplenishmentReport(input); effects.forEach(fn => fn()); return tree; },
    async respond(index: number, body: any, status = 200) { requests[index].resolve(Response.json(body, { status })); await tick(); },
    async reject(index: number) { requests[index].reject(new Error("offline")); await tick(); },
    failStorage() { storageFails = true; },
    unmount() { cleanups.forEach(fn => fn?.()); },
    get recorded() { return recorded; }, get authorization() { return authorization; }
  };
}
function elements(tree: any, predicate: (element: any) => boolean): any[] {
  if (!tree || typeof tree !== "object") return [];
  const children = Array.isArray(tree) ? tree : tree.props?.children ?? [];
  return [...(!Array.isArray(tree) && predicate(tree) ? [tree] : []), ...[children].flat().flatMap(child => elements(child, predicate))];
}
const field = (tree: any, name: string) => elements(tree, e => e.props?.name === name)[0];
const text = (tree: any): string => Array.isArray(tree) ? tree.map(text).join("") : tree && typeof tree === "object" ? text(tree.props?.children) : tree == null ? "" : String(tree);
const button = (tree: any, name: string) => elements(tree, e => e.type === "button" && text(e).includes(name))[0];
const change = (tree: any, name: string, value: string) => field(tree, name).props.onChange({ target: { value } });
const submit = (tree: any) => elements(tree, e => e.type === "form")[0].props.onSubmit({ preventDefault() {} });
function ready(h: ReturnType<typeof harness>) { h.render(); let tree = h.render(); change(tree, "productId", product.id); return h.render(); }

test("a report sends the exact SKU/operator, permits unknown quantity, and preserves shortage observation", async () => {
  const h = harness(); let tree = ready(h); change(tree, "shortageStatus", "unavailable"); tree = h.render(); submit(tree); submit(tree);
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].body.productId, product.id); assert.equal(h.requests[0].body.quantity, null);
  assert.equal(h.requests[0].body.unit, "袋"); assert.equal(h.requests[0].body.expectedOperatorId, id(3)); assert.equal(h.requests[0].body.shortageStatus, "unavailable");
  await h.respond(0, { ok: true, demandId: id(8) }); assert.equal(h.recorded, 1); assert.equal(h.storage.has(key()), false);
});

test("unknown result locks all input and retries the original body including its request ID", async () => {
  const h = harness(); let tree = ready(h); change(tree, "quantity", "3"); tree = h.render(); change(tree, "note", "明日の営業用"); tree = h.render(); submit(tree);
  const first = JSON.stringify(h.requests[0].body); await h.reject(0); tree = h.render(); assert.equal(field(tree, "productId").props.disabled, true);
  submit(tree); assert.equal(JSON.stringify(h.requests[1].body), first); await h.respond(1, { error: "temporary" }, 503);
  const reloaded = harness(h.storage); reloaded.render(); tree = reloaded.render(); submit(tree); assert.equal(JSON.stringify(reloaded.requests[0].body), first);
});

test("authorization expiry retains pending request for the same employee and cannot transfer it to another employee", async () => {
  const h = harness(); let tree = ready(h); submit(tree); const first = JSON.stringify(h.requests[0].body);
  await h.respond(0, { error: "expired", code: "operator_expired" }, 401); assert.equal(h.authorization, 1); assert.equal(h.storage.has(key()), true);
  tree = h.render({ ...h.props, canOperate: false }); submit(tree); assert.equal(h.requests.length, 1);
  const other = harness(h.storage); other.render({ ...other.props, expectedOperatorId: id(4) }); tree = other.render({ ...other.props, expectedOperatorId: id(4) });
  assert.equal(field(tree, "productId").props.value, ""); assert.equal(button(tree, "担当者に報告").props.disabled, true);
  const original = harness(h.storage); original.render(); tree = original.render(); submit(tree); assert.equal(JSON.stringify(original.requests[0].body), first);
});

test("switching stores hides the previous draft immediately and ignores its eventual response", async () => {
  const h = harness(); let tree = ready(h); submit(tree);
  const other = { ...h.props, storeId: id(5) }; tree = h.render(other); assert.equal(field(tree, "productId").props.value, "");
  await h.respond(0, { ok: true, demandId: id(8) }); assert.equal(h.recorded, 0); assert.equal(h.storage.has(key()), false);
  tree = h.render(other); assert.equal(field(tree, "productId").props.value, ""); assert.equal(h.storage.has(key(id(5))), false);
});

test("an unsent draft survives reload and cannot reinterpret a changed product unit", () => {
  const h = harness(); let tree = ready(h); change(tree, "quantity", "3");
  const reloaded = harness(h.storage), next = { ...reloaded.props, products: [{ ...product, unit: "箱" }] };
  reloaded.render(next); tree = reloaded.render(next); assert.equal(field(tree, "quantity").props.value, "3"); assert.match(text(tree), /単位が変わりました/);
  submit(tree); assert.equal(reloaded.requests.length, 0); button(tree, "現在の商品単位で入力し直す").props.onClick(); tree = reloaded.render(next);
  assert.equal(field(tree, "quantity").props.value, ""); submit(tree); assert.equal(reloaded.requests[0].body.unit, "箱");
});

test("definitive rejection keeps an editable draft, while malformed success remains pending", async () => {
  const h = harness(); let tree = ready(h); change(tree, "quantity", "2"); tree = h.render(); submit(tree); const firstId = h.requests[0].body.requestId;
  await h.respond(0, { error: "unit changed" }, 409); tree = h.render(); assert.equal(field(tree, "quantity").props.disabled, false); assert.equal(field(tree, "quantity").props.value, "2");
  submit(tree); assert.notEqual(h.requests[1].body.requestId, firstId); await h.respond(1, {}); tree = h.render(); assert.equal(field(tree, "quantity").props.disabled, true);
  submit(tree); assert.deepEqual(h.requests[2].body, h.requests[1].body);
});

test("invalid quantities or unavailable durable storage cannot send a report", () => {
  const h = harness(); let tree = ready(h); change(tree, "quantity", "1.5"); tree = h.render(); submit(tree); assert.equal(h.requests.length, 0);
  change(tree, "quantity", "1000"); tree = h.render(); submit(tree); assert.equal(h.requests.length, 0);
  change(tree, "quantity", "3"); tree = h.render(); h.failStorage(); submit(tree); assert.equal(h.requests.length, 0);
});

test("a menu entry preselects only an exact scoped SKU and never overwrites an existing employee draft", () => {
  const h = harness(), props = { ...h.props, initialProductId: product.id }; h.render(props); let tree = h.render(props);
  assert.equal(field(tree, "productId").props.value, product.id); change(tree, "quantity", "4");
  const reloaded = harness(h.storage), next = { ...reloaded.props, initialProductId: id(99), products: [product, { ...product, id: id(99) }] };
  reloaded.render(next); tree = reloaded.render(next); assert.equal(field(tree, "productId").props.value, product.id); assert.equal(field(tree, "quantity").props.value, "4");
  const hidden = harness(), unavailable = { ...hidden.props, initialProductId: id(100) }; hidden.render(unavailable); tree = hidden.render(unavailable);
  assert.equal(field(tree, "productId").props.value, "");
});
