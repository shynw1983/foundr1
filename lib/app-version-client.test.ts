import assert from "node:assert/strict";
import test from "node:test";
import { createAppVersionCoordinator, appVersionHealthyCheckMs, appVersionFallbackCheckMs, publishAppVersionOnce, subscribeToAppVersion, type AppVersionDependencies } from "./app-version-client.ts";

const a = "a".repeat(64), b = "b".repeat(64), c = "c".repeat(64);
const reply = (version = a, app = "store") => Response.json({ app, version });
const config = (app = "store") => Response.json({ app, key: "public-key", cluster: "ap3", versionChannel: `app-version-${app}`, eventName: "app.version.updated" });
async function flush() { for (let i = 0; i < 30; i += 1) await Promise.resolve(); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
function harness(options: { version?: () => Promise<Response> | Response; config?: () => Promise<Response> | Response; connected?: boolean; connect?: AppVersionDependencies["connect"] } = {}) {
  let now = 0, sequence = 0, visible = true, stopped = 0, listening = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const requests: Array<{ url: string; at: number; signal?: AbortSignal | null }> = [];
  const realtime: Array<Parameters<AppVersionDependencies["connect"]>[1]> = [];
  let wake = () => {}, visibility = () => {};
  const deps: AppVersionDependencies = {
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const text = String(url); requests.push({ url: text, at: now, signal: init?.signal });
      return text.includes("realtime-config") ? (options.config?.() ?? config()) : (options.version?.() ?? reply());
    }) as typeof fetch,
    now: () => now,
    setTimeout: (run, delay) => { const id = ++sequence; timers.set(id, { at: now + delay, run }); return id as unknown as ReturnType<typeof setTimeout>; },
    clearTimeout: (id) => { timers.delete(id as unknown as number); },
    visible: () => visible,
    listen(w, v) { wake = w; visibility = v; listening += 1; return () => { listening -= 1; }; },
    async connect(_config, handlers) { realtime.push(handlers); handlers.connection(options.connected !== false); return options.connect ? options.connect(_config, handlers) : () => { stopped += 1; }; }
  };
  const core = createAppVersionCoordinator({ appId: "store" }, deps);
  const snapshots: string[] = [];
  const unsubscribe = core.subscribe((snapshot) => snapshots.push(snapshot.version));
  return {
    core, deps, snapshots, unsubscribe, requests, realtime,
    get listening() { return listening; }, get stopped() { return stopped; },
    get reads() { return requests.filter((request) => !request.url.includes("realtime-config")); },
    async advance(milliseconds: number) {
      const target = now + milliseconds;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].run(); await flush();
      }
      now = target; await flush();
    },
    wake() { wake(); },
    visible(value: boolean) { visible = value; visibility(); }
  };
}

test("a connected socket is insufficient; fallback stays until the app channel acknowledges", async () => {
  const h = harness();
  await h.advance(50);
  assert.equal(h.reads.length, 1);
  h.realtime[0].connection(true);
  await h.advance(appVersionFallbackCheckMs);
  assert.equal(h.reads.length, 2);
  h.unsubscribe();
});

test("healthy connection reconciles a missed event after fifteen minutes with bounded requests", async () => {
  let version = a;
  const h = harness({ version: () => reply(version) });
  await h.advance(50);
  h.realtime[0].subscribed();
  await h.advance(50);
  assert.equal(h.reads.length, 2, "subscribe acknowledgement closes the initial-read window");
  version = b;
  await h.advance(appVersionHealthyCheckMs - 1);
  assert.equal(h.reads.length, 2);
  await h.advance(1);
  assert.equal(h.reads.length, 3);
  assert.equal(h.snapshots.at(-1), b);
  await h.advance(appVersionHealthyCheckMs * 2);
  assert.equal(h.reads.length, 5, "one lightweight integrity read per healthy interval");
  h.unsubscribe();
});

