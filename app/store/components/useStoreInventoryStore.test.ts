import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { loadStoreInventoryStore } from "./store-inventory-store.ts";

const context = (storeId = "allowed-store") => ({ selectedStoreId: storeId, access: { stores: [{ id: storeId, name: "Allowed" }] } });
function responses(...items: Array<Response | Error>) {
  const calls: Array<{ url: string; signal?: AbortSignal | null }> = [];
  const request: typeof fetch = async (url, options) => {
    calls.push({ url: String(url), signal: options?.signal });
    const next = items.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, "Unexpected context request");
    return next;
  };
  return { calls, request };
}
const forbidden = () => Response.json({ error: "権限がありません。" }, { status: 403 });
const input = (signal = new AbortController().signal) => ({ explicitStoreId: null as string | null, storedStoreId: "old-store", signal });

test("a stale saved store denied with 403 falls back once to the server's scoped default", async () => {
  const h = responses(forbidden(), Response.json(context()));
  const options = input();
  assert.deepEqual(await loadStoreInventoryStore(options, h.request), { storeId: "allowed-store", stores: context().access.stores });
  assert.deepEqual(h.calls.map(call => call.url), ["/api/store/context?storeId=old-store", "/api/store/context"]);
  assert.ok(h.calls.every(call => call.signal === options.signal));
});

test("an explicit link denied with 403 cannot fall back to a different store", async () => {
  const h = responses(forbidden());
  await assert.rejects(loadStoreInventoryStore({ ...input(), explicitStoreId: "linked-store" }, h.request), /権限がありません。/);
  assert.deepEqual(h.calls.map(call => call.url), ["/api/store/context?storeId=linked-store"]);
  const mismatch = responses(Response.json(context("different-store")));
  await assert.rejects(loadStoreInventoryStore({ ...input(), explicitStoreId: "linked-store" }, mismatch.request), /指定した店舗を確認できません/);
  assert.equal(mismatch.calls.length, 1);
  const empty = responses(Response.json(context()));
  await assert.rejects(loadStoreInventoryStore({ ...input(), explicitStoreId: "" }, empty.request), /指定した店舗を確認できません/);
  assert.equal(empty.calls.length, 0);
});

test("authentication, server, network and invalid-response errors are preserved without fallback", async () => {
  for (const status of [401, 500, 503]) {
    const h = responses(Response.json({ error: `failure-${status}` }, { status }));
    await assert.rejects(loadStoreInventoryStore(input(), h.request), new RegExp(`failure-${status}`));
    assert.equal(h.calls.length, 1);
  }
  const error = new Error("network unavailable"), network = responses(error);
  await assert.rejects(loadStoreInventoryStore(input(), network.request), failure => failure === error);
  assert.equal(network.calls.length, 1);
  const invalid = responses(new Response("invalid json"));
  await assert.rejects(loadStoreInventoryStore(input(), invalid.request), SyntaxError);
  assert.equal(invalid.calls.length, 1);
  const fallbackFailure = responses(forbidden(), Response.json({ error: "scope unavailable" }, { status: 503 }));
  await assert.rejects(loadStoreInventoryStore(input(), fallbackFailure.request), /scope unavailable/);
  assert.equal(fallbackFailure.calls.length, 2);
});

test("a valid saved store stays exact, while an empty selection asks only for the server default", async () => {
  const saved = responses(Response.json(context("old-store")));
  assert.equal((await loadStoreInventoryStore(input(), saved.request)).storeId, "old-store");
  assert.deepEqual(saved.calls.map(call => call.url), ["/api/store/context?storeId=old-store"]);
  const empty = responses(Response.json(context()));
  assert.equal((await loadStoreInventoryStore({ ...input(), storedStoreId: "" }, empty.request)).storeId, "allowed-store");
  assert.deepEqual(empty.calls.map(call => call.url), ["/api/store/context"]);
  const mismatch = responses(Response.json(context()));
  await assert.rejects(loadStoreInventoryStore(input(), mismatch.request), /指定した店舗を確認できません/);
  assert.equal(mismatch.calls.length, 1);
});

test("cancellation prevents initial work and a late forbidden response cannot start fallback", async () => {
  const controller = new AbortController(); controller.abort();
  const cancelled = responses(Response.json(context()));
  await assert.rejects(loadStoreInventoryStore(input(controller.signal), cancelled.request), { name: "AbortError" });
  assert.equal(cancelled.calls.length, 0);
  const lateController = new AbortController();
  let finish!: (response: Response) => void;
  let calls = 0;
  const lateRequest: typeof fetch = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const pending = loadStoreInventoryStore(input(lateController.signal), lateRequest);
  lateController.abort(); finish(forbidden());
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls, 1);
});

test("cancellation during fallback JSON parsing cannot publish a stale store", async () => {
  const controller = new AbortController();
  let finish!: (body: unknown) => void;
  let parsing!: () => void;
  const started = new Promise<void>(resolve => { parsing = resolve; });
  const fallback = Response.json(context());
  fallback.json = () => { parsing(); return new Promise(resolve => { finish = resolve; }); };
  const h = responses(forbidden(), fallback);
  const pending = loadStoreInventoryStore(input(controller.signal), h.request);
  await started;
  controller.abort(); finish(context());
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(h.calls.length, 2);
});

test("unmount cancels the context load and ignores a late loader result without changing saved selection", async () => {
  const exports: Record<string, any> = {}, stateWrites: unknown[] = [], stored: string[] = [];
  let cleanup!: () => void, loadSignal!: AbortSignal, finish!: (result: unknown) => void;
  const modules: Record<string, any> = {
    react: { useState: (value: unknown) => [value, (next: unknown) => stateWrites.push(next)], useRef: (value: unknown) => ({ current: value }), useEffect: (effect: () => () => void) => { cleanup = effect(); } },
    "./store-selection": { getStoredStoreSelection: () => "old-store", setStoredStoreSelection: (id: string) => stored.push(id) },
    "./store-inventory-store": { loadStoreInventoryStore: ({ signal }: { signal: AbortSignal }) => { loadSignal = signal; return new Promise(resolve => { finish = resolve; }); } }
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL("./useStoreInventoryStore.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, {
    exports, AbortController, URLSearchParams, window: { location: { search: "" } },
    require: (name: string) => { if (name in modules) return modules[name]; throw new Error(`Unmocked ${name}`); }
  });
  exports.useStoreInventoryStore(); cleanup();
  assert.equal(loadSignal.aborted, true);
  finish({ storeId: "allowed-store", stores: context().access.stores });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(stateWrites, []);
  assert.deepEqual(stored, []);
});
