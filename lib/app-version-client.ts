import { appVersionChannel, appVersionEventName, isContentAppVersion, type AppVersionScope } from "./app-version-protocol.ts";

export type AppVersionSnapshot = { app: AppVersionScope; version: string; shortVersion: string };
export type AppVersionResource = { appId: AppVersionScope; versionEndpoint?: string; realtimeConfigEndpoint?: string };
type RealtimeConfig = { app: AppVersionScope; key: string; cluster: string; versionChannel: string; eventName: string };
type RealtimeHandlers = { connection: (connected: boolean) => void; subscribed: () => void; unavailable: () => void; event: (payload: unknown) => void };
type Timer = ReturnType<typeof setTimeout>;
export type AppVersionDependencies = {
  fetch: typeof fetch;
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => Timer;
  clearTimeout: (timer: Timer) => void;
  visible: () => boolean;
  listen: (wake: () => void, visibility: () => void) => () => void;
  connect: (config: RealtimeConfig, handlers: RealtimeHandlers) => Promise<() => void>;
};

export const appVersionHealthyCheckMs = 15 * 60_000;
export const appVersionFallbackCheckMs = 5 * 60_000;
const maximumBackoffMs = 60 * 60_000;
const requestTimeoutMs = 10_000;
const subscriptionTimeoutMs = 15_000;
const wakeCoalesceMs = 50;

