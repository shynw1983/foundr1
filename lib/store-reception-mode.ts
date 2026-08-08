export const storeReceptionModes = ["auto", "force_open", "force_closed"] as const;

export type StoreReceptionMode = (typeof storeReceptionModes)[number];

export function normalizeStoreReceptionMode(value: unknown): StoreReceptionMode {
  return storeReceptionModes.includes(value as StoreReceptionMode)
    ? value as StoreReceptionMode
    : "auto";
}

export function getStoreReceptionModeLabel(mode: StoreReceptionMode) {
  if (mode === "force_open") return "手動受付";
  if (mode === "force_closed") return "手動停止";
  return "自動受付";
}
