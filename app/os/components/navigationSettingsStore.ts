"use client";

import {
  defaultNavigationMenuSettings,
  normalizeNavigationMenuSettings,
  type NavigationMenuSettings
} from "../../../lib/navigation-setting-defaults";

let cachedNavigationSettings: NavigationMenuSettings | null = null;
let inflightRequest: Promise<NavigationMenuSettings> | null = null;

export function getCachedNavigationSettings() {
  return cachedNavigationSettings;
}

export function setCachedNavigationSettings(settings: NavigationMenuSettings) {
  cachedNavigationSettings = normalizeNavigationMenuSettings(settings);
}

export async function loadNavigationSettings() {
  if (cachedNavigationSettings) return cachedNavigationSettings;
  if (inflightRequest) return inflightRequest;

  inflightRequest = fetch("/api/settings?module=navigation", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) {
        cachedNavigationSettings = defaultNavigationMenuSettings;
        return cachedNavigationSettings;
      }
      const body = await response.json().catch(() => ({})) as { settings?: unknown };
      cachedNavigationSettings = normalizeNavigationMenuSettings(body.settings);
      return cachedNavigationSettings;
    })
    .finally(() => {
      inflightRequest = null;
    });

  return inflightRequest;
}
