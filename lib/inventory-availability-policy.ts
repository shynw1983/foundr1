export type PlatformAvailabilityOverride = "available" | "unavailable" | undefined;

export function resolveFullSyncAvailability(
  inventoryAvailable: boolean,
  platformOverride: PlatformAvailabilityOverride
) {
  // A platform override can stop an otherwise available product, but it must
  // never reopen inventory that the store has explicitly marked unavailable.
  if (!inventoryAvailable) return false;
  return platformOverride !== "unavailable";
}

export function shouldResetPlatformAvailabilityOverrides(input: {
  requestedReset?: boolean;
  persistOverall?: boolean;
  stockStatus: "available" | "low_stock" | "unavailable";
  hasPlatformOverride: boolean;
}) {
  if (input.requestedReset) return true;
  return input.persistOverall !== false
    && !input.hasPlatformOverride
    && input.stockStatus !== "low_stock";
}
