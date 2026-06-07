import { requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

const writableRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);
const priceTaxModes = new Set(["tax_included", "tax_excluded"]);
const discountTypes = new Set(["percent", "amount"]);
const discountTargetScopes = new Set(["all", "category", "item_kind", "brand"]);

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

type PosBrandSetting = {
  brandId: string;
  brandName: string;
  posPricingMode: "fixed" | "weight";
  posWeightUnit: string;
  posWeightUnitPrice: number | null;
};

type CustomerDisplayMediaAsset = {
  id: string;
  type: "image" | "video";
  url: string;
  pathname: string;
  name: string;
  durationSeconds: number;
  fit: "cover" | "contain";
};

type CustomerDisplayMediaSettings = {
  mode: "default" | "slideshow" | "video";
  transition: "fade" | "slide" | "none";
  slideDurationSeconds: number;
  videoMuted: boolean;
  videoLoop: boolean;
  backgroundColor: string;
  assets: CustomerDisplayMediaAsset[];
};

const defaultCustomerDisplayMediaSettings: CustomerDisplayMediaSettings = {
  mode: "default",
  transition: "fade",
  slideDurationSeconds: 8,
  videoMuted: true,
  videoLoop: true,
  backgroundColor: "#fbfbf8",
  assets: []
};

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

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeRate(value: unknown, fallback: number) {
  const rate = Number(value);
  if (!Number.isFinite(rate)) return fallback;
  return Math.max(0, Math.min(100, Math.round(rate * 100) / 100));
}

function normalizeDisplayNames(value: unknown) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(
    ["en", "zh", "zh-Hant", "ko", "vi", "ne"]
      .map((language) => [language, normalizeText(source[language]).slice(0, 120)])
      .filter(([, displayName]) => displayName)
  );
}

function normalizeCustomerDisplayMediaSettings(value: unknown): CustomerDisplayMediaSettings {
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
      const type: CustomerDisplayMediaAsset["type"] = normalizeText(asset.type) === "video" ? "video" : "image";
      const url = normalizeText(asset.url);
      if (!url) return [];
      const fit: CustomerDisplayMediaAsset["fit"] = normalizeText(asset.fit) === "contain" ? "contain" : "cover";
      return [{
        id: normalizeText(asset.id) || `asset_${index + 1}`,
        type,
        url: url.slice(0, 500),
        pathname: normalizeText(asset.pathname).slice(0, 240),
        name: normalizeText(asset.name).slice(0, 120) || (type === "video" ? "video" : "image"),
        durationSeconds: Math.max(3, Math.min(60, Math.round(Number(asset.durationSeconds) || Number(record.slideDurationSeconds) || defaultCustomerDisplayMediaSettings.slideDurationSeconds))),
        fit
      }];
    }).slice(0, 12)
  };
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
  const seen = new Set<string>();
  const presets = source.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const name = normalizeText(record.name);
    if (!name) return [];
    const rawKey = normalizeText(record.key) || name.toLowerCase().replace(/[^a-z0-9]+/g, "_") || `discount_${index + 1}`;
    const keyBase = rawKey.slice(0, 48);
    let key = keyBase;
    let suffix = 2;
    while (seen.has(key)) {
      key = `${keyBase}_${suffix}`.slice(0, 64);
      suffix += 1;
    }
    seen.add(key);
    const discountType = discountTypes.has(normalizeText(record.discountType)) ? normalizeText(record.discountType) as PosDiscountPreset["discountType"] : "percent";
    const maxValue = discountType === "percent" ? 100 : 999999;
    const discountValue = Math.max(0, Math.min(maxValue, Math.round(Number(record.discountValue) || 0)));
    if (discountValue <= 0) return [];
    const targetScope = discountTargetScopes.has(normalizeText(record.targetScope)) ? normalizeText(record.targetScope) as PosDiscountPreset["targetScope"] : "all";
    const targetValue = targetScope === "all" ? "" : normalizeText(record.targetValue);
    if (targetScope !== "all" && !targetValue) return [];
    return [{
      key,
      name: name.slice(0, 80),
      displayNames: {
        ...getDefaultDiscountDisplayNames(key, name),
        ...normalizeDisplayNames(record.displayNames)
      },
      discountType,
      discountValue,
      targetScope,
      targetValue: targetValue.slice(0, 120),
      enabled: record.enabled !== false,
      stampEligible: record.stampEligible === true,
      allowCouponCombination: record.allowCouponCombination === true
    }];
  });
  return presets.length ? presets.slice(0, 20) : defaultDiscountPresets;
}

function normalizeBrandSettings(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  return source.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const brandId = normalizeText(record.brandId);
    if (!brandId) return [];
    const posPricingMode = normalizeText(record.posPricingMode) === "weight" ? "weight" : "fixed";
    const posWeightUnit = normalizeText(record.posWeightUnit) || "g";
    const rawUnitPrice = Number(record.posWeightUnitPrice);
    const posWeightUnitPrice = Number.isFinite(rawUnitPrice) && rawUnitPrice > 0 ? Math.round(rawUnitPrice * 100) / 100 : null;
    return [{
      brandId,
      posPricingMode,
      posWeightUnit: posWeightUnit.slice(0, 20),
      posWeightUnitPrice
    }];
  });
}

async function resolveStoreId(request: Request, session: NonNullable<Awaited<ReturnType<typeof requireOsSession>>>) {
  const access = await getStoreOrderAccess(session);
  const requestedStoreId = new URL(request.url).searchParams.get("storeId");
  const storeFilter = getScopedStoreFilter(access, requestedStoreId);
  if (storeFilter === "__forbidden__") return { access, selectedStoreId: "", forbidden: true };
  return { access, selectedStoreId: storeFilter ?? access.stores[0]?.id ?? "", forbidden: false };
}

