"use client";

const storeSelectionStorageKey = "foundr1:store:selectedStoreId";
const storeSelectionEventName = "foundr1-store-selection-change";

export function getStoredStoreSelection() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(storeSelectionStorageKey) || "";
}

export function setStoredStoreSelection(storeId: string) {
  if (typeof window === "undefined" || !storeId) return;
  window.localStorage.setItem(storeSelectionStorageKey, storeId);
  window.dispatchEvent(new CustomEvent(storeSelectionEventName, { detail: { storeId } }));
}

export function clearStoredStoreSelection() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storeSelectionStorageKey);
  window.dispatchEvent(new CustomEvent(storeSelectionEventName, { detail: { storeId: "" } }));
}
