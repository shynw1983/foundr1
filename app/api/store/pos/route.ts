import { getTodaySummary } from "../../../../lib/pos-daily-summary-data";
import { rejectDebugWrite } from '../../../../lib/pos-debug-write';
import { validateInvoiceDetails } from '../../../../lib/pos-invoice';
import { isPosOptionAllowed } from '../../../../lib/pos-option-dependencies';
import { createPosOptionGift } from "../../../../lib/pos-option-gifts";
import { evaluatePosBowlBenefits, matchesPosBowlQuote, type PosBowlChoice } from "../../../../lib/pos-bowl-benefits";
import { normalizePosCampaignFields, evaluatePosDiscounts, matchesPosDiscountQuote, type PosCampaignFields } from "../../../../lib/pos-discount-campaigns";
import { normalizePosItemPricing, resolvePosItemPricingMode, type PosItemPricingInput } from '../../../../lib/pos-item-pricing';
import { buildPosPrintDocumentSnapshots } from '../../../../lib/pos-print-document-builder';
import { posPrintSnapshotWrites, readPosCheckoutPrintDocuments } from '../../../../lib/pos-print-document-ledger';
import type { PosPrintMode } from '../../../../lib/pos-print-document-contract';
import { defaultPosScaleFilterSettings, normalizePosScaleFilterSettings } from '../../../../lib/pos-scale-filter';
import { defaultPosScaleTareSettings, normalizePosScaleTareSettings, posWeightMeasurementFromReading } from '../../../../lib/pos-scale-tare';
import type { PosWeightMeasurement } from '../../../../lib/pos-scale-tare';
import { readPosMenuConfig, readPosMenuRevision, applyPosMenu, posMenuGuard, posMenuLock } from '../../../../lib/pos-menu-settings';
import { applyPosItems, applyPosOptions } from '../../../../lib/pos-menu-policy';
import { dineInSourceFulfillmentModes } from "../../../../lib/store-dine-in-fulfillment";
import { getPosItemFulfillmentMode, createPosItemFulfillmentSnapshot, type PosItemFulfillmentMode } from "../../../../lib/pos-item-fulfillment";
import { readDineInMenus, readDineInMenuRevision, dineInMenuGuard } from '../../../../lib/store-dine-in-menu';
import { resolveDineInCatalog, flattenDineInOptions } from '../../../../lib/store-dine-in-runtime';
import { dineInOptionAppliesToItem, isLocalDineInOption } from '../../../../lib/store-dine-in-menu-policy';
import { getPosOptionSelectionType, getPosOptionSelectionRules, isStoreDineInSelection } from '../../../../lib/dine-in-option-selection';
import { assertRelayOrigin, relayStations, requireRelayOwner, ownerGuardSql, relayResponse } from '../../../../lib/store-relay';
import { buildRelayDocuments } from '../../../../lib/store-relay-documents';
import type { RelayOwner } from '../../../../lib/store-relay-policy';
import { createHash, randomUUID } from "node:crypto";
import { allocatePosBowlCodes, isPosCashSessionOpen, PosCashSessionChangedError, posCashSessionGuards, readPosServingTickets } from "../../../../lib/pos-bowl-data";
import { expandPosBowls, isPosBowl, isDineInBowlOptionGroup, offlineServingTickets } from "../../../../lib/pos-serving-policy";
import { after } from "next/server";
import { isPosSellableItem } from "../../../../lib/pos-catalog-policy";
import { requireOsSession } from "../../../../lib/api-auth";
import { createPickupCode, findCustomerOrderById } from "../../../../lib/customer-orders";
import { sql } from "../../../../lib/db";
import { awardLoyaltyForPaidOrder, calculateCouponDiscount, getUsableMemberCoupon, isMemberExchangeCoupon, resolveMemberForOrder } from "../../../../lib/loyalty";
import { ensureProductionTasksForOrder } from "../../../../lib/order-production";
import { publishCustomerOrderEvent } from "../../../../lib/order-realtime";
import { normalizePosPrinterSettings } from "../../../../lib/pos-printer";
import { defaultPosFulfillmentWorkspaceSettings, normalizePosFulfillmentWorkspaceSettings } from "../../../../lib/pos-fulfillment-settings";
import { defaultPosDisplayStandbySettings, normalizePosDisplayStandbySettings } from "../../../../lib/pos-display-standby";
import { syncWebReservationToSalesOrder } from "../../../../lib/sales-orders";
import { markDiningOrdersPaid } from "../../../../lib/store-dining-sessions";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../lib/store-order-access";
import { markInventoryOrderReady } from "../../../../lib/inventory-order-usage";

export const dynamic = "force-dynamic";

// Debug checkouts exist only in the browser's mounted workspace. Reject a
// mistakenly submitted debug request before authentication or any SQL work.


type PosCheckoutItemInput = {
  fulfillmentMode?: string;
  bowlBenefit?: PosBowlChoice;
  scaleCaptureId?: string;
  weightMeasurement?: PosWeightMeasurement;
  menuCatalogItemId?: string;
  quantity?: number;
  measuredQuantity?: number | string;
  measuredUnit?: string;
  preparationNote?: string;
  selectedOptions?: Array<{
    groupId?: string;
    optionIds?: string[];
  }>;
};

function publishPosOrderEventAfterResponse(eventName: "order.created" | "order.updated", orderId: string) {
  after(async () => {
    const order = await findCustomerOrderById(orderId).catch(() => null);
    if (!order) return;
    await publishCustomerOrderEvent(eventName, order).catch(() => undefined);
  });
}

type PosCheckoutBody = {
  posFulfillmentPolicyVersion?: number;
  printDocumentVersion?: number;
  printMode?: PosPrintMode;
  relayOwner?: RelayOwner;
  posMenuRevision?: string;
  dineInMenuRevision?: string;
  offlineQueued?: boolean;
  offlineClientOrderId?: string;
  offlineCreatedAt?: string;
  offlinePickupCode?: string;
  offlineExpectedAmount?: number;
  storeId?: string;
  orderType?: string;
  paymentMethod?: string;
  cashTenderedAmount?: number | string | null;
  tableSessionKey?: string;
  diningSessionId?: string;
  bowlNumber?: string;
  bowlTicketVersion?: number;
  dineInAssociationVersion?: number;
  memberId?: string;
  memberToken?: string;
  memberPhone?: string;
  memberEmail?: string;
  memberName?: string;
  memberLanguage?: string;
  couponId?: string;
  discountPresetKey?: string;
  discountQuote?: unknown;
  receiptRequested?: boolean;
  receiptRecipientName?: string;
  receiptPurposeText?: string;
  note?: string;
  items?: PosCheckoutItemInput[];
};

type PosTableAdjustmentBody = {
  storeId?: string;
  tableSessionKey?: string;
  action?: string;
  orderId?: string;
  itemId?: string;
  quantity?: number | string;
};

type PosDiscountPreset = PosCampaignFields & {
  key: string;
  name: string;
  displayNames?: Record<string, string>;
  discountType: "percent" | "amount";
  discountValue: number;
  targetScope: "all" | "category" | "item_kind" | "brand";
  targetValue: string;
  enabled: boolean;
  stampEligible: boolean;
  allowCouponCombination: boolean;
};

type PosDiscountItem = {
  brandId: string;
  posPricingMode?: string;
  posWeightUnit?: string;
  posWeightUnitPrice?: number | null;
  itemKind: string;
  category: string;
  amount: number;
};

const discountTypes = new Set(["percent", "amount"]);
const discountTargetScopes = new Set(["all", "category", "item_kind", "brand"]);
const defaultDiscountPresets: PosDiscountPreset[] = [{
  key: "student_20",
  name: "学割 20%OFF",
  displayNames: {
    en: "Student discount 20% off",
    zh: "学生优惠 20%OFF",
    "zh-Hant": "學生優惠 20%OFF",
    ko: "학생 할인 20%OFF",
    vi: "Giảm giá học sinh 20%",
    ne: "विद्यार्थी छुट 20%OFF"
  },
  discountType: "percent",
  discountValue: 20,
  targetScope: "all",
  targetValue: "",
  enabled: true,
  stampEligible: false,
  allowCouponCombination: false
}];

const defaultCustomerDisplayMediaSettings = {
  standby: defaultPosDisplayStandbySettings(),
  mode: "default",
  transition: "fade",
  slideDurationSeconds: 8,
  videoMuted: true,
  videoLoop: true,
  backgroundColor: "#fbfbf8",
  assets: []
};

function isDineInWeightMalatangOptionGroup(group: { groupKey: string; groupName: string; posEnabled?: boolean }) {
  return isDineInBowlOptionGroup(group);
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

async function containsMalatangBrand(brandIds: string[]) {
  if (!brandIds.length) return false;
  const rows = await sql`
    select exists(
      select 1
      from brands
      where id::text = any(${brandIds})
        and (lower(name) like '%maamaa%' or name like '%まぁ麻%' or name like '%麻辣%')
    ) as matched
  `;
  return rows[0]?.matched === true;
}

function normalizeMemberLanguage(value: unknown) {
  const language = normalizeText(value);
  return ["ja", "zh", "zh-Hant", "en", "ko", "vi", "ne"].includes(language) ? language : "";
}

function normalizeDisplayNames(value: unknown) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(
    ["en", "zh", "zh-Hant", "ko", "vi", "ne"]
      .map((language) => [language, normalizeText(source[language]).slice(0, 120)])
      .filter(([, displayName]) => displayName)
  );
}

function getDefaultDiscountDisplayNames(key: string, name: string) {
  if (key === "student_20" || name.includes("学割")) {
    return {
      en: "Student discount 20% off",
      zh: "学生优惠 20%OFF",
      "zh-Hant": "學生優惠 20%OFF",
      ko: "학생 할인 20%OFF",
      vi: "Giảm giá học sinh 20%",
      ne: "विद्यार्थी छुट 20%OFF"
    };
  }
  return {};
}

function normalizeDiscountPresets(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  const presets = source.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const name = normalizeText(record.name);
    const key = normalizeText(record.key);
    if (!name || !key) return [];
    const discountType = discountTypes.has(normalizeText(record.discountType)) ? normalizeText(record.discountType) as PosDiscountPreset["discountType"] : "percent";
    const maxValue = discountType === "percent" ? 100 : 999999;
    const discountValue = Math.max(0, Math.min(maxValue, Math.round(Number(record.discountValue) || 0)));
    if (discountValue <= 0 && !(record.applicationMode === "campaign" && record.campaignBasis === "bowl_choice" && record.bowlBenefitMode === "gift_only")) return [];
    const targetScope = discountTargetScopes.has(normalizeText(record.targetScope)) ? normalizeText(record.targetScope) as PosDiscountPreset["targetScope"] : "all";
    const targetValue = targetScope === "all" ? "" : normalizeText(record.targetValue);
    if (targetScope !== "all" && !targetValue) return [];
    return [{
      key,
      name,
      displayNames: {
        ...getDefaultDiscountDisplayNames(key, name),
        ...normalizeDisplayNames(record.displayNames)
      },
      discountType,
      discountValue,
      targetScope,
      targetValue,
      enabled: record.enabled !== false,
      stampEligible: record.stampEligible === true,
      allowCouponCombination: record.allowCouponCombination === true,
      ...normalizePosCampaignFields(record)
    }];
  });
  return presets.length ? presets : defaultDiscountPresets;
}

function normalizeCustomerDisplayMediaSettings(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const modeValue = normalizeText(record.mode);
  const transitionValue = normalizeText(record.transition);
  const backgroundColor = normalizeText(record.backgroundColor);
  const assets = Array.isArray(record.assets) ? record.assets : [];
  return {
    ...record,
    standby: normalizePosDisplayStandbySettings(record.standby),
    mode: modeValue === "slideshow" || modeValue === "video" ? modeValue : "default",
    transition: transitionValue === "slide" || transitionValue === "none" ? transitionValue : "fade",
    slideDurationSeconds: Math.max(3, Math.min(60, Math.round(Number(record.slideDurationSeconds) || defaultCustomerDisplayMediaSettings.slideDurationSeconds))),
    videoMuted: record.videoMuted !== false,
    videoLoop: record.videoLoop !== false,
    backgroundColor: /^#[0-9a-f]{6}$/i.test(backgroundColor) ? backgroundColor : defaultCustomerDisplayMediaSettings.backgroundColor,
    assets: assets.flatMap((item, index) => {
      const asset = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
      const url = normalizeText(asset.url);
      if (!url) return [];
      const type = normalizeText(asset.type) === "video" ? "video" : "image";
      return [{
        id: normalizeText(asset.id) || `asset_${index + 1}`,
        type,
        url: url.slice(0, 500),
        pathname: normalizeText(asset.pathname).slice(0, 240),
        name: normalizeText(asset.name).slice(0, 120) || type,
        durationSeconds: Math.max(3, Math.min(60, Math.round(Number(asset.durationSeconds) || Number(record.slideDurationSeconds) || defaultCustomerDisplayMediaSettings.slideDurationSeconds))),
        fit: normalizeText(asset.fit) === "contain" ? "contain" : "cover"
      }];
    }).slice(0, 12)
  };
}

