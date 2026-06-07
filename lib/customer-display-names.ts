export type CustomerDisplayNameOverride = {
  brandName: string;
  platform: string;
  sourceLabel: string;
  displayName: string;
};

export type CustomerDisplayNameSettings = {
  defaultName: string;
  overrides: CustomerDisplayNameOverride[];
};

export const emptyCustomerDisplayNameSettings: CustomerDisplayNameSettings = {
  defaultName: "",
  overrides: []
};

export function normalizeCustomerDisplayNameSettings(value: unknown): CustomerDisplayNameSettings {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawOverrides = Array.isArray(record.overrides) ? record.overrides : [];

  return {
    defaultName: String(record.defaultName ?? "").trim(),
    overrides: rawOverrides
      .map((item) => {
        const override = item && typeof item === "object" ? item as Record<string, unknown> : {};
        return {
          brandName: String(override.brandName ?? "").trim(),
          platform: String(override.platform ?? "").trim(),
          sourceLabel: String(override.sourceLabel ?? "").trim(),
          displayName: String(override.displayName ?? "").trim()
        };
      })
      .filter((override) => override.displayName)
  };
}

export function resolveCustomerStoreDisplayName(input: {
  settings?: unknown;
  internalStoreName: string;
  brandName?: string;
  platform?: string;
}) {
  const settings = normalizeCustomerDisplayNameSettings(input.settings);
  const brandName = String(input.brandName ?? "").trim();
  const platform = String(input.platform ?? "").trim();
  const candidates = [
    (override: CustomerDisplayNameOverride) => override.brandName === brandName && override.platform === platform,
    (override: CustomerDisplayNameOverride) => override.brandName === brandName && !override.platform,
    (override: CustomerDisplayNameOverride) => !override.brandName && override.platform === platform
  ];

  for (const matches of candidates) {
    const override = settings.overrides.find(matches);
    if (override?.displayName) return override.displayName;
  }

  return settings.defaultName || input.internalStoreName;
}

export function orderSourceToCustomerDisplayPlatform(orderSource: string) {
  if (orderSource === "maamaa_web" || orderSource === "nanacha_web") return "web_reservation";
  if (orderSource === "store_pos") return "foundr1_pos";
  return orderSource;
}
