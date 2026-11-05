import { getStoreCashBusinessDayState } from "./store-business-hours";

const businessHoursStorageKey = "foundr1-store:business-hours:v1";

export const storeOrderAlertEventName = "foundr1:store-order-alert";

type StoreHoursEntry = {
  id: string;
  businessHours?: unknown;
};

type StoredBusinessHours = Record<string, unknown>;

function readStoredBusinessHours(): StoredBusinessHours {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(businessHoursStorageKey) || "{}") as StoredBusinessHours;
  } catch {
    return {};
  }
}

export function rememberStoreBusinessHours(stores: StoreHoursEntry[] | undefined) {
  if (typeof window === "undefined" || !stores?.length) return;
  const next = { ...readStoredBusinessHours() };
  stores.forEach((store) => {
    if (store.id && store.businessHours != null) next[store.id] = store.businessHours;
  });
  window.localStorage.setItem(businessHoursStorageKey, JSON.stringify(next));
}

function isAnyStoreOpen(storeIds?: string[]) {
  const stored = readStoredBusinessHours();
  const ids = storeIds?.filter(Boolean) ?? Object.keys(stored);
  if (!ids.length) return true;
  return ids.some((storeId) => {
    const businessHours = stored[storeId];
    if (!businessHours || (typeof businessHours === "object" && Object.keys(businessHours).length === 0)) return true;
    return getStoreCashBusinessDayState(businessHours).status === "business_open";
  });
}

export function getStoreFallbackPollDelay(options: {
  baseIntervalMs?: number;
  disconnectedForMs?: number;
  failureCount?: number;
  maxIntervalMs?: number;
  minIntervalMs?: number;
  outageBackoff?: "critical" | "standard";
  respectBusinessHours?: boolean;
  storeIds?: string[];
} = {}) {
  if (options.respectBusinessHours !== false && !isAnyStoreOpen(options.storeIds)) return 60 * 60_000;
  const baseIntervalMs = Math.max(options.minIntervalMs ?? 30_000, options.baseIntervalMs ?? 60_000);
  const failureCount = Math.max(0, Math.min(4, options.failureCount ?? 0));
  const disconnectedForMs = Math.max(0, options.disconnectedForMs ?? 0);
  const standardBackoff = options.outageBackoff === "standard";
  const outageFloorMs = standardBackoff
    ? disconnectedForMs >= 60 * 60_000
      ? 60 * 60_000
      : disconnectedForMs >= 15 * 60_000
        ? 30 * 60_000
        : disconnectedForMs >= 5 * 60_000
          ? 15 * 60_000
          : baseIntervalMs
    : disconnectedForMs >= 15 * 60_000
      ? 5 * 60_000
      : disconnectedForMs >= 5 * 60_000
        ? 2 * 60_000
        : baseIntervalMs;
  const defaultMaximumMs = standardBackoff ? 60 * 60_000 : 5 * 60_000;
  const maxIntervalMs = Math.max(baseIntervalMs, options.maxIntervalMs ?? defaultMaximumMs);
  return Math.min(maxIntervalMs, Math.max(outageFloorMs, baseIntervalMs * (2 ** failureCount)));
}

