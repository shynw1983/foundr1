export type StoreAvailabilityDisplayMode = "separate_category" | "mixed" | "hidden";
export type StoreUserDisplayMode = "avatar" | "name" | "avatar_name";
export type StoreOrderAlertSound = "foundr1_default" | "kitchen_bell" | "urgent_order" | "soft_chime";

export const storeOrderAlertSoundOptions: Array<{ value: StoreOrderAlertSound; label: string; description: string }> = [
  { value: "foundr1_default", label: "Foundr1 Default", description: "短く明るい二段チャイム。日常運用で耳に残りやすい音。" },
  { value: "kitchen_bell", label: "Kitchen Bell", description: "厨房でも気づきやすい、澄んだベル風の通知音。" },
  { value: "urgent_order", label: "Urgent Order", description: "漏れ防止向け。刺さりすぎない短い反復音。" },
  { value: "soft_chime", label: "Soft Chime", description: "静かな店舗向け。柔らかいが最初の音で気づきやすいチャイム。" }
];

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
  orderAlerts: {
    sound: StoreOrderAlertSound;
    repeatUntilHandled: boolean;
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
  },
  orderAlerts: {
    sound: "kitchen_bell",
    repeatUntilHandled: true
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

function normalizeOrderAlertSound(value: unknown): StoreOrderAlertSound {
  return storeOrderAlertSoundOptions.some((option) => option.value === value) ? value as StoreOrderAlertSound : "kitchen_bell";
}

export function normalizeStoreModuleSettings(value: unknown): StoreModuleSettings {
  const source = asObject(value);
  const availability = asObject(source.availability);
  const targets = asObject(availability.targets);
  const header = asObject(source.header);
  const orderAlerts = asObject(source.orderAlerts);

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
    },
    orderAlerts: {
      sound: normalizeOrderAlertSound(orderAlerts.sound),
      repeatUntilHandled: asBoolean(orderAlerts.repeatUntilHandled, defaultStoreModuleSettings.orderAlerts.repeatUntilHandled)
    }
  };
}