function getDiscountEligibleAmount(preset: PosDiscountPreset, items: PosDiscountItem[], subtotalAmount: number) {
  if (preset.targetScope === "all") return subtotalAmount;
  return items.reduce((sum, item) => {
    if (preset.targetScope === "category" && item.category !== preset.targetValue) return sum;
    if (preset.targetScope === "item_kind" && item.itemKind !== preset.targetValue) return sum;
    if (preset.targetScope === "brand" && item.brandId !== preset.targetValue) return sum;
    return sum + item.amount;
  }, 0);
}

function calculatePosDiscount(preset: PosDiscountPreset | null, items: PosDiscountItem[], subtotalAmount: number) {
  if (!preset) return 0;
  const eligibleAmount = Math.max(0, Math.round(getDiscountEligibleAmount(preset, items, subtotalAmount)));
  if (eligibleAmount <= 0) return 0;
  const rawDiscount = preset.discountType === "percent"
    ? Math.floor(eligibleAmount * preset.discountValue / 100)
    : preset.discountValue;
  return Math.min(eligibleAmount, Math.max(0, Math.round(rawDiscount)));
}

function getOrderTaxRate(settings: Awaited<ReturnType<typeof getPosSettings>>, orderType: string) {
  return orderType === "eat_in" ? Number(settings.dineInTaxRate ?? 10) : Number(settings.takeoutTaxRate ?? 8);
}

function calculateTaxSummary(params: {
  subtotalAmount: number;
  discountAmount: number;
  couponDiscountAmount: number;
  taxRate: number;
  priceTaxMode: string;
}) {
  const taxableAmount = Math.max(0, Math.round(params.subtotalAmount - params.discountAmount - params.couponDiscountAmount));
  const taxRate = Math.max(0, Number(params.taxRate) || 0);
  if (params.priceTaxMode === "tax_excluded") {
    const taxAmount = Math.floor(taxableAmount * taxRate / 100);
    return { taxableAmount, taxAmount, amount: taxableAmount + taxAmount };
  }
  const taxAmount = taxRate > 0 ? taxableAmount - Math.floor(taxableAmount / (1 + taxRate / 100)) : 0;
  return { taxableAmount, taxAmount, amount: taxableAmount };
}

function allocateAmountByWeight(totalAmount: number, weights: number[]) {
  const total = Math.max(0, Math.round(Number(totalAmount) || 0));
  const normalizedWeights = weights.map((weight) => Math.max(0, Math.round(Number(weight) || 0)));
  const weightTotal = normalizedWeights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0 || weightTotal <= 0) return weights.map(() => 0);
  const rawShares = normalizedWeights.map((weight) => total * weight / weightTotal);
  const shares = rawShares.map(Math.floor);
  let remainder = total - shares.reduce((sum, share) => sum + share, 0);
  rawShares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((left, right) => right.fraction - left.fraction)
    .forEach(({ index }) => {
      if (remainder <= 0) return;
      shares[index] += 1;
      remainder -= 1;
    });
  return shares;
}

function toPositiveInt(value: unknown, fallback = 1) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return fallback;
  return Math.max(1, Math.min(99, Math.floor(nextValue)));
}

function toPositiveMeasuredQuantity(value: unknown) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return null;
  const rounded = Math.round(nextValue * 1000) / 1000;
  return rounded > 0 ? rounded : null;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function getNumberFromSchema(schema: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = schema?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function getNestedNumberFromSchema(schema: Record<string, unknown> | undefined, parentKey: string, keys: string[]) {
  const parent = schema?.[parentKey];
  if (!parent || typeof parent !== "object" || Array.isArray(parent)) return null;
  return getNumberFromSchema(parent as Record<string, unknown>, keys);
}

function getWeightPricingConfig(item: PosItemPricingInput & { posPricingMode?: string; posWeightUnit?: string; posWeightUnitPrice?: number | null; variableSchema?: Record<string, unknown> }, orderType: string) {
  if (orderType !== "eat_in" || resolvePosItemPricingMode(item) !== "weight") return null;
  const schema = item.variableSchema ?? {};
  const unit = normalizeText(item.posWeightUnit) || String(schema.weightUnit ?? schema.measuredUnit ?? (schema.posWeightPricing as Record<string, unknown> | undefined)?.unit ?? "g").trim() || "g";
  const unitPrice = Number(item.posWeightUnitPrice ?? 0) > 0
    ? Number(item.posWeightUnitPrice)
    : getNumberFromSchema(schema, ["pricePerGram", "weightUnitPrice", "measuredUnitPrice"]) ??
    getNestedNumberFromSchema(schema, "posWeightPricing", ["pricePerGram", "unitPrice", "weightUnitPrice"]);
  return { unit, unitPrice };
}

function getEffectiveSelectionType(group: { groupKey: string; selectionType: string; sourceGroupId?: string; localKind?: string }) {
  return getPosOptionSelectionType(group);
}

function getAllowedRuleKey(groupKey: string) {
  const ruleKeys: Record<string, string> = {
    size: "allowedSizes",
    temperature: "temperatures",
    sweetness: "allowedSweetness",
    ice: "allowedIce",
    option: "allowedOptions",
    topping: "allowedToppings"
  };
  return ruleKeys[groupKey] ?? `allowed_${groupKey}`;
}

function getJstParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const [pickupDate, pickupTime] = formatter.format(date).replace(" ", "T").split("T");
  return { pickupDate, pickupTime };
}

async function getSelectedStoreId(request: Request, session: Awaited<ReturnType<typeof requireOsSession>>) {
  if (!session) return { access: null, selectedStoreId: "", forbidden: false };
  const access = await getStoreOrderAccess(session);
  const requestedStoreId = new URL(request.url).searchParams.get("storeId");
  const storeFilter = getScopedStoreFilter(access, requestedStoreId);
  if (storeFilter === "__forbidden__") return { access, selectedStoreId: "", forbidden: true };
  return { access, selectedStoreId: storeFilter ?? access.stores[0]?.id ?? "", forbidden: false };
}

async function getPosMenu(selectedStoreId: string) {
  if (!selectedStoreId) return { brands: [], categories: [], items: [], optionGroups: [] };

  const config = await readPosMenuConfig(selectedStoreId);
  const shownItemIds = config.settings.filter(s=>s.kind==='item'&&s.visible===true).map(s=>s.targetId);
  const [brands, categories, items] = await Promise.all([
    sql`
      select brands.id::text, brands.name
      from brands
      join store_brands on store_brands.brand_id = brands.id
      where store_brands.store_id = ${selectedStoreId}
        and brands.status = 'active'
      order by brands.name
    `,
    sql`
      select
        menu_categories.id::text,
        menu_categories.brand_id::text as "brandId",
        menu_categories.name,
        menu_categories.sort_order as "sortOrder"
      from menu_categories
      join store_brands
        on store_brands.brand_id = menu_categories.brand_id
        and store_brands.store_id = ${selectedStoreId}
      join brands on brands.id = menu_categories.brand_id
      where menu_categories.store_id is null
        and brands.status = 'active'
      order by brands.name, menu_categories.sort_order, menu_categories.name
    `,
    sql`
      select
        menu_catalog_items.id::text,
        menu_catalog_items.brand_id::text as "brandId",
        brands.name as "brandName",
        menu_catalog_items.name,
        coalesce(menu_catalog_items.display_names, '{}'::jsonb) as "displayNames",
        menu_catalog_items.item_kind as "itemKind",
        coalesce(menu_catalog_items.category, '未分類') as category,
        coalesce(menu_catalog_items.image_url, '') as "imageUrl",
        menu_catalog_items.base_price::float as "basePrice",
        menu_catalog_items.variable_schema as "variableSchema",
        coalesce(nullif(store_brands.pos_pricing_mode, ''), 'fixed') as "posPricingMode",
        coalesce(nullif(store_brands.pos_weight_unit, ''), 'g') as "posWeightUnit",
        store_brands.pos_weight_unit_price::float as "posWeightUnitPrice",
        menu_store_settings.price_override::float as "priceOverride",
        coalesce(menu_store_settings.is_available, true) as "isAvailable"
      from menu_catalog_items
      join brands on brands.id = menu_catalog_items.brand_id
      join store_brands
        on store_brands.brand_id = menu_catalog_items.brand_id
        and store_brands.store_id = ${selectedStoreId}
      left join menu_store_settings
        on menu_store_settings.menu_catalog_item_id = menu_catalog_items.id
        and menu_store_settings.store_id = ${selectedStoreId}
      left join menu_categories
        on menu_categories.brand_id = menu_catalog_items.brand_id
        and menu_categories.store_id is null
        and menu_categories.name = coalesce(nullif(menu_catalog_items.category, ''), '未分類')
      where menu_catalog_items.is_active = true
        and menu_catalog_items.store_id is null
        and (coalesce(menu_store_settings.pos_enabled, true) = true or menu_catalog_items.id::text = any(${shownItemIds}))
        and coalesce(menu_store_settings.is_available, true) = true
      order by brands.name, coalesce(menu_categories.sort_order, 9999), menu_catalog_items.sort_order, menu_catalog_items.name
    `
  ]);

  const sellableItems = (items as Array<{ id: string; brandId: string; brandName: string; name: string; basePrice: number; priceOverride: number | null } & PosItemPricingInput>).filter(isPosSellableItem).map(normalizePosItemPricing);
  const itemIds = sellableItems.map((item) => item.id);
  const optionGroups = itemIds.length
    ? await sql`
      select
        menu_option_groups.id::text,
        menu_option_groups.brand_id::text as "brandId",
        coalesce(menu_option_groups.menu_catalog_item_id::text, '') as "menuCatalogItemId",
        coalesce(menu_option_groups.applicable_categories, '{}') as "applicableCategories",
        menu_option_groups.group_key as "groupKey",
        menu_option_groups.name,
        coalesce(menu_option_groups.display_names, '{}'::jsonb) as "displayNames",
        menu_option_groups.selection_type as "selectionType",
        menu_option_groups.rule_json as "ruleJson",
        menu_option_groups.sort_order as "sortOrder",
        coalesce(
          json_agg(
            json_build_object(
              'id', menu_options.id::text,
              'optionKey', menu_options.option_key,
              'applicableCategories', coalesce(menu_options.applicable_categories, '{}'),
              'name', menu_options.name,
              'displayNames', coalesce(menu_options.display_names, '{}'::jsonb),
              'priceDelta', menu_options.price_delta::float,
              'sortOrder', menu_options.sort_order
            )
            order by menu_options.sort_order, menu_options.name
          ) filter (where menu_options.id is not null),
          '[]'::json
        ) as options
      from menu_option_groups
      join store_brands
        on store_brands.brand_id = menu_option_groups.brand_id
        and store_brands.store_id = ${selectedStoreId}
      left join menu_options
        on menu_options.option_group_id = menu_option_groups.id
        and menu_options.is_active = true
      left join menu_option_store_settings
        on menu_option_store_settings.menu_option_id = menu_options.id
        and menu_option_store_settings.store_id = ${selectedStoreId}
      where menu_option_groups.is_active = true
        and (
          menu_option_groups.menu_catalog_item_id is null
          or menu_option_groups.menu_catalog_item_id::text = any(${itemIds})
        )
        and coalesce(menu_option_store_settings.is_available, true) = true
      group by menu_option_groups.id
      order by menu_option_groups.sort_order, menu_option_groups.name
    `
    : [];

  return { brands, categories, ...applyPosMenu(sellableItems, optionGroups as Array<{id:string;options:Array<{id:string;priceDelta:number|null}>}>, config) };
}