export function appVersionEndpoints(resource: AppVersionResource) {
  return {
    version: resource.versionEndpoint ?? `/api/app/version?app=${resource.appId}`,
    realtime: resource.realtimeConfigEndpoint ?? `/api/app/version/realtime-config?app=${resource.appId}`
  };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function readSnapshot(value: unknown, app: AppVersionScope): AppVersionSnapshot | null {
  if (!isRecord(value) || value.app !== app || !isContentAppVersion(value.version)) return null;
  const version = value.version as string;
  return { app, version, shortVersion: version.slice(0, 7) };
}
function readConfig(value: unknown, app: AppVersionScope): RealtimeConfig | null {
  if (!isRecord(value) || value.app !== app || value.versionChannel !== appVersionChannel(app)
    || value.eventName !== appVersionEventName || typeof value.key !== "string" || !value.key
    || typeof value.cluster !== "string" || !value.cluster) return null;
  return { app, key: value.key, cluster: value.cluster, versionChannel: value.versionChannel, eventName: value.eventName };
}
function retryAfter(response: Response, now: number) {
  const value = response.headers.get("Retry-After");
  if (!value) return 0;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
}

/** One public app-version resource, with no business records or automatic reloads. */
export function createAppVersionCoordinator(resource: AppVersionResource, deps: AppVersionDependencies) {
  const endpoints = appVersionEndpoints(resource);
  const listeners = new Set<(snapshot: AppVersionSnapshot) => void>();
  const requests = new Set<AbortController>();
  let active = false;
  let unauthorized = false;
  let inFlight = false;
  let readAgain = false;
  let snapshot: AppVersionSnapshot | null = null;
  let connected = false;
  let subscribed = false;
  let configInFlight = false;
  let configFailureCount = 0;
  let configRetryNotBefore = 0;
  let realtimeClose: (() => void) | undefined;
  let stopListening: (() => void) | undefined;
  let readTimer: Timer | undefined;
  let wakeTimer: Timer | undefined;
  let subscriptionTimer: Timer | undefined;
  let failureCount = 0;
  let lastReadAt = 0;
  let lastSuccessAt: number | null = null;
  let retryNotBefore = 0;
  let generation = 0;

  const clear = (timer: Timer | undefined) => { if (timer !== undefined) deps.clearTimeout(timer); };
  const healthy = () => connected && subscribed;
  const pauseTimers = () => { clear(readTimer); readTimer = undefined; clear(wakeTimer); wakeTimer = undefined; };
  const boundedJson = async (url: string) => {
    const controller = new AbortController();
    requests.add(controller);
    const abort = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("Version request cancelled")), { once: true });
    });
    const timer = deps.setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      return await Promise.race([
        deps.fetch(url, { cache: "no-store", redirect: "error", signal: controller.signal })
          .then(async (response) => ({ response, body: response.ok ? await response.json() as unknown : null })), abort
      ]);
    } finally {
      clear(timer);
      requests.delete(controller);
    }
  };
  const blockUnauthorized = () => {
    unauthorized = true;
    pauseTimers();
    clear(subscriptionTimer);
    subscriptionTimer = undefined;
    realtimeClose?.();
    realtimeClose = undefined;
    connected = false;
    subscribed = false;
    requests.forEach((controller) => controller.abort());
  };
  const schedule = () => {
    clear(readTimer);
    readTimer = undefined;
    if (!active || unauthorized || !deps.visible() || inFlight) return;
    const base = healthy() ? appVersionHealthyCheckMs : appVersionFallbackCheckMs;
    const due = failureCount
      ? Math.max(deps.now(), retryNotBefore)
      : Math.max((lastSuccessAt ?? deps.now()) + base, retryNotBefore);
    readTimer = deps.setTimeout(() => { readTimer = undefined; requestRefresh(); }, Math.max(0, due - deps.now()));
  };
  const queueRead = () => {
    if (!active || unauthorized || !deps.visible() || wakeTimer !== undefined) return;
    wakeTimer = deps.setTimeout(() => { wakeTimer = undefined; requestRefresh(); }, wakeCoalesceMs);
  };
  const invalidate = () => {
    if (!active || unauthorized) return;
    if (inFlight) readAgain = true;
    else queueRead();
  };
  const connectRealtime = async () => {
    if (!active || unauthorized || !deps.visible() || configInFlight || realtimeClose || deps.now() < configRetryNotBefore) return;
    configInFlight = true;
    const current = generation;
    let setupSucceeded = false;
    let live = true;
    const failSetup = (response?: Response) => {
      configFailureCount += 1;
      configRetryNotBefore = deps.now() + Math.max(
        Math.min(maximumBackoffMs, appVersionFallbackCheckMs * 2 ** Math.min(configFailureCount - 1, 8)),
        response ? retryAfter(response, deps.now()) : 0
      );
    };
    try {
      const { response, body } = await boundedJson(endpoints.realtime);
      if (!active || current !== generation || unauthorized) return;
      if (response.status === 401 || response.status === 403) { blockUnauthorized(); return; }
      if (!response.ok) { failSetup(response); return; }
      const config = readConfig(body, resource.appId);
      if (!config) { failSetup(); return; }
      if (!active || current !== generation || unauthorized) return;
      const connection = deps.connect(config, {
        connection(value) {
          if (!live || !active || current !== generation || unauthorized) return;
          connected = value;
          if (!value) subscribed = false;
          schedule();
        },
        subscribed() {
          if (!live || !active || current !== generation || unauthorized || !connected) return;
          subscribed = true;
          clear(subscriptionTimer);
          subscriptionTimer = undefined;
          invalidate();
          schedule();
        },
        unavailable() {
          if (!live || !active || current !== generation || unauthorized) return;
          subscribed = false;
          live = false;
          realtimeClose?.();
          realtimeClose = undefined;
          failSetup();
          schedule();
        },
        event(payload) {
          if (live && active && current === generation && !unauthorized && readSnapshot(payload, resource.appId)) invalidate();
        }
      });
      const setupController = new AbortController();
      requests.add(setupController);
      const setupAbort = new Promise<never>((_, reject) => {
        setupController.signal.addEventListener("abort", () => { live = false; reject(new Error("Version subscription setup cancelled")); }, { once: true });
      });
      const setupTimer = deps.setTimeout(() => setupController.abort(), subscriptionTimeoutMs);
      let close: () => void;
      try {
        close = await Promise.race([connection.then((release) => {
          if (setupController.signal.aborted) release();
          return release;
        }), setupAbort]);
      } finally {
        clear(setupTimer);
        requests.delete(setupController);
      }
      if (!live || !active || current !== generation || unauthorized) { close(); return; }
      setupSucceeded = true;
      configFailureCount = 0;
      configRetryNotBefore = 0;
      realtimeClose = () => { live = false; close(); };
      if (!subscribed) subscriptionTimer = deps.setTimeout(() => {
        subscriptionTimer = undefined;
        if (!live || !active || current !== generation) return;
        subscribed = false;
        realtimeClose?.();
        realtimeClose = undefined;
        failSetup();
        schedule();
      }, subscriptionTimeoutMs);
    } catch {
      if (active && current === generation && !unauthorized && !setupSucceeded) failSetup();
    } finally {
      if (current === generation) configInFlight = false;
    }
  };
  async function requestRefresh() {
    if (!active || unauthorized || !deps.visible() || inFlight) return;
    const now = deps.now();
    if (now < retryNotBefore) { schedule(); return; }
    inFlight = true;
    readAgain = false;
    lastReadAt = now;
    const current = generation;
    let succeeded = false;
    void connectRealtime();
    try {
      const url = `${endpoints.version}${endpoints.version.includes("?") ? "&" : "?"}t=${now}`;
      const { response, body } = await boundedJson(url);
      if (!active || current !== generation || unauthorized) return;
      if (response.status === 401 || response.status === 403) { blockUnauthorized(); return; }
      if (!response.ok) {
        retryNotBefore = Math.max(retryNotBefore, deps.now() + retryAfter(response, deps.now()));
        throw new Error("Version read failed");
      }
      const next = readSnapshot(body, resource.appId);
      if (!next) throw new Error("Mismatched version response");
      if (!active || current !== generation || unauthorized) return;
      failureCount = 0;
      retryNotBefore = 0;
      lastSuccessAt = deps.now();
      snapshot = next;
      succeeded = true;
      listeners.forEach((listener) => listener(next));
    } catch {
      if (active && current === generation && !unauthorized) {
        failureCount += 1;
        retryNotBefore = Math.max(retryNotBefore, deps.now() + Math.min(maximumBackoffMs, appVersionFallbackCheckMs * 2 ** Math.min(failureCount - 1, 8)));
      }
    } finally {
      if (current === generation) {
        inFlight = false;
        if (succeeded && readAgain) queueRead();
        else schedule();
      }
    }
  }
  const wake = () => {
    if (!active || unauthorized || !deps.visible()) return;
    if (inFlight) { if (deps.now() - lastReadAt > wakeCoalesceMs) readAgain = true; }
    else queueRead();
  };
  const visibility = () => {
    if (!deps.visible()) pauseTimers();
    else wake();
  };
  const stop = () => {
    active = false;
    generation += 1;
    pauseTimers();
    clear(subscriptionTimer);
    subscriptionTimer = undefined;
    stopListening?.();
    stopListening = undefined;
    realtimeClose?.();
    realtimeClose = undefined;
    requests.forEach((controller) => controller.abort());
    connected = false;
    subscribed = false;
    inFlight = false;
    configInFlight = false;
  };
  return {
    subscribe(listener: (value: AppVersionSnapshot) => void, options: { freshOnly?: boolean } = {}) {
      const notify = (value: AppVersionSnapshot) => listener(value);
      listeners.add(notify);
      if (snapshot && !options.freshOnly) listener(snapshot);
      if (!active) {
        active = true;
        unauthorized = false;
        stopListening = deps.listen(wake, visibility);
        queueRead();
      } else if (options.freshOnly) wake();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        listeners.delete(notify);
        if (!listeners.size) stop();
      };
    },
    invalidate,
    resume() { unauthorized = false; failureCount = 0; retryNotBefore = 0; configFailureCount = 0; configRetryNotBefore = 0; wake(); }
  };
}