test("push is scoped invalidation and reads authoritative version instead of displaying a payload", async () => {
  const h = harness();
  await h.advance(50);
  h.realtime[0].subscribed(); await h.advance(50);
  const before = h.reads.length;
  h.realtime[0].event({ app: "os", version: b });
  h.realtime[0].event({ app: "store", version: "bad" });
  await h.advance(50);
  assert.equal(h.reads.length, before);
  h.realtime[0].event({ app: "store", version: b });
  await h.advance(50);
  assert.equal(h.reads.length, before + 1);
  assert.equal(h.snapshots.at(-1), a, "the event's newer-looking hash is never trusted as a snapshot");
  h.unsubscribe();
});

test("events during an in-flight read are reconciled by one trailing read", async () => {
  let version: Promise<Response> | Response = reply();
  const h = harness({ version: () => version });
  await h.advance(50);
  const pending = deferred<Response>(); version = pending.promise;
  h.core.invalidate(); await h.advance(50);
  assert.equal(h.reads.length, 2);
  h.core.invalidate(); h.core.invalidate(); h.core.invalidate();
  await h.advance(200);
  assert.equal(h.reads.length, 2, "no parallel version request");
  version = reply(b); pending.resolve(reply(a)); await flush(); await h.advance(50);
  assert.equal(h.reads.length, 3);
  assert.equal(h.snapshots.at(-1), b);
  h.unsubscribe();
});

test("adjacent resume wakes coalesce, hidden clients stop reads, and visible resume reconciles", async () => {
  const h = harness(); await h.advance(50);
  h.wake(); h.wake(); h.wake(); await h.advance(50);
  assert.equal(h.reads.length, 2);
  h.visible(false); await h.advance(60 * 60_000);
  assert.equal(h.reads.length, 2);
  h.visible(true); h.wake(); h.wake(); await h.advance(50);
  assert.equal(h.reads.length, 3);
  h.unsubscribe();
  assert.equal(h.listening, 0);
  await h.advance(60 * 60_000); assert.equal(h.reads.length, 3);
});

test("resubscription reconciles immediately and a single failed app subscription uses fallback", async () => {
  const h = harness(); await h.advance(50);
  h.realtime[0].subscribed(); await h.advance(50);
  h.realtime[0].connection(false);
  await h.advance(appVersionFallbackCheckMs);
  assert.equal(h.reads.length, 3);
  h.realtime[0].connection(true); h.realtime[0].subscribed(); await h.advance(50);
  assert.equal(h.reads.length, 4);
  h.realtime[0].unavailable(); await h.advance(appVersionFallbackCheckMs);
  assert.equal(h.reads.length, 5);
  assert.equal(h.realtime.length, 2, "retry setup without acquiring business channels");
  h.unsubscribe();
});

test("HTTP failures back off, honor Retry-After, and focus cannot bypass the limit", async () => {
  let response = new Response("", { status: 429, headers: { "Retry-After": "1200" } });
  const h = harness({ version: () => response.clone() }); await h.advance(50);
  assert.deepEqual(h.snapshots, []);
  h.wake(); await h.advance(appVersionFallbackCheckMs);
  assert.equal(h.reads.length, 1);
  await h.advance(15 * 60_000); assert.equal(h.reads.length, 2);
  response = reply(b); h.wake(); await h.advance(appVersionFallbackCheckMs);
  assert.equal(h.reads.length, 2, "the second 429 also carries a twenty-minute budget");
  await h.advance(15 * 60_000); assert.equal(h.reads.length, 3);
  assert.equal(h.snapshots.at(-1), b);
  h.unsubscribe();
});

test("request timeout releases the in-flight slot and retries with bounded backoff", async () => {
  const never = deferred<Response>(); let response: Promise<Response> | Response = never.promise;
  const h = harness({ version: () => response }); await h.advance(50);
  await h.advance(10_000); assert.equal(h.reads.length, 1);
  assert.equal(h.reads[0].signal?.aborted, true);
  response = reply(b); h.wake(); await h.advance(appVersionFallbackCheckMs - 1);
  assert.equal(h.reads.length, 1);
  await h.advance(1); assert.equal(h.reads.length, 2);
  assert.equal(h.snapshots.at(-1), b);
  never.resolve(reply(c)); await flush();
  assert.equal(h.snapshots.at(-1), b, "late timed-out results never overwrite the newer read");
  h.unsubscribe();
});

