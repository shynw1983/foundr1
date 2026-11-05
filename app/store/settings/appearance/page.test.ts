import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate as waitForTurn } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const themeContract: Record<string, any> = {};
runInNewContext(ts.transpileModule(readFileSync(new URL("../../../../lib/store-theme.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { exports: themeContract });

type Target = "operations" | "pickup" | "customer" | "courier";
function fixture(canManageTheme = true, target: Target = "operations", mode: "custom" | "brand" = "custom") {
  const slots: any[] = [];
  const exports: Record<string, any> = {};
  const listeners = new Map<string, () => void>();
  const previews: Array<string | null> = [];
  const saved: Array<[string, string | null, string]> = [];
  const savedTargets: Target[] = [];
  let currentTarget = target;
  const selected: string[] = [];
  let index = 0, dirty = false;
  let pending: Array<() => void> = [];
  let failureStatus = 0, refreshFails = false;
  const window = {
    location: { href: "https://example.test/store/settings/appearance?storeId=store-a" },
    history: { state: null, replaceState: (_state: unknown, _unused: string, url: string) => { window.location.href = url; } },
    addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name)
  };
  const theme = {
    context: { storeId: "store-a", storeName: "A", stores: [{ id: "store-a", name: "A" }, { id: "store-b", name: "B" }], canManageTheme,
      target, brand: target === "operations" ? null : { name: "まぁ麻", logoUrl: "/maamaa.svg", primaryColor: "#c30d23" },
      theme: { primaryColor: mode === "brand" ? "#c30d23" : "#245d49", mode, paletteVersion: 1 }, revision: "revision-a", updatedAt: null as string | null },
    loading: false, error: "", previewColor: null as string | null,
    setPreviewColor: (color: string | null) => { theme.previewColor = color; previews.push(color); },
    refresh: async () => {
      if (refreshFails) { theme.error = "offline"; throw new Error("offline"); }
      theme.context = { ...theme.context, revision: "revision-refreshed" };
      theme.error = "";
    },
    saveTheme: async (color: string, revision: string | null, nextMode: string) => {
      saved.push([color, revision, nextMode]);
      savedTargets.push(theme.context.target);
      if (failureStatus) throw Object.assign(new Error("failed"), { status: failureStatus });
      theme.context = { ...theme.context, theme: { ...theme.context.theme, primaryColor: color, mode: nextMode as "brand" | "custom" }, revision: "revision-saved" };
    }
  };
  const react = {
    useState: (initial: any) => {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], (value: any) => {
        const next = typeof value === "function" ? value(slots[slot]) : value;
        if (!Object.is(next, slots[slot])) { slots[slot] = next; dirty = true; }
      }];
    },
    useRef: (initial: any) => {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = { current: initial };
      return slots[slot];
    },
    useEffect: (run: () => void | (() => void), deps: any[]) => {
      const slot = index++;
      const previous = slots[slot];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        pending.push(() => { previous?.cleanup?.(); slots[slot] = { deps, cleanup: run() }; });
      }
    }
  };
  const modules: Record<string, any> = {
    react,
    "react/jsx-runtime": { jsx: (type: any, props: any, key: unknown) => ({ type, props, key }), jsxs: (type: any, props: any, key: unknown) => ({ type, props, key }) },
    "lucide-react": { Check: "Check", Palette: "Palette", RefreshCw: "RefreshCw", RotateCcw: "RotateCcw" },
    "../../../os/components/OsTranslationProvider": { useOsTranslation: () => ({ t: (value: string, values?: Record<string,string>) => value.replace(/\{(\w+)\}/g, (token, key) => values?.[key] ?? token), language: "ja" }) },
    "../../../../lib/store-theme": themeContract,
    "../../components/StoreNavTabs": { StoreNavTabs: "StoreNavTabs" },
    "../../components/StoreThemeProvider": { useStoreTheme: () => theme, StoreThemeEditorScope: "StoreThemeEditorScope" },
    "../../components/store-selection": { storeSelectionEventName: "store-selection", setStoredStoreSelection: (id: string) => { selected.push(id); listeners.get("store-selection")?.(); } },
    "./appearance.module.css": { default: new Proxy({}, { get: (_target, key) => String(key) }) }
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL("./page.tsx", import.meta.url), "utf8") + "\nexport { StoreAppearanceEditor, TargetPreview };", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, URL, window, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unmocked appearance dependency: ${name}`);
    return modules[name];
  } });
  const elements = (node: any): any[] => node && typeof node === "object"
    ? Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)] : [];
  function render() {
    let tree;
    for (let pass = 0; pass < 10; pass++) {
      dirty = false; index = 0; pending = [];
      tree = exports.StoreAppearanceEditor({ target: currentTarget, onTargetChange: switchTarget });
      pending.forEach(run => run());
      if (!dirty) return elements(tree);
    }
    throw new Error("Appearance effects did not settle");
  }
  const button = (nodes: any[], label: string) => nodes.find(node => node.type === "button" && elements(node.props.children).length === 0 && node.props.children === label)
    ?? nodes.find(node => node.type === "button" && JSON.stringify(node.props.children).includes(label));
  function switchTarget(nextTarget: Target) {
    slots.forEach(slot => slot?.cleanup?.()); slots.length = 0;
    currentTarget = nextTarget;
    theme.previewColor = null;
    theme.context = { ...theme.context, target: nextTarget, brand: nextTarget === "operations" ? null : { name: "まぁ麻", logoUrl: "/maamaa.svg", primaryColor: "#c30d23" },
      theme: { primaryColor: nextTarget === "operations" ? "#245d49" : "#c30d23", mode: nextTarget === "operations" ? "custom" : "brand", paletteVersion: 1 }, revision: `revision-${nextTarget}` };
  }
  function page() { index = 0; return elements(exports.default()); }
  function sample() { return elements(exports.TargetPreview({ target: currentTarget, brand: theme.context.brand, storeName: "A", canEdit: true })); }
  return { render, page, sample, switchTarget, button, theme, previews, saved, savedTargets, selected, window, fail: (status: number) => { failureStatus = status; }, failRefresh: () => { refreshFails = true; } };
}

test("a non-manager sees no theme editing or preview controls", () => {
  const f = fixture(false), nodes = f.render();
  assert.equal(nodes.some(node => node.type === "input"), false);
  assert.equal(f.button(nodes, "Store操作画面に保存"), undefined);
  assert.ok(nodes.find(node => node.type === "a" && node.props.href === "/store/inventory"));
  assert.equal(f.previews.some(color => color !== null), false);
});

test("a conflict retains the color draft and a failed refresh keeps saving blocked", async () => {
  const f = fixture();
  let nodes = f.render();
  nodes.find(node => node.type === "input" && node.props.type === "text" && node.props.maxLength === 7).props.onChange({ target: { value: "#235a9f" } });
  nodes = f.render();
  f.fail(409);
  await f.button(nodes, "Store操作画面に保存").props.onClick();
  await waitForTurn();
  nodes = f.render();
  assert.equal(nodes.find(node => node.type === "input" && node.props.maxLength === 7).props.value, "#235a9f");
  assert.equal(f.button(nodes, "Store操作画面に保存").props.disabled, true);
  assert.deepEqual(f.saved[0], ["#235a9f", "revision-a", "custom"]);
  f.failRefresh();
  f.button(nodes, "最新の設定を確認").props.onClick();
  await waitForTurn();
  assert.equal(f.button(f.render(), "Store操作画面に保存").props.disabled, true);
});

test("explicit successful refresh preserves the draft and saves against the newly verified revision", async () => {
  const f = fixture();
  let nodes = f.render();
  nodes.find(node => node.type === "input" && node.props.maxLength === 7).props.onChange({ target: { value: "#63509b" } });
  f.fail(409);
  f.button(f.render(), "Store操作画面に保存").props.onClick();
  await waitForTurn();
  f.button(f.render(), "最新の設定を確認").props.onClick();
  await waitForTurn();
  nodes = f.render();
  assert.equal(nodes.find(node => node.type === "input" && node.props.maxLength === 7).props.value, "#63509b");
  assert.equal(f.button(nodes, "Store操作画面に保存").props.disabled, false);
  f.fail(0);
  f.button(nodes, "Store操作画面に保存").props.onClick();
  await waitForTurn();
  assert.deepEqual(f.saved.at(-1), ["#63509b", "revision-refreshed", "custom"]);
});

test("store switching replaces an explicit URL target and discards the previous preview", () => {
  const f = fixture();
  let nodes = f.render();
  nodes.find(node => node.type === "input" && node.props.maxLength === 7).props.onChange({ target: { value: "#235a9f" } });
  nodes = f.render();
  nodes.find(node => node.type === "select" && node.props["aria-label"] === "設定する店舗").props.onChange({ target: { value: "store-b" } });
  assert.equal(new URL(f.window.location.href).searchParams.get("storeId"), "store-b");
  assert.deepEqual(f.selected, ["store-b"]);
  assert.equal(f.previews.at(-1), null);
  f.theme.context = { ...f.theme.context, storeId: "store-b", storeName: "B", revision: "revision-b" };
  nodes = f.render();
  assert.equal(nodes.find(node => node.type === "input" && node.props.maxLength === 7).props.value, "#245d49");
});

test("a rejected permission removes write controls and clears the preview", async () => {
  const f = fixture();
  let nodes = f.render();
  nodes.find(node => node.type === "input" && node.props.maxLength === 7).props.onChange({ target: { value: "#235a9f" } });
  f.fail(403);
  f.button(f.render(), "Store操作画面に保存").props.onClick();
  await waitForTurn();
  nodes = f.render();
  assert.equal(f.button(nodes, "Store操作画面に保存"), undefined);
  assert.equal(f.previews.at(-1), null);
});

test("the Store navigation stays outside the keyed editor theme scope", () => {
  const f = fixture(), nodes = f.page();
  const scope = nodes.find(node => node.type === "StoreThemeEditorScope");
  assert.ok(scope);
  assert.equal(scope.key, "operations");
  assert.equal(scope.props.target, "operations");
  assert.equal(scope.props.children.type.name, "StoreAppearanceEditor");
  assert.ok(nodes.find(node => node.type === "StoreNavTabs"));
  assert.equal(scope.props.children.type === "StoreNavTabs", false);
});

test("customer-facing targets keep brand mode and preview only the target's effective brand color", () => {
  for (const target of ["pickup", "customer", "courier"] as const) {
    const f = fixture(true, target, "brand"), nodes = f.render();
    assert.equal(nodes.find(node => node.type === "input" && node.props.value === "brand").props.checked, true);
    assert.equal(nodes.find(node => node.type === "fieldset" && node.props.children[0].props.children === "テーマ色を選ぶ").props.disabled, true);
    const preview = nodes.find(node => node.props?.["data-preview-target"] === target);
    assert.equal(preview.props.style["--preview-primary"], "#c30d23");
    assert.equal(preview.props.style["--store-primary"], undefined);
    assert.equal(f.saved.length, 0);
    assert.equal(f.sample().some(node => node.type === "button" || node.type === "input"), false);
    assert.ok(f.sample().find(node => node.type === "img" && node.props.src === "/maamaa.svg"));
  }
});

test("a custom customer-screen color saves only through its scoped target and revision", async () => {
  const f = fixture(true, "pickup", "brand");
  let nodes = f.render();
  nodes.find(node => node.type === "input" && node.props.value === "custom").props.onChange();
  nodes = f.render();
  nodes.find(node => node.type === "input" && node.props.maxLength === 7).props.onChange({ target: { value: "#0098b0" } });
  nodes = f.render();
  assert.equal(nodes.find(node => node.props?.["data-preview-target"] === "pickup").props.style["--preview-primary"], "#0098b0");
  f.button(nodes, "呼出画面に保存").props.onClick();
  await waitForTurn();
  assert.deepEqual(f.saved[0], ["#0098b0", "revision-a", "custom"]);
  assert.deepEqual(f.savedTargets, ["pickup"]);
});

test("restoring a customer's brand color previews the real brand color before saving", async () => {
  const f = fixture(true, "customer", "custom");
  let nodes = f.render();
  f.button(nodes, "ブランドカラーをプレビュー").props.onClick();
  nodes = f.render();
  assert.equal(f.theme.context.theme.primaryColor, "#245d49");
  assert.equal(f.saved.length, 0);
  assert.equal(nodes.find(node => node.props?.["data-preview-target"] === "customer").props.style["--preview-primary"], "#c30d23");
  assert.equal(nodes.find(node => node.type === "input" && node.props.value === "brand").props.checked, true);
  f.button(nodes, "POSお客様画面に保存").props.onClick();
  await waitForTurn();
  assert.deepEqual(f.saved[0], ["#c30d23", "revision-a", "brand"]);
  assert.deepEqual(f.savedTargets, ["customer"]);
});

test("changing the target clears the old draft and uses the new target's revision", async () => {
  const f = fixture();
  let nodes = f.render();
  nodes.find(node => node.type === "input" && node.props.maxLength === 7).props.onChange({ target: { value: "#8264d9" } });
  nodes = f.render();
  nodes.find(node => node.type === "select" && node.props["aria-label"] === "設定する画面").props.onChange({ target: { value: "courier" } });
  nodes = f.render();
  assert.equal(nodes.find(node => node.type === "input" && node.props.maxLength === 7).props.value, "#c30d23");
  assert.equal(f.previews.at(-1), null);
  nodes.find(node => node.type === "input" && node.props.value === "custom").props.onChange();
  nodes = f.render();
  nodes.find(node => node.type === "input" && node.props.maxLength === 7).props.onChange({ target: { value: "#00977b" } });
  f.button(f.render(), "配達員向け表示に保存").props.onClick();
  await waitForTurn();
  assert.deepEqual(f.saved[0], ["#00977b", "revision-courier", "custom"]);
  assert.deepEqual(f.savedTargets, ["courier"]);
});

test("an unresolved single brand uses that display's fallback rather than the Store operation color", () => {
  const f = fixture(true, "customer", "brand");
  f.theme.context.brand = null;
  f.theme.context.theme.primaryColor = "#262827";
  const nodes = f.render();
  assert.equal(nodes.find(node => node.props?.["data-preview-target"] === "customer").props.style["--preview-primary"], "#262827");
  assert.ok(nodes.find(node => node.type === "p" && node.props.children === "単一のブランド配色を確認できないため、この画面の標準配色を使用します。"));
  assert.equal(f.previews.some(color => color !== null), false);
});