async function getTableCheckoutRequests(selectedStoreId: string) {
  if (!selectedStoreId) return [];
  const rows = await sql`
    select
      store_customer_orders.id::text,
      store_customer_orders.pickup_code as "pickupCode",
      store_customer_orders.amount,
      store_customer_orders.status,
      store_customer_orders.drink,
      coalesce(store_customer_orders.customer_summary ->> 'tableSessionKey', store_customer_orders.table_session_key, '') as "tableSessionKey",
      coalesce(nullif(store_tables.display_name, ''), store_tables.label, '') as "tableLabel",
      coalesce(store_customer_orders.customer_summary ->> 'checkoutRequestType', '') as "checkoutRequestType",
      coalesce(store_customer_orders.customer_summary ->> 'checkoutRequestedAt', '') as "checkoutRequestedAt"
    from store_customer_orders
    left join store_tables on store_tables.id = store_customer_orders.store_table_id
    where store_customer_orders.store_id::text = ${selectedStoreId}
      and store_customer_orders.order_source = 'table_qr'
      and store_customer_orders.status <> 'cancelled'
      and store_customer_orders.payment_status <> 'paid'
      and coalesce(store_customer_orders.customer_summary ->> 'checkoutStatus', '') = 'requested'
      and store_customer_orders.created_at > now() - interval '14 days'
    order by store_customer_orders.created_at asc
  `;
  const orderIds = (rows as Array<{ id: string }>).map((row) => row.id);
  const itemRows = orderIds.length ? await sql`
    select
      store_customer_order_items.id::text,
      store_customer_order_items.order_id::text as "orderId",
      store_customer_order_items.item_name as name,
      coalesce(store_customer_order_items.quantity, 1)::int as quantity,
      coalesce(store_customer_order_items.amount, 0)::int as amount,
      coalesce(store_customer_order_items.option_label, '') as "optionLabel",
      store_customer_order_items.topping_labels as toppings
    from store_customer_order_items
    where store_customer_order_items.order_id::text = any(${orderIds})
    order by store_customer_order_items.order_id, store_customer_order_items.sort_order, store_customer_order_items.created_at
  ` : [];
  const itemsByOrderId = new Map<string, Array<{
    id: string;
    name: string;
    quantity: number;
    amount: number;
    optionLabel: string;
    toppings: string[];
  }>>();
  for (const row of itemRows as Array<{ id: string; orderId: string; name: string; quantity: number; amount: number; optionLabel: string; toppings: string[] | null }>) {
    const items = itemsByOrderId.get(row.orderId) ?? [];
    items.push({
      id: row.id,
      name: row.name,
      quantity: Number(row.quantity ?? 1),
      amount: Number(row.amount ?? 0),
      optionLabel: row.optionLabel,
      toppings: Array.isArray(row.toppings) ? row.toppings : []
    });
    itemsByOrderId.set(row.orderId, items);
  }
  const groups = new Map<string, {
    id: string;
    tableSessionKey: string;
    tableLabel: string;
    checkoutRequestType: string;
    checkoutRequestedAt: string;
    totalAmount: number;
    orderCount: number;
    pickupCodes: string[];
    itemSummary: string[];
    orders: Array<{
      id: string;
      pickupCode: string;
      amount: number;
      status: string;
      items: Array<{
        id: string;
        name: string;
        quantity: number;
        amount: number;
        optionLabel: string;
        toppings: string[];
      }>;
    }>;
  }>();
  for (const row of rows as Array<{
    id: string;
    pickupCode: string;
    amount: number;
    status: string;
    drink: string;
    tableSessionKey: string;
    tableLabel: string;
    checkoutRequestType: string;
    checkoutRequestedAt: string;
  }>) {
    const key = row.tableSessionKey || row.id;
    const current = groups.get(key);
    const itemSummary = String(row.drink || "").split(/\n+/).map((item) => item.trim()).filter(Boolean).slice(0, 2);
    if (!current) {
      groups.set(key, {
        id: row.id,
        tableSessionKey: key,
        tableLabel: row.tableLabel || "テーブル未設定",
        checkoutRequestType: row.checkoutRequestType,
        checkoutRequestedAt: row.checkoutRequestedAt,
        totalAmount: Number(row.amount ?? 0),
        orderCount: 1,
        pickupCodes: [row.pickupCode],
        itemSummary,
        orders: [{
          id: row.id,
          pickupCode: row.pickupCode,
          amount: Number(row.amount ?? 0),
          status: row.status,
          items: itemsByOrderId.get(row.id) ?? []
        }]
      });
      continue;
    }
    current.totalAmount += Number(row.amount ?? 0);
    current.orderCount += 1;
    current.pickupCodes.push(row.pickupCode);
    current.itemSummary.push(...itemSummary);
    current.orders.push({
      id: row.id,
      pickupCode: row.pickupCode,
      amount: Number(row.amount ?? 0),
      status: row.status,
      items: itemsByOrderId.get(row.id) ?? []
    });
    const currentTime = new Date(current.checkoutRequestedAt).getTime();
    const rowTime = new Date(row.checkoutRequestedAt).getTime();
    if (Number.isFinite(rowTime) && (!Number.isFinite(currentTime) || rowTime > currentTime)) {
      current.id = row.id;
      current.checkoutRequestType = row.checkoutRequestType;
      current.checkoutRequestedAt = row.checkoutRequestedAt;
    }
  }
  return Array.from(groups.values()).sort((a, b) => {
    const aTime = new Date(a.checkoutRequestedAt).getTime();
    const bTime = new Date(b.checkoutRequestedAt).getTime();
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });
}

async function getOpenCashSessionId(selectedStoreId: string) {
  const rows = await sql`
    select id::text
    from pos_cash_sessions
    where store_id::text = ${selectedStoreId}
      and status = 'open'
    order by opened_at desc
    limit 1
  `;
  return rows[0]?.id as string | undefined;
}

async function refreshTableQrOrderAfterAdjustment(input: {
  orderId: string;
  sessionId: string;
  reason: string;
}) {
  const itemRows = await sql`
    select
      id::text,
      item_name as name,
      quantity,
      amount
    from store_customer_order_items
    where order_id::text = ${input.orderId}
    order by sort_order, created_at
  ` as Array<{ id: string; name: string; quantity: number; amount: number }>;
  const amount = itemRows.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const itemCount = itemRows.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
  const drink = itemRows.map((item) => item.name).filter(Boolean).join("\n");
  const adjustmentPayload = {
    staffAdjusted: true,
    staffAdjustedAt: new Date().toISOString(),
    staffAdjustedBy: input.sessionId,
    staffAdjustmentReason: input.reason,
    subtotalAmount: amount,
    itemCount
  };

  if (!itemRows.length) {
    await sql`
      update store_customer_orders
      set
        status = 'cancelled',
        amount = 0,
        drink = '',
        cancelled_at = now(),
        customer_summary = customer_summary || ${JSON.stringify(adjustmentPayload)}::jsonb,
        updated_at = now()
      where id::text = ${input.orderId}
    `;
    await sql`
      update order_production_tasks
      set
        status = 'cancelled',
        item_summary = item_summary || E'\nキャンセル済み',
        updated_at = now()
      where order_id::text = ${input.orderId}
        and status <> 'ready'
    `;
    await markInventoryOrderReady(input.orderId);
    publishPosOrderEventAfterResponse("order.updated", input.orderId);
    return;
  }

  await sql`
    update store_customer_orders
    set
      amount = ${amount},
      drink = ${drink},
      customer_summary = customer_summary || ${JSON.stringify(adjustmentPayload)}::jsonb,
      updated_at = now()
    where id::text = ${input.orderId}
  `;
  await sql`delete from order_production_tasks where order_id::text = ${input.orderId} and status <> 'ready'`;
  await markInventoryOrderReady(input.orderId);
  await ensureProductionTasksForOrder(input.orderId);
  publishPosOrderEventAfterResponse("order.updated", input.orderId);
}