for (const status of [401, 403]) test(`${status} halts automatic reads and subscriptions until explicit resume`, async () => {
  let response = new Response("", { status });
  const h = harness({ version: () => response.clone() }); await h.advance(50);
  h.wake(); h.visible(false); h.visible(true); await h.advance(2 * 60 * 60_000);
  assert.equal(h.reads.length, 1);
  response = reply(b); h.core.resume(); await h.advance(50);
  assert.equal(h.reads.length, 2); assert.equal(h.snapshots.at(-1), b);
  h.unsubscribe();
});

test("cross-app snapshots are rejected and do not mark an update", async () => {
  let response = reply(b, "os");
  const h = harness({ version: () => response.clone() }); await h.advance(50);
  assert.deepEqual(h.snapshots, []);
  response = reply(a); await h.advance(appVersionFallbackCheckMs);
  assert.deepEqual(h.snapshots, [a]); h.unsubscribe();
});

test("disposed work ignores late responses and closes only its realtime lease", async () => {
  const pending = deferred<Response>();
  const h = harness({ version: () => pending.promise }); await h.advance(50);
  h.unsubscribe(); assert.equal(h.stopped, 1);
  pending.resolve(reply(b)); await flush();
  assert.deepEqual(h.snapshots, []);
  await h.advance(2 * 60 * 60_000); assert.equal(h.reads.length, 1);
});

test("two listeners share a coordinator/read, and the first release keeps the other alive", async () => {
  const h = harness(); const other: string[] = [];
  const release = h.core.subscribe((snapshot) => other.push(snapshot.version));
  await h.advance(50); assert.equal(h.reads.length, 1); assert.deepEqual(other, [a]);
  h.unsubscribe(); await h.advance(appVersionFallbackCheckMs);
  assert.equal(h.reads.length, 2); assert.equal(h.listening, 1);
  release(); assert.equal(h.listening, 0);
});

test("publishing uses app-scoped deduplication, retries failed HTTP, and tolerates disabled storage", async () => {
  let calls = 0, status = 403;
  const fetcher = (async () => { calls += 1; return status === 200 ? reply(b, "os") : new Response("", { status }); }) as typeof fetch;
  const storage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(await publishAppVersionOnce("os", b, "/api/app/version?app=os", { fetch: fetcher, storage }), false);
  status = 200;
  const [first, second] = await Promise.all([
    publishAppVersionOnce("os", b, "/api/app/version?app=os", { fetch: fetcher, storage }),
    publishAppVersionOnce("os", b, "/api/app/version?app=os", { fetch: fetcher, storage })
  ]);
  assert.equal(first, true); assert.equal(second, true); assert.equal(calls, 2);
  assert.equal(await publishAppVersionOnce("os", b, "/api/app/version?app=os", { fetch: fetcher, storage }), true);
  assert.equal(calls, 2);
  const cross = (async () => { calls += 1; return reply(b, "os"); }) as typeof fetch;
  assert.equal(await publishAppVersionOnce("store", b, "/api/store/version", { fetch: cross, storage }), false);
  assert.equal(calls, 3);
});

test("headers alone cannot strand a version read: JSON body stays in the timeout and dispose scope", async () => {
  const body = deferred<unknown>();
  const waiting = { ok: true, status: 200, json: () => body.promise } as Response;
  let response = waiting;
  const h = harness({ version: () => response }); await h.advance(50);
  await h.advance(10_000);
  assert.equal(h.reads[0].signal?.aborted, true);
  response = reply(b); await h.advance(appVersionFallbackCheckMs);
  assert.equal(h.snapshots.at(-1), b);
  body.resolve({ app: "store", version: c }); await flush();
  assert.equal(h.snapshots.at(-1), b);
  h.unsubscribe();

  const disposedBody = deferred<unknown>();
  const second = harness({ version: () => ({ ok: true, status: 200, json: () => disposedBody.promise } as Response) });
  await second.advance(50); second.unsubscribe();
  assert.equal(second.reads[0].signal?.aborted, true);
  disposedBody.resolve({ app: "store", version: b }); await flush();
  assert.deepEqual(second.snapshots, []);
});

