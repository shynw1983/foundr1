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
  failureCount?: number;
  storeIds?: string[];
} = {}) {
  if (!isAnyStoreOpen(options.storeIds)) return 15 * 60_000;
  const baseIntervalMs = Math.max(30_000, options.baseIntervalMs ?? 60_000);
  const failureCount = Math.max(0, Math.min(4, options.failureCount ?? 0));
  return Math.min(5 * 60_000, baseIntervalMs * (2 ** failureCount));
}

export function createStoreFallbackPoller(
  task: () => Promise<unknown> | unknown,
  options: { baseIntervalMs?: number; storeIds?: () => string[] } = {}
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
    timer = window.setTimeout(run, getStoreFallbackPollDelay({
      baseIntervalMs: options.baseIntervalMs,
      failureCount,
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