function browserDependencies(): AppVersionDependencies {
  return {
    fetch: window.fetch.bind(window), now: Date.now,
    setTimeout: (callback, delay) => window.setTimeout(callback, delay) as unknown as Timer,
    clearTimeout: (timer) => window.clearTimeout(timer as unknown as number),
    visible: () => document.visibilityState === "visible",
    listen(wake, visibility) {
      window.addEventListener("focus", wake);
      window.addEventListener("pageshow", wake);
      window.addEventListener("online", wake);
      document.addEventListener("visibilitychange", visibility);
      return () => {
        window.removeEventListener("focus", wake);
        window.removeEventListener("pageshow", wake);
        window.removeEventListener("online", wake);
        document.removeEventListener("visibilitychange", visibility);
      };
    },
    async connect(config, handlers) {
      const { acquireSharedPusher } = await import("./shared-pusher-client");
      const lease = acquireSharedPusher({ key: config.key, cluster: config.cluster });
      handlers.connection(lease.connection.state === "connected");
      const channel = lease.subscribe(config.versionChannel);
      lease.connection.bind("connected", () => handlers.connection(true));
      for (const event of ["connecting", "disconnected", "unavailable", "failed"]) lease.connection.bind(event, () => handlers.connection(false));
      channel.bind("pusher:subscription_succeeded", handlers.subscribed);
      channel.bind("pusher:subscription_error", handlers.unavailable);
      channel.bind(config.eventName, handlers.event);
      return () => lease.disconnect();
    }
  };
}
const coordinators = new Map<string, { coordinator: ReturnType<typeof createAppVersionCoordinator>; listeners: number }>();
/** Shared within this browser runtime; independent devices retain their own checks. */
export function subscribeToAppVersion(resource: AppVersionResource, listener: (snapshot: AppVersionSnapshot) => void) {
  const endpoints = appVersionEndpoints(resource);
  const key = JSON.stringify([resource.appId, endpoints.version, endpoints.realtime]);
  let entry = coordinators.get(key);
  if (!entry) {
    entry = { coordinator: createAppVersionCoordinator(resource, browserDependencies()), listeners: 0 };
    coordinators.set(key, entry);
  }
  entry.listeners += 1;
  const unsubscribe = entry.coordinator.subscribe(listener, { freshOnly: true });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    unsubscribe();
    if (entry && --entry.listeners === 0) coordinators.delete(key);
  };
}
const publishing = new Map<string, Promise<boolean>>();
export async function publishAppVersionOnce(appId: AppVersionScope, version: string, endpoint: string, options: {
  fetch?: typeof fetch;
  storage?: Pick<Storage, "getItem" | "setItem">;
} = {}) {
  if (!isContentAppVersion(version)) return false;
  const key = `foundr1:version-published:v2:${appId}:${version}`;
  let storage = options.storage;
  try { storage ??= window.sessionStorage; if (storage?.getItem(key) === "1") return true; } catch { /* Storage is optional. */ }
  const requestKey = `${endpoint}:${key}`;
  const pending = publishing.get(requestKey);
  if (pending) return pending;
  const request = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const abort = new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("Version publication cancelled")), { once: true });
      });
      const result = await Promise.race([
        (options.fetch ?? fetch)(endpoint, { method: "POST", cache: "no-store", redirect: "error", signal: controller.signal })
          .then(async (response) => response.ok ? readSnapshot(await response.json(), appId) : null),
        abort
      ]);
      if (!result) return false;
      try { storage?.setItem(key, "1"); } catch { /* In-memory deduplication remains available. */ }
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  })();
  publishing.set(requestKey, request);
  const succeeded = await request;
  if (!succeeded && publishing.get(requestKey) === request) publishing.delete(requestKey);
  return succeeded;
}
