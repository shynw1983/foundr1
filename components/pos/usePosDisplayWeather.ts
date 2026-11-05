"use client";

import { useEffect, useState } from "react";
import { getPosDisplayWeatherDate, isPosDisplayWeatherStale, posDisplayWeatherRefreshMs, readPosDisplayWeatherResponse,
  type PosDisplayWeatherForecast, type PosDisplayWeatherResponse, type PosDisplayWeatherStatus } from "../../lib/pos-display-weather";

export type PosDisplayWeatherState = {
  status: PosDisplayWeatherStatus | "idle" | "loading";
  data: PosDisplayWeatherForecast | null;
};
type Entry = {
  response: PosDisplayWeatherResponse | null;
  retrievedAt: number;
  retryAfter: number;
  failed: boolean;
  listeners: Set<() => void>;
  pending?: { controller: AbortController; promise: Promise<void> };
};
const cache = new Map<string, Entry>();
const retryMs = 2 * 60 * 1000;

function entryFor(storeId: string) {
  let entry = cache.get(storeId);
  if (!entry) {
    entry = { response: null, retrievedAt: 0, retryAfter: 0, failed: false, listeners: new Set() };
    cache.set(storeId, entry);
    for (const [key, value] of cache) {
      if (cache.size <= 16) break;
      if (key !== storeId && !value.listeners.size && !value.pending) cache.delete(key);
    }
  }
  return entry;
}

function snapshot(entry: Entry): PosDisplayWeatherState {
  const response = entry.response;
  if (response && response.date === getPosDisplayWeatherDate()) {
    if (response.data) return { status: entry.failed || response.status === "stale" || isPosDisplayWeatherStale(response.data) ? "stale" : "ready", data: response.data };
    return { status: response.status, data: null };
  }
  return { status: entry.pending ? "loading" : "unavailable", data: null };
}

function publish(entry: Entry) { entry.listeners.forEach(listener => listener()); }

function refresh(storeId: string, entry: Entry) {
  const now = Date.now();
  if (entry.pending || now < entry.retryAfter) return;
  if (entry.response?.date === getPosDisplayWeatherDate() && now - entry.retrievedAt < posDisplayWeatherRefreshMs) return;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 30 * 1000);
  const promise = (async () => {
    try {
      const response = await fetch(`/api/store/pos/customer-display/weather?storeId=${encodeURIComponent(storeId)}`, {
        cache: "no-store", credentials: "same-origin", signal: controller.signal
      });
      if (controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) {
        entry.response = null; entry.failed = true; entry.retryAfter = Date.now() + retryMs;
        return;
      }
      if (!response.ok) throw new Error("Weather forecast unavailable");
      const value = readPosDisplayWeatherResponse(await response.json(), storeId);
      if (controller.signal.aborted) return;
      if (!value) throw new Error("Weather forecast unavailable");
      // A temporary provider outage can retain today's last forecast with an explicit stale status.
      if (value.status === "unavailable" && entry.response?.data && entry.response.date === getPosDisplayWeatherDate()) {
        entry.failed = true; entry.retryAfter = Date.now() + retryMs;
      } else {
        entry.response = value; entry.retrievedAt = Date.now(); entry.failed = false;
        entry.retryAfter = value.status === "unavailable" ? Date.now() + retryMs : 0;
        if (value.status === "unavailable") entry.retrievedAt = 0;
      }
    } catch {
      if (timedOut || !controller.signal.aborted) { entry.failed = true; entry.retryAfter = Date.now() + retryMs; }
    } finally {
      window.clearTimeout(timeout);
      if (timedOut) { entry.failed = true; entry.retryAfter = Date.now() + retryMs; }
      if (entry.pending?.controller === controller) entry.pending = undefined;
      if (timedOut || !controller.signal.aborted) publish(entry);
    }
  })();
  entry.pending = { controller, promise };
  publish(entry);
}

export function usePosDisplayWeather(storeId: string | undefined, enabled: boolean): PosDisplayWeatherState {
  const [current, setCurrent] = useState<{ storeId: string; value: PosDisplayWeatherState } | null>(null);
  useEffect(() => {
    if (!storeId || !enabled) return;
    const entry = entryFor(storeId);
    const update = () => setCurrent({ storeId, value: snapshot(entry) });
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      refresh(storeId, entry);
      update();
    };
    entry.listeners.add(update);
    tick();
    const timer = window.setInterval(tick, 60 * 1000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("online", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("online", tick);
      entry.listeners.delete(update);
      if (!entry.listeners.size && entry.pending) {
        const pending = entry.pending;
        entry.pending = undefined;
        pending.controller.abort();
      }
    };
  }, [storeId, enabled]);
  if (!storeId || !enabled) return { status: "idle", data: null };
  if (current?.storeId !== storeId) return { status: "loading", data: null };
  // A clock render can cross midnight before the cache timer runs. Never expose yesterday as today.
  if (current.value.data && current.value.data.date !== getPosDisplayWeatherDate()) return { status: "loading", data: null };
  if (current.value.data && isPosDisplayWeatherStale(current.value.data)) return { status: "stale", data: current.value.data };
  return current.value;
}
