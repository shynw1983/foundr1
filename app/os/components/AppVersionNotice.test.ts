import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as protocol from "../../../lib/app-version-protocol.ts";

const a = "a".repeat(64), b = "b".repeat(64);
type Element = { type: unknown; props: Record<string, unknown> };
function noticeHarness() {
  let pathname = "/store", cursor = 0, reloads = 0;
  const values: unknown[] = [];
  const effects: Array<{ dependencies: unknown[]; cleanup?: () => void }> = [];
  const queued: Array<() => void> = [];
  const subscriptions: Array<{ resource: { appId: string }; listener: (value: { app: string; version: string; shortVersion: string }) => void; disposed: boolean }> = [];
  const publications: unknown[][] = [];
  const exports: Record<string, (props: Record<string, unknown>) => Element | null> = {};
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in values)) values[index] = initial;
      return [values[index], (value: unknown) => { values[index] = value; }];
    },
    useEffect(callback: () => (() => void) | undefined, dependencies: unknown[]) {
      const index = cursor++;
      const previous = effects[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        queued.push(() => {
          previous?.cleanup?.();
          const cleanup = callback();
          effects[index] = { dependencies, cleanup };
        });
      }
    }
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL("./AppVersionNotice.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, {
    exports,
    window: { location: { reload() { reloads += 1; } } },
    require(name: string) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }) };
      if (name === "next/navigation") return { usePathname: () => pathname };
      if (name === "lucide-react") return { RefreshCw: () => null };
      if (name.endsWith("app-version-protocol")) return protocol;
      if (name.endsWith("app-version-client")) return {
        appVersionEndpoints: (resource: { appId: string; versionEndpoint?: string; realtimeConfigEndpoint?: string }) => ({ version: resource.versionEndpoint ?? `/api/app/version?app=${resource.appId}`, realtime: resource.realtimeConfigEndpoint ?? `/api/app/version/realtime-config?app=${resource.appId}` }),
        publishAppVersionOnce(...args: unknown[]) { publications.push(args); return Promise.resolve(true); },
        subscribeToAppVersion(resource: { appId: string }, listener: (value: { app: string; version: string; shortVersion: string }) => void) {
          const subscription = { resource, listener, disposed: false };
          subscriptions.push(subscription); return () => { subscription.disposed = true; };
        }
      };
      throw new Error(`Unexpected dependency ${name}`);
    }
  });
  const props: Record<string, unknown> = { appId: "store", appName: "Store", initialVersion: a, initialShortVersion: a.slice(0, 7), pathPrefixes: ["/store"] };
  return {
    props, subscriptions, publications,
    get reloads() { return reloads; },
    path(value: string) { pathname = value; },
    render() { cursor = 0; return exports.AppVersionNotice(props); },
    commit() { while (queued.length) queued.shift()!(); },
    emit(app: string, version: string, index = subscriptions.length - 1) { subscriptions[index].listener({ app, version, shortVersion: version.slice(0, 7) }); }
  };
}
function findButton(element: Element): Element | undefined {
  if (element.type === "button") return element;
  const children = element.props.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child && typeof child === "object" && "type" in child) {
      const found = findButton(child as Element); if (found) return found;
    }
  }
  return undefined;
}

test("only an authoritative version difference shows a notice; reload requires an explicit click", () => {
  const h = noticeHarness();
  assert.equal(h.render(), null); h.commit();
  assert.equal(h.subscriptions.length, 1);
  h.emit("os", b); assert.equal(h.render(), null);
  h.emit("store", a); assert.equal(h.render(), null);
  h.emit("store", b); const notice = h.render(); assert.ok(notice);
  assert.equal(h.reloads, 0);
  const button = findButton(notice); assert.ok(button);
  (button.props.onClick as () => void)(); assert.equal(h.reloads, 1);
  h.emit("store", a); assert.equal(h.render(), null, "equal authoritative snapshot clears an old notice");
});

test("a new baseline or app cannot render a previous resource's stale update", () => {
  const h = noticeHarness(); h.render(); h.commit(); h.emit("store", b); assert.ok(h.render());
  h.props.initialVersion = b;
  assert.equal(h.render(), null); h.commit();
  assert.equal(h.subscriptions[0].disposed, true);
  assert.equal(h.subscriptions.length, 2);
  h.emit("store", b); assert.equal(h.render(), null);
  h.props.appId = "os"; h.props.appName = "OS"; h.props.pathPrefixes = ["/os"]; h.path("/os");
  assert.equal(h.render(), null); h.commit();
  assert.equal(h.subscriptions[1].disposed, true);
  h.emit("store", a); assert.equal(h.render(), null);
  assert.equal(h.subscriptions.at(-1)?.resource.appId, "os");
});

test("hidden displays, unrelated paths and local builds do not subscribe or publish", () => {
  for (const [path, version] of [["/store/pos/customer-display", a], ["/os", a], ["/store", "local"]]) {
    const h = noticeHarness(); h.path(path); h.props.initialVersion = version; h.props.hiddenPaths = ["/store/pos/customer-display"];
    assert.equal(h.render(), null); h.commit();
    assert.equal(h.subscriptions.length, 0); assert.equal(h.publications.length, 0);
  }
});