test("a subscription callback without an actually connected transport never enables the healthy cadence", async () => {
  const h = harness({ connected: false }); await h.advance(50);
  h.realtime[0].subscribed(); await h.advance(50);
  assert.equal(h.reads.length, 1, "a cached acknowledgement on a disconnected socket is ignored");
  await h.advance(appVersionFallbackCheckMs);
  assert.equal(h.reads.length, 2);
  h.unsubscribe();

  const second = harness(); await second.advance(50);
  second.realtime[0].subscribed(); await second.advance(50);
  second.realtime[0].connection(false);
  second.realtime[0].subscribed();
  await second.advance(appVersionFallbackCheckMs);
  assert.equal(second.reads.length, 3, "late subscription success cannot undo a transport outage");
  second.unsubscribe();
});

test("publication timeout covers a hanging JSON body and frees deduplication for a later retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const body = deferred<unknown>(); let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return calls === 1 ? { ok: true, json: () => body.promise } as Response : reply(c, "staff");
  }) as typeof fetch;
  const storage = { getItem() { return null; }, setItem() {} };
  const pending = publishAppVersionOnce("staff", c, "/api/app/version?app=staff", { fetch: fetcher, storage });
  await flush(); t.mock.timers.tick(10_000); await flush();
  assert.equal(await pending, false);
  assert.equal(await publishAppVersionOnce("staff", c, "/api/app/version?app=staff", { fetch: fetcher, storage }), true);
  assert.equal(calls, 2);
  body.resolve({ app: "staff", version: a }); await flush();
  assert.equal(await publishAppVersionOnce("staff", c, "/api/app/version?app=staff", { fetch: fetcher, storage }), true);
  assert.equal(calls, 2);
});

test("the exported browser subscription shares one resource coordinator and releases only the final lease", async () => {
  const h = harness({ config: () => new Response("", { status: 503 }) }); h.unsubscribe();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const windowEvents = new EventTarget(); const documentEvents = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    fetch: h.deps.fetch, setTimeout: h.deps.setTimeout, clearTimeout: h.deps.clearTimeout,
    addEventListener: windowEvents.addEventListener.bind(windowEvents), removeEventListener: windowEvents.removeEventListener.bind(windowEvents)
  } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    visibilityState: "visible", addEventListener: documentEvents.addEventListener.bind(documentEvents), removeEventListener: documentEvents.removeEventListener.bind(documentEvents)
  } });
  let first = 0, second = 0;
  const offFirst = subscribeToAppVersion({ appId: "store" }, () => { first += 1; });
  const offSecond = subscribeToAppVersion({ appId: "store" }, () => { second += 1; });
  try {
    await h.advance(50); assert.equal(h.reads.length, 1); assert.equal(first, 1); assert.equal(second, 1);
    offFirst(); windowEvents.dispatchEvent(new Event("focus")); await h.advance(50);
    assert.equal(h.reads.length, 2); assert.equal(first, 1); assert.equal(second, 2);
    offSecond(); windowEvents.dispatchEvent(new Event("focus")); await h.advance(50);
    assert.equal(h.reads.length, 2);
  } finally {
    offFirst(); offSecond();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument); else Reflect.deleteProperty(globalThis, "document");
  }
});

test("a stalled realtime loader is bounded and a late lease is released without affecting public reads", async () => {
  const connection = deferred<() => void>(); let released = 0;
  const h = harness({ connected: false, connect: () => connection.promise });
  await h.advance(50); await h.advance(15_000);
  connection.resolve(() => { released += 1; }); await flush();
  assert.equal(released, 1);
  const before = h.reads.length;
  h.realtime[0].connection(true); h.realtime[0].subscribed(); h.realtime[0].event({ app: "store", version: b });
  await h.advance(50); assert.equal(h.reads.length, before, "late callbacks from expired setup are ignored");
  await h.advance(appVersionFallbackCheckMs); assert.equal(h.reads.length, before + 1);
  h.unsubscribe();
});

test("an unauthorized realtime configuration stops that runtime instead of falling back under another identity", async () => {
  const h = harness({ config: () => new Response("", { status: 403 }) });
  await h.advance(50); const before = h.requests.length;
  h.wake(); await h.advance(2 * 60 * 60_000);
  assert.equal(h.requests.length, before); assert.equal(h.realtime.length, 0);
  h.unsubscribe();
});
