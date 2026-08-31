type PromotionItem = Record<string, unknown>;
type PromotionCampaign = Record<string, unknown>;

export type StoreStatusSnapshot = {
  isOpen: boolean | null;
  isOrderable: boolean | null;
  availabilityState: string;
  availabilityMessage: string;
  workingHoursLabel: string;
  observedAt: string;
  source: "server" | "bridge";
};

export type PromotionObservationStatus = "reliable" | "partial" | "closed" | "unknown";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function campaignKey(value: PromotionCampaign) {
  return text(value.title) || "__default__";
}

function itemKey(value: PromotionItem) {
  return text(value.key) || text(value.name) || text(value.title);
}

export function promotionIsActive(value: unknown) {
  const snapshot = record(value);
  return snapshot.active === true || (Array.isArray(snapshot.campaigns) && snapshot.campaigns.length > 0);
}

export function mergePromotionSnapshots(previous: unknown, current: unknown) {
  const previousRecord = record(previous);
  const currentRecord = record(current);
  const campaigns = new Map<string, PromotionCampaign>();
  for (const value of Array.isArray(previousRecord.campaigns) ? previousRecord.campaigns : []) {
    if (!value || typeof value !== "object") continue;
    campaigns.set(campaignKey(value as PromotionCampaign), { ...(value as PromotionCampaign) });
  }
  for (const value of Array.isArray(currentRecord.campaigns) ? currentRecord.campaigns : []) {
    if (!value || typeof value !== "object") continue;
    const incoming = value as PromotionCampaign;
    const key = campaignKey(incoming);
    const existing = campaigns.get(key) ?? {};
    const items = new Map<string, PromotionItem>();
    for (const item of Array.isArray(existing.items) ? existing.items : []) {
      if (item && typeof item === "object") items.set(itemKey(item as PromotionItem), item as PromotionItem);
    }
    for (const item of Array.isArray(incoming.items) ? incoming.items : []) {
      if (item && typeof item === "object") items.set(itemKey(item as PromotionItem), item as PromotionItem);
    }
    const discountLabels = [...new Set([
      ...(Array.isArray(existing.discountLabels) ? existing.discountLabels : []),
      ...(Array.isArray(incoming.discountLabels) ? incoming.discountLabels : [])
    ].map(String).filter(Boolean))];
    campaigns.set(key, {
      ...existing,
      ...incoming,
      itemCount: items.size || Number(incoming.itemCount) || Number(existing.itemCount) || 0,
      discountLabels,
      items: [...items.values()]
    });
  }
  return {
    ...previousRecord,
    ...currentRecord,
    active: promotionIsActive(previousRecord) || promotionIsActive(currentRecord),
    campaigns: [...campaigns.values()]
  };
}

export function resolvePromotionObservation(input: {
  previous: unknown;
  current: unknown;
  isOpen: boolean | null;
  complete: boolean;
}) {
  const hasPrevious = input.previous !== null && input.previous !== undefined;
  if (!hasPrevious) {
    return {
      promotions: record(input.current),
      status: input.complete ? "reliable" as const : input.isOpen === false ? "closed" as const : "partial" as const,
      acceptedEnd: false
    };
  }
  if (input.isOpen === false) {
    return { promotions: record(input.previous), status: "closed" as const, acceptedEnd: false };
  }
  if (input.complete && input.isOpen === true) {
    return {
      promotions: record(input.current),
      status: "reliable" as const,
      acceptedEnd: promotionIsActive(input.previous) && !promotionIsActive(input.current)
    };
  }
  if (promotionIsActive(input.current)) {
    return {
      promotions: mergePromotionSnapshots(input.previous, input.current),
      status: "partial" as const,
      acceptedEnd: false
    };
  }
  return { promotions: record(input.previous), status: input.isOpen === null ? "unknown" as const : "partial" as const, acceptedEnd: false };
}
