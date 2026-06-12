import { requireOsSession } from "../../../../lib/api-auth";
import { createPickupCode, findCustomerOrderById } from "../../../../lib/customer-orders";
import { sql } from "../../../../lib/db";
import { awardLoyaltyForPaidOrder, calculateCouponDiscount, getUsableMemberCoupon, isMemberExchangeCoupon, redeemMemberCouponForOrder, resolveMemberForOrder } from "../../../../lib/loyalty";
import { ensureProductionTasksForOrder } from "../../../../lib/order-production";
import { publishCustomerOrderEvent } from "../../../../lib/order-realtime";
import { normalizePosPrinterSettings } from "../../../../lib/pos-printer";
import { syncWebReservationToSalesOrder } from "../../../../lib/sales-orders";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

type PosCheckoutItemInput = {
  menuCatalogItemId?: string;
  quantity?: number;
  measuredQuantity?: number | string;
  measuredUnit?: string;
  selectedOptions?: Array<{
    groupId?: string;
    optionIds?: string[];
  }>;
};

type PosCheckoutBody = {
  storeId?: string;
  orderType?: string;
  paymentMethod?: string;
  cashTenderedAmount?: number | string | null;
  memberId?: string;
  memberToken?: string;
  memberPhone?: string;
  memberEmail?: string;
  memberName?: string;
  memberLanguage?: string;
  couponId?: string;
  discountPresetKey?: string;
  note?: string;
  items?: PosCheckoutItemInput[];
};

type PosDiscountPreset = {
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
  mode: "default",
  transition: "fade",
  slideDurationSeconds: 8,
  videoMuted: true,
  videoLoop: true,
  backgroundColor: "#fbfbf8",
  assets: []
};

const dineInWeightMalatangOptionGroupKeys = new Set([
  "heat",
  "numb",
  "dine-in-customer-ingredient",
  "dine-in-customer-ingredients",
  "customer-requested-ingredient",
  "customer-requested-ingredients",
  "counter-ingredient",
  "counter-ingredients",
  "counter-requested-ingredient",
  "counter-requested-ingredients"
]);
const dineInWeightMalatangOptionGroupNames = new Set([
  "堂吃客人指定食材",
  "堂食客人指定食材",
  "柜台指定食材",
  "カウンター指定食材",
  "店内客指定食材",
  "店内お客様指定食材"
]);