export function createStoreFallbackPoller(
  task: () => Promise<unknown> | unknown,
  options: {
    baseIntervalMs?: number | (() => number);
    maxIntervalMs?: number;
    minIntervalMs?: number;
    outageBackoff?: "critical" | "standard";
    respectBusinessHours?: boolean;
    storeIds?: () => string[];
  } = {}
) {
  let active = false;
  let timer = 0;
  let failureCount = 0;
  let running = false;

  const clear = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };

  const schedule = () => {
    clear();
    if (!active || document.visibilityState !== "visible") return;
    const configuredBaseIntervalMs = typeof options.baseIntervalMs === "function"
      ? options.baseIntervalMs()
      : options.baseIntervalMs;
    timer = window.setTimeout(run, getStoreFallbackPollDelay({
      baseIntervalMs: Math.max(options.minIntervalMs ?? 30_000, configuredBaseIntervalMs ?? 60_000),
      // Elapsed poller lifetime is not an outage. Successful reads retain their base cadence.
      disconnectedForMs: 0,
      failureCount,
      maxIntervalMs: options.maxIntervalMs,
      minIntervalMs: options.minIntervalMs,
      outageBackoff: options.outageBackoff,
      respectBusinessHours: options.respectBusinessHours,
      storeIds: options.storeIds?.()
    }));
  };

  const run = async () => {
    if (!active || running || document.visibilityState !== "visible") {
      schedule();
      return;
    }
    running = true;
    try {
      await task();
      failureCount = 0;
    } catch {
      failureCount += 1;
    } finally {
      running = false;
      schedule();
    }
  };

  const handleVisible = () => {
    if (document.visibilityState === "visible") void run();
    else clear();
  };

  return {
    start(options: { immediate?: boolean } = {}) {
      if (active) return;
      active = true;
      window.addEventListener("online", handleVisible);
      window.addEventListener("focus", handleVisible);
      document.addEventListener("visibilitychange", handleVisible);
      if (options.immediate) void run();
      else schedule();
    },
    stop() {
      active = false;
      clear();
      window.removeEventListener("online", handleVisible);
      window.removeEventListener("focus", handleVisible);
      document.removeEventListener("visibilitychange", handleVisible);
    },
    runNow() {
      void run();
    }
  };
}

export type StoreRefreshError = Error & { status?: number; retryAfterMs?: number };

