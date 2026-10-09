import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function harness() {
  const exports: Record<string, any> = {};
  const states: any[] = [], refs: any[] = [], deps: any[][] = [];
  let si = 0, ri = 0, ei = 0;
  let effects: Array<() => void> = [];
  const requests: Array<{ url: string; body: any; resolve: (response: Response) => void }> = [];
  const applied: any[] = [];
  const react = {
    useState(initial: any) { const i = si++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], (next: any) => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; },
    useRef(initial: any) { const i = ri++; return refs[i] ??= { current: initial }; },
    useEffect(fn: () => void, next: any[]) { const i = ei++; if (!deps[i] || next.some((v, n) => v !== deps[i][n])) effects.push(fn); deps[i] = next; }
  };
  const modules: Record<string, any> = { react, "react/jsx-runtime": { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) },
    "../components/OsTranslationProvider": { useOsTranslation: () => ({ t: (s: string) => s }) }, "./OrderTemplatesPanel.module.css": { default: {} } };
  runInNewContext(ts.transpileModule(readFileSync(new URL("./OrderTemplatesPanel.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, AbortController, fetch: (url: string, options?: any) => new Promise<Response>(resolve => requests.push({ url, body: options?.body ? JSON.parse(options.body) : null, resolve })),
      require: (name: string) => { if (!(name in modules)) throw new Error(`Unmocked ${name}`); return modules[name]; } });
  return { requests, applied,
    render(storeId = "A", cartItems: any = [{ productId: "p", quantity: 2, purchaseUnit: "袋" }]) { si = ri = ei = 0; effects = []; const tree = exports.OrderTemplatesPanel({ storeId, storeName: storeId, cartItems, products: [{ id: "p", name: "P" }], disabled: false,
      onApply(template: any) { applied.push(template); return { added: 1, retained: 0, unavailable: 0 }; } }); const run = effects; run.forEach(fn => fn()); return tree; },
    async respond(index: number, body: any, status = 200) { requests[index].resolve(Response.json(body, { status })); await new Promise(resolve => setTimeout(resolve, 0)); }
  };
}
function elements(tree: any, predicate: (e: any) => boolean): any[] { if (!tree || typeof tree !== "object") return []; const children = Array.isArray(tree) ? tree : tree.props?.children ?? []; return [...(!Array.isArray(tree) && predicate(tree) ? [tree] : []), ...[children].flat().flatMap(child => elements(child, predicate))]; }
function text(tree: any): string { if (Array.isArray(tree)) return tree.map(text).join(""); if (tree && typeof tree === "object") return text(tree.props?.children); return tree === undefined || tree === null ? "" : String(tree); }
const button = (tree: any, label: string) => elements(tree, e => e.type === "button" && text(e).includes(label))[0];
const template = { id: "t", name: "weekly", items: [{ productId: "p", quantity: 2, purchaseUnit: "袋" }], unavailableItemCount: 0 };

test("templates only affect the cart after the operator explicitly selects and adds one", async () => {
  const h = harness(); h.render(); await h.respond(0, { templates: [template], canManage: true }); let tree = h.render();
  assert.equal(h.applied.length, 0); assert.equal(button(tree, "下書きに追加").props.disabled, true);
  elements(tree, e => e.type === "select")[0].props.onChange({ target: { value: "t" } }); tree = h.render();
  button(tree, "下書きに追加").props.onClick(); assert.deepEqual(h.applied, [template]);
  assert.equal(h.requests.length, 1);
});

test("switching stores never exposes an old store template or accepts its late response", async () => {
  const h = harness(); h.render("A"); h.render("B");
  await h.respond(1, { templates: [{ ...template, name: "B-weekly" }], canManage: false });
  await h.respond(0, { templates: [template], canManage: true }); const tree = h.render("B");
  assert.equal(text(tree).includes("B-weekly"), true); assert.equal(text(tree).includes("常用発注の名前"), false);
  assert.equal(button(tree, "下書きに追加").props.disabled, true);
  assert.equal(h.applied.length, 0); assert.equal(h.requests[1].url, "/api/orders/templates?storeId=B");
});

test("saving requires explicit valid cart data and a name; server failure preserves the named draft", async () => {
  const h = harness(); h.render(); await h.respond(0, { templates: [], canManage: true }); let tree = h.render("A", null);
  elements(tree, e => e.type === "input")[0].props.onChange({ target: { value: "weekly" } }); tree = h.render("A", null);
  assert.equal(button(tree, "現在の商品リストを保存").props.disabled, true);
  tree = h.render(); let prevented = false;
  elements(tree, e => e.type === "input")[0].props.onKeyDown({ key: "Enter", preventDefault() { prevented = true; } });
  assert.equal(prevented, true); // Enter in the name field must not submit its parent purchase-order form.
  assert.deepEqual(h.requests[1].body, { storeId: "A", name: "weekly", items: template.items });
  await h.respond(1, { error: "changed" }, 409); tree = h.render();
  assert.equal(elements(tree, e => e.type === "input")[0].props.value, "weekly");
  assert.equal(elements(tree, e => e.props?.role === "alert").length, 1);
});