async function getPosSettings(selectedStoreId: string) {
  const defaults = { dineInEnabled: true, takeoutEnabled: true, dineInTaxRate: 10, takeoutTaxRate: 8, externalPaymentTerminalBrand: "PayCAS", priceTaxMode: "tax_included", discountPresets: defaultDiscountPresets, customerDisplayMediaSettings: defaultCustomerDisplayMediaSettings, printerSettings: normalizePosPrinterSettings(null), scaleTareSettings: defaultPosScaleTareSettings(), scaleFilterSettings: defaultPosScaleFilterSettings(), fulfillmentWorkspace: defaultPosFulfillmentWorkspaceSettings() };
  if (!selectedStoreId) return defaults;
  const rows = await sql`
    select
      coalesce(dine_in_enabled, true) as "dineInEnabled",
      coalesce(takeout_enabled, true) as "takeoutEnabled",
      coalesce(dine_in_tax_rate, 10)::float as "dineInTaxRate",
      coalesce(takeout_tax_rate, 8)::float as "takeoutTaxRate",
      coalesce(nullif(external_payment_terminal_brand, ''), 'PayCAS') as "externalPaymentTerminalBrand",
      coalesce(nullif(price_tax_mode, ''), 'tax_included') as "priceTaxMode",
      coalesce(discount_presets, '[]'::jsonb) as "discountPresets",
      coalesce(customer_display_media_settings, '{}'::jsonb) as "customerDisplayMediaSettings",
      coalesce(printer_settings, '{}'::jsonb) as "printerSettings",
      coalesce(scale_tare_settings, '{}'::jsonb) as "scaleTareSettings",
      coalesce(scale_filter_settings, '{}'::jsonb) as "scaleFilterSettings"
    from pos_store_settings
    where store_id::text = ${selectedStoreId}
    limit 1
  `;
  const settings = rows[0] as (typeof defaults & { discountPresets?: unknown }) | undefined;
  return settings ? {
    ...settings,
    discountPresets: normalizeDiscountPresets(settings.discountPresets),
    customerDisplayMediaSettings: normalizeCustomerDisplayMediaSettings(settings.customerDisplayMediaSettings),
    printerSettings: normalizePosPrinterSettings(settings.printerSettings),
    fulfillmentWorkspace: normalizePosFulfillmentWorkspaceSettings((settings.printerSettings as unknown as Record<string, unknown> | null)?.fulfillmentWorkspace),
    scaleTareSettings: normalizePosScaleTareSettings(settings.scaleTareSettings),
    scaleFilterSettings: normalizePosScaleFilterSettings(settings.scaleFilterSettings)
  } : defaults;
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { access, selectedStoreId, forbidden } = await getSelectedStoreId(request, session);
  if (forbidden) return Response.json({ error: "権限がありません。" }, { status: 403 });

  if (new URL(request.url).searchParams.get('menuRevisionOnly') === '1') {
    const [posRevision, dineInRevision] = selectedStoreId
      ? await Promise.all([readPosMenuRevision(selectedStoreId), readDineInMenuRevision(selectedStoreId)])
      : [{ revision: '' }, { revision: '' }];
    return Response.json({ selectedStoreId, posMenuRevision: posRevision.revision, dineInMenuRevision: dineInRevision.revision },
      { headers: { 'Cache-Control': 'no-store' } });
  }

  const debugMode = new URL(request.url).searchParams.get("debug") === "1";
  const [menu, todaySummary, posSettings, tableCheckoutRequests] = await Promise.all([
    getPosMenu(selectedStoreId),
    debugMode ? { orderCount: 0, total: 0, average: 0, latestOrders: [] } : getTodaySummary(selectedStoreId),
    getPosSettings(selectedStoreId),
    debugMode ? [] : getTableCheckoutRequests(selectedStoreId)
  ]);

  const dineInState = selectedStoreId ? await readDineInMenus(selectedStoreId) : null;
  const localMenu = dineInState ? await resolveDineInCatalog(selectedStoreId, dineInState) : null;
  const independentBrands = new Set(localMenu?.brandIds ?? []);
  const fulfillmentModes = dineInState ? dineInSourceFulfillmentModes(dineInState) : new Map<string, PosItemFulfillmentMode>();
  const physicalItems = menu.items.map(item => ({ ...item, fulfillmentMode: getPosItemFulfillmentMode({
    brandName: String(item.brandName || ''), itemKind: String(item.itemKind || ''), posPricingMode: String(item.posPricingMode || ''),
    fulfillmentMode: fulfillmentModes.get(String(item.id))
  }) }));
  return Response.json({
    access,
    selectedStoreId,
    ...menu,
    items: physicalItems,
    posFulfillmentPolicyVersion: 1,
    dineInMenuRevision: dineInState?.ready ? dineInState.revision : '',
    dineInMenu: localMenu && independentBrands.size ? {
      items: [...physicalItems.filter(item => !independentBrands.has(String((item as {brandId?:string}).brandId))), ...localMenu.items],
      optionGroups: [...menu.optionGroups.filter(group => !independentBrands.has(String((group as {brandId?:string}).brandId))), ...localMenu.optionGroups],
      categories: [...menu.categories.filter(category => !independentBrands.has(String(category.brandId))), ...localMenu.categories]
    } : null,
    posSettings,
    serverTime: new Date().toISOString(),
    todaySummary,
    tableCheckoutRequests,
    ...(debugMode ? { debugMode: true } : {})
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const debugRejection = rejectDebugWrite(request);
  if (debugRejection) return debugRejection;
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as PosTableAdjustmentBody;
  const storeId = normalizeText(body.storeId);
  const tableSessionKey = normalizeText(body.tableSessionKey);
  const action = normalizeText(body.action);
  const orderId = normalizeText(body.orderId);
  const itemId = normalizeText(body.itemId);
  const nextQuantity = Math.max(0, Math.min(99, Math.round(Number(body.quantity ?? 0) || 0)));

  if (!storeId || !tableSessionKey || !orderId || !["cancel_order", "cancel_item", "set_item_quantity"].includes(action)) {
    return Response.json({ error: "修正対象を選択してください。" }, { status: 400 });
  }

  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, storeId);
  if (storeFilter === "__forbidden__" || !storeFilter) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const orderRows = await sql`
    select
      id::text,
      payment_status as "paymentStatus",
      status
    from store_customer_orders
    where id::text = ${orderId}
      and store_id::text = ${storeId}
      and order_source = 'table_qr'
      and coalesce(customer_summary ->> 'tableSessionKey', table_session_key, '') = ${tableSessionKey}
    limit 1
  `;
  const order = orderRows[0] as { id: string; paymentStatus: string; status: string } | undefined;
  if (!order || order.status === "cancelled") return Response.json({ error: "対象のテーブル注文が見つかりません。" }, { status: 404 });
  if (order.paymentStatus === "paid") return Response.json({ error: "支払い済みのテーブル注文は修正できません。" }, { status: 409 });

  if (action === "cancel_order") {
    await sql`update store_customer_orders set inventory_items_ready_at = null where id::text = ${orderId}`;
    await sql`delete from store_customer_order_items where order_id::text = ${orderId}`;
    await refreshTableQrOrderAfterAdjustment({ orderId, sessionId: session.id, reason: "cancel_order" });
    return Response.json({
      ok: true,
      tableCheckoutRequests: await getTableCheckoutRequests(storeId),
      todaySummary: await getTodaySummary(storeId)
    });
  }

  if (!itemId) return Response.json({ error: "修正する商品を選択してください。" }, { status: 400 });
  const itemRows = await sql`
    select
      id::text,
      quantity,
      amount
    from store_customer_order_items
    where id::text = ${itemId}
      and order_id::text = ${orderId}
    limit 1
  `;
  const item = itemRows[0] as { id: string; quantity: number; amount: number } | undefined;
  if (!item) return Response.json({ error: "対象の商品が見つかりません。" }, { status: 404 });

  await sql`update store_customer_orders set inventory_items_ready_at = null where id::text = ${orderId}`;
  if (action === "cancel_item" || nextQuantity <= 0) {
    await sql`delete from store_customer_order_items where id::text = ${itemId} and order_id::text = ${orderId}`;
    await refreshTableQrOrderAfterAdjustment({ orderId, sessionId: session.id, reason: "cancel_item" });
  } else {
    const currentQuantity = Math.max(1, Number(item.quantity ?? 1));
    const unitAmount = Math.round(Number(item.amount ?? 0) / currentQuantity);
    const nextAmount = unitAmount * nextQuantity;
    await sql`
      update store_customer_order_items
      set
        quantity = ${nextQuantity},
        amount = ${nextAmount},
        gross_amount = case when gross_amount > 0 then ${nextAmount} else gross_amount end
      where id::text = ${itemId}
        and order_id::text = ${orderId}
    `;
    await refreshTableQrOrderAfterAdjustment({ orderId, sessionId: session.id, reason: "set_item_quantity" });
  }

  return Response.json({
    ok: true,
    tableCheckoutRequests: await getTableCheckoutRequests(storeId),
    todaySummary: await getTodaySummary(storeId)
  });
}

export async function POST(request: Request) {
  const debugRejection = rejectDebugWrite(request);
  if (debugRejection) return debugRejection;
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as PosCheckoutBody;
  const checkoutFingerprint = createHash("sha256").update(JSON.stringify({ ...body, offlineQueued: undefined, dineInAssociationVersion: undefined })).digest("hex");
  const offlineQueued = body.offlineQueued === true;
  const offlineClientOrderId = normalizeText(body.offlineClientOrderId);
  const offlineCreatedAt = normalizeText(body.offlineCreatedAt);
  const offlinePickupCode = normalizeText(body.offlinePickupCode);
  const offlineExpectedAmount = Number(body.offlineExpectedAmount ?? 0);
  const storeId = normalizeText(body.storeId);
  const orderType = normalizeText(body.orderType) || "eat_in";
  const paymentMethod = normalizeText(body.paymentMethod) || "cash";
  const memberId = normalizeText(body.memberId);
  const memberToken = normalizeText(body.memberToken);
  const memberPhone = normalizeText(body.memberPhone);
  const memberEmail = normalizeText(body.memberEmail);
  const memberName = normalizeText(body.memberName);
  const memberLanguage = normalizeMemberLanguage(body.memberLanguage);
  const couponId = normalizeText(body.couponId);
  const requestedDiscountPresetKey = normalizeText(body.discountPresetKey);
  let discountPresetKey = requestedDiscountPresetKey;
  const tableSessionKey = normalizeText(body.tableSessionKey);
  const diningSessionId = normalizeText(body.diningSessionId);
  const cashTenderedAmount = body.cashTenderedAmount === null || body.cashTenderedAmount === undefined || body.cashTenderedAmount === ""
    ? null
    : Math.round(Number(body.cashTenderedAmount));
  const note = normalizeText(body.note);
  const receiptRequested = body.receiptRequested === true;
  let invoiceDetails: ReturnType<typeof validateInvoiceDetails> = { receiptRecipientName: undefined, receiptPurposeText: undefined };
  try { invoiceDetails = receiptRequested ? validateInvoiceDetails(body) : { receiptRecipientName: undefined, receiptPurposeText: undefined }; }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : '宛名を確認してください。' }, { status: 400 }); }
  const durablePrintDocuments = body.printDocumentVersion === 1 && !tableSessionKey;
  if (durablePrintDocuments && !["auto", "deferred", "none"].includes(String(body.printMode))) return Response.json({ error: "伝票の印刷方法を選択してください。" }, { status: 400 });
  const cartItems = Array.isArray(body.items) ? body.items : [];

  if (!storeId || (!tableSessionKey && cartItems.length === 0)) {
    return Response.json({ error: "店舗と商品を選択してください。" }, { status: 400 });
  }

  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, storeId);
  if (storeFilter === "__forbidden__" || !storeFilter) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }
  if (
    offlineQueued && (
      paymentMethod !== "cash" ||
      memberId || memberToken || memberPhone || memberEmail || memberName || memberLanguage ||
      couponId || discountPresetKey || tableSessionKey || diningSessionId
    )
  ) {
    return Response.json({ error: "オフライン会計は、会員・クーポン・割引・テーブル会計を使わない現金注文のみ同期できます。" }, { status: 400 });
  }
  // A sibling request may finish this sale while we wait for a cash-session
  // lock. Reuse its saved documents before suggesting a fresh checkout.
  async function findRecordedCheckout(): Promise<Response | null> {
    if (!offlineClientOrderId) return null;
    const existingRows = await sql`
      select id::text as "orderId", pickup_code as "pickupCode", amount, status, payment_status as "paymentStatus", customer_summary as "customerSummary"
      from store_customer_orders
      where offline_client_order_id = ${offlineClientOrderId}
        and store_id::text = ${storeId}
      limit 1
    `;
    if (existingRows[0]) {
      if (existingRows[0].customerSummary?.checkoutFingerprint && existingRows[0].customerSummary.checkoutFingerprint !== checkoutFingerprint) {
        return Response.json({ error: "同じ会計IDの内容が変わっています。元の会計を確認してください。" }, { status: 409 });
      }
      await markInventoryOrderReady(String(existingRows[0].orderId));
      await ensureProductionTasksForOrder(String(existingRows[0].orderId));
      await awardLoyaltyForPaidOrder(String(existingRows[0].orderId));
      await syncWebReservationToSalesOrder(String(existingRows[0].orderId));
      const existingTickets = await readPosServingTickets(String(existingRows[0].orderId));
      return Response.json({
        ok: true,
        duplicate: true,
        ...existingRows[0],
        ...existingRows[0].customerSummary,
        reprintAllowed: existingRows[0].paymentStatus === "paid" && ["new", "preparing", "ready"].includes(String(existingRows[0].status)) && !existingTickets.some(ticket => ticket.handedOffAt),
        servingTickets: existingTickets,
        ...(durablePrintDocuments ? { printDocuments: await readPosCheckoutPrintDocuments(storeId, String(existingRows[0].orderId)) } : {}),
        todaySummary: await getTodaySummary(storeId)
      });
    }
    return null;
  }
  const recordedCheckout = await findRecordedCheckout();
  if (recordedCheckout) return recordedCheckout;
  const posSettings = await getPosSettings(storeId);
  const printMode: PosPrintMode = durablePrintDocuments ? body.printMode === "auto" && !posSettings.printerSettings.enabled ? "deferred" : body.printMode! : "auto";
  const relayRows = await relayStations(storeId);
  const relayRequired = relayRows.some(row => row.enabled && (row.print_enabled || row.scale_enabled));
  const relayStation = relayRows.find(row => row.id === body.relayOwner?.stationId && row.enabled);
  if (relayRequired) {
    if (!relayStation || !body.relayOwner || offlineQueued) return Response.json({error:'レジを取得し、オンラインで会計してください。'},{status:409});
    try { assertRelayOrigin(request); await requireRelayOwner(storeId,body.relayOwner,session); } catch(e) { return relayResponse(e); }
    if (relayStation.print_enabled && ((!relayStation.device_online && !(durablePrintDocuments && printMode !== 'auto')) || tableSessionKey)) return Response.json({error:tableSessionKey?'中継印刷ではテーブル会計を利用できません。':'中継端末の接続を確認してください。'},{status:409});
  }
  const relayPrinting = Boolean(relayRequired && relayStation?.print_enabled && (!durablePrintDocuments || printMode === "auto"));
  if (orderType === "eat_in" && !posSettings.dineInEnabled) {
    return Response.json({ error: "この店舗では店内飲食の会計は無効です。" }, { status: 400 });
  }
  if (orderType === "takeout" && !posSettings.takeoutEnabled) {
    return Response.json({ error: "この店舗では持ち帰りの会計は無効です。" }, { status: 400 });
  }

  if (tableSessionKey) {
    const cashSessionId = await getOpenCashSessionId(storeId);
    if (!cashSessionId) {
      const recorded = await findRecordedCheckout();
      if (recorded) return recorded;
      return Response.json({ error: "POS 会計の前に開店前のレジ金額を確認してください。" }, { status: 400 });
    }
    const orders = await sql`
      select
        store_customer_orders.id::text,
        store_customer_orders.pickup_code as "pickupCode",
        store_customer_orders.amount,
        store_customer_orders.status,
        store_customer_orders.drink,
        coalesce(nullif(store_tables.display_name, ''), store_tables.label, '') as "tableLabel"
      from store_customer_orders
      left join store_tables on store_tables.id = store_customer_orders.store_table_id
      where store_customer_orders.store_id::text = ${storeId}
        and store_customer_orders.order_source = 'table_qr'
        and store_customer_orders.status <> 'cancelled'
        and store_customer_orders.payment_status <> 'paid'
        and coalesce(store_customer_orders.customer_summary ->> 'tableSessionKey', store_customer_orders.table_session_key, '') = ${tableSessionKey}
      order by store_customer_orders.created_at asc
    `;
    if (!orders.length) {
      return Response.json({ error: "会計待ちのテーブル注文が見つかりません。" }, { status: 404 });
    }
    const amount = orders.reduce((sum, order) => sum + Number(order.amount ?? 0), 0);
    if (
      paymentMethod === "cash" &&
      (cashTenderedAmount === null || !Number.isFinite(cashTenderedAmount) || cashTenderedAmount < amount)
    ) {
      return Response.json({ error: "現金会計はお預かり金額を合計以上で入力してください。" }, { status: 400 });
    }
    const cashChangeAmount = paymentMethod === "cash" && cashTenderedAmount !== null ? cashTenderedAmount - amount : null;
    const paidAt = new Date().toISOString();
    const tableLabel = String(orders[0]?.tableLabel || "テーブル");
    const checkoutPayload = {
      checkoutStatus: "handled",
      checkoutHandledAt: paidAt,
      checkoutHandledBy: session.id,
      cashierId: session.id,
      cashierName: session.name,
      paymentIntent: paymentMethod,
      paymentMethod,
      cashTenderedAmount,
      cashChangeAmount,
      posCheckoutType: "table_qr",
      paidAt
    };
    const orderIds = (orders as Array<{ id: string }>).map((order) => order.id);
    const updatedRows = await sql`
      update store_customer_orders
      set
        payment_status = 'paid',
        payment_provider = ${paymentMethod},
        paid_at = now(),
        payment_updated_at = now(),
        pos_cash_session_id = ${cashSessionId},
        customer_summary = customer_summary || ${JSON.stringify(checkoutPayload)}::jsonb,
        updated_at = now()
      where id::text = any(${orderIds})
      returning id::text, pickup_code as "pickupCode"
    `;
    await markDiningOrdersPaid(orderIds);
    for (const row of updatedRows as Array<{ id: string }>) {
      await ensureProductionTasksForOrder(row.id);
      await syncWebReservationToSalesOrder(row.id);
      publishPosOrderEventAfterResponse("order.updated", row.id);
    }
    const todaySummary = await getTodaySummary(storeId);
    const taxRate = getOrderTaxRate(posSettings, "eat_in");
    const taxSummary = calculateTaxSummary({
      subtotalAmount: amount,
      discountAmount: 0,
      couponDiscountAmount: 0,
      taxRate,
      priceTaxMode: posSettings.priceTaxMode
    });
    return Response.json({
      ok: true,
      orderId: orderIds[orderIds.length - 1],
      pickupCode: (orders as Array<{ pickupCode: string }>).map((order) => order.pickupCode).join("・"),
      amount,
      receiptRequested,
      ...invoiceDetails,
      subtotalAmount: amount,
      taxableAmount: taxSummary.taxableAmount,
      taxAmount: taxSummary.taxAmount,
      taxRate,
      priceTaxMode: posSettings.priceTaxMode,
      discountAmount: 0,
      discountName: "",
      discountPresetKey: "",
      couponId: "",
      couponCode: "",
      couponName: "",
      couponDiscountAmount: 0,
      cashTenderedAmount,
      cashChangeAmount,
      tableSessionKey,
      tableLabel,
      tableOrderCount: orders.length,
      loyaltyMember: null,
      todaySummary
    });
  }

  const posMenuConfig = await readPosMenuConfig(storeId);
  const dineInState = await readDineInMenus(storeId);
  if (orderType === 'eat_in' && body.dineInAssociationVersion !== 1 && dineInState.menus.some(menu => menu.enabled && menu.catalog.optionGroups.some(group => group.explicitItemLinks))) {
    return Response.json({ error: '選択グループの関連設定が更新されました。メニュー更新だけでなく、POS のページ全体を再読み込みしてから会計してください。', code: 'POS_DINE_IN_ASSOCIATION_REFRESH_REQUIRED' }, { status: 409 });
  }
  const localMenu = orderType === 'eat_in' ? await resolveDineInCatalog(storeId, dineInState) : null;
  const fulfillmentModes = dineInSourceFulfillmentModes(dineInState);
  const enforcePhysicalFulfillmentRevision = body.posFulfillmentPolicyVersion === 1 && dineInState.ready;
  if (enforcePhysicalFulfillmentRevision && body.dineInMenuRevision !== dineInState.revision) {
    return Response.json({error:'提供方法の設定が変更されました。メニューを更新して内容を確認してください。',code:'POS_FULFILLMENT_MENU_CHANGED'},{status:409});
  }
  const independentBrands = new Set(localMenu?.brandIds ?? []);
  if (orderType === 'eat_in' && (independentBrands.size || body.dineInMenuRevision) && body.dineInMenuRevision !== dineInState.revision) {
    return Response.json({error:'店内飲食メニューが変更されました。再読込して商品を選び直してください。'},{status:409});
  }
  if (posMenuConfig.settings.length && body.posMenuRevision !== posMenuConfig.revision) return Response.json({error:'店内メニューが変更されました。再読込して内容を確認してください。'},{status:409});
  const shownItemIds = posMenuConfig.settings.filter(s=>s.kind==='item'&&s.visible===true).map(s=>s.targetId);
  const requestedIds = Array.from(new Set(cartItems.map((item) => normalizeText(item.menuCatalogItemId)).filter(Boolean)));
  if (requestedIds.length === 0) {
    return Response.json({ error: "商品を選択してください。" }, { status: 400 });
  }

  const menuRows = await sql`
    select
      menu_catalog_items.id::text,
      menu_catalog_items.brand_id::text as "brandId",
      menu_catalog_items.name,
      brands.name as "brandName",
      coalesce(menu_catalog_items.display_names, '{}'::jsonb) as "displayNames",
      menu_catalog_items.item_kind as "itemKind",
      coalesce(menu_catalog_items.category, '') as category,
      menu_catalog_items.variable_schema as "variableSchema",
      coalesce(nullif(store_brands.pos_pricing_mode, ''), 'fixed') as "posPricingMode",
      coalesce(nullif(store_brands.pos_weight_unit, ''), 'g') as "posWeightUnit",
      store_brands.pos_weight_unit_price::float as "posWeightUnitPrice",
      menu_catalog_items.base_price::float as "basePrice",
      coalesce(menu_store_settings.price_override, menu_catalog_items.base_price, 0)::int as price
    from menu_catalog_items
    join brands on brands.id = menu_catalog_items.brand_id
    join store_brands
      on store_brands.brand_id = menu_catalog_items.brand_id
      and store_brands.store_id = ${storeId}
    left join menu_store_settings
      on menu_store_settings.menu_catalog_item_id = menu_catalog_items.id
      and menu_store_settings.store_id = ${storeId}
    where menu_catalog_items.is_active = true
      and menu_catalog_items.store_id is null
      and (coalesce(menu_store_settings.pos_enabled, true) = true or menu_catalog_items.id::text = any(${shownItemIds}))
      and coalesce(menu_store_settings.is_available, true) = true
  `;
  if ((menuRows as Array<{ id: string; name: string }>).some((item) => requestedIds.includes(item.id) && !isPosSellableItem(item))) {
    return Response.json({ error: "案内専用の商品は会計できません。商品を選び直してください。" }, { status: 400 });
  }
  type CheckoutMenuItem = {
    id: string;
    brandId: string;
    brandName: string;
    name: string;
    displayNames?: Record<string, string>;
    itemKind: string;
    category: string;
    posPricingMode: string;
    posPricingOverride?: 'fixed' | 'weight';
    posWeightUnit: string;
    posWeightUnitPrice: number | null;
    price: number;
    basePrice: number | null;
    variableSchema: Record<string, unknown>;
    sourceItemId?: string;
    optionGroupIds?: string[];
    fulfillmentMode?: PosItemFulfillmentMode;
    productionType?: 'bowl' | 'drink' | 'item';
    dineInMenuRevision?: string;
  };
  const checkoutMenuItems: CheckoutMenuItem[] = [
    ...applyPosItems((menuRows as CheckoutMenuItem[]).map(normalizePosItemPricing), posMenuConfig.settings).filter(item => !independentBrands.has(item.brandId)),
    ...(localMenu?.items ?? []).map(item => ({...item, price:Number(item.price ?? item.priceOverride ?? item.basePrice ?? 0)}))
  ].map(item => ({ ...item, fulfillmentMode: getPosItemFulfillmentMode({ ...item,
    fulfillmentMode: item.sourceItemId ? item.fulfillmentMode : fulfillmentModes.get(item.id)
  }) }));
  const menuById = new Map(checkoutMenuItems.filter(isPosSellableItem).map(item => [item.id, item]));
  const optionRows = await sql`
    select
      menu_options.id::text,
      menu_options.option_key as "optionKey",
      menu_options.name,
      coalesce(menu_options.applicable_categories, '{}') as "applicableCategories",
      coalesce(menu_options.display_names, '{}'::jsonb) as "displayNames",
      coalesce(menu_options.price_delta, 0)::int as "priceDelta",
      menu_option_groups.id::text as "groupId",
      menu_option_groups.brand_id::text as "brandId",
      coalesce(menu_option_groups.menu_catalog_item_id::text, '') as "menuCatalogItemId",
      coalesce(menu_option_groups.applicable_categories, '{}') as "groupApplicableCategories",
      menu_option_groups.group_key as "groupKey",
      menu_option_groups.name as "groupName",
      coalesce(menu_option_groups.display_names, '{}'::jsonb) as "groupDisplayNames",
      menu_option_groups.selection_type as "selectionType",
      menu_option_groups.rule_json as "ruleJson"
    from menu_options
    join menu_option_groups on menu_option_groups.id = menu_options.option_group_id
    join store_brands
      on store_brands.brand_id = menu_option_groups.brand_id
      and store_brands.store_id = ${storeId}
    left join menu_option_store_settings
      on menu_option_store_settings.menu_option_id = menu_options.id
      and menu_option_store_settings.store_id = ${storeId}
    where menu_options.is_active = true
      and menu_option_groups.is_active = true
      and coalesce(menu_option_store_settings.is_available, true) = true

  `;
  type CheckoutMenuOption = {
    id: string;
    optionKey: string;
    name: string;
    groupApplicableCategories: string[];
    displayNames?: Record<string, string>;
    priceDelta: number;
    groupId: string;
    brandId: string;
    menuCatalogItemId: string;
    applicableCategories: string[];
    groupKey: string;
    groupName: string;
    groupDisplayNames?: Record<string, string>;
    selectionType: string;
    ruleJson: Record<string, unknown>;
    posEnabled?: boolean;
    sourceOptionId?: string;
    localOnly?: true;
    localOriginId?: string;
    sourceGroupId?: string;
    sourceGroupRuleJson?: Record<string, unknown>;
    sourceName?: string;
    groupSourceName?: string;
    localKind?: string;
    explicitItemLinks?: true;
    itemOptionExclusions?: Record<string, string[]>;
    linkedItemId?: string;
    linkedSourceItemId?: string;
    complimentary?: true;
    campaignKey?: string;
    originalUnitPrice?: number;
    giftSourceGroupName?: string;
  };
  const checkoutOptions: CheckoutMenuOption[] = [
    ...applyPosOptions(optionRows as CheckoutMenuOption[],posMenuConfig.settings).filter(option => !independentBrands.has(option.brandId)),
    ...(localMenu ? flattenDineInOptions(localMenu) : []).map(option => ({...option,priceDelta:Number(option.priceDelta ?? 0)}))
  ];
  const optionsById = new Map(checkoutOptions.map(option => [option.id, option]));

  // Read immutable captures only from this cashier's scoped station. Client metadata is display-only.
  const requestedCaptures=cartItems.map(item=>normalizeText(item.scaleCaptureId)).filter(Boolean);
  const captureRows=requestedCaptures.length?await sql`select c.id::text,c.grams::float,c.reading
    from store_relay_scale_captures c join store_relay_stations s on s.id=c.station_id
    where s.store_id::text=${storeId} and c.id::text=any(${requestedCaptures}::text[])
      and c.station_id::text=${body.relayOwner?.stationId||''} and c.epoch=${body.relayOwner?.epoch??-1}
      and c.employee_id::text=${session.id} and c.order_id is null`:[];
  const captureById=new Map(captureRows.map(c=>[String(c.id),c]));

  let normalizedItems: Array<{
    id: string;
    brandId: string;
    brandName: string;
    name: string;
    displayNames?: Record<string, string>;
    itemKind: string;
    category: string;
    posPricingMode: string;
    posPricingOverride?: 'fixed' | 'weight';
    posWeightUnit: string;
    posWeightUnitPrice: number | null;
    quantity: number;
    unitPrice: number;
    amount: number;
    measuredQuantity: number | null;
    measuredUnit: string;
    measuredUnitPrice: number | null;
    preparationNote: string;
    scaleCaptureId: string;
    weightMeasurement?: PosWeightMeasurement;
    selectedOptions: Array<NonNullable<ReturnType<typeof optionsById.get>>>;
    bowlBenefit?: PosBowlChoice;
    sourceItemId?: string;
    fulfillmentMode?: PosItemFulfillmentMode;
    productionType?: 'bowl' | 'drink' | 'item';
    dineInMenuRevision?: string;
  }> = [];
  try {
    normalizedItems = cartItems.map((item) => {
      const menuItem = menuById.get(normalizeText(item.menuCatalogItemId));
      if (!menuItem) throw new Error("商品の販売状態が変わりました。商品を選び直してください。");
      if (offlineQueued && body.posFulfillmentPolicyVersion === 1 && item.fulfillmentMode !== getPosItemFulfillmentMode(menuItem))
        throw new Error('オフライン会計時の提供方法と現在の設定が一致しません。元の会計を確認してください。');
      if (item.bowlBenefit && (!isPosBowl(menuItem) || Number(item.quantity) !== 1 || offlineQueued)) throw new Error("特典はオンラインで1杯ずつ選択してください。");
      const weightPricing = getWeightPricingConfig(menuItem, orderType);
      const quantity = toPositiveInt(item.quantity);
      const measuredQuantity = weightPricing ? toPositiveMeasuredQuantity(item.measuredQuantity) : null;
      const measuredUnit = weightPricing?.unit ?? "";
      const measuredUnitPrice = weightPricing?.unitPrice ?? null;
      if (weightPricing && (measuredUnitPrice === null || measuredUnitPrice <= 0)) {
        throw new Error(`${menuItem.name} の重量単価が設定されていません。`);
      }
      if (weightPricing && measuredQuantity === null) {
        throw new Error(`${menuItem.name} は重量を入力してください。`);
      }
      const captureId=normalizeText(item.scaleCaptureId);
      let weightMeasurement:PosWeightMeasurement|undefined;
      if(weightPricing){
        if(captureId){
          const capture=captureById.get(captureId);
          const grams=Number(measuredQuantity)*(measuredUnit==='kg'?1000:measuredUnit==='g'?1:NaN);
          if(!capture||!Number.isFinite(grams)||Math.abs(Number(capture.grams)-grams)>=0.0001)
            throw Object.assign(new Error('計量データを確認してください。'),{status:409});
          weightMeasurement=posWeightMeasurementFromReading(capture.reading);
          if(posSettings.scaleTareSettings.enabled&&weightMeasurement.mode!=='preset')
            throw Object.assign(new Error('ボウルの重量設定が変わりました。POSを再読み込みして量り直してください。'),{status:409});
        }else if(item.weightMeasurement?.mode==='manual_net')weightMeasurement={mode:'manual_net'};
        else if(posSettings.scaleTareSettings.enabled)throw Object.assign(new Error('ボウルの重量設定が変わりました。POSを再読み込みし、食材の正味重量を確認してください。'),{status:409});
      }
      const unitPrice = weightPricing ? Math.round((measuredQuantity ?? 0) * (measuredUnitPrice ?? 0)) : Number(menuItem.price ?? 0);
      const selectedOptions = Array.isArray(item.selectedOptions) ? item.selectedOptions : [];
      const selected = selectedOptions.flatMap((group) => asStringArray(group.optionIds).map((optionId) => optionsById.get(optionId)).filter(Boolean)) as Array<NonNullable<ReturnType<typeof optionsById.get>>>;
      // Build the dependency context from trusted option rows, not client-supplied group IDs.
      const dependencySelection: Record<string, string[]> = {};
      for (const option of selected) (dependencySelection[option.groupId] ||= []).push(option.id);
      const isAllowedOption = (option: NonNullable<ReturnType<typeof optionsById.get>>) => {
        if (!isPosOptionAllowed(option, option.id, dependencySelection)) return false;
        if (menuItem.optionGroupIds && !menuItem.optionGroupIds.includes(option.groupId)) return false;
        const scopedGroup = { id: option.groupId, brandId: option.brandId, menuCatalogItemId: option.menuCatalogItemId,
          applicableCategories: option.groupApplicableCategories, groupKey: option.groupKey, name: option.groupName,
          sourceName: option.groupSourceName, posEnabled: option.posEnabled, localKind: option.localKind,
          explicitItemLinks: option.explicitItemLinks, itemOptionExclusions: option.itemOptionExclusions };
        const scopedItem = { ...menuItem, posPricingMode: weightPricing ? 'weight' : 'fixed' };
        return dineInOptionAppliesToItem(option, scopedGroup, scopedItem);
      };
      const validSelected = selected.filter(isAllowedOption);
      const requestedOptionCount = selectedOptions.reduce((sum, group) => sum + asStringArray(group.optionIds).length, 0);
      if (validSelected.length !== requestedOptionCount) throw new Error("選択肢の販売状態が変わりました。内容を選び直してください。");
      const groupedCounts = new Map<string, { count: number; optionIds: Set<string>; optionCounts: Map<string, number>; selectionType: string; limit: number; perOptionMax: number; storeOwned: boolean; groupName: string }>();
      for (const option of validSelected) {
        const selectionType = getEffectiveSelectionType(option);
        const current = groupedCounts.get(option.groupId) ?? {
          count: 0,
          optionIds: new Set<string>(),
          optionCounts: new Map<string, number>(),
          selectionType,
          limit: getPosOptionSelectionRules(option).max,
          perOptionMax: getPosOptionSelectionRules(option).perOptionMax,
          storeOwned: isStoreDineInSelection(option),
          groupName: option.groupName
        };
        current.count += 1;
        current.optionIds.add(option.id);
        current.optionCounts.set(option.id, (current.optionCounts.get(option.id) || 0) + 1);
        groupedCounts.set(option.groupId, current);
      }
      for (const group of groupedCounts.values()) {
        if (group.selectionType === "single" && group.count > 1) {
          throw new Error(`${group.groupName} は1つだけ選択できます。`);
        }
        if (group.selectionType === "multiple" && group.optionIds.size !== group.count) {
          throw new Error(`${group.groupName} は同じ選択肢を重複して選べません。`);
        }
        if (group.storeOwned && [...group.optionCounts.values()].some(count => count > group.perOptionMax)) {
          throw new Error(`${group.groupName} は同じ選択肢を最大${group.perOptionMax}点までです。`);
        }
        if (group.count > group.limit) {
          throw new Error(`${group.groupName} は最大${group.limit}点までです。`);
        }
      }
      const applicableGroups = new Map(Array.from(optionsById.values()).filter(isAllowedOption).map((option) => [option.groupId, option]));
      for (const [groupId, option] of applicableGroups) {
        const minimum = getPosOptionSelectionRules(option).min;
        if ((groupedCounts.get(groupId)?.count || 0) < minimum) throw new Error(`${option.groupName} を選択してください。`);
      }
      const optionTotal = validSelected.reduce((sum, option) => sum + Number(option.priceDelta ?? 0), 0);
      return {
        ...menuItem,
        bowlBenefit: item.bowlBenefit,
        quantity,
        unitPrice,
        measuredQuantity,
        measuredUnit,
        measuredUnitPrice,
        preparationNote: normalizeText(item.preparationNote).slice(0, 300),
        scaleCaptureId: captureId,
        weightMeasurement,
        // Association scopes validate the current menu, not a historical sale. Do not
        // repeat a whole group's per-product exclusions in every ordered option.
        selectedOptions: validSelected.map(({ explicitItemLinks: _links, itemOptionExclusions: _exclusions, ...option }) => option),
        amount: (unitPrice + optionTotal) * quantity
      };
    }).filter(Boolean) as typeof normalizedItems;
    normalizedItems = expandPosBowls(normalizedItems);
    if (normalizedItems.length > 99) throw new Error("1回の会計は99明細までです。");
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "選択数が正しくありません。" }, { status: (error as {status?:number}).status===409?409:400 });
  }

  if (normalizedItems.length === 0) {
    return Response.json({ error: "POS で販売できる商品がありません。" }, { status: 400 });
  }
  const hasPreparation = normalizedItems.some(item => getPosItemFulfillmentMode(item) !== 'immediate');
  if (normalizedItems.some(item => getPosItemFulfillmentMode(item) === 'immediate') && body.posFulfillmentPolicyVersion !== 1) {
    return Response.json({error:'提供方法の設定が更新されました。POS のページ全体を再読み込みしてください。',code:'POS_FULFILLMENT_REFRESH_REQUIRED'},{status:409});
  }
  const containsMalatang = await containsMalatangBrand(Array.from(new Set(normalizedItems.map((item) => item.brandId))));
  if (orderType === "eat_in" && !containsMalatang) {
    return Response.json({
      error: "ドリンクのみのご注文はお持ち帰りです。店内利用にはマーラータンのご注文が必要です。"
    }, { status: 400 });
  }

  const subtotalAmount = normalizedItems.reduce((sum, item) => sum + item.amount, 0);
  const manualPreset = requestedDiscountPresetKey
    ? posSettings.discountPresets.find(preset => preset.key === requestedDiscountPresetKey && preset.enabled && preset.applicationMode !== "campaign")
    : undefined;
  if (requestedDiscountPresetKey && !manualPreset) {
    return Response.json({ error: "利用できない割引です。" }, { status: 400 });
  }
  const discountEvaluatedAt = new Date();
  // Queued offline sales keep the amount recorded at sale time; do not apply today's promotion retroactively.
  const discountEvaluation = evaluatePosDiscounts(offlineQueued ? [] : posSettings.discountPresets,
    requestedDiscountPresetKey, normalizedItems, subtotalAmount, discountEvaluatedAt);
  const giftCatalog = [...checkoutMenuItems.filter(item => !isPosBowl(item)).map(item => ({
    id: item.id, sourceItemId: item.sourceItemId, brandId: item.brandId, category: item.category,
    name: item.name, displayNames: item.displayNames, price: Number(item.price), available: true,
    fixed: !getWeightPricingConfig(item, orderType),
    requiresOptions: checkoutOptions.some(option => (!item.optionGroupIds || item.optionGroupIds.includes(option.groupId)) && getPosOptionSelectionRules(option).min > 0 && dineInOptionAppliesToItem(option, {
      ...option, id:option.groupId, name:option.groupName, applicableCategories:option.groupApplicableCategories
    }, item))
  })), ...checkoutOptions.map(option => createPosOptionGift(option))];
  const bowlEvaluation = evaluatePosBowlBenefits(offlineQueued ? [] : posSettings.discountPresets, requestedDiscountPresetKey,
    normalizedItems.map(item => ({ ...item, isBowl:isPosBowl(item), choice:item.bowlBenefit })), giftCatalog, discountEvaluatedAt);
  const hasBowlChoice = bowlEvaluation.applications.length > 0 || normalizedItems.some(item => item.bowlBenefit);
  if (bowlEvaluation.errors.length) return Response.json({code:"POS_BOWL_BENEFIT_CHANGED",error:bowlEvaluation.errors[0]}, {status:409});
  const discountPreset = bowlEvaluation.preset;
  discountPresetKey = bowlEvaluation.appliedKey;
  const posDiscountAmount = bowlEvaluation.amount;
  if (!offlineQueued && (hasBowlChoice ? !matchesPosBowlQuote(body.discountQuote, bowlEvaluation) :
    (body.discountQuote !== undefined || discountPreset?.applicationMode === "campaign") && !matchesPosDiscountQuote(body.discountQuote, discountEvaluation))) {
    return Response.json({ code: hasBowlChoice ? "POS_BOWL_BENEFIT_CHANGED" : "POS_DISCOUNT_CHANGED",
      error: hasBowlChoice ? "特典設定が変わりました。メニューを更新して、特典を選び直してください。" : "割引・キャンペーン条件が変わりました。金額を確認し直してください。",
      storeId, discountPresets: posSettings.discountPresets, serverTime: discountEvaluatedAt.toISOString() }, { status: 409 });
  }
  if (bowlEvaluation.usedRules.some(rule => !rule.allowCouponCombination) && couponId) {
    return Response.json({ error: "割引とクーポンは同時に利用できません。" }, { status: 400 });
  }
  if (discountPreset && posDiscountAmount <= 0 && !bowlEvaluation.applications.some(a => a.kind === "gift")) {
    return Response.json({ error: "この注文では割引を適用できません。" }, { status: 400 });
  }
  for (const application of bowlEvaluation.applications) {
    if (!application.gift) continue;
    const gift = application.gift;
    if (gift.kind === "option") {
      const source = optionsById.get(gift.optionId!);
      if (!source) return Response.json({code:"POS_BOWL_BENEFIT_CHANGED",error:"プレゼントの選択肢を選び直してください。"},{status:409});
      normalizedItems[application.index].selectedOptions.push({ ...source, priceDelta:0, complimentary:true,
        campaignKey:application.campaignKey, originalUnitPrice:gift.price, giftSourceGroupName:source.groupName,
        groupKey:"campaign_gift",groupName:"サービス ¥0",groupDisplayNames:{en:"Complimentary ¥0",zh:"赠品 ¥0","zh-Hans":"赠品 ¥0","zh-Hant":"贈品 ¥0"} });
      continue;
    }
    normalizedItems[application.index].selectedOptions.push({
      complimentary:true, campaignKey:application.campaignKey, originalUnitPrice:gift.price,
      id: `campaign-gift:${gift.id}`, optionKey: `campaign-gift:${gift.id}`, name:gift.name,
      displayNames:gift.displayNames, priceDelta:0, groupId:`campaign:${application.campaignKey}`,
      groupKey:"campaign_gift", groupName:"サービス ¥0", groupDisplayNames:{en:"Complimentary ¥0",zh:"赠品 ¥0","zh-Hans":"赠品 ¥0","zh-Hant":"贈品 ¥0",ko:"증정 ¥0",vi:"Quà tặng ¥0",ne:"उपहार ¥0"},
      brandId:gift.brandId, menuCatalogItemId:"", applicableCategories:[], groupApplicableCategories:[],
      selectionType:"single", ruleJson:{}, linkedItemId:gift.id, linkedSourceItemId:gift.sourceItemId || gift.id
    });
  }
  const cashSessionId = await getOpenCashSessionId(storeId);
  if (!cashSessionId) {
    const recorded = await findRecordedCheckout();
    if (recorded) return recorded;
    return Response.json({ error: "POS 会計の前に開店前のレジ金額を確認してください。" }, { status: 400 });
  }
  const { pickupDate, pickupTime } = getJstParts();
  const legacyOfflineBowl = offlineQueued && body.bowlTicketVersion !== 1 && /^(?:0?[1-9]|[12]\d|30)$/.test(normalizeText(body.bowlNumber))
    && offlinePickupCode === String(Number(body.bowlNumber)).padStart(2, "0");
  if (containsMalatang && !offlineQueued && body.bowlTicketVersion !== 1) {
    return Response.json({ error: "POSを再読み込みしてください。新しい1杯ごとの伝票発行に更新されました。" }, { status: 409 });
  }
  const bowlIndexes = legacyOfflineBowl ? [] : normalizedItems.flatMap((item, index) => isPosBowl(item) ? [index] : []);
  if (offlineQueued && bowlIndexes.length && !/^O[A-F0-9]{8,20}$/.test(offlinePickupCode)) {
    return Response.json({ error: "オフライン受付番号が正しくありません。" }, { status: 400 });
  }
  let bowlCodes: string[] = [];
  try {
    if (bowlIndexes.length && !offlineQueued) bowlCodes = await allocatePosBowlCodes(storeId, bowlIndexes.length, cashSessionId);
  } catch (error) {
    if (error instanceof PosCashSessionChangedError) {
      const recorded = await findRecordedCheckout();
      if (recorded) return recorded;
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
  const servingTickets = legacyOfflineBowl ? [] : offlineQueued
    ? offlineServingTickets(normalizedItems, offlinePickupCode)
    : bowlIndexes.map((itemIndex, index) => ({ itemIndex, pickupCode: bowlCodes[index] }));
  const pickupCode = (offlineClientOrderId && /^[A-Z0-9-]{1,24}$/.test(offlinePickupCode)
    ? offlinePickupCode : createPickupCode("D"));
  const brandId = normalizedItems[0]?.brandId ?? null;
  const firstItemName = normalizedItems[0]?.name ?? "";
  const member = await resolveMemberForOrder({
    memberId,
    memberToken,
    phone: memberPhone,
    email: memberEmail,
    displayName: memberName,
    metadata: { source: "store_pos" }
  });
  let coupon: Awaited<ReturnType<typeof getUsableMemberCoupon>> | null = null;
  let couponDiscountAmount = 0;
  let couponItemIndex = -1;
  if (couponId) {
    if (!member?.id) return Response.json({ error: "クーポン利用には会員確認が必要です。" }, { status: 400 });
    coupon = await getUsableMemberCoupon(member.id, couponId);
    if (!coupon) return Response.json({ error: "利用できないクーポンです。" }, { status: 400 });
    const exchangeEligibleCandidates = normalizedItems.flatMap((item, index) => {
      if (coupon?.brandId && item.brandId !== coupon.brandId) return [];
      if (item.measuredQuantity) return [];
      const sizeReduction = item.selectedOptions
        .filter((option) => option.groupKey === "size")
        .reduce((sum, option) => sum + Math.min(0, Number(option.priceDelta ?? 0)), 0);
      const bodyAmount = Math.max(0, Math.round(item.unitPrice + sizeReduction));
      return bodyAmount > 0 ? [{ index, amount: bodyAmount }] : [];
    });
    const exchangeEligibleAmounts = exchangeEligibleCandidates.map((candidate) => candidate.amount);
    couponDiscountAmount = calculateCouponDiscount(coupon, subtotalAmount, exchangeEligibleAmounts);
    if (isMemberExchangeCoupon(coupon) && couponDiscountAmount > 0) {
      couponItemIndex = exchangeEligibleCandidates.reduce((bestIndex, candidate, candidateIndex) => (
        candidate.amount > exchangeEligibleCandidates[bestIndex]?.amount ? candidateIndex : bestIndex
      ), 0);
      couponItemIndex = exchangeEligibleCandidates[couponItemIndex]?.index ?? -1;
    }
    if (couponDiscountAmount <= 0) return Response.json({ error: "この注文ではクーポンを適用できません。" }, { status: 400 });
  }
  const itemDiscountAmounts = bowlEvaluation.allocations;
  const couponBases = normalizedItems.map((item, index) => Math.max(0, item.amount - itemDiscountAmounts[index]));
  const itemCouponDiscountAmounts = normalizedItems.map(() => 0);
  if (couponDiscountAmount > 0 && coupon) {
    if (couponItemIndex >= 0) {
      itemCouponDiscountAmounts[couponItemIndex] = Math.min(couponDiscountAmount, couponBases[couponItemIndex]);
    } else {
      const couponShares = allocateAmountByWeight(couponDiscountAmount, couponBases);
      couponShares.forEach((share, index) => {
        itemCouponDiscountAmounts[index] = Math.min(share, couponBases[index]);
      });
    }
  }
  const itemPaidAmounts = normalizedItems.map((item, index) => Math.max(0, item.amount - itemDiscountAmounts[index] - itemCouponDiscountAmounts[index]));
  const taxRate = getOrderTaxRate(posSettings, orderType);
  const taxSummary = calculateTaxSummary({
    subtotalAmount,
    discountAmount: posDiscountAmount,
    couponDiscountAmount,
    taxRate,
    priceTaxMode: posSettings.priceTaxMode
  });
  const amount = taxSummary.amount;
  if (offlineClientOrderId && Number.isFinite(offlineExpectedAmount) && offlineExpectedAmount > 0 && amount !== Math.round(offlineExpectedAmount)) {
    return Response.json({ error: offlineQueued
      ? `オフライン会計時の金額と現在のメニュー金額が一致しません（会計時 ${offlineExpectedAmount}円 / 現在 ${amount}円）。管理者の確認が必要です。`
      : 'メニューの価格が変更されました。再読込して商品を選び直してください。' }, { status: 409 });
  }
  if (
    paymentMethod === "cash" &&
    (cashTenderedAmount === null || !Number.isFinite(cashTenderedAmount) || cashTenderedAmount < amount)
  ) {
    return Response.json({ error: "現金会計はお預かり金額を合計以上で入力してください。" }, { status: 400 });
  }
  const cashChangeAmount = paymentMethod === "cash" && cashTenderedAmount !== null ? cashTenderedAmount - amount : null;

  const orderId = randomUUID();
  const orderItemIds = normalizedItems.map(() => randomUUID());
  const handoffTime = new Date().toISOString();
  const posItemFulfillment = createPosItemFulfillmentSnapshot(normalizedItems.map((item, index) => ({ ...item, orderItemId: orderItemIds[index] })), handoffTime);
  const printSnapshots = durablePrintDocuments ? buildPosPrintDocumentSnapshots(posSettings.printerSettings,
    access.stores.find(store => store.id === storeId)?.name || 'Foundr1 STORE', {
      pickupCode, orderType, paymentMethod, amount, subtotalAmount, discountAmount: posDiscountAmount, couponDiscountAmount,
      taxAmount: taxSummary.taxAmount, taxRate, cashTenderedAmount, cashChangeAmount, receiptRequested, ...invoiceDetails, note,
      memberLanguage: normalizeMemberLanguage(member?.preferredLanguage || memberLanguage), cashierName: session.name
    }, normalizedItems.map((item, index) => ({ ...item, orderItemId: orderItemIds[index] })),
    servingTickets.map(ticket => ({ ...ticket, itemId: orderItemIds[ticket.itemIndex] })), printMode) : [];
  const printDocuments = durablePrintDocuments ? { version: 1 as const, orderId, mode: printMode,
    documentCount: printSnapshots.length, pendingCount: printSnapshots.filter(snapshot => snapshot.requested).length } : undefined;
  const writes = [sql`
    insert into store_customer_orders (
      id,
      brand_id,
      store_id,
      order_source,
      offline_client_order_id,
      offline_created_at,
      pickup_code,
      status,
      payment_status,
      payment_provider,
      member_id,
      pickup_date,
      pickup_time,
      amount,
      currency,
      customer_summary,
      drink,
      paid_at,
      completed_at,
      payment_updated_at,
      pos_cash_session_id,
      updated_at
    )
    values (
      ${orderId},
      ${brandId},
      ${storeId},
      'store_pos',
      ${offlineClientOrderId || null},
      ${offlineCreatedAt || null},
      ${pickupCode},
      ${hasPreparation ? 'new' : 'completed'},
      'paid',
      ${paymentMethod},
      ${member?.id ?? null},
      ${pickupDate},
      ${pickupTime},
      ${amount},
      'JPY',
      ${JSON.stringify({
        orderType,
        servingTickets,
        posItemFulfillment,
        hasPreparation,
        posFulfillmentPolicyVersion: 1,
        checkoutFingerprint,
        relayPrinting,
        printDocuments,
        relayStationId: relayPrinting ? relayStation?.id : undefined,
        note,
        cashierId: session.id,
        cashierName: session.name,
        memberId: member?.id ?? "",
        memberNumber: member?.memberNumber ?? "",
        memberLabel: member ? (member.displayName || member.phone || member.email || member.memberNumber) : "",
        memberLanguage: normalizeMemberLanguage(member?.preferredLanguage || memberLanguage),
        subtotalAmount,
        taxableAmount: taxSummary.taxableAmount,
        taxAmount: taxSummary.taxAmount,
        taxRate,
        priceTaxMode: posSettings.priceTaxMode,
        discountPresetKey,
        discountPresetName: discountPreset?.name ?? "",
        bowlBenefits: bowlEvaluation.applications.map(a => ({ ...a, evaluatedAt:discountEvaluatedAt.toISOString(), rule:posSettings.discountPresets.find(r => r.key === a.campaignKey) })),
        discountSource: discountPreset?.applicationMode === "campaign" ? "campaign" : "manual",
        discountCampaign: discountPreset?.applicationMode === "campaign" ? {
          key: discountPreset.key, name: discountPreset.name, startsOn: discountPreset.startsOn, endsOn: discountPreset.endsOn,
          minimumSubtotal: discountPreset.minimumSubtotal, discountType: discountPreset.discountType,
          discountValue: discountPreset.discountValue, targetScope: discountPreset.targetScope, targetValue: discountPreset.targetValue,
          evaluatedAt: discountEvaluatedAt.toISOString(), amount: posDiscountAmount
        } : null,
        discountAmount: posDiscountAmount,
        stampEligible: bowlEvaluation.usedRules.every(rule => rule.stampEligible),
        couponId: coupon?.id ?? "",
        couponCode: coupon?.couponCode ?? "",
        couponName: coupon?.name ?? "",
        couponDiscountAmount,
        receiptRequested,
        ...invoiceDetails,
        cashTenderedAmount,
        cashChangeAmount,
        itemCount: normalizedItems.reduce((sum, item) => sum + item.quantity, 0),
        items: normalizedItems.map((item) => ({
          menuCatalogItemId: item.sourceItemId || item.id,
          storeMenuItemId: item.sourceItemId ? item.id : undefined,
          storeMenuRevision: item.dineInMenuRevision,
          name: item.name,
          displayNames: item.displayNames,
          productionType: item.productionType,
          fulfillmentMode: getPosItemFulfillmentMode(item),
          quantity: item.quantity,
          scaleCaptureId: item.scaleCaptureId || undefined,
          weightMeasurement: item.weightMeasurement,
          measuredQuantity: item.measuredQuantity,
          measuredUnit: item.measuredUnit,
          measuredUnitPrice: item.measuredUnitPrice,
          preparationNote: item.preparationNote,
          options: "selectedOptions" in item ? item.selectedOptions : []
        }))
      })},
      ${firstItemName},
      now(),
      ${hasPreparation ? null : handoffTime}::timestamptz,
      now(),
      ${cashSessionId ?? null},
      now()
    )
    on conflict (offline_client_order_id) where offline_client_order_id is not null do nothing
    returning id::text
  `];

  for (let index = 0; index < normalizedItems.length; index += 1) {
    const item = normalizedItems[index];
    const selectedOptions = item.selectedOptions;
    const groupLabels = new Map<string, string[]>();
    for (const option of selectedOptions) {
      const labels = groupLabels.get(option.groupKey) ?? [];
      labels.push(option.name);
      groupLabels.set(option.groupKey, labels);
    }
    const sizeLabel = groupLabels.get("size")?.join(", ") ?? "";
    const temperature = groupLabels.get("temperature")?.join(", ") ?? "";
    const sweetness = groupLabels.get("sweetness")?.join(", ") ?? "";
    const ice = groupLabels.get("ice")?.join(", ") ?? "";
    const optionLabels = selectedOptions
      .filter((option) => option.groupKey === "option")
      .map((option) => option.name);
    const toppingOptions = selectedOptions.filter((option) => option.groupKey === "topping" || !["size", "temperature", "sweetness", "ice", "option"].includes(option.groupKey));
    // A store addon group can combine several canonical source groups. Persist each
    // source group separately so inventory keeps canonical identities; local labels remain snapshots.
    const customizationKey = (option: CheckoutMenuOption) => `${option.groupId}:${option.sourceGroupId || option.groupId}:${option.linkedItemId ? "product" : isLocalDineInOption(option) ? "local" : "option"}:${option.complimentary ? "gift" : "paid"}`;
    const customizations = Array.from(new Set(selectedOptions.map(customizationKey))).map((key) => {
      const options = selectedOptions.filter((option) => customizationKey(option) === key);
      const groupId = options[0].groupId;
      const group = options[0];
      return {
        groupId: group.sourceGroupId || groupId,
        storeMenuGroupId: isStoreDineInSelection(group) ? groupId : undefined,
        storeMenuOptionIds: isStoreDineInSelection(group) ? options.map(option => option.id) : undefined,
        groupKey: group.groupKey, groupName: group.groupName, groupDisplayNames: group.groupDisplayNames, selectionType: getEffectiveSelectionType(group),
        optionDisplayNames: options.map(option => option.displayNames),
        ...(group.complimentary ? { complimentary:true, campaignKey:group.campaignKey, giftSourceGroupName:group.giftSourceGroupName,
          originalOptionPrices:options.map(option=>option.originalUnitPrice ?? 0) } : {}),
        // Native store choices and product-backed choices never become canonical
        // menu_option identities. Separate groups keep all display arrays aligned.
        optionIds: options.filter(option => !option.linkedItemId && !isLocalDineInOption(option)).map((option) => option.sourceOptionId || option.id),
        ...(options.some(isLocalDineInOption) ? { localOptions: options.filter(isLocalDineInOption).map(option => {
          const grams = Number((option.sourceGroupRuleJson || option.ruleJson).portionGrams);
          return { storeMenuOptionId: option.id, localOriginId: option.localOriginId!, name: option.name,
            displayNames: option.displayNames || {}, quantity: 1, unitPrice: option.priceDelta,
            ...(option.complimentary ? {complimentary:true,campaignKey:option.campaignKey,originalUnitPrice:option.originalUnitPrice} : {}),
            portionGrams: Number.isFinite(grams) && grams > 0 && grams <= 99_999 ? grams : null };
        }) } : {}),
        ...(options.some(option => option.linkedItemId) ? { linkedItems: options.filter(option => option.linkedItemId).map(option => ({
          menuCatalogItemId: option.linkedSourceItemId!, storeMenuItemId: option.linkedItemId!,
          name: option.name, displayNames: option.displayNames, quantity: 1, unitPrice: option.priceDelta,
          ...(option.complimentary ? { complimentary:true, campaignKey:option.campaignKey, originalUnitPrice:option.originalUnitPrice ?? 0 } : {})
        })) } : {}),
        optionKeys: options.map((option) => option.optionKey),
        optionLabels: options.map((option) => option.name), optionPrices: options.map((option) => option.priceDelta)
      };
    });
    writes.push(sql`
      insert into store_customer_order_items (
        id,
        order_id,
        pickup_code,
        preparation_note,
        menu_catalog_item_id,
        item_name,
        size_key,
        size_label,
        temperature,
        sweetness,
        ice,
        option_key,
        option_label,
        topping_keys,
        topping_labels,
        customizations,
        quantity,
        measured_quantity,
        measured_unit,
        measured_unit_price,
        weight_measurement,
        amount,
        gross_amount,
        discount_amount,
        coupon_discount_amount,
        paid_amount,
        coupon_id,
        sort_order
      )
      select
        ${orderItemIds[index]}::uuid,
        ${orderId}::uuid,
        ${servingTickets.find((ticket) => ticket.itemIndex === index)?.pickupCode || ""},
        ${item.preparationNote},
        ${item.sourceItemId || item.id}::uuid,
        ${item.name},
        ${selectedOptions.filter((option) => option.groupKey === "size").map((option) => option.optionKey).join(",")},
        ${sizeLabel},
        ${temperature},
        ${sweetness},
        ${ice},
        ${optionLabels.join(",")},
        ${optionLabels.join(", ")},
        ${toppingOptions.map((option) => option.optionKey)},
        ${toppingOptions.map((option) => option.name)},
        ${JSON.stringify(customizations)}::jsonb,
        ${item.quantity},
        ${item.measuredQuantity},
        ${item.measuredUnit},
        ${item.measuredUnitPrice},
        ${JSON.stringify(item.weightMeasurement||{})}::jsonb,
        ${item.amount},
        ${item.amount},
        ${itemDiscountAmounts[index]},
        ${itemCouponDiscountAmounts[index]},
        ${itemPaidAmounts[index]},
        ${itemCouponDiscountAmounts[index] > 0 && coupon?.id ? coupon.id : null},
        ${index}
      where exists (select 1 from store_customer_orders where id = ${orderId}::uuid)
    `);
  }

  if (coupon && member?.id) {
    writes.push(sql`update member_coupons set status='used', used_order_id=${orderId}::uuid,
      used_store_id=${storeId}::uuid, used_at=now()
      where id::text=${coupon.id} and member_id::text=${member.id} and status='available'
        and (expires_at is null or expires_at > now())
        and exists (select 1 from store_customer_orders where id=${orderId}::uuid)`);
    // A raced/expired coupon must roll back the new order and all its items, not leave a paid partial order.
    writes.push(sql`select 1 / case when
      not exists (select 1 from store_customer_orders where id=${orderId}::uuid)
      or exists (select 1 from member_coupons where id::text=${coupon.id} and used_order_id=${orderId}::uuid)
      then 1 else 0 end as coupon_committed`);
  }
  if (durablePrintDocuments) {
    try { writes.push(...posPrintSnapshotWrites({ storeId, orderId, mode: printMode, snapshots: printSnapshots,
      relayStationId: relayPrinting ? String(relayStation?.id || '') : undefined, employeeId: session.id })); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : '印刷設定を確認してください。' }, { status: 409 }); }
  }
  if (!durablePrintDocuments && relayPrinting && relayStation) {
    let documents;
    try { documents = buildRelayDocuments(posSettings.printerSettings, access.stores.find(s=>s.id===storeId)?.name || 'Foundr1 STORE', {
      pickupCode,orderType,paymentMethod,amount,subtotalAmount,discountAmount:posDiscountAmount,couponDiscountAmount,
      taxAmount:taxSummary.taxAmount,taxRate,cashTenderedAmount,cashChangeAmount,receiptRequested,...invoiceDetails,note,
      memberLanguage:normalizeMemberLanguage(member?.preferredLanguage || memberLanguage)
    },normalizedItems,servingTickets); } catch(e) { return Response.json({error:e instanceof Error?e.message:'印刷設定を確認してください。'},{status:409}); }
    for (const [sequence,doc] of documents.entries()) writes.push(sql`insert into store_relay_print_jobs(station_id,store_id,order_id,document_key,sequence,kind,payload,created_by)
      select ${relayStation.id}::uuid,${storeId}::uuid,${orderId}::uuid,${`${orderId}:${sequence}`},${sequence},${doc.kind},${JSON.stringify(doc.payload)}::jsonb,${session.id}::uuid
      where exists(select 1 from store_customer_orders where id=${orderId}::uuid)`);
  }
  const captureIds=new Set<string>();
  for(const item of normalizedItems){
    if(!item.scaleCaptureId)continue;
    if(captureIds.has(item.scaleCaptureId)||item.quantity!==1||!body.relayOwner)return Response.json({error:'計量データを確認してください。'},{status:409});
    captureIds.add(item.scaleCaptureId);
    const grams=Number(item.measuredQuantity)*(item.measuredUnit==='kg'?1000:item.measuredUnit==='g'?1:NaN);
    if(!Number.isFinite(grams))return Response.json({error:'計量単位を確認してください。'},{status:409});
    writes.push(sql`update store_relay_scale_captures set order_id=${orderId}::uuid where id::text=${item.scaleCaptureId}
      and station_id::text=${body.relayOwner.stationId} and epoch=${body.relayOwner.epoch} and employee_id::text=${session.id}
      and abs(grams-${grams})<0.0001 and order_id is null and exists(select 1 from store_customer_orders where id=${orderId}::uuid)`);
    writes.push(sql`select 1 / case when not exists(select 1 from store_customer_orders where id=${orderId}::uuid)
      or exists(select 1 from store_relay_scale_captures where id::text=${item.scaleCaptureId} and order_id=${orderId}::uuid) then 1 else 0 end`);
  }
  if(normalizedItems.some(item=>item.measuredQuantity!==null))writes.push(
    sql`select pg_advisory_xact_lock(hashtextextended(${`pos-scale-tare:${storeId}`},0))`,
    sql`select 1 / case when coalesce((select scale_tare_settings->>'revision' from pos_store_settings where store_id::text=${storeId}),'')=${posSettings.scaleTareSettings.revision}
      then 1 else 0 end as tare_settings_current`
  );
  const insertResultIndex = offlineClientOrderId ? 2 : 0;
  if (offlineClientOrderId) writes.unshift(
    sql`select pg_advisory_xact_lock(hashtextextended(${`pos:${storeId}:${offlineClientOrderId}`},0))`,
    sql`select 1 / case when not exists (select 1 from pos_abandoned_checkouts where store_id::text=${storeId} and request_id=${offlineClientOrderId}) then 1 else 0 end as request_allowed`
  );
  if (relayRequired && body.relayOwner) writes.unshift(
    sql`select id from store_relay_stations where id::text=${body.relayOwner.stationId} for update`,
    ownerGuardSql(storeId,body.relayOwner,session)
  );
  const dineInGuardCount = dineInState.ready && (orderType === 'eat_in' || enforcePhysicalFulfillmentRevision || normalizedItems.some(item => getPosItemFulfillmentMode(item) === 'immediate')) ? 2 : 0;
  if (dineInGuardCount) writes.unshift(posMenuLock(storeId),dineInMenuGuard(storeId,dineInState.revision));
  if(posMenuConfig.ready) writes.unshift(posMenuLock(storeId),posMenuGuard(storeId,posMenuConfig.revision));
  const cashGuards = posCashSessionGuards(storeId, cashSessionId);
  let writeResults;
  try { writeResults = await sql.transaction([...cashGuards, ...writes]); }
  catch (error) {
    if ((error as { code?: string }).code === "22012") {
      if (!await isPosCashSessionOpen(storeId, cashSessionId)) {
        const recorded = await findRecordedCheckout();
        if (recorded) return recorded;
        const failure = new PosCashSessionChangedError();
        return Response.json({ error: failure.message, code: failure.code }, { status: failure.status });
      }
      return Response.json({ error: "会計リクエストまたはクーポンの状態が変わりました。会計は保存していません。内容を確認してください。" }, { status: 409 });
    }
    throw error;
  }
  if (!writeResults[cashGuards.length + insertResultIndex + (relayRequired ? 2 : 0) + (posMenuConfig.ready ? 2 : 0) + dineInGuardCount]?.length) {
    const existing = await sql`select id::text as "orderId", pickup_code as "pickupCode", amount, status, payment_status as "paymentStatus", customer_summary as summary
      from store_customer_orders where store_id::text = ${storeId} and offline_client_order_id = ${offlineClientOrderId} limit 1`;
    if (!existing[0]) return Response.json({ error: "会計を確認できませんでした。" }, { status: 409 });
    if (existing[0].summary?.checkoutFingerprint && existing[0].summary.checkoutFingerprint !== checkoutFingerprint) return Response.json({ error: "同じ会計IDの内容が変わっています。" }, { status: 409 });
    await markInventoryOrderReady(String(existing[0].orderId));
    await ensureProductionTasksForOrder(String(existing[0].orderId));
    await awardLoyaltyForPaidOrder(String(existing[0].orderId));
    await syncWebReservationToSalesOrder(String(existing[0].orderId));
    const existingTickets = await readPosServingTickets(String(existing[0].orderId));
    return Response.json({ ok: true, duplicate: true, ...existing[0], ...existing[0].summary,
      reprintAllowed: existing[0].paymentStatus === "paid" && ["new", "preparing", "ready"].includes(String(existing[0].status)) && !existingTickets.some(ticket => ticket.handedOffAt),
      servingTickets: existingTickets, ...(durablePrintDocuments ? { printDocuments: await readPosCheckoutPrintDocuments(storeId, String(existing[0].orderId)) } : {}), todaySummary: await getTodaySummary(storeId) });
  }


  await markInventoryOrderReady(orderId);
  await ensureProductionTasksForOrder(orderId);
  const loyaltyMember = await awardLoyaltyForPaidOrder(orderId);
  await syncWebReservationToSalesOrder(orderId);
  publishPosOrderEventAfterResponse("order.created", orderId);
  const todaySummary = await getTodaySummary(storeId);
  return Response.json({
    ok: true,
    relayPrinting,
    printDocuments,
    hasPreparation,
    posFulfillmentPolicyVersion: 1,
    posItemFulfillment,
    orderId,
    pickupCode,
    servingTickets: await readPosServingTickets(orderId),
    amount,
    receiptRequested,
    ...invoiceDetails,
    subtotalAmount,
    taxableAmount: taxSummary.taxableAmount,
    taxAmount: taxSummary.taxAmount,
    taxRate,
    priceTaxMode: posSettings.priceTaxMode,
    discountAmount: posDiscountAmount,
    discountName: discountPreset?.name ?? "",
    discountPresetKey,
    couponId: coupon?.id ?? "",
    couponCode: coupon?.couponCode ?? "",
    couponName: coupon?.name ?? "",
    couponDiscountAmount,
    cashTenderedAmount,
    cashChangeAmount,
    loyaltyMember,
    diningSessionId,
    diningSeatLabel: "",
    todaySummary
  });
}
