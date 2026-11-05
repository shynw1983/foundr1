"use client";

// Per-terminal acknowledgement only controls sound. The server remains the
// authority for whether a platform operation still needs attention.
const acknowledgedStorageKey = "foundr1:inventory-sync:alerted:v1";
const mutedStorageKey = "foundr1:inventory-sync:muted:v1";
const acknowledgedInMemory = new Set<string>();
let mutedInMemory = false;

export function inventorySyncSoundMuted() {
  try { return window.localStorage.getItem(mutedStorageKey) === "true"; }
  catch { return mutedInMemory; }
}

export function setInventorySyncSoundMuted(muted: boolean) {
  mutedInMemory = muted;
  try { window.localStorage.setItem(mutedStorageKey, String(muted)); } catch { /* WebView storage may be unavailable. */ }
}

function acknowledgedKeys() {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(acknowledgedStorageKey) || "[]");
    if (Array.isArray(stored)) for (const key of stored) if (typeof key === "string") acknowledgedInMemory.add(key);
  } catch { /* Keep an in-memory acknowledgement when storage is unavailable. */ }
  return acknowledgedInMemory;
}

export function unacknowledgedInventorySyncKeys(storeId: string, keys: string[]) {
  const known = acknowledgedKeys();
  return keys.filter(key => key && !known.has(`${storeId}:${key}`));
}

export function acknowledgeInventorySyncKeys(storeId: string, keys: string[]) {
  const known = acknowledgedKeys();
  for (const key of keys) if (key) known.add(`${storeId}:${key}`);
  try { window.localStorage.setItem(acknowledgedStorageKey, JSON.stringify([...known])); } catch { /* The visible warning is unaffected. */ }
}

export function isInventorySyncNativeShell() {
  const nativeWindow = window as typeof window & { Foundr1NativeNotifications?: unknown; Foundr1Printer?: unknown };
  return Boolean(nativeWindow.Foundr1NativeNotifications || nativeWindow.Foundr1Printer);
}

// One short foreground chime; background system notifications are sent by the
// server. Never start the repeating new-order alarm for an inventory failure.
export function playInventorySyncChime(context: AudioContext) {
  for (const [at, frequency] of [[0, 659.25], [0.18, 880]]) {
    const start = context.currentTime + at;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.26);
  }
}

export async function withInventorySyncAlertLock(action: () => void) {
  // Multiple open Store tabs share one terminal acknowledgement. Web Locks
  // serializes the storage check and playback where the browser supports it.
  if (navigator.locks?.request) await navigator.locks.request("foundr1:inventory-sync:chime", action);
  else action();
}

let notificationStoreRequest: { key: string; promise: Promise<string> } | null = null;

// All mounted Store consumers must resolve the notification scope before their
// initial reads. Sharing the request prevents the navigation/menu from restoring
// the old stored selection after the alert panel has switched to the target.
export function getScopedInventorySyncNotificationStore() {
  const query = new URLSearchParams(window.location.search);
  const requested = query.get("syncAttention") === "1" ? query.get("storeId") || "" : "";
  if (!requested) return Promise.resolve("");
  if (notificationStoreRequest?.key === requested) return notificationStoreRequest.promise;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);
  const promise = fetch("/api/store/context", { cache: "no-store", signal: controller.signal })
    .then(response => response.ok ? response.json() : null)
    .then(body => Array.isArray(body?.access?.stores) && body.access.stores.some((store: { id?: string }) => store.id === requested) ? requested : "")
    .catch(() => "")
    .finally(() => window.clearTimeout(timeout));
  notificationStoreRequest = { key: requested, promise };
  return promise;
}