/** One read-model, one timer. Events during an active read require a trailing snapshot. */
export function createStoreRefreshCoordinator(
  task: (signal: AbortSignal) => Promise<unknown>,
  options: {
    healthyIntervalMs: number | (() => number);
    fallbackIntervalMs: number | (() => number);
    maxFailureIntervalMs?: number;
    timeoutMs?: number;
    jitterRatio?: number;
    onUnauthorized?: () => void;
    onError?: (error: StoreRefreshError) => void;
  }
) {
  let active = false;
  let healthy = false;
  let unauthorized = false;
  let dirty = false;
  let generation = 0;
  let timer = 0;
  let wakeTimer = 0;
  let failureCount = 0;
  let notBefore = 0;
  let retryAfterUntil = 0;
  let pending: Promise<void> | null = null;
  let controller: AbortController | null = null;
  const visible = () => document.visibilityState !== "hidden";
  const online = () => typeof navigator === "undefined" || navigator.onLine !== false;
  const clear = () => { if (timer) window.clearTimeout(timer); timer = 0; };
  const interval = () => {
    const setting = healthy ? options.healthyIntervalMs : options.fallbackIntervalMs;
    return Math.max(100, typeof setting === "function" ? setting() : setting);
  };
  const schedule = () => {
    clear();
    if (!active || unauthorized || !visible() || !online() || pending) return;
    const base = interval();
    // A working HTTP path must not slow down simply because the websocket is unavailable.
    const backoff = failureCount ? Math.min(Math.max(base, options.maxFailureIntervalMs ?? 300_000), base * 2 ** Math.min(5, failureCount)) : base;
    const jitter = 1 + Math.max(0, options.jitterRatio ?? 0.1) * Math.random();
    const delay = Math.max(backoff * jitter, notBefore - Date.now());
    timer = window.setTimeout(() => { timer = 0; void refresh(); }, delay);
  };
  const refresh = (refreshOptions: { force?: boolean } = {}): Promise<void> => {
    if (!active || unauthorized) return Promise.resolve();
    if (!visible() || !online()) { dirty = true; clear(); return Promise.resolve(); }
    if (pending) { dirty = true; return pending; }
    if (refreshOptions.force) notBefore = retryAfterUntil;
    if (Date.now() < notBefore) { schedule(); return Promise.resolve(); }
    clear();
    const capturedGeneration = generation;
    const work = async () => {
      // Defer one microtask so a synchronous group of initial/focus/events shares one read.
      await Promise.resolve();
      do {
        dirty = false;
        controller = new AbortController();
        const currentController = controller;
        let timeout = 0;
        let timedOut = false;
        const abort = new Promise<never>((_, reject) => {
          currentController.signal.addEventListener("abort", () => reject(new DOMException("Refresh aborted", "AbortError")), { once: true });
          timeout = window.setTimeout(() => { timedOut = true; currentController.abort(); }, options.timeoutMs ?? 15_000);
        });
        try {
          await Promise.race([task(currentController.signal), abort]);
          if (!active || generation !== capturedGeneration) return;
          failureCount = 0;
          notBefore = 0;
          retryAfterUntil = 0;
        } catch (cause) {
          if (!active || generation !== capturedGeneration) return;
          if (currentController.signal.aborted && !timedOut) return;
          const details = cause && typeof cause === "object" ? cause as { message?: string; status?: number; retryAfterMs?: number } : {};
          const error: StoreRefreshError = cause instanceof Error ? cause : Object.assign(new Error(details.message ?? String(cause)), {
            status: details.status, retryAfterMs: details.retryAfterMs
          });
          if (error.status === 401 || error.status === 403) {
            unauthorized = true;
            dirty = false;
            options.onUnauthorized?.();
          } else {
            failureCount += 1;
            const base = interval();
            const backoff = Math.min(Math.max(base, options.maxFailureIntervalMs ?? 300_000), base * 2 ** Math.min(5, failureCount));
            retryAfterUntil = Date.now() + Math.max(0, error.retryAfterMs ?? 0);
            notBefore = Math.max(Date.now() + backoff, retryAfterUntil);
          }
          options.onError?.(error);
          // Wait for the error policy; an event must not turn a failed request into a hot loop.
          dirty = false;
        } finally {
          if (timeout) window.clearTimeout(timeout);
          if (controller === currentController) controller = null;
        }
      } while (dirty && active && generation === capturedGeneration && !unauthorized && visible() && online());
    };
    const currentWork = work().finally(() => {
      if (pending !== currentWork) return;
      pending = null;
      schedule();
    });
    pending = currentWork;
    return currentWork;
  };
  const wake = () => {
    if (!active || unauthorized || !visible() || !online()) { clear(); return; }
    // Browser commonly fires online/focus/pageshow/visibilitychange in the same burst.
    if (wakeTimer) return;
    wakeTimer = window.setTimeout(() => { wakeTimer = 0; void refresh({ force: true }); }, 75);
  };
  const hidden = () => { if (visible()) wake(); else { clear(); if (wakeTimer) window.clearTimeout(wakeTimer); wakeTimer = 0; } };
  const offline = () => { clear(); };
  return {
    start(startOptions: { immediate?: boolean } = {}) {
      if (active) return;
      active = true;
      unauthorized = false;
      failureCount = 0;
      notBefore = 0;
      retryAfterUntil = 0;
      generation += 1;
      window.addEventListener("online", wake);
      window.addEventListener("offline", offline);
      window.addEventListener("focus", wake);
      window.addEventListener("pageshow", wake);
      document.addEventListener("visibilitychange", hidden);
      if (startOptions.immediate) void refresh(); else schedule();
    },
    stop() {
      active = false;
      generation += 1;
      dirty = false;
      clear();
      if (wakeTimer) window.clearTimeout(wakeTimer);
      wakeTimer = 0;
      controller?.abort();
      pending = null;
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", offline);
      window.removeEventListener("focus", wake);
      window.removeEventListener("pageshow", wake);
      document.removeEventListener("visibilitychange", hidden);
    },
    refresh,
    runNow() { return refresh(); },
    reschedule: schedule,
    setRealtimeHealthy(value: boolean) {
      if (healthy === value) return;
      healthy = value;
      schedule();
    }
  };
}
