import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { sql } from "./db";
import { sendLarkTextMessage } from "./lark";
import { createOsNotification } from "./web-push";

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
  type: "new_product" | "price_changed" | "renamed" | "category_changed" | "description_changed" | "image_changed" | "availability_changed" | "details_changed" | "item_promotion_changed" | "store_rating_changed" | "store_review_count_changed" | "store_promotion_changed" | "returned" | "removed";
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
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function comparableDetails(record: Record<string, unknown>) {
  const keys = [
    "customizationsList", "modifierGroups", "modifier_groups", "modifiers", "options",
    "optionGroups", "option_groups", "variations", "variants", "sizes", "tags",
    "dietaryInfo", "dietaryLabels", "allergens", "hasCustomizations", "numAlcoholicItems"
  ];
  return Object.fromEntries(keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
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
      const catalogItems = Array.isArray(standard.catalogItems) ? standard.catalogItems : [];
      for (const rawItem of catalogItems) {
        if (!rawItem || typeof rawItem !== "object") continue;
        const raw = rawItem as Record<string, unknown>;
        const displayPrice = raw.priceTagline && typeof raw.priceTagline === "object"
          ? (raw.priceTagline as Record<string, unknown>).text
          : null;
        const item = itemFromRecord({
          ...raw,
          categoryName: category,
          price: numericPrice(displayPrice) ?? (numericPrice(raw.price) === null ? null : Number(raw.price) / 100),
          priceCurrency: currency,
          url: sourceUrl
        }, sourceUrl);
        if (!item) continue;
        const existing = items.get(item.externalKey);
        const isFeatured = /featured|おすすめ/i.test(category);
        const existingFeatured = existing ? /featured|おすすめ/i.test(existing.category) : false;
        const isPromotional = Boolean(normalizeWhitespace(standard.promoUUID)) || Object.keys(item.promotionDetails).length > 0;
        const existingPromotional = existing ? Object.keys(existing.promotionDetails).length > 0 : false;
        if (!existing) {
          items.set(item.externalKey, item);
        } else if (isPromotional && !existingPromotional) {
          items.set(item.externalKey, { ...item, category: existing.category });
        } else if (!isPromotional && existingPromotional) {
          items.set(item.externalKey, { ...existing, category: item.category });
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
    promotionDetails
  };
}

function formatPrice(price: number | null, currency: string) {
  if (price === null) return "価格不明";
  if (currency === "JPY") return `¥${new Intl.NumberFormat("ja-JP").format(price)}`;
  return `${currency} ${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(price)}`;
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
    const [{ body, contentType, finalUrl }, previousRows, snapshotCountRows] = await Promise.all([
      source.sourceType === "uber_eats" ? fetchUberMenu(source.sourceUrl) : fetchPublicMenu(source.sourceUrl),
      sql`
        select id::text, external_key as "externalKey", name, normalized_name as "normalizedName",
          category, description, price::float as price, currency, item_url as "itemUrl", image_url as "imageUrl",
          is_available as "isAvailable", raw_payload as "rawPayload", is_present as "isPresent"
        from competitor_menu_items where source_id = ${source.id}
      `,
      sql`select count(*)::int as count from competitor_menu_snapshots where source_id = ${source.id}`
    ]);
    const items = parseMenuItems(body, contentType, finalUrl);
    const storeMetrics = parseStoreMetrics(body);
    if (!items.length) {
      throw new Error("商品データを検出できませんでした。公開メニューのURL、または専用読取方式の設定を確認してください。");
    }
    const baseline = Number(snapshotCountRows[0]?.count ?? 0) === 0;
    const typedPreviousRows = previousRows as PreviousItem[];
    const previousByKey = new Map(typedPreviousRows.map((item) => [item.externalKey, item]));
    const currentByKey = new Map(items.map((item) => [item.externalKey, item]));
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
        const previous = previousByKey.get(item.externalKey);
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
          changes.push({ type: "details_changed", externalKey: item.externalKey, title: item.name, summary: "オプション・仕様などの商品詳細が変更されました。", previousValue: publicItemValue(previous), currentValue: publicItemValue(item) });
        }
        if (stableJson(comparablePromotionDetails(previous.rawPayload)) !== stableJson(item.promotionDetails)) {
          changes.push({ type: "item_promotion_changed", externalKey: item.externalKey, title: item.name, summary: "商品の割引・キャンペーン内容が変更されました。", previousValue: publicItemValue(previous), currentValue: publicItemValue(item) });
        }
      }
      const safeCompleteSnapshot = typedPreviousRows.length === 0 || items.length >= Math.max(1, Math.floor(typedPreviousRows.length * 0.7));
      if (safeCompleteSnapshot) {
        for (const previous of typedPreviousRows) {
          if (previous.isPresent && !currentByKey.has(previous.externalKey)) {
            changes.push({ type: "removed", externalKey: previous.externalKey, title: previous.name, summary: "メニューから掲載がなくなりました。", previousValue: publicItemValue(previous), currentValue: {} });
          }
        }
      }
    }

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
    const removedKeys = changes.filter((change) => change.type === "removed").map((change) => change.externalKey);
    for (const key of removedKeys) {
      await sql`
        update competitor_menu_items set is_present = false, missing_at = now(), updated_at = now()
        where source_id = ${source.id} and external_key = ${key} and is_present = true
      `;
    }
    for (const change of changes) {
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
    await notifyNewProducts(source, changes);
    await sql`
      update competitor_menu_changes set notified_at = now()
      where source_id = ${source.id} and notified_at is null
        and detected_at >= (select started_at from competitor_menu_scan_runs where id = ${runId})
    `;
    await Promise.all([
      sql`
        update competitor_menu_scan_runs set status = 'succeeded', item_count = ${items.length},
          new_item_count = ${changes.filter((change) => change.type === "new_product").length},
          change_count = ${changes.length}, completed_at = now() where id = ${runId}
      `,
      sql`
        update competitor_menu_sources set last_scanned_at = now(), last_success_at = now(),
          last_rating = ${storeMetrics.rating}, last_review_count_label = ${storeMetrics.reviewCountLabel},
          last_promotions = ${JSON.stringify(storeMetrics.promotions)}::jsonb,
          last_error = '', updated_at = now() where id = ${source.id}
      `
    ]);
    return { ok: true, sourceId: source.id, baseline, itemCount: items.length, changeCount: changes.length, newItemCount: changes.filter((change) => change.type === "new_product").length };
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