async function getSettings(storeId: string) {
  const [rows, brandRows] = await Promise.all([
    sql`
    select
      stores.id::text as "storeId",
      stores.name as "storeName",
      coalesce(pos_store_settings.dine_in_enabled, true) as "dineInEnabled",
      coalesce(pos_store_settings.dine_in_tax_rate, 10)::float as "dineInTaxRate",
      coalesce(pos_store_settings.takeout_tax_rate, 8)::float as "takeoutTaxRate",
      coalesce(nullif(pos_store_settings.external_payment_terminal_brand, ''), 'PayCAS') as "externalPaymentTerminalBrand",
      coalesce(nullif(pos_store_settings.price_tax_mode, ''), 'tax_included') as "priceTaxMode",
      coalesce(pos_store_settings.discount_presets, '[]'::jsonb) as "discountPresets",
      coalesce(pos_store_settings.customer_display_media_settings, '{}'::jsonb) as "customerDisplayMediaSettings",
      coalesce(pos_store_settings.updated_at::text, '') as "updatedAt"
    from stores
    left join pos_store_settings on pos_store_settings.store_id = stores.id
    where stores.id::text = ${storeId}
    limit 1
  `,
    sql`
      select
        brands.id::text as "brandId",
        brands.name as "brandName",
        coalesce(nullif(store_brands.pos_pricing_mode, ''), 'fixed') as "posPricingMode",
        coalesce(nullif(store_brands.pos_weight_unit, ''), 'g') as "posWeightUnit",
        store_brands.pos_weight_unit_price::float as "posWeightUnitPrice"
      from store_brands
      join brands on brands.id = store_brands.brand_id
      where store_brands.store_id::text = ${storeId}
        and brands.status = 'active'
      order by brands.name
    `
  ]);
  const settings = rows[0] as (Record<string, unknown> & { discountPresets?: unknown }) | undefined;
  if (!settings) return null;
  return {
    ...settings,
    discountPresets: normalizeDiscountPresets(settings.discountPresets),
    customerDisplayMediaSettings: normalizeCustomerDisplayMediaSettings(settings.customerDisplayMediaSettings),
    posBrandSettings: brandRows as PosBrandSetting[]
  };
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { access, selectedStoreId, forbidden } = await resolveStoreId(request, session);
  if (forbidden || !selectedStoreId) return Response.json({ error: "権限がありません。" }, { status: 403 });

  return Response.json({
    access: { ...access, canManagePosSettings: writableRoles.has(session.role) },
    selectedStoreId,
    settings: await getSettings(selectedStoreId)
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!writableRoles.has(session.role)) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as {
    storeId?: string;
    dineInEnabled?: boolean;
    dineInTaxRate?: number | string;
    takeoutTaxRate?: number | string;
    externalPaymentTerminalBrand?: string;
    priceTaxMode?: string;
    discountPresets?: unknown[];
    customerDisplayMediaSettings?: unknown;
    posBrandSettings?: unknown[];
  };
  const access = await getStoreOrderAccess(session);
  const storeId = getScopedStoreFilter(access, body.storeId);
  if (storeId === "__forbidden__" || !storeId) return Response.json({ error: "店舗を選択してください。" }, { status: 400 });

  const priceTaxMode = normalizeText(body.priceTaxMode) || "tax_included";
  if (!priceTaxModes.has(priceTaxMode)) return Response.json({ error: "価格の税区分が正しくありません。" }, { status: 400 });

  const dineInTaxRate = normalizeRate(body.dineInTaxRate, 10);
  const takeoutTaxRate = normalizeRate(body.takeoutTaxRate, 8);
  const externalPaymentTerminalBrand = normalizeText(body.externalPaymentTerminalBrand) || "PayCAS";
  const discountPresets = normalizeDiscountPresets(body.discountPresets);
  const customerDisplayMediaSettings = normalizeCustomerDisplayMediaSettings(body.customerDisplayMediaSettings);
  const brandSettings = normalizeBrandSettings(body.posBrandSettings);
  await sql`
    insert into pos_store_settings (
      store_id,
      dine_in_enabled,
      dine_in_tax_rate,
      takeout_tax_rate,
      external_payment_terminal_brand,
      price_tax_mode,
      discount_presets,
      customer_display_media_settings,
      updated_by,
      updated_at
    )
    values (
      ${storeId},
      ${body.dineInEnabled !== false},
      ${dineInTaxRate},
      ${takeoutTaxRate},
      ${externalPaymentTerminalBrand},
      ${priceTaxMode},
      ${JSON.stringify(discountPresets)}::jsonb,
      ${JSON.stringify(customerDisplayMediaSettings)}::jsonb,
      ${session.id},
      now()
    )
    on conflict (store_id)
    do update set
      dine_in_enabled = excluded.dine_in_enabled,
      dine_in_tax_rate = excluded.dine_in_tax_rate,
      takeout_tax_rate = excluded.takeout_tax_rate,
      external_payment_terminal_brand = excluded.external_payment_terminal_brand,
      price_tax_mode = excluded.price_tax_mode,
      discount_presets = excluded.discount_presets,
      customer_display_media_settings = excluded.customer_display_media_settings,
      updated_by = excluded.updated_by,
      updated_at = now()
  `;

  for (const setting of brandSettings) {
    await sql`
      update store_brands
      set
        pos_pricing_mode = ${setting.posPricingMode},
        pos_weight_unit = ${setting.posWeightUnit},
        pos_weight_unit_price = ${setting.posPricingMode === "weight" ? setting.posWeightUnitPrice : null}
      where store_id::text = ${storeId}
        and brand_id::text = ${setting.brandId}
    `;
  }

  return Response.json({ ok: true, selectedStoreId: storeId, settings: await getSettings(storeId) });
}