function isDineInWeightMalatangOptionGroup(group: { groupKey: string; groupName: string }) {
  return dineInWeightMalatangOptionGroupKeys.has(group.groupKey) || dineInWeightMalatangOptionGroupNames.has(group.groupName);
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
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
    if (discountValue <= 0) return [];
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
      allowCouponCombination: record.allowCouponCombination === true
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

function getWeightPricingConfig(item: { posPricingMode?: string; posWeightUnit?: string; posWeightUnitPrice?: number | null; variableSchema?: Record<string, unknown> }, orderType: string) {
  if (orderType !== "eat_in" || item.posPricingMode !== "weight") return null;
  const schema = item.variableSchema ?? {};
  const unit = normalizeText(item.posWeightUnit) || String(schema.weightUnit ?? schema.measuredUnit ?? (schema.posWeightPricing as Record<string, unknown> | undefined)?.unit ?? "g").trim() || "g";
  const unitPrice = Number(item.posWeightUnitPrice ?? 0) > 0
    ? Number(item.posWeightUnitPrice)
    : getNumberFromSchema(schema, ["pricePerGram", "weightUnitPrice", "measuredUnitPrice"]) ??
    getNestedNumberFromSchema(schema, "posWeightPricing", ["pricePerGram", "unitPrice", "weightUnitPrice"]);
  return { unit, unitPrice };
}

function getOptionGroupLimit(ruleJson: Record<string, unknown>, fallback: number) {
  const limit = Number(ruleJson?.limit);
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(0, Math.floor(limit));
}

function getEffectiveSelectionType(group: { groupKey: string; selectionType: string }) {
  if (group.selectionType === "quantity") return "quantity";
  if (["size", "temperature", "sweetness", "ice", "option"].includes(group.groupKey)) return "single";
  if (group.groupKey === "topping") return "multiple";
  return group.selectionType || "single";
}

function getPosPickupCodePrefix(orderType: string) {
  return orderType === "eat_in" ? "S" : "P";
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
        and coalesce(menu_store_settings.pos_enabled, true) = true
        and coalesce(menu_store_settings.is_available, true) = true
      order by brands.name, coalesce(menu_categories.sort_order, 9999), menu_catalog_items.sort_order, menu_catalog_items.name
    `
  ]);

  const itemIds = (items as Array<{ id: string }>).map((item) => item.id);
  const optionGroups = itemIds.length
    ? await sql`
      select
        menu_option_groups.id::text,
        menu_option_groups.brand_id::text as "brandId",
        coalesce(menu_option_groups.menu_catalog_item_id::text, '') as "menuCatalogItemId",
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

  return { brands, categories, items, optionGroups };
}

async function getTodaySummary(selectedStoreId: string) {
  if (!selectedStoreId) return { orderCount: 0, total: 0, average: 0, latestOrders: [] };

  const rows = await sql`
    select
      count(*)::int as "orderCount",
      coalesce(sum(amount), 0)::int as total
    from store_customer_orders
    where store_id::text = ${selectedStoreId}
      and order_source = 'store_pos'
      and created_at >= (date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo')
      and created_at < ((date_trunc('day', now() at time zone 'Asia/Tokyo') + interval '1 day') at time zone 'Asia/Tokyo')
      and status <> 'cancelled'
  `;
  const latestOrders = await sql`
    select
      id::text,
      pickup_code as "pickupCode",
      amount,
      payment_provider as "paymentMethod",
      to_char(created_at at time zone 'Asia/Tokyo', 'HH24:MI') as "createdTime"
    from store_customer_orders
    where store_id::text = ${selectedStoreId}
      and order_source = 'store_pos'
    order by created_at desc
    limit 8
  `;
  const summary = rows[0] as { orderCount: number; total: number } | undefined;
  const orderCount = Number(summary?.orderCount ?? 0);
  const total = Number(summary?.total ?? 0);
  return {
    orderCount,
    total,
    average: orderCount ? Math.round(total / orderCount) : 0,
    latestOrders
  };
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

async function getPosSettings(selectedStoreId: string) {
  const defaults = { dineInEnabled: true, dineInTaxRate: 10, takeoutTaxRate: 8, externalPaymentTerminalBrand: "PayCAS", priceTaxMode: "tax_included", discountPresets: defaultDiscountPresets, customerDisplayMediaSettings: defaultCustomerDisplayMediaSettings, printerSettings: normalizePosPrinterSettings(null) };
  if (!selectedStoreId) return defaults;
  const rows = await sql`
    select
      coalesce(dine_in_enabled, true) as "dineInEnabled",
      coalesce(dine_in_tax_rate, 10)::float as "dineInTaxRate",
      coalesce(takeout_tax_rate, 8)::float as "takeoutTaxRate",
      coalesce(nullif(external_payment_terminal_brand, ''), 'PayCAS') as "externalPaymentTerminalBrand",
      coalesce(nullif(price_tax_mode, ''), 'tax_included') as "priceTaxMode",
      coalesce(discount_presets, '[]'::jsonb) as "discountPresets",
      coalesce(customer_display_media_settings, '{}'::jsonb) as "customerDisplayMediaSettings",
      coalesce(printer_settings, '{}'::jsonb) as "printerSettings"
    from pos_store_settings
    where store_id::text = ${selectedStoreId}
    limit 1
  `;
  const settings = rows[0] as (typeof defaults & { discountPresets?: unknown }) | undefined;
  return settings ? {
    ...settings,
    discountPresets: normalizeDiscountPresets(settings.discountPresets),
    customerDisplayMediaSettings: normalizeCustomerDisplayMediaSettings(settings.customerDisplayMediaSettings),
    printerSettings: normalizePosPrinterSettings(settings.printerSettings)
  } : defaults;
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { access, selectedStoreId, forbidden } = await getSelectedStoreId(request, session);
  if (forbidden) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const [menu, todaySummary, posSettings] = await Promise.all([
    getPosMenu(selectedStoreId),
    getTodaySummary(selectedStoreId),
    getPosSettings(selectedStoreId)
  ]);

  return Response.json({
    access,
    selectedStoreId,
    ...menu,
    posSettings,
    todaySummary
  });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as PosCheckoutBody;
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
  const discountPresetKey = normalizeText(body.discountPresetKey);
  const cashTenderedAmount = body.cashTenderedAmount === null || body.cashTenderedAmount === undefined || body.cashTenderedAmount === ""
    ? null
    : Math.round(Number(body.cashTenderedAmount));
  const note = normalizeText(body.note);
  const cartItems = Array.isArray(body.items) ? body.items : [];

  if (!storeId || cartItems.length === 0) {
    return Response.json({ error: "店舗と商品を選択してください。" }, { status: 400 });
  }

  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, storeId);
  if (storeFilter === "__forbidden__" || !storeFilter) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }
  const posSettings = await getPosSettings(storeId);

  const requestedIds = Array.from(new Set(cartItems.map((item) => normalizeText(item.menuCatalogItemId)).filter(Boolean)));
  if (requestedIds.length === 0) {
    return Response.json({ error: "商品を選択してください。" }, { status: 400 });
  }

  const menuRows = await sql`
    select
      menu_catalog_items.id::text,
      menu_catalog_items.brand_id::text as "brandId",
      menu_catalog_items.name,
      coalesce(menu_catalog_items.display_names, '{}'::jsonb) as "displayNames",
      menu_catalog_items.item_kind as "itemKind",
      coalesce(menu_catalog_items.category, '') as category,
      menu_catalog_items.variable_schema as "variableSchema",
      coalesce(nullif(store_brands.pos_pricing_mode, ''), 'fixed') as "posPricingMode",
      coalesce(nullif(store_brands.pos_weight_unit, ''), 'g') as "posWeightUnit",
      store_brands.pos_weight_unit_price::float as "posWeightUnitPrice",
      coalesce(menu_store_settings.price_override, menu_catalog_items.base_price, 0)::int as price
    from menu_catalog_items
    join store_brands
      on store_brands.brand_id = menu_catalog_items.brand_id
      and store_brands.store_id = ${storeId}
    left join menu_store_settings
      on menu_store_settings.menu_catalog_item_id = menu_catalog_items.id
      and menu_store_settings.store_id = ${storeId}
    where menu_catalog_items.id::text = any(${requestedIds})
      and menu_catalog_items.is_active = true
      and menu_catalog_items.store_id is null
      and coalesce(menu_store_settings.pos_enabled, true) = true
      and coalesce(menu_store_settings.is_available, true) = true
  `;
  const menuById = new Map((menuRows as Array<{
    id: string;
    brandId: string;
    name: string;
    displayNames?: Record<string, string>;
    itemKind: string;
    category: string;
    posPricingMode: string;
    posWeightUnit: string;
    posWeightUnitPrice: number | null;
    price: number;
    variableSchema: Record<string, unknown>;
  }>).map((item) => [item.id, item]));
  const optionRows = await sql`
    select
      menu_options.id::text,
      menu_options.option_key as "optionKey",
      menu_options.name,
      coalesce(menu_options.display_names, '{}'::jsonb) as "displayNames",
      coalesce(menu_options.price_delta, 0)::int as "priceDelta",
      menu_option_groups.id::text as "groupId",
      menu_option_groups.brand_id::text as "brandId",
      coalesce(menu_option_groups.menu_catalog_item_id::text, '') as "menuCatalogItemId",
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
      and (
        menu_option_groups.menu_catalog_item_id is null
        or menu_option_groups.menu_catalog_item_id::text = any(${requestedIds})
      )
  `;
  const optionsById = new Map((optionRows as Array<{
    id: string;
    optionKey: string;
    name: string;
    displayNames?: Record<string, string>;
    priceDelta: number;
    groupId: string;
    brandId: string;
    menuCatalogItemId: string;
    groupKey: string;
    groupName: string;
    groupDisplayNames?: Record<string, string>;
    selectionType: string;
    ruleJson: Record<string, unknown>;
  }>).map((option) => [option.id, option]));

  let normalizedItems: Array<{
    id: string;
    brandId: string;
    name: string;
    displayNames?: Record<string, string>;
    itemKind: string;
    category: string;
    posPricingMode: string;
    posWeightUnit: string;
    posWeightUnitPrice: number | null;
    quantity: number;
    unitPrice: number;
    amount: number;
    measuredQuantity: number | null;
    measuredUnit: string;
    measuredUnitPrice: number | null;
    selectedOptions: Array<NonNullable<ReturnType<typeof optionsById.get>>>;
  }> = [];
  try {
    normalizedItems = cartItems.map((item) => {
      const menuItem = menuById.get(normalizeText(item.menuCatalogItemId));
      if (!menuItem) return null;
      const weightPricing = getWeightPricingConfig(menuItem, orderType);
      const quantity = weightPricing ? 1 : toPositiveInt(item.quantity);
      const measuredQuantity = weightPricing ? toPositiveMeasuredQuantity(item.measuredQuantity) : null;
      const measuredUnit = weightPricing?.unit ?? "";
      const measuredUnitPrice = weightPricing?.unitPrice ?? null;
      if (weightPricing && (measuredUnitPrice === null || measuredUnitPrice <= 0)) {
        throw new Error(`${menuItem.name} の重量単価が設定されていません。`);
      }
      if (weightPricing && measuredQuantity === null) {
        throw new Error(`${menuItem.name} は重量を入力してください。`);
      }
      const unitPrice = weightPricing ? Math.round((measuredQuantity ?? 0) * (measuredUnitPrice ?? 0)) : Number(menuItem.price ?? 0);
      const selectedOptions = Array.isArray(item.selectedOptions) ? item.selectedOptions : [];
      const selected = selectedOptions.flatMap((group) => asStringArray(group.optionIds).map((optionId) => optionsById.get(optionId)).filter(Boolean)) as Array<NonNullable<ReturnType<typeof optionsById.get>>>;
      const validSelected = selected.filter((option) => {
        if (option.brandId !== menuItem.brandId) return false;
        if (option.menuCatalogItemId && option.menuCatalogItemId !== menuItem.id) return false;
        if (weightPricing && !isDineInWeightMalatangOptionGroup(option)) return false;
        const allowedKeys = asStringArray(menuItem.variableSchema?.[getAllowedRuleKey(option.groupKey)]);
        if (!allowedKeys.length) return true;
        return allowedKeys.includes(option.optionKey) || allowedKeys.includes(option.name);
      });
      const groupedCounts = new Map<string, { count: number; optionIds: Set<string>; selectionType: string; limit: number; groupName: string }>();
      for (const option of validSelected) {
        const selectionType = getEffectiveSelectionType(option);
        const current = groupedCounts.get(option.groupId) ?? {
          count: 0,
          optionIds: new Set<string>(),
          selectionType,
          limit: getOptionGroupLimit(option.ruleJson, selectionType === "single" ? 1 : 99),
          groupName: option.groupName
        };
        current.count += 1;
        current.optionIds.add(option.id);
        groupedCounts.set(option.groupId, current);
      }
      for (const group of groupedCounts.values()) {
        if (group.selectionType === "single" && group.count > 1) {
          throw new Error(`${group.groupName} は1つだけ選択できます。`);
        }
        if (group.selectionType === "multiple" && group.optionIds.size !== group.count) {
          throw new Error(`${group.groupName} は同じ選択肢を重複して選べません。`);
        }
        if (group.count > group.limit) {
          throw new Error(`${group.groupName} は最大${group.limit}点までです。`);
        }
      }
      const optionTotal = validSelected.reduce((sum, option) => sum + Number(option.priceDelta ?? 0), 0);
      return {
        ...menuItem,
        quantity,
        unitPrice,
        measuredQuantity,
        measuredUnit,
        measuredUnitPrice,
        selectedOptions: validSelected,
        amount: (unitPrice + optionTotal) * quantity
      };
    }).filter(Boolean) as typeof normalizedItems;
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "選択数が正しくありません。" }, { status: 400 });
  }

  if (normalizedItems.length === 0) {
    return Response.json({ error: "POS で販売できる商品がありません。" }, { status: 400 });
  }

  const subtotalAmount = normalizedItems.reduce((sum, item) => sum + item.amount, 0);
  const discountPreset = discountPresetKey
    ? posSettings.discountPresets.find((preset) => preset.key === discountPresetKey && preset.enabled) ?? null
    : null;
  if (discountPresetKey && !discountPreset) {
    return Response.json({ error: "利用できない割引です。" }, { status: 400 });
  }
  if (discountPreset && !discountPreset.allowCouponCombination && couponId) {
    return Response.json({ error: "割引とクーポンは同時に利用できません。" }, { status: 400 });
  }
  const posDiscountAmount = calculatePosDiscount(discountPreset, normalizedItems, subtotalAmount);
  if (discountPreset && posDiscountAmount <= 0) {
    return Response.json({ error: "この注文では割引を適用できません。" }, { status: 400 });
  }
  const cashSessionId = await getOpenCashSessionId(storeId);
  if (!cashSessionId) {
    return Response.json({ error: "POS 会計の前に開店前のレジ金額を確認してください。" }, { status: 400 });
  }
  const { pickupDate, pickupTime } = getJstParts();
  const pickupCode = createPickupCode(getPosPickupCodePrefix(orderType));
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
  const discountBases = normalizedItems.map((item) => {
    if (!discountPreset) return 0;
    if (discountPreset.targetScope === "category" && item.category !== discountPreset.targetValue) return 0;
    if (discountPreset.targetScope === "item_kind" && item.itemKind !== discountPreset.targetValue) return 0;
    if (discountPreset.targetScope === "brand" && item.brandId !== discountPreset.targetValue) return 0;
    return item.amount;
  });
  const itemDiscountAmounts = allocateAmountByWeight(posDiscountAmount, discountBases);
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
  if (
    paymentMethod === "cash" &&
    (cashTenderedAmount === null || !Number.isFinite(cashTenderedAmount) || cashTenderedAmount < amount)
  ) {
    return Response.json({ error: "現金会計はお預かり金額を合計以上で入力してください。" }, { status: 400 });
  }
  const cashChangeAmount = paymentMethod === "cash" && cashTenderedAmount !== null ? cashTenderedAmount - amount : null;

  const orderRows = await sql`
    insert into store_customer_orders (
      brand_id,
      store_id,
      order_source,
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
      ${brandId},
      ${storeId},
      'store_pos',
      ${pickupCode},
      'new',
      'paid',
      ${paymentMethod},
      ${member?.id ?? null},
      ${pickupDate},
      ${pickupTime},
      ${amount},
      'JPY',
      ${JSON.stringify({
        orderType,
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
        discountAmount: posDiscountAmount,
        stampEligible: discountPreset ? discountPreset.stampEligible : true,
        couponId: coupon?.id ?? "",
        couponCode: coupon?.couponCode ?? "",
        couponName: coupon?.name ?? "",
        couponDiscountAmount,
        cashTenderedAmount,
        cashChangeAmount,
        itemCount: normalizedItems.reduce((sum, item) => sum + item.quantity, 0),
        items: normalizedItems.map((item) => ({
          menuCatalogItemId: item.id,
          name: item.name,
          quantity: item.quantity,
          measuredQuantity: item.measuredQuantity,
          measuredUnit: item.measuredUnit,
          measuredUnitPrice: item.measuredUnitPrice,
          options: "selectedOptions" in item ? item.selectedOptions : []
        }))
      })},
      ${firstItemName},
      now(),
      null,
      now(),
      ${cashSessionId ?? null},
      now()
    )
    returning id::text
  `;
  const orderId = orderRows[0]?.id as string | undefined;
  if (!orderId) return Response.json({ error: "会計を保存できませんでした。" }, { status: 500 });
  if (coupon && member?.id) {
    const redeemedCoupon = await redeemMemberCouponForOrder({ memberId: member.id, couponId: coupon.id, orderId, storeId });
    if (!redeemedCoupon) return Response.json({ error: "クーポンを使用処理できませんでした。もう一度会員情報を確認してください。" }, { status: 409 });
  }

  for (let index = 0; index < normalizedItems.length; index += 1) {
    const item = normalizedItems[index];
    const selectedOptions = "selectedOptions" in item ? item.selectedOptions as Array<{
      optionKey: string;
      name: string;
      groupKey: string;
      groupName: string;
    }> : [];
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
    await sql`
      insert into store_customer_order_items (
        order_id,
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
        quantity,
        measured_quantity,
        measured_unit,
        measured_unit_price,
        amount,
        gross_amount,
        discount_amount,
        coupon_discount_amount,
        paid_amount,
        coupon_id,
        sort_order
      )
      values (
        ${orderId},
        ${item.id},
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
        ${item.quantity},
        ${item.measuredQuantity},
        ${item.measuredUnit},
        ${item.measuredUnitPrice},
        ${item.amount},
        ${item.amount},
        ${itemDiscountAmounts[index]},
        ${itemCouponDiscountAmounts[index]},
        ${itemPaidAmounts[index]},
        ${itemCouponDiscountAmounts[index] > 0 && coupon?.id ? coupon.id : null},
        ${index}
      )
    `;
  }

  await ensureProductionTasksForOrder(orderId);
  const loyaltyMember = await awardLoyaltyForPaidOrder(orderId);
  await syncWebReservationToSalesOrder(orderId);
  await publishCustomerOrderEvent("order.created", await findCustomerOrderById(orderId));
  const todaySummary = await getTodaySummary(storeId);
  return Response.json({
    ok: true,
    orderId,
    pickupCode,
    amount,
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
    todaySummary
  });
}
