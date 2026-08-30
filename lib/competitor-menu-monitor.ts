import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { sql } from "./db";
import { sendLarkTextMessage } from "./lark";
import { createOsNotification } from "./web-push";
import { canonicalCompetitorProductIdentity } from "./competitor-menu-identity";

export type CompetitorSourceType = "website" | "uber_eats" | "delivery_platform" | "json";

type SourceRow = {
  id: string;
  competitorName: string;
  sourceName: string;
  sourceUrl: string;
  sourceType: CompetitorSourceType;
  lastRating: number | null;
  lastReviewCountLabel: string;
  lastPromotions: Record<string, unknown> | null;
};

type MenuItem = {
  externalKey: string;
  name: string;
  normalizedName: string;
  category: string;
  description: string;
  price: number | null;
  currency: string;
  itemUrl: string;
  imageUrl: string;
  isAvailable: boolean;
  details: Record<string, unknown>;
  options: Record<string, unknown>;
  promotionDetails: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
};

type PreviousItem = {
  id: string;
  externalKey: string;
  name: string;
  normalizedName: string;
  category: string;
  description: string;
  price: number | null;
  currency: string;
  itemUrl: string;
  imageUrl: string;
  isAvailable: boolean;
  rawPayload: Record<string, unknown>;
  isPresent: boolean;
};

type Change = {
  type: "new_product" | "price_changed" | "renamed" | "category_changed" | "description_changed" | "image_changed" | "availability_changed" | "details_changed" | "options_changed" | "item_promotion_changed" | "store_rating_changed" | "store_review_count_changed" | "store_promotion_changed" | "returned" | "removed";
  externalKey: string;
  title: string;
  summary: string;
  previousValue: Record<string, unknown>;
  currentValue: Record<string, unknown>;
};

const requestTimeoutMs = 15_000;
const maxResponseBytes = 5 * 1024 * 1024;
const maxRedirects = 3;

function normalizeWhitespace(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeName(value: unknown) {
  return normalizeWhitespace(value).normalize("NFKC").toLocaleLowerCase("ja-JP");
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested: string = firstText(...value);
      if (nested) return nested;
      continue;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const nested: string = firstText(record.url, record.contentUrl, record.src);
      if (nested) return nested;
      continue;
    }
    const text = normalizeWhitespace(value);
    if (text) return text;
  }
  return "";
}

function numericPrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[^0-9.,-]/g, "").replace(/,/g, "");
  if (!/[0-9]/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function comparableDetails(record: Record<string, unknown>) {
  const keys = [
    "tags", "dietaryInfo", "dietaryLabels", "allergens", "hasCustomizations", "numAlcoholicItems"
  ];
  return Object.fromEntries(keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
}

function comparableOptions(record: Record<string, unknown>) {
  const keys = [
    "customizationsList", "modifierGroups", "modifier_groups", "modifiers", "options",
    "optionGroups", "option_groups", "variations", "variants", "sizes"
  ];
  return Object.fromEntries(keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
}

function optionDetailsLoaded(record: Record<string, unknown>) {
  return record._optionDetailsLoaded === true;
}

type OptionChangeDetails = {
  priority: "low" | "normal" | "high";
  kind: "visibility" | "availability" | "catalog" | "returned" | "price" | "rules" | "mixed" | "display";
  added: string[];
  returned: string[];
  hidden: string[];
  availabilityChanged: string[];
  priceChanged: string[];
  ruleChanged: string[];
  affectedProducts?: string[];
};

type ComparableOption = {
  id: string;
  title: string;
  groupTitle: string;
  price: number;
  isSoldOut: boolean;
};

type ComparableOptionGroup = {
  id: string;
  title: string;
  min: number;
  max: number;
};

function optionText(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return normalizeWhitespace(value);
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return optionText(record.text ?? record.title ?? record.label);
}

function optionSnapshot(value: Record<string, unknown>) {
  const options: ComparableOption[] = [];
  const groups: ComparableOptionGroup[] = [];
  const rootGroups = value.customizationsList;

  function visit(groupValues: unknown, depth = 0) {
    if (!Array.isArray(groupValues) || depth > 6) return;
    for (const [groupIndex, entry] of groupValues.entries()) {
      if (!entry || typeof entry !== "object") continue;
      const group = entry as Record<string, unknown>;
      const groupTitle = optionText(group.title ?? group.name) || "選択内容";
      const groupId = optionText(group.uuid ?? group.id) || `${depth}:${groupIndex}:${groupTitle}`;
      const uniqueMin = Number(group.minPermittedUnique ?? 0) || 0;
      const uniqueMax = Number(group.maxPermittedUnique ?? 0) || 0;
      groups.push({
        id: groupId,
        title: groupTitle,
        min: uniqueMin > 0 ? uniqueMin : Number(group.minPermitted ?? 0) || 0,
        max: uniqueMax > 0 ? uniqueMax : Number(group.maxPermitted ?? 0) || 0
      });
      const groupOptions = Array.isArray(group.options) ? group.options : [];
      for (const [optionIndex, optionEntry] of groupOptions.entries()) {
        if (!optionEntry || typeof optionEntry !== "object") continue;
        const option = optionEntry as Record<string, unknown>;
        const title = optionText(option.title ?? option.name) || "名称未設定";
        const id = optionText(option.uuid ?? option.id) || `${groupId}:${optionIndex}:${title}`;
        const rawPrice = Number(option.price ?? option.priceAmount ?? 0);
        options.push({
          id,
          title,
          groupTitle,
          price: Number.isFinite(rawPrice) ? rawPrice / 100 : 0,
          isSoldOut: option.isSoldOut === true || option.isAvailable === false
        });
        visit(option.childCustomizationList ?? option.customizationsList, depth + 1);
      }
    }
  }

  visit(rootGroups);
  return { options, groups };
}

function shortList(values: string[], limit = 4) {
  const visible = values.slice(0, limit).join("、");
  return values.length > limit ? `${visible}ほか${values.length - limit}件` : visible;
}

function optionPriceLabel(value: number) {
  return value > 0 ? `+¥${new Intl.NumberFormat("ja-JP").format(value)}` : "無料";
}

export function describeOptionChanges(
  previous: Record<string, unknown>,
  current: Record<string, unknown>,
  historicallySeenOptionKeys: ReadonlySet<string> = new Set(),
  historicalPricesByTitle: ReadonlyMap<string, number> = new Map()
) {
  const before = optionSnapshot(previous);
  const after = optionSnapshot(current);
  const beforeOptions = new Map(before.options.map((option) => [option.id, option]));
  const afterOptions = new Map(after.options.map((option) => [option.id, option]));
  const beforeGroups = new Map(before.groups.map((group) => [group.id, group]));
  const afterGroups = new Map(after.groups.map((group) => [group.id, group]));
  const appeared = after.options.filter((option) => !beforeOptions.has(option.id));
  const wasSeen = (option: ComparableOption) => historicallySeenOptionKeys.has(`id:${option.id}`)
    || historicallySeenOptionKeys.has(`title:${normalizeName(option.title)}`);
  const returned = appeared.filter(wasSeen);
  const added = appeared.filter((option) => !wasSeen(option));
  const hidden = before.options.filter((option) => !afterOptions.has(option.id));
  const availabilityChanged = after.options.flatMap((option) => {
    const old = beforeOptions.get(option.id);
    if (!old || old.isSoldOut === option.isSoldOut) return [];
    return [`${option.title}（${old.isSoldOut ? "売り切れ" : "販売中"}→${option.isSoldOut ? "売り切れ" : "販売再開"}）`];
  });
  const priceChanged = after.options.flatMap((option) => {
    const old = beforeOptions.get(option.id);
    const historicalPrice = returned.includes(option)
      ? historicalPricesByTitle.get(normalizeName(option.title))
      : undefined;
    const previousPrice = old?.price ?? historicalPrice;
    if (previousPrice === undefined || previousPrice === option.price) return [];
    return [`${option.title}（${optionPriceLabel(previousPrice)}→${optionPriceLabel(option.price)}）`];
  });
  const renamed = after.options.flatMap((option) => {
    const old = beforeOptions.get(option.id);
    return old && old.title !== option.title ? [`${old.title}→${option.title}`] : [];
  });
  const ruleChanged = after.groups.flatMap((group) => {
    const old = beforeGroups.get(group.id);
    if (!old) return [`選択グループ追加：${group.title}（${group.min}～${group.max}件）`];
    if (old.title === group.title && old.min === group.min && old.max === group.max) return [];
    return [`${old.title}${old.title !== group.title ? `→${group.title}` : ""}（${old.min}～${old.max}件→${group.min}～${group.max}件）`];
  });
  for (const group of before.groups) {
    if (!afterGroups.has(group.id)) ruleChanged.push(`選択グループが非表示：${group.title}`);
  }

  const addedLabels = added.map((option) => `${option.title}（${optionPriceLabel(option.price)}）`);
  const returnedLabels = returned.map((option) => `${option.title}（${optionPriceLabel(option.price)}）`);
  const hiddenLabels = hidden.map((option) => `${option.title}（${optionPriceLabel(option.price)}）`);
  const parts = [
    addedLabels.length ? `選択肢追加：${shortList(addedLabels)}` : "",
    returnedLabels.length ? `選択肢が再表示：${shortList(returnedLabels)}` : "",
    hiddenLabels.length ? `選択肢がメニューから非表示：${hiddenLabels.join("、")}` : "",
    availabilityChanged.length ? `選択肢の販売状態変更：${shortList(availabilityChanged)}` : "",
    priceChanged.length ? `選択価格変更：${shortList(priceChanged)}` : "",
    renamed.length ? `選択肢名称変更：${shortList(renamed)}` : "",
    ruleChanged.length ? `選択ルール変更：${shortList(ruleChanged)}` : ""
  ].filter(Boolean);
  const hasPrice = priceChanged.length > 0;
  const hasRules = ruleChanged.length > 0;
  const onlyVisibility = hidden.length > 0 && !added.length && !returned.length && !availabilityChanged.length && !hasPrice && !renamed.length && !hasRules;
  const onlyAvailability = availabilityChanged.length > 0 && !added.length && !returned.length && !hidden.length && !hasPrice && !renamed.length && !hasRules;
  const onlyReturned = returned.length > 0 && !added.length && !hidden.length && !availabilityChanged.length && !hasPrice && !renamed.length && !hasRules;
  const kind: OptionChangeDetails["kind"] = hasPrice ? "price"
    : hasRules ? "rules"
      : onlyVisibility ? "visibility"
        : onlyAvailability ? "availability"
          : onlyReturned ? "returned"
            : added.length || returned.length || hidden.length || renamed.length ? "catalog"
            : "display";
  const details: OptionChangeDetails = {
    priority: hasPrice || hasRules ? "high" : onlyVisibility || onlyAvailability || onlyReturned || !parts.length ? "low" : "normal",
    kind,
    added: addedLabels,
    returned: returnedLabels,
    hidden: hiddenLabels,
    availabilityChanged,
    priceChanged,
    ruleChanged
  };
  return {
    summary: parts.length ? `${parts.join("。")}。` : "選択肢の並び順または表示情報が変更されました。",
    details
  };
}

function isUberPromotionCategory(category: string) {
  return /^(save on select items|selected items? offer|対象商品.*割引|一部商品.*割引)$/i.test(normalizeWhitespace(category));
}

function nestedText(value: unknown) {
  const texts = new Set<string>();
  function visit(entry: unknown, depth: number) {
    if (!entry || depth > 8) return;
    if (Array.isArray(entry)) {
      for (const child of entry) visit(child, depth + 1);
      return;
    }
    if (typeof entry !== "object") return;
    for (const [key, child] of Object.entries(entry as Record<string, unknown>)) {
      if (["text", "accessibilityText"].includes(key) && typeof child === "string") {
        const text = normalizeWhitespace(child.replace(/<[^>]+>/g, " "));
        if (text) texts.add(text);
      } else {
        visit(child, depth + 1);
      }
    }
  }
  visit(value, 0);
  return [...texts].sort((a, b) => a.localeCompare(b, "ja"));
}

function comparablePromotionDetails(record: Record<string, unknown>) {
  const promoInfo = record.promoInfo && typeof record.promoInfo === "object"
    ? record.promoInfo as Record<string, unknown>
    : null;
  const analytics = record.catalogItemAnalyticsData && typeof record.catalogItemAnalyticsData === "object"
    ? record.catalogItemAnalyticsData as Record<string, unknown>
    : null;
  const priceTagline = record.priceTagline && typeof record.priceTagline === "object"
    ? record.priceTagline as Record<string, unknown>
    : null;
  const format = typeof priceTagline?.textFormat === "string" ? priceTagline.textFormat : "";
  const struckPrice = format.match(/line-through[^>]*>([^<]+)</i)?.[1] ?? "";
  const labels = nestedText(promoInfo?.promoBadge);
  const promoType = normalizeWhitespace(analytics?.promoType);
  const originalPrice = normalizeWhitespace(struckPrice);
  const currentPrice = normalizeWhitespace(priceTagline?.text);
  if (!promoInfo && !promoType && !originalPrice) return {};
  return {
    ...(labels.length ? { labels } : {}),
    ...(promoType ? { promoType } : {}),
    ...(currentPrice ? { currentPrice } : {}),
    ...(originalPrice ? { originalPrice } : {})
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function resolveUrl(value: string, sourceUrl: string) {
  if (!value) return "";
  try {
    return new URL(value, sourceUrl).toString();
  } catch {
    return "";
  }
}

function itemFromRecord(record: Record<string, unknown>, sourceUrl: string): MenuItem | null {
  const name = firstText(record.name, record.title, record.displayName, record.productName, record.itemName);
  if (!name || name.length > 240) return null;
  const offers = record.offers && typeof record.offers === "object" ? record.offers as Record<string, unknown> : {};
  const priceInfo = record.priceInfo && typeof record.priceInfo === "object" ? record.priceInfo as Record<string, unknown> : {};
  const price = numericPrice(record.price) ?? numericPrice(record.basePrice) ?? numericPrice(record.priceAmount)
    ?? numericPrice(offers.price) ?? numericPrice(priceInfo.price);
  const externalId = firstText(record.id, record["@id"], record.productId, record.itemId, record.sku, record.uuid);
  const category = firstText(record.category, record.categoryName, record.sectionName, record.menuSection);
  const description = firstText(record.description, record.itemDescription, record.subtitle);
  const itemUrl = resolveUrl(firstText(record.url, offers.url), sourceUrl);
  const imageUrl = resolveUrl(firstText(record.image, record.imageUrl, record.photo, record.thumbnailUrl), sourceUrl);
  const currency = firstText(record.priceCurrency, offers.priceCurrency, priceInfo.currency) || "JPY";
  const isAvailable = record.isAvailable === false || record.isSoldOut === true ? false : true;
  const normalizedName = normalizeName(name);
  const externalKey = externalId
    ? `id:${normalizeWhitespace(externalId)}`
    : `derived:${hash([normalizedName, normalizeName(category)].join("|"))}`;
  return {
    externalKey,
    name,
    normalizedName,
    category,
    description,
    price,
    currency: currency.slice(0, 12).toUpperCase(),
    itemUrl,
    imageUrl,
    isAvailable,
    details: comparableDetails(record),
    options: comparableOptions(record),
    promotionDetails: comparablePromotionDetails(record),
    rawPayload: record
  };
}

function collectMenuItems(root: unknown, sourceUrl: string) {
  const collected = new Map<string, MenuItem>();
  const visited = new WeakSet<object>();

  function visit(value: unknown, path: string, depth: number) {
    if (!value || depth > 14) return;
    if (Array.isArray(value)) {
      for (const entry of value.slice(0, 2_000)) visit(entry, path, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    if (visited.has(value as object)) return;
    visited.add(value as object);
    const record = value as Record<string, unknown>;
    const schemaType = firstText(record["@type"]).toLowerCase();
    const likelyPath = /(^|[.\[])(product|products|menu|menus|menuitem|menuitems|item|items|dish|dishes)([.\[]|$)/i.test(path);
    const explicitProduct = schemaType.includes("product") || schemaType.includes("menuitem");
    const hasCommercialFields = [record.price, record.basePrice, record.offers, record.priceInfo, record.image, record.imageUrl].some((entry) => entry !== undefined);
    if ((explicitProduct || (likelyPath && hasCommercialFields)) && (record.name || record.title || record.displayName || record.productName)) {
      const item = itemFromRecord(record, sourceUrl);
      if (item && !collected.has(item.externalKey)) collected.set(item.externalKey, item);
    }
    for (const [key, child] of Object.entries(record)) {
      if (["description", "reviews", "aggregateRating"].includes(key)) continue;
      visit(child, path ? `${path}.${key}` : key, depth + 1);
    }
  }

  visit(root, "", 0);
  return [...collected.values()];
}

function collectUberStoreItems(root: unknown, sourceUrl: string) {
  if (!root || typeof root !== "object") return [];
  const response = root as Record<string, unknown>;
  const data = response.data && typeof response.data === "object" ? response.data as Record<string, unknown> : null;
  const catalogSectionsMap = data?.catalogSectionsMap && typeof data.catalogSectionsMap === "object"
    ? data.catalogSectionsMap as Record<string, unknown>
    : null;
  if (!catalogSectionsMap) return [];
  const currency = firstText(data?.currencyCode) || "JPY";
  const items = new Map<string, MenuItem>();
  const promotionSectionByKey = new Map<string, boolean>();
  for (const sectionCollection of Object.values(catalogSectionsMap)) {
    if (!Array.isArray(sectionCollection)) continue;
    for (const section of sectionCollection) {
      if (!section || typeof section !== "object") continue;
      const payload = (section as Record<string, unknown>).payload;
      if (!payload || typeof payload !== "object") continue;
      const standardPayload = (payload as Record<string, unknown>).standardItemsPayload;
      if (!standardPayload || typeof standardPayload !== "object") continue;
      const standard = standardPayload as Record<string, unknown>;
      const titleValue = standard.title && typeof standard.title === "object"
        ? (standard.title as Record<string, unknown>).text
        : standard.title;
      const category = firstText(titleValue);
      const isPromotionSection = Boolean(normalizeWhitespace(standard.promoUUID)) || isUberPromotionCategory(category);
      const catalogItems = Array.isArray(standard.catalogItems) ? standard.catalogItems : [];
      for (const rawItem of catalogItems) {
        if (!rawItem || typeof rawItem !== "object") continue;
        const raw = rawItem as Record<string, unknown>;
        const displayPrice = raw.priceTagline && typeof raw.priceTagline === "object"
          ? (raw.priceTagline as Record<string, unknown>).text
          : null;
        const promotionDetails = comparablePromotionDetails(raw);
        const originalPrice = numericPrice(promotionDetails.originalPrice);
        const item = itemFromRecord({
          ...raw,
          categoryName: category,
          // A campaign price is not a product price change. Track the struck-through
          // original price as the product price and keep the campaign price in promo details.
          price: originalPrice ?? numericPrice(displayPrice) ?? (numericPrice(raw.price) === null ? null : Number(raw.price) / 100),
          priceCurrency: currency,
          url: sourceUrl
        }, sourceUrl);
        if (!item) continue;
        const existing = items.get(item.externalKey);
        const isFeatured = /featured|おすすめ/i.test(category);
        const existingFeatured = existing ? /featured|おすすめ/i.test(existing.category) : false;
        if (!existing) {
          items.set(item.externalKey, isPromotionSection ? { ...item, category: "" } : item);
          promotionSectionByKey.set(item.externalKey, isPromotionSection);
        } else if (isPromotionSection && !promotionSectionByKey.get(item.externalKey)) {
          items.set(item.externalKey, {
            ...existing,
            promotionDetails: Object.keys(item.promotionDetails).length ? item.promotionDetails : existing.promotionDetails,
            rawPayload: Object.keys(item.promotionDetails).length ? item.rawPayload : existing.rawPayload
          });
        } else if (!isPromotionSection && promotionSectionByKey.get(item.externalKey)) {
          items.set(item.externalKey, {
            ...item,
            promotionDetails: Object.keys(item.promotionDetails).length ? item.promotionDetails : existing.promotionDetails
          });
          promotionSectionByKey.set(item.externalKey, false);
        } else if (existingFeatured && !isFeatured) {
          items.set(item.externalKey, item);
        }
      }
    }
  }
  return [...items.values()];
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseMenuItems(body: string, contentType: string, sourceUrl: string) {
  const roots: unknown[] = [];
  if (contentType.includes("json") || /^[\s\n]*[\[{]/.test(body)) {
    try {
      roots.push(JSON.parse(body));
    } catch {
      // Some menu endpoints return HTML while retaining a JSON-like content type.
    }
  }
  const scriptPattern = /<script\b[^>]*type=["'](?:application\/ld\+json|application\/json)["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of body.matchAll(scriptPattern)) {
    try {
      roots.push(JSON.parse(decodeHtmlEntities(match[1]).trim()));
    } catch {
      // Ignore unrelated or non-standard embedded scripts.
    }
  }
  const nextDataMatch = body.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      roots.push(JSON.parse(decodeHtmlEntities(nextDataMatch[1]).trim()));
    } catch {
      // The page can still expose valid JSON-LD.
    }
  }
  const items = new Map<string, MenuItem>();
  for (const root of roots) {
    for (const item of collectUberStoreItems(root, sourceUrl)) items.set(item.externalKey, item);
    for (const item of collectMenuItems(root, sourceUrl)) {
      if (!items.has(item.externalKey)) items.set(item.externalKey, item);
    }
  }
  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

function parseStoreMetrics(body: string) {
  const roots: unknown[] = [];
  try {
    roots.push(JSON.parse(body));
  } catch {
    const scriptPattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    for (const match of body.matchAll(scriptPattern)) {
      try {
        roots.push(JSON.parse(decodeHtmlEntities(match[1]).trim()));
      } catch {
        // Ignore invalid unrelated structured data.
      }
    }
  }
  let rating: number | null = null;
  let reviewCountLabel = "";
  const visited = new WeakSet<object>();
  function visit(value: unknown, depth: number) {
    if (!value || depth > 12 || (rating !== null && reviewCountLabel)) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    if (typeof value !== "object" || visited.has(value as object)) return;
    visited.add(value as object);
    const record = value as Record<string, unknown>;
    const ratingRecord = record.rating && typeof record.rating === "object"
      ? record.rating as Record<string, unknown>
      : record.aggregateRating && typeof record.aggregateRating === "object"
        ? record.aggregateRating as Record<string, unknown>
        : null;
    if (ratingRecord) {
      rating ??= numericPrice(ratingRecord.ratingValue ?? ratingRecord.value);
      reviewCountLabel ||= firstText(ratingRecord.reviewCount, ratingRecord.ratingCount);
    }
    for (const child of Object.values(record)) visit(child, depth + 1);
  }
  for (const root of roots) visit(root, 0);
  const campaigns = new Map<string, { title: string; itemKeys: Set<string>; discountLabels: Set<string> }>();
  let hasStorePromotion = false;
  for (const root of roots) {
    if (!root || typeof root !== "object") continue;
    const rootRecord = root as Record<string, unknown>;
    const data = rootRecord.data && typeof rootRecord.data === "object"
      ? rootRecord.data as Record<string, unknown>
      : rootRecord;
    hasStorePromotion ||= data.hasStorePromotion === true;
    const sectionsMap = data.catalogSectionsMap && typeof data.catalogSectionsMap === "object"
      ? data.catalogSectionsMap as Record<string, unknown>
      : {};
    for (const sectionCollection of Object.values(sectionsMap)) {
      if (!Array.isArray(sectionCollection)) continue;
      for (const section of sectionCollection) {
        if (!section || typeof section !== "object") continue;
        const payload = (section as Record<string, unknown>).payload;
        const standard = payload && typeof payload === "object"
          && (payload as Record<string, unknown>).standardItemsPayload
          && typeof (payload as Record<string, unknown>).standardItemsPayload === "object"
          ? (payload as Record<string, unknown>).standardItemsPayload as Record<string, unknown>
          : null;
        if (!standard || !normalizeWhitespace(standard.promoUUID)) continue;
        const titleRecord = standard.title && typeof standard.title === "object"
          ? standard.title as Record<string, unknown>
          : null;
        const title = firstText(titleRecord?.text, standard.title) || "割引対象商品";
        const catalogItems = Array.isArray(standard.catalogItems) ? standard.catalogItems : [];
        const discountLabels = catalogItems.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const details = comparablePromotionDetails(item as Record<string, unknown>);
          return Array.isArray(details.labels) ? details.labels.map(String) : [];
        });
        const campaign = campaigns.get(title) ?? { title, itemKeys: new Set<string>(), discountLabels: new Set<string>() };
        for (const item of catalogItems) {
          if (!item || typeof item !== "object") continue;
          const itemRecord = item as Record<string, unknown>;
          campaign.itemKeys.add(firstText(itemRecord.uuid, itemRecord.id, itemRecord.title));
        }
        for (const label of discountLabels) campaign.discountLabels.add(label);
        campaigns.set(title, campaign);
      }
    }
  }
  const promotions = {
    active: hasStorePromotion || campaigns.size > 0,
    campaigns: [...campaigns.values()].map((campaign) => ({
      title: campaign.title,
      itemCount: campaign.itemKeys.size,
      discountLabels: [...campaign.discountLabels].sort((a, b) => a.localeCompare(b, "ja"))
    })).sort((a, b) => a.title.localeCompare(b.title, "ja"))
  };
  return { rating, reviewCountLabel, promotions };
}

function uberStoreUuid(sourceUrl: string) {
  const url = new URL(sourceUrl);
  if (url.hostname !== "www.ubereats.com" && url.hostname !== "ubereats.com") return "";
  const token = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
  try {
    const hex = Buffer.from(token, "base64url").toString("hex");
    if (hex.length !== 32) return "";
    return hex.replace(/^(........)(....)(....)(....)(............)$/, "$1-$2-$3-$4-$5");
  } catch {
    return "";
  }
}

async function fetchUberMenu(sourceUrl: string) {
  await validatePublicUrl(sourceUrl);
  const storeUuid = uberStoreUuid(sourceUrl);
  if (!storeUuid) throw new Error("Uber Eats の店舗IDをURLから確認できませんでした。");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch("https://www.ubereats.com/_p/api/getStoreV1?localeCode=ja-JP", {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "x",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"
      },
      body: JSON.stringify({ storeUuid, diningMode: "DELIVERY" })
    });
    if (!response.ok) throw new Error(`Uber Eats メニューを取得できませんでした（HTTP ${response.status}）。`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxResponseBytes) throw new Error("Uber Eats メニューのデータ量が上限を超えています。");
    const body = new TextDecoder().decode(buffer);
    const parsed = JSON.parse(body) as { status?: unknown };
    if (parsed.status !== "success") throw new Error("Uber Eats からメニューが返されませんでした。");
    return { body, contentType: "application/json", finalUrl: sourceUrl };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Uber Eats メニューの読み込みがタイムアウトしました。");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchUberItemDetails(storeUuid: string, item: MenuItem) {
  const raw = item.rawPayload;
  const menuItemUuid = firstText(raw.uuid, raw.id, item.externalKey.replace(/^id:/, ""));
  const sectionUuid = firstText(raw.sectionUuid);
  const subsectionUuid = firstText(raw.subsectionUuid);
  if (!menuItemUuid || !sectionUuid || !subsectionUuid) throw new Error("商品オプションの読取IDが不足しています。");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch("https://www.ubereats.com/_p/api/getMenuItemV1?localeCode=ja-JP", {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "x",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"
      },
      body: JSON.stringify({
        itemRequestType: "ITEM",
        storeUuid,
        sectionUuid,
        subsectionUuid,
        menuItemUuid,
        diningMode: "DELIVERY",
        cbType: "EATER_ENDORSED"
      })
    });
    if (!response.ok) throw new Error(`商品オプションを取得できませんでした（HTTP ${response.status}）。`);
    const result = await response.json() as { status?: unknown; data?: unknown };
    if (result.status !== "success" || !result.data || typeof result.data !== "object") {
      throw new Error("商品オプションが返されませんでした。");
    }
    return result.data as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

async function hydrateUberOptions(items: MenuItem[], sourceUrl: string, previousByKey: Map<string, PreviousItem>) {
  const storeUuid = uberStoreUuid(sourceUrl);
  if (!storeUuid) return items;
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      const previous = previousByKey.get(item.externalKey);
      if (item.rawPayload.hasCustomizations !== true) {
        item.rawPayload = { ...item.rawPayload, customizationsList: [], _optionDetailsLoaded: true };
      } else {
        try {
          const detail = await fetchUberItemDetails(storeUuid, item);
          item.rawPayload = {
            ...item.rawPayload,
            customizationsList: Array.isArray(detail.customizationsList) ? detail.customizationsList : [],
            _optionDetailsLoaded: true
          };
        } catch {
          // A temporary detail-endpoint failure must not look like every option was removed.
          if (previous && optionDetailsLoaded(previous.rawPayload)) {
            item.rawPayload = {
              ...item.rawPayload,
              customizationsList: previous.rawPayload.customizationsList,
              _optionDetailsLoaded: true
            };
          } else {
            item.rawPayload = { ...item.rawPayload, _optionDetailsLoaded: false };
          }
        }
      }
      item.details = comparableDetails(item.rawPayload);
      item.options = comparableOptions(item.rawPayload);
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, () => worker()));
  return items;
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc")
    || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9")
    || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("::ffff:127.")
    || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
}

async function validatePublicUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("メニューURLが正しくありません。");
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("http または https のURLを指定してください。");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local")) throw new Error("公開されているメニューURLを指定してください。");
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("公開ネットワーク上のメニューURLを指定してください。");
  }
  return url;
}

async function fetchPublicMenu(input: string) {
  let url = await validatePublicUrl(input);
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(url, {
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/json;q=0.9,*/*;q=0.7",
          "User-Agent": "Foundr1OS-CompetitorMenuMonitor/1.0 (+https://foundr1.jp)"
        }
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirect === maxRedirects) throw new Error("メニューページの転送先を確認できませんでした。");
        url = await validatePublicUrl(new URL(location, url).toString());
        continue;
      }
      if (!response.ok) throw new Error(`メニューページを取得できませんでした（HTTP ${response.status}）。`);
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > maxResponseBytes) throw new Error("メニューページのデータ量が上限を超えています。");
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > maxResponseBytes) throw new Error("メニューページのデータ量が上限を超えています。");
      return {
        body: new TextDecoder().decode(buffer),
        contentType: response.headers.get("content-type") ?? "",
        finalUrl: url.toString()
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("メニューページの読み込みがタイムアウトしました。");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("メニューページを取得できませんでした。");
}

function publicItemValue(item: MenuItem | PreviousItem) {
  const details = "details" in item ? item.details : comparableDetails(item.rawPayload);
  const options = "options" in item ? item.options : comparableOptions(item.rawPayload);
  const promotionDetails = "promotionDetails" in item ? item.promotionDetails : comparablePromotionDetails(item.rawPayload);
  return {
    name: item.name,
    category: item.category,
    description: item.description,
    price: item.price,
    currency: item.currency,
    itemUrl: item.itemUrl,
    imageUrl: item.imageUrl,
    isAvailable: item.isAvailable,
    details,
    options,
    promotionDetails
  };
}

function formatPrice(price: number | null, currency: string) {
  if (price === null) return "価格不明";
  if (currency === "JPY") return `¥${new Intl.NumberFormat("ja-JP").format(price)}`;
  return `${currency} ${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(price)}`;
}

function itemPromotionChangeSummary(previous: PreviousItem, current: MenuItem) {
  const previousPromotion = comparablePromotionDetails(previous.rawPayload);
  const currentPromotion = current.promotionDetails;
  const currentDiscountPrice = numericPrice(currentPromotion.currentPrice);
  const previousDiscountPrice = numericPrice(previousPromotion.currentPrice);
  const basePriceSame = previous.price !== null && current.price !== null && previous.price === current.price;
  const basePriceText = current.price === null ? "通常価格は不明" : `通常価格は${formatPrice(current.price, current.currency)}`;
  const baseRelation = basePriceSame ? `${basePriceText}で前回から変更なし` : previous.price !== null && current.price !== null
    ? `通常価格は${formatPrice(previous.price, previous.currency)}から${formatPrice(current.price, current.currency)}に変更`
    : basePriceText;
  const discountRate = current.price && currentDiscountPrice !== null
    ? Math.round((1 - currentDiscountPrice / current.price) * 1_000) / 10
    : null;
  const discountText = currentDiscountPrice === null
    ? "割引"
    : `${formatPrice(currentDiscountPrice, current.currency)}${discountRate !== null && discountRate > 0 ? `（${discountRate}%OFF）` : ""}`;

  if (!Object.keys(previousPromotion).length && Object.keys(currentPromotion).length) {
    return `${baseRelation}、${discountText}の割引が開始されました。`;
  }
  if (Object.keys(previousPromotion).length && !Object.keys(currentPromotion).length) {
    return `${baseRelation}、割引が終了しました。`;
  }
  if (previousDiscountPrice !== null && currentDiscountPrice !== null && previousDiscountPrice !== currentDiscountPrice) {
    return `${baseRelation}、割引価格が${formatPrice(previousDiscountPrice, previous.currency)}から${discountText}に変わりました。`;
  }
  return `${baseRelation}、割引・キャンペーン内容が変更されました。`;
}

function consolidateSharedOptionChanges(changes: Change[]) {
  const optionGroups = new Map<string, Change[]>();
  for (const change of changes) {
    if (change.type !== "options_changed") continue;
    const signature = stableJson({
      optionChangeDetails: change.currentValue.optionChangeDetails
    });
    optionGroups.set(signature, [...(optionGroups.get(signature) ?? []), change]);
  }
  const duplicateChanges = new Set<Change>();
  for (const group of optionGroups.values()) {
    if (group.length < 2) continue;
    const [first, ...duplicates] = group;
    const affectedProducts = group.map((change) => change.title);
    const details = first.currentValue.optionChangeDetails as OptionChangeDetails;
    if (details.hidden.length === 1 && !details.added.length && !details.returned.length && !details.availabilityChanged.length && !details.priceChanged.length && !details.ruleChanged.length) {
      first.title = `共通選択肢が1件非表示`;
      first.summary = `共通選択肢が1件、メニューから非表示になりました：${details.hidden[0]}。`;
    } else {
      first.title = `共通選択内容の変更`;
      first.summary = `${first.summary} ${group.length}商品で共通する1件の変更として記録しました。`;
    }
    first.currentValue = {
      ...first.currentValue,
      optionChangeDetails: {
        ...(first.currentValue.optionChangeDetails as OptionChangeDetails),
        affectedProducts
      }
    };
    for (const duplicate of duplicates) duplicateChanges.add(duplicate);
  }
  return changes.filter((change) => !duplicateChanges.has(change));
}

async function notifyNewProducts(source: SourceRow, changes: Change[]) {
  const newProducts = changes.filter((change) => change.type === "new_product");
  if (!newProducts.length) return;
  const recipients = await sql`
    select id::text, coalesce(lark_open_id, '') as "larkOpenId", coalesce(lark_user_id, '') as "larkUserId"
    from employees
    where role = 'owner' and status = 'active'
  `;
  const title = `競合店「${source.competitorName}」で新商品を検出`;
  const summary = newProducts.slice(0, 3).map((change) => {
    const current = change.currentValue as { name?: unknown; price?: unknown; currency?: unknown };
    return `${String(current.name ?? change.title)}（${formatPrice(typeof current.price === "number" ? current.price : null, String(current.currency ?? "JPY"))}）`;
  }).join("、");
  const message = `${summary}${newProducts.length > 3 ? ` ほか${newProducts.length - 3}件` : ""}`;
  const href = `/os/analytics/competitors?source=${encodeURIComponent(source.id)}`;
  await Promise.all(recipients.map(async (recipient) => {
    await createOsNotification({
      employeeId: String(recipient.id),
      type: "competitor_new_product",
      title,
      message,
      href,
      sourceKey: `competitor-new-product:${source.id}:${hash(newProducts.map((change) => change.externalKey).sort().join("|"))}`
    });
    await sendLarkTextMessage({
      larkOpenId: String(recipient.larkOpenId || "") || null,
      larkUserId: String(recipient.larkUserId || "") || null
    }, `${title}\n${message}\nFoundr1 OSで確認：${href}`);
  }));
}

export async function scanCompetitorMenuSource(sourceId: string, triggerType: "scheduled" | "manual" | "system" = "scheduled") {
  const sourceRows = await sql`
    select id::text, competitor_name as "competitorName", source_name as "sourceName",
      source_url as "sourceUrl", source_type as "sourceType", last_rating::float as "lastRating",
      last_review_count_label as "lastReviewCountLabel", last_promotions as "lastPromotions"
    from competitor_menu_sources
    where id::text = ${sourceId}
    limit 1
  ` as SourceRow[];
  const source = sourceRows[0];
  if (!source) throw new Error("監視先が見つかりません。");
  const runRows = await sql`
    insert into competitor_menu_scan_runs (source_id, trigger_type)
    values (${source.id}, ${triggerType}) returning id::text
  `;
  const runId = String(runRows[0].id);

  try {
    const [{ body, contentType, finalUrl }, previousRows, snapshotCountRows, optionHistoryRows] = await Promise.all([
      source.sourceType === "uber_eats" ? fetchUberMenu(source.sourceUrl) : fetchPublicMenu(source.sourceUrl),
      sql`
        select id::text, external_key as "externalKey", name, normalized_name as "normalizedName",
          category, description, price::float as price, currency, item_url as "itemUrl", image_url as "imageUrl",
          is_available as "isAvailable", raw_payload as "rawPayload", is_present as "isPresent"
        from competitor_menu_items where source_id = ${source.id}
      `,
      sql`select count(*)::int as count from competitor_menu_snapshots where source_id = ${source.id}`,
      sql`
        select title, current_value #> '{optionChangeDetails}' as details
        from competitor_menu_changes
        where source_id = ${source.id}
          and change_type = 'options_changed'
        order by detected_at
      `
    ]);
    let items = parseMenuItems(body, contentType, finalUrl);
    const storeMetrics = parseStoreMetrics(body);
    if (!items.length) {
      throw new Error("商品データを検出できませんでした。公開メニューのURL、または専用読取方式の設定を確認してください。");
    }
    const baseline = Number(snapshotCountRows[0]?.count ?? 0) === 0;
    const typedPreviousRows = previousRows as PreviousItem[];
    const historicallySeenOptionsByProduct = new Map<string, Set<string>>();
    const historicalOptionPricesByProduct = new Map<string, Map<string, number>>();
    const rememberOptions = (productName: string, value: Record<string, unknown>) => {
      const key = normalizeName(productName);
      if (!key) return;
      const known = historicallySeenOptionsByProduct.get(key) ?? new Set<string>();
      const prices = historicalOptionPricesByProduct.get(key) ?? new Map<string, number>();
      for (const option of optionSnapshot(value).options) {
        known.add(`id:${option.id}`);
        known.add(`title:${normalizeName(option.title)}`);
        prices.set(normalizeName(option.title), option.price);
      }
      historicallySeenOptionsByProduct.set(key, known);
      historicalOptionPricesByProduct.set(key, prices);
    };
    for (const previous of typedPreviousRows) {
      rememberOptions(previous.name, comparableOptions(previous.rawPayload));
    }
    for (const historyRow of optionHistoryRows as Array<Record<string, unknown>>) {
      const optionDetails = objectValue(historyRow.details);
      const affectedProducts = Array.isArray(optionDetails.affectedProducts)
        ? optionDetails.affectedProducts.map(String)
        : [String(historyRow.title ?? "")];
      const historicalLabels = [
        ...(Array.isArray(optionDetails.added) ? optionDetails.added : []),
        ...(Array.isArray(optionDetails.returned) ? optionDetails.returned : []),
        ...(Array.isArray(optionDetails.hidden) ? optionDetails.hidden : [])
      ].map(String);
      for (const productName of affectedProducts) {
        const key = normalizeName(productName);
        if (!key) continue;
        const known = historicallySeenOptionsByProduct.get(key) ?? new Set<string>();
        const prices = historicalOptionPricesByProduct.get(key) ?? new Map<string, number>();
        for (const label of historicalLabels) {
          const title = label.replace(/（(?:\+¥[\d,]+|無料)）$/, "");
          if (title) {
            const normalizedTitle = normalizeName(title);
            known.add(`title:${normalizedTitle}`);
            const priceText = label.match(/（(?:\+¥([\d,]+)|無料)）$/)?.[1];
            prices.set(normalizedTitle, priceText ? Number(priceText.replace(/,/g, "")) : 0);
          }
        }
        historicallySeenOptionsByProduct.set(key, known);
        historicalOptionPricesByProduct.set(key, prices);
      }
    }
    const previousByKey = new Map(typedPreviousRows.map((item) => [item.externalKey, item]));
    const previousByIdentity = new Map<string, PreviousItem>();
    for (const previous of typedPreviousRows) {
      const identity = canonicalCompetitorProductIdentity(previous.externalKey);
      const existing = previousByIdentity.get(identity);
      if (!existing || (!existing.isPresent && previous.isPresent)) previousByIdentity.set(identity, previous);
    }
    if (source.sourceType === "uber_eats") {
      const previousLookup = new Map(previousByKey);
      for (const [identity, previous] of previousByIdentity) {
        previousLookup.set(identity, previous);
        previousLookup.set(`id:${identity}`, previous);
      }
      items = await hydrateUberOptions(items, source.sourceUrl, previousLookup);
    }
    // Some imported baselines used the bare Uber UUID while the live API uses
    // `id:<UUID>`. Preserve the existing key so one product cannot become a
    // false new-product + removed-product pair when the prefix changes.
    for (const item of items) {
      if (previousByKey.has(item.externalKey)) continue;
      const previous = previousByIdentity.get(canonicalCompetitorProductIdentity(item.externalKey));
      if (previous) item.externalKey = previous.externalKey;
    }
    // Uber's campaign shelf is a duplicate display location, not the product's
    // category. If it is the only section returned temporarily, retain the last
    // real category instead of recording a false category change.
    for (const item of items) {
      if (item.category && !isUberPromotionCategory(item.category)) continue;
      const previous = previousByKey.get(item.externalKey) ?? previousByIdentity.get(canonicalCompetitorProductIdentity(item.externalKey));
      if (previous?.category && !isUberPromotionCategory(previous.category)) item.category = previous.category;
    }
    const currentByKey = new Map(items.map((item) => [item.externalKey, item]));
    const currentIdentities = new Set(items.map((item) => canonicalCompetitorProductIdentity(item.externalKey)));
    const changes: Change[] = [];

    if (!baseline) {
      if (source.lastRating !== null && storeMetrics.rating !== null && source.lastRating !== storeMetrics.rating) {
        changes.push({
          type: "store_rating_changed", externalKey: `store:${source.id}`, title: source.competitorName,
          summary: `店舗評価が ${source.lastRating} から ${storeMetrics.rating} に変わりました。`,
          previousValue: { rating: source.lastRating, reviewCount: source.lastReviewCountLabel, itemUrl: source.sourceUrl },
          currentValue: { rating: storeMetrics.rating, reviewCount: storeMetrics.reviewCountLabel, itemUrl: source.sourceUrl }
        });
      }
      if (source.lastReviewCountLabel && storeMetrics.reviewCountLabel && source.lastReviewCountLabel !== storeMetrics.reviewCountLabel) {
        changes.push({
          type: "store_review_count_changed", externalKey: `store:${source.id}`, title: source.competitorName,
          summary: `評価件数が ${source.lastReviewCountLabel} から ${storeMetrics.reviewCountLabel} に変わりました。`,
          previousValue: { rating: source.lastRating, reviewCount: source.lastReviewCountLabel, itemUrl: source.sourceUrl },
          currentValue: { rating: storeMetrics.rating, reviewCount: storeMetrics.reviewCountLabel, itemUrl: source.sourceUrl }
        });
      }
      if (source.lastPromotions !== null && stableJson(source.lastPromotions) !== stableJson(storeMetrics.promotions)) {
        changes.push({
          type: "store_promotion_changed", externalKey: `store:${source.id}`, title: source.competitorName,
          summary: "店舗の割引・キャンペーン内容が変更されました。",
          previousValue: { promotions: source.lastPromotions, itemUrl: source.sourceUrl },
          currentValue: { promotions: storeMetrics.promotions, itemUrl: source.sourceUrl }
        });
      }
      for (const item of items) {
        const previous = previousByKey.get(item.externalKey) ?? previousByIdentity.get(canonicalCompetitorProductIdentity(item.externalKey));
        if (!previous) {
          changes.push({ type: "new_product", externalKey: item.externalKey, title: item.name, summary: `${formatPrice(item.price, item.currency)}で新しく掲載されました。`, previousValue: {}, currentValue: publicItemValue(item) });
          continue;
        }
        if (!previous.isPresent) {
          changes.push({ type: "returned", externalKey: item.externalKey, title: item.name, summary: "メニューへの掲載が再開されました。", previousValue: publicItemValue(previous), currentValue: publicItemValue(item) });
        }
        if (previous.name !== item.name) {
          changes.push({ type: "renamed", externalKey: item.externalKey, title: item.name, summary: `「${previous.name}」から名称が変わりました。`, previousValue: publicItemValue(previous), currentValue: publicItemValue(item) });
        }
        if (previous.price !== null && item.price !== null && previous.price !== item.price) {
          changes.push({ type: "price_changed", externalKey: item.externalKey, title: item.name, summary: `${formatPrice(previous.price, previous.currency)}から${formatPrice(item.price, item.currency)}に変わりました。`, previousValue: publicItemValue(previous), currentValue: publicItemValue(item) });
        }
        if (previous.category !== item.category) {
          changes.push({ type: "category_changed", externalKey: item.externalKey, title: item.name, summary: `分類が「${previous.category || "未設定"}」から「${item.category || "未設定"}」に変わりました。`, previousValue: publicItemValue(previous), currentValue: publicItemValue(item) });
        }
        if (normalizeWhitespace(previous.description) !== normalizeWhitespace(item.description)) {
          changes.push({ type: "description_changed", externalKey: item.externalKey, title: item.name, summary: "商品説明が変更されました。", previousValue: publicItemValue(previous), currentValue: publicItemValue(item) });
        }
        if (previous.imageUrl !== item.imageUrl) {
          changes.push({ type: "image_changed", externalKey: item.externalKey, title: item.name, summary: "商品画像が変更されました。", previousValue: publicItemValue(previous), currentValue: publicItemValue(item) });
        }
        if (previous.isAvailable !== item.isAvailable) {
          changes.push({ type: "availability_changed", externalKey: item.externalKey, title: item.name, summary: item.isAvailable ? "販売が再開されました。" : "売り切れ・販売停止になりました。", previousValue: publicItemValue(previous), currentValue: publicItemValue(item) });
        }
        if (stableJson(comparableDetails(previous.rawPayload)) !== stableJson(item.details)) {
          changes.push({ type: "details_changed", externalKey: item.externalKey, title: item.name, summary: "商品の仕様・表示情報が変更されました。", previousValue: publicItemValue(previous), currentValue: publicItemValue(item) });
        }
        if (optionDetailsLoaded(previous.rawPayload) && optionDetailsLoaded(item.rawPayload)
          && stableJson(comparableOptions(previous.rawPayload)) !== stableJson(item.options)) {
          const seenOptionIds = new Set([
            ...(historicallySeenOptionsByProduct.get(normalizeName(previous.name)) ?? []),
            ...(historicallySeenOptionsByProduct.get(normalizeName(item.name)) ?? [])
          ]);
          const historicalPrices = new Map([
            ...(historicalOptionPricesByProduct.get(normalizeName(previous.name)) ?? []),
            ...(historicalOptionPricesByProduct.get(normalizeName(item.name)) ?? [])
          ]);
          const optionChange = describeOptionChanges(
            comparableOptions(previous.rawPayload),
            item.options,
            seenOptionIds,
            historicalPrices
          );
          changes.push({
            type: "options_changed",
            externalKey: item.externalKey,
            title: item.name,
            summary: optionChange.summary,
            previousValue: publicItemValue(previous),
            currentValue: { ...publicItemValue(item), optionChangeDetails: optionChange.details }
          });
        }
        if (stableJson(comparablePromotionDetails(previous.rawPayload)) !== stableJson(item.promotionDetails)) {
          changes.push({ type: "item_promotion_changed", externalKey: item.externalKey, title: item.name, summary: itemPromotionChangeSummary(previous, item), previousValue: publicItemValue(previous), currentValue: publicItemValue(item) });
        }
      }
      const safeCompleteSnapshot = typedPreviousRows.length === 0 || items.length >= Math.max(1, Math.floor(typedPreviousRows.length * 0.7));
      if (safeCompleteSnapshot) {
        for (const previous of typedPreviousRows) {
          if (previous.isPresent && !currentByKey.has(previous.externalKey)
            && !currentIdentities.has(canonicalCompetitorProductIdentity(previous.externalKey))) {
            changes.push({ type: "removed", externalKey: previous.externalKey, title: previous.name, summary: "メニューから掲載がなくなりました。", previousValue: publicItemValue(previous), currentValue: {} });
          }
        }
      }
    }

    const recordedChanges = consolidateSharedOptionChanges(changes);

    const payload = items.map((item) => ({
      externalKey: item.externalKey,
      name: item.name,
      normalizedName: item.normalizedName,
      category: item.category,
      description: item.description,
      price: item.price,
      currency: item.currency,
      itemUrl: item.itemUrl,
      imageUrl: item.imageUrl,
      isAvailable: item.isAvailable,
      rawPayload: item.rawPayload
    }));
    const contentHash = hash(JSON.stringify(payload.map(({ rawPayload: _rawPayload, ...item }) => item)));
    await sql`
      insert into competitor_menu_snapshots (source_id, scan_run_id, content_hash, item_count, payload)
      values (${source.id}, ${runId}, ${contentHash}, ${items.length}, ${JSON.stringify(payload)}::jsonb)
      on conflict (source_id, content_hash) do nothing
    `;
    await sql`
      insert into competitor_menu_items (
        source_id, external_key, name, normalized_name, category, description, price, currency,
        item_url, image_url, is_available, raw_payload, is_present, last_seen_at, missing_at, updated_at
      )
      select ${source.id}, x."externalKey", x.name, x."normalizedName", x.category, x.description, x.price,
        x.currency, x."itemUrl", x."imageUrl", x."isAvailable", x."rawPayload", true, now(), null, now()
      from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as x(
        "externalKey" text, name text, "normalizedName" text, category text, description text, price numeric,
        currency text, "itemUrl" text, "imageUrl" text, "isAvailable" boolean, "rawPayload" jsonb
      )
      on conflict (source_id, external_key) do update set
        name = excluded.name, normalized_name = excluded.normalized_name, category = excluded.category,
        description = excluded.description,
        price = excluded.price, currency = excluded.currency, item_url = excluded.item_url,
        image_url = excluded.image_url, is_available = excluded.is_available,
        raw_payload = excluded.raw_payload, is_present = true,
        last_seen_at = now(), missing_at = null, updated_at = now()
    `;
    const removedKeys = recordedChanges.filter((change) => change.type === "removed").map((change) => change.externalKey);
    for (const key of removedKeys) {
      await sql`
        update competitor_menu_items set is_present = false, missing_at = now(), updated_at = now()
        where source_id = ${source.id} and external_key = ${key} and is_present = true
      `;
    }
    for (const change of recordedChanges) {
      const itemRows = await sql`
        select id::text from competitor_menu_items where source_id = ${source.id} and external_key = ${change.externalKey} limit 1
      `;
      await sql`
        insert into competitor_menu_changes (
          source_id, item_id, change_type, title, summary, previous_value, current_value
        ) values (
          ${source.id}, ${itemRows[0]?.id ?? null}, ${change.type}, ${change.title}, ${change.summary},
          ${JSON.stringify(change.previousValue)}::jsonb, ${JSON.stringify(change.currentValue)}::jsonb
        )
      `;
    }
    await notifyNewProducts(source, recordedChanges);
    await sql`
      update competitor_menu_changes set notified_at = now()
      where source_id = ${source.id} and notified_at is null
        and detected_at >= (select started_at from competitor_menu_scan_runs where id = ${runId})
    `;
    await Promise.all([
      sql`
        update competitor_menu_scan_runs set status = 'succeeded', item_count = ${items.length},
          new_item_count = ${recordedChanges.filter((change) => change.type === "new_product").length},
          change_count = ${recordedChanges.length}, completed_at = now() where id = ${runId}
      `,
      sql`
        update competitor_menu_sources set last_scanned_at = now(), last_success_at = now(),
          last_rating = ${storeMetrics.rating}, last_review_count_label = ${storeMetrics.reviewCountLabel},
          last_promotions = ${JSON.stringify(storeMetrics.promotions)}::jsonb,
          last_error = '', updated_at = now() where id = ${source.id}
      `
    ]);
    return { ok: true, sourceId: source.id, baseline, itemCount: items.length, changeCount: recordedChanges.length, newItemCount: recordedChanges.filter((change) => change.type === "new_product").length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "メニューの読取に失敗しました。";
    await Promise.all([
      sql`update competitor_menu_scan_runs set status = 'failed', error_detail = ${message}, completed_at = now() where id = ${runId}`,
      sql`update competitor_menu_sources set last_scanned_at = now(), last_error = ${message}, updated_at = now() where id = ${source.id}`
    ]);
    return { ok: false, sourceId: source.id, error: message };
  }
}

export async function scanAllActiveCompetitorMenus() {
  const rows = await sql`select id::text from competitor_menu_sources where is_active = true order by created_at`;
  const results = [];
  for (const row of rows) results.push(await scanCompetitorMenuSource(String(row.id), "scheduled"));
  return { ok: results.every((result) => result.ok), scanned: results.length, results };
}
