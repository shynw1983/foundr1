import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function render(active = "replenishment", role = "staff", canUseInventory = true, storeCount = 2, canManageTheme = false) {
  const exports: Record<string, any> = {};
  const settings = { header: { showClock: false, userDisplay: "name", showNotifications: false, showLanguagePicker: true } };
  const stores = [{ id: "store-a", name: "A" }, { id: "store-b", name: "B" }].slice(0, storeCount);
  const context = { selectedStoreId: "store-a", access: { role, canUseAllStoreView: ["owner", "manager"].includes(role), stores } };
  const state = [null, settings, role, canUseInventory, context, false, false];
  let stateIndex = 0;
  const stored: string[] = [], assigned: string[] = [];
  let reloads = 0;
  const modules: Record<string, any> = {
    react: { useState: () => [state[stateIndex++], () => {}], useRef: (value: unknown) => ({ current: value }), useEffect: () => {} },
    "react/jsx-runtime": { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) },
    "lucide-react": { ChevronDown: "ChevronDown", Clock3: "Clock3", Menu: "Menu", Palette: "Palette", Store: "Store" },
    "../../os/components/UserBadge": { UserBadge: "UserBadge" },
    "../../os/components/useCloseOnOutside": { useCloseOnOutside() {} },
    "../../../lib/module-setting-defaults": { defaultStoreModuleSettings: settings },
    "./store-selection": { getStoredStoreSelection: () => "store-a", setStoredStoreSelection: (id: string) => stored.push(id) },
    "../../../lib/inventory-sync-alert-client": { getScopedInventorySyncNotificationStore: async () => "" },
    "../../../lib/store-polling-client": { rememberStoreBusinessHours() {}, storeOrderAlertEventName: "order-alert" },
    "./StoreThemeProvider": { useStoreTheme: () => ({ context: { canManageTheme } }) },
    "./store-navigation": { getVisibleStoreNavigation: () => [], storeNavigationGroups: [] }
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL("./StoreNavTabs.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
  }).outputText, {
    exports, URL,
    window: { location: { href: `https://example.test/store/${active}?storeId=store-a&productId=sku-a`, assign: (url: string) => assigned.push(url), reload: () => reloads++ } },
    require: (name: string) => { if (name in modules) return modules[name]; throw new Error(`Unmocked ${name}`); }
  });
  const tree = exports.StoreNavTabs({ active, storeId: "store-a" });
  const elements = (node: any): any[] => node && typeof node === "object"
    ? Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)] : [];
  const select = elements(tree).find(node => node.type === "select" && node.props["aria-label"] === "店舗切替");
  const appearanceLink = elements(tree).find(node => node.type === "a" && node.props.href === "/store/settings/appearance");
  return { select, appearanceLink, stored, assigned, reloads: () => reloads };
}

test("appearance navigation is visible only when the server theme context grants management", () => {
  assert.equal(render("appearance", "owner").appearanceLink, undefined);
  assert.equal(render("appearance", "staff").appearanceLink, undefined);
  const permitted = render("appearance", "staff", true, 1, true).appearanceLink;
  assert.ok(permitted);
  assert.equal(permitted.props["aria-current"], "page");
});

test("scoped staff can switch replenishment stores and replace the URL store without dropping the selected SKU", () => {
  const view = render();
  assert.ok(view.select);
  assert.equal(view.select.props.value, "store-a");
  view.select.props.onChange({ target: { value: "store-b" } });
  assert.deepEqual(view.stored, ["store-b"]);
  const destination = new URL(view.assigned[0]);
  assert.equal(destination.pathname, "/store/replenishment");
  assert.equal(destination.searchParams.get("storeId"), "store-b");
  assert.equal(destination.searchParams.get("productId"), "sku-a");
  assert.equal(view.reloads(), 0);
});

test("replenishment store switching requires multiple scoped stores and staff inventory permission", () => {
  assert.equal(render("replenishment", "staff", false).select, undefined);
  assert.equal(render("replenishment", "staff", true, 1).select, undefined);
  assert.equal(render("replenishment", "store_terminal").select, undefined);
  const manager = render("replenishment", "manager");
  assert.ok(manager.select);
  manager.select.props.onChange({ target: { value: "store-b" } });
  assert.equal(new URL(manager.assigned[0]).searchParams.get("storeId"), "store-b");
});

test("existing inventory and receiving switch URLs, and a same-store selection performs no navigation", () => {
  for (const active of ["inventory", "receiving"]) {
    const view = render(active);
    assert.ok(view.select, active);
    view.select.props.onChange({ target: { value: "store-a" } });
    assert.deepEqual(view.stored, []);
    assert.deepEqual(view.assigned, []);
    view.select.props.onChange({ target: { value: "store-b" } });
    assert.equal(new URL(view.assigned[0]).searchParams.get("storeId"), "store-b");
    assert.equal(view.reloads(), 0);
  }
});
