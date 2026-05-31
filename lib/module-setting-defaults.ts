export type StoreAvailabilityDisplayMode = "separate_category" | "mixed" | "hidden";
export type StoreUserDisplayMode = "avatar" | "name" | "avatar_name";

export type StoreModuleSettings = {
  availability: {
    targets: {
      items: boolean;
      options: boolean;
    };
    optionDisplayMode: StoreAvailabilityDisplayMode;
    allowStorePriceEdit: boolean;
    allowChannelToggle: boolean;
  };
  header: {
    showClock: boolean;
    showNotifications: boolean;
    showLanguagePicker: boolean;
    userDisplay: StoreUserDisplayMode;
  };
};

export const defaultStoreModuleSettings: StoreModuleSettings = {
  availability: {
    targets: {
      items: true,
      options: true
    },
    optionDisplayMode: "separate_category",
    allowStorePriceEdit: false,
    allowChannelToggle: false
  },
  header: {
    showClock: true,
    showNotifications: true,
    showLanguagePicker: true,
    userDisplay: "avatar"
  }
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeDisplayMode(value: unknown): StoreAvailabilityDisplayMode {
  return value === "mixed" || value === "hidden" || value === "separate_category" ? value : "separate_category";
}

function normalizeUserDisplay(value: unknown): StoreUserDisplayMode {
  return value === "name" || value === "avatar_name" || value === "avatar" ? value : "avatar";
}

export function normalizeStoreModuleSettings(value: unknown): StoreModuleSettings {
  const source = asObject(value);
  const availability = asObject(source.availability);
  const targets = asObject(availability.targets);
  const header = asObject(source.header);

  return {
    availability: {
      targets: {
        items: asBoolean(targets.items, defaultStoreModuleSettings.availability.targets.items),
        options: asBoolean(targets.options, defaultStoreModuleSettings.availability.targets.options)
      },
      optionDisplayMode: normalizeDisplayMode(availability.optionDisplayMode),
      allowStorePriceEdit: asBoolean(availability.allowStorePriceEdit, defaultStoreModuleSettings.availability.allowStorePriceEdit),
      allowChannelToggle: asBoolean(availability.allowChannelToggle, defaultStoreModuleSettings.availability.allowChannelToggle)
    },
    header: {
      showClock: asBoolean(header.showClock, defaultStoreModuleSettings.header.showClock),
      showNotifications: asBoolean(header.showNotifications, defaultStoreModuleSettings.header.showNotifications),
      showLanguagePicker: asBoolean(header.showLanguagePicker, defaultStoreModuleSettings.header.showLanguagePicker),
      userDisplay: normalizeUserDisplay(header.userDisplay)
    }
  };
}
