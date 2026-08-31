function text(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function itemUuidFromHref(href) {
  try {
    const value = new URL(String(href)).searchParams.get("modctx");
    if (!value) return "";
    for (const candidate of [value, decodeURIComponent(value)]) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed?.itemUuid) return String(parsed.itemUuid);
      } catch {
        // Try the next decoding level.
      }
    }
  } catch {
    // Ignore malformed card URLs.
  }
  return "";
}

function productName(lines) {
  const priceIndex = lines.findIndex((line) => /¥\s*[\d,]+/u.test(line));
  const candidates = lines.slice(0, priceIndex < 0 ? Math.min(lines.length, 6) : priceIndex)
    .filter((line) => !/^(?:#\d+ most liked|Quick Add|\d+% off)$/iu.test(line));
  return text(candidates.at(-1));
}

export function parseUberCompetitorCards(cards) {
  const products = new Map();
  for (const card of Array.isArray(cards) ? cards : []) {
    const rawText = String(card?.text ?? "");
    const discountLabels = [...new Set(rawText.match(/\d+(?:\.\d+)?%\s*off/giu) ?? [])];
    if (!discountLabels.length) continue;
    const lines = rawText.split(/\r?\n/u).map(text).filter(Boolean);
    const prices = [...rawText.matchAll(/¥\s*([\d,]+)/gu)].map((match) => `¥${match[1]}`);
    const key = itemUuidFromHref(card?.href);
    const name = productName(lines);
    if (!key && !name) continue;
    products.set(key || name, {
      key: key || name,
      name: name || key,
      currentPrice: prices[0] ?? "",
      originalPrice: prices[1] ?? "",
      discountLabels
    });
  }
  return [...products.values()];
}

export function buildUberCompetitorSnapshot({ sourceId, apiData, cards, menuLoaded, locationReady, observedAt = new Date().toISOString() }) {
  const products = parseUberCompetitorCards(cards);
  const metadata = apiData?.storeInfoMetadata ?? {};
  const availability = metadata.storeAvailablityStatus ?? metadata.storeAvailabilityStatus ?? {};
  const isOpen = typeof apiData?.isOpen === "boolean" ? apiData.isOpen : null;
  const complete = isOpen === true && menuLoaded === true && locationReady === true;
  return {
    sourceId: String(sourceId ?? ""),
    observedAt,
    storeStatus: {
      isOpen,
      isOrderable: typeof apiData?.isOrderable === "boolean" ? apiData.isOrderable : null,
      availabilityState: text(availability.state),
      availabilityMessage: text(availability.displayMessage || apiData?.closedMessage),
      workingHoursLabel: text(apiData?.workingHoursTagline || metadata.workingHoursTagline),
      observedAt,
      source: "bridge"
    },
    promotionComplete: complete,
    deliveryLocationReady: locationReady === true,
    promotions: {
      active: products.length > 0,
      campaigns: products.length ? [{
        title: "Save on Select Items",
        itemCount: products.length,
        discountLabels: [...new Set(products.flatMap((item) => item.discountLabels))],
        items: products
      }] : []
    }
  };
}
