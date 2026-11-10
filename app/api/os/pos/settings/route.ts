import { normalizePosPaymentRounding } from "../../../../../lib/pos-payment-rounding";
import { normalizePosCampaignFields, validatePosCampaignPresets, type PosCampaignFields } from "../../../../../lib/pos-discount-campaigns";
import { randomUUID } from 'node:crypto';
import { defaultPosScaleFilterSettings, normalizePosScaleFilterSettings, validatePosScaleFilterSettings } from '../../../../../lib/pos-scale-filter';
import { defaultPosScaleTareSettings, normalizePosScaleTareSettings, validatePosScaleTareSettings } from '../../../../../lib/pos-scale-tare';
import { requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";
import { normalizePosPrinterSettings } from "../../../../../lib/pos-printer";
import { validatePosPrintingSettings } from "../../../../../lib/pos-print-settings-validation";
import { normalizePosFulfillmentWorkspaceSettings, validatePosFulfillmentWorkspaceSettings } from "../../../../../lib/pos-fulfillment-settings";
import { normalizePosDisplayStandbySettings, validatePosDisplayStandbySettings, type PosDisplayStandbySettings } from "../../../../../lib/pos-display-standby";
import { roleHasPermission } from "../../../../../lib/role-permissions";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../lib/store-order-access";
import { posMenuLock } from "../../../../../lib/pos-menu-settings";
import { getPosCounterMenuSettings, posCounterMenuTaxIncludedGuard, PosCounterMenuSettingsError, savePosCounterMenuSettings, sharedMenuBlocksTaxExcluded } from "../../../../../lib/pos-counter-menu-settings";

export const dynamic = "force-dynamic";

const priceTaxModes = new Set(["tax_included", "tax_excluded"]);
const discountTypes = new Set(["percent", "amount"]);
const discountTargetScopes = new Set(["all", "category", "item_kind", "brand"]);

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
  standby: PosDisplayStandbySettings;
};

const defaultCustomerDisplayMediaSettings: CustomerDisplayMediaSettings = {
  mode: "default",
  transition: "fade",
  slideDurationSeconds: 8,
  videoMuted: true,
  videoLoop: true,
  backgroundColor: "#fbfbf8",
  assets: [],
  standby: normalizePosDisplayStandbySettings(null)
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
    standby: normalizePosDisplayStandbySettings(record.standby),
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
    if (discountValue <= 0 && !(record.applicationMode === "campaign" && record.campaignBasis === "bowl_choice" && record.bowlBenefitMode === "gift_only")) return [];
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
      allowCouponCombination: record.allowCouponCombination === true,
      ...normalizePosCampaignFields(record)
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
      coalesce(pos_store_settings.takeout_enabled, true) as "takeoutEnabled",
      coalesce(pos_store_settings.dine_in_tax_rate, 10)::float as "dineInTaxRate",
      coalesce(pos_store_settings.takeout_tax_rate, 8)::float as "takeoutTaxRate",
      to_jsonb(pos_store_settings)->'payment_rounding' as "paymentRounding",
      coalesce(nullif(pos_store_settings.external_payment_terminal_brand, ''), 'PayCAS') as "externalPaymentTerminalBrand",
      coalesce(nullif(pos_store_settings.price_tax_mode, ''), 'tax_included') as "priceTaxMode",
      coalesce(pos_store_settings.discount_presets, '[]'::jsonb) as "discountPresets",
      coalesce(pos_store_settings.customer_display_media_settings, '{}'::jsonb) as "customerDisplayMediaSettings",
      coalesce(pos_store_settings.printer_settings, '{}'::jsonb) as "printerSettings",
      coalesce(pos_store_settings.scale_tare_settings, '{}'::jsonb) as "scaleTareSettings",
      coalesce(pos_store_settings.scale_filter_settings, '{}'::jsonb) as "scaleFilterSettings",
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
    paymentRounding: normalizePosPaymentRounding(settings.paymentRounding),
    customerDisplayMediaSettings: {
      ...(settings.customerDisplayMediaSettings && typeof settings.customerDisplayMediaSettings === "object" && !Array.isArray(settings.customerDisplayMediaSettings)
        ? settings.customerDisplayMediaSettings as Record<string, unknown> : {}),
      ...normalizeCustomerDisplayMediaSettings(settings.customerDisplayMediaSettings)
    },
    printerSettings: normalizePosPrinterSettings(settings.printerSettings),
    fulfillmentWorkspace: normalizePosFulfillmentWorkspaceSettings((settings.printerSettings as Record<string, unknown> | null)?.fulfillmentWorkspace),
    scaleTareSettings: normalizePosScaleTareSettings(settings.scaleTareSettings),
    scaleFilterSettings: normalizePosScaleFilterSettings(settings.scaleFilterSettings),
    posBrandSettings: brandRows as PosBrandSetting[]
  };
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { access, selectedStoreId, forbidden } = await resolveStoreId(request, session);
  if (forbidden || !selectedStoreId) return Response.json({ error: "権限がありません。" }, { status: 403 });
  const canManagePosSettings = await roleHasPermission(session.role, "pos.manageSettings");

  if (new URL(request.url).searchParams.get("section") === "counterMenuPolicy") {
    const counterMenu = await getPosCounterMenuSettings(selectedStoreId);
    if (!counterMenu) return Response.json({ error: "権限がありません。" }, { status: 403 });
    return Response.json({ access: { ...access, canManagePosSettings }, selectedStoreId, counterMenu }, { headers: { "Cache-Control": "no-store" } });
  }

  return Response.json({
    access: { ...access, canManagePosSettings },
    selectedStoreId,
    settings: await getSettings(selectedStoreId)
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if ((await roleHasPermission(session.role, "pos.manageSettings")) === false) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const rawBody: unknown = await request.json().catch(() => ({}));
  const body = (rawBody && typeof rawBody === "object" && !Array.isArray(rawBody) ? rawBody : {}) as {
    storeId?: string;
    section?: string;
    fulfillmentWorkspace?: unknown;
    scaleTareSettings?: unknown;
    scaleFilterSettings?: unknown;
    dineInEnabled?: boolean;
    takeoutEnabled?: boolean;
    dineInTaxRate?: number | string;
    takeoutTaxRate?: number | string;
    externalPaymentTerminalBrand?: string;
    paymentRounding?: unknown;
    priceTaxMode?: string;
    counterMenuPolicy?: unknown;
    counterMenuPolicyRevision?: unknown;
    counterMenuRevision?: unknown;
    discountPresets?: unknown[];
    discountCampaignVersion?: number;
    customerDisplayMediaSettings?: unknown;
    customerDisplayStandby?: unknown;
    printerSettings?: unknown;
    posBrandSettings?: unknown[];
  };
  const access = await getStoreOrderAccess(session);
  const storeId = getScopedStoreFilter(access, body.storeId);
  if (storeId === "__forbidden__" && ["general", "counterMenuPolicy", "customerDisplayMedia", "fulfillment", "customerDisplayStandby", "printing", "receiptConnection", "discount"].includes(body.section || "")) return Response.json({ error: "権限がありません。" }, { status: 403 });
  if (storeId === "__forbidden__" || !storeId) return Response.json({ error: "店舗を選択してください。" }, { status: 400 });

  if (body.section === "counterMenuPolicy") {
    if (body.storeId !== storeId || !access.stores.some(store => store.id === storeId)) return Response.json({ error: "権限がありません。" }, { status: 403 });
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
      return Response.json({ error: "不正なリクエスト元です。" }, { status: 403 });
    }
    try {
      const counterMenu = await savePosCounterMenuSettings(storeId, session.id, body.counterMenuPolicy, body.counterMenuPolicyRevision, body.counterMenuRevision);
      return Response.json({ ok: true, selectedStoreId: storeId, counterMenu }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof PosCounterMenuSettingsError) return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
      throw error;
    }
  }

  if (body.section === "general") {
    if (!access.stores.some(store=>store.id===storeId)) return Response.json({error:"権限がありません。"},{status:403});
    if (typeof body.dineInEnabled!=="boolean" || typeof body.takeoutEnabled!=="boolean" || ![body.dineInTaxRate,body.takeoutTaxRate].every(value=>(typeof value==="number"||typeof value==="string"&&value.trim()!=="")&&Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=100) || !priceTaxModes.has(String(body.priceTaxMode)) || !Array.isArray(body.posBrandSettings)) return Response.json({error:"税率・販売設定を確認してください。"},{status:400});
    if (!body.dineInEnabled&&!body.takeoutEnabled) return Response.json({error:"店内飲食または持ち帰りのどちらかを有効にしてください。"},{status:400});
    const brandSettings=normalizeBrandSettings(body.posBrandSettings);
    if (brandSettings.length!==body.posBrandSettings.length) return Response.json({error:"ブランドの販売設定を確認してください。"},{status:400});
    const linked=await sql`select brand_id::text as id from store_brands where store_id::text=${storeId}`;
    if (brandSettings.some(setting=>!linked.some(brand=>brand.id===setting.brandId))) return Response.json({error:"権限がありません。"},{status:403});
    try {
      await sql.transaction([posMenuLock(storeId), ...(body.priceTaxMode === "tax_excluded" ? [posCounterMenuTaxIncludedGuard(storeId)] : []),
        sql`insert into pos_store_settings(store_id,dine_in_enabled,takeout_enabled,dine_in_tax_rate,takeout_tax_rate,external_payment_terminal_brand,price_tax_mode,payment_rounding,updated_by)
        values(${storeId}::uuid,${body.dineInEnabled},${body.takeoutEnabled},${normalizeRate(body.dineInTaxRate,10)},${normalizeRate(body.takeoutTaxRate,8)},${normalizeText(body.externalPaymentTerminalBrand)||"PayCAS"},${String(body.priceTaxMode)},${JSON.stringify(normalizePosPaymentRounding(body.paymentRounding))}::jsonb,${session.id}::uuid)
        on conflict(store_id) do update set dine_in_enabled=excluded.dine_in_enabled,takeout_enabled=excluded.takeout_enabled,dine_in_tax_rate=excluded.dine_in_tax_rate,takeout_tax_rate=excluded.takeout_tax_rate,external_payment_terminal_brand=excluded.external_payment_terminal_brand,price_tax_mode=excluded.price_tax_mode,payment_rounding=case when ${body.paymentRounding !== undefined} then excluded.payment_rounding else pos_store_settings.payment_rounding end,updated_by=excluded.updated_by,updated_at=now()`,
        ...brandSettings.map(setting=>sql`update store_brands set pos_pricing_mode=${setting.posPricingMode},pos_weight_unit=${setting.posWeightUnit},pos_weight_unit_price=${setting.posPricingMode==="weight"?setting.posWeightUnitPrice:null} where store_id::text=${storeId} and brand_id::text=${setting.brandId}`)]);
    } catch (error) {
      if (body.priceTaxMode === "tax_excluded" && (error as { code?: string }).code === "22012") return Response.json({ error: sharedMenuBlocksTaxExcluded }, { status: 409 });
      throw error;
    }
    return Response.json({ok:true,selectedStoreId:storeId,settings:await getSettings(storeId)},{headers:{"Cache-Control":"no-store"}});
  }
  if (body.section === "customerDisplayMedia") {
    if (!access.stores.some(store=>store.id===storeId)) return Response.json({error:"権限がありません。"},{status:403});
    if (!body.customerDisplayMediaSettings||typeof body.customerDisplayMediaSettings!=="object"||Array.isArray(body.customerDisplayMediaSettings)) return Response.json({error:"広告設定を確認してください。"},{status:400});
    const normalized=normalizeCustomerDisplayMediaSettings(body.customerDisplayMediaSettings);
    const {standby:_standby,...media}=normalized;
    // Advertising owns these fields only; the standby designer and unknown settings survive concurrent saves.
    await sql`insert into pos_store_settings(store_id,customer_display_media_settings,updated_by) values(${storeId}::uuid,${JSON.stringify(media)}::jsonb,${session.id}::uuid)
      on conflict(store_id) do update set customer_display_media_settings=(case when jsonb_typeof(pos_store_settings.customer_display_media_settings)='object' then pos_store_settings.customer_display_media_settings else '{}'::jsonb end)||excluded.customer_display_media_settings,updated_by=excluded.updated_by,updated_at=now()`;
    return Response.json({ok:true,selectedStoreId:storeId,settings:await getSettings(storeId)},{headers:{"Cache-Control":"no-store"}});
  }

  if (body.section === "receiptConnection") {
    if (!access.stores.some(store => store.id === storeId)) return Response.json({ error: "権限がありません。" }, { status: 403 });
    if (!body.printerSettings || typeof body.printerSettings !== "object" || Array.isArray(body.printerSettings)) {
      return Response.json({ error: "プリンター接続の設定を確認してください。" }, { status: 400 });
    }
    const source = body.printerSettings as Record<string, unknown>;
    const normalized = normalizePosPrinterSettings(Object.fromEntries([
      "showPrintQueue", "receiptPrinter", "customerDisplay", "deviceType", "connectionType", "identifier", "host", "port",
      "paperWidth", "characterEncoding", "cutPaper", "openCashDrawer"
    ].map(key => [key, source[key]])));
    const connection = { showPrintQueue: normalized.showPrintQueue, receiptPrinter: normalized.receiptPrinter,
      customerDisplay: normalized.customerDisplay, deviceType: normalized.deviceType, connectionType: normalized.connectionType,
      identifier: normalized.identifier, host: normalized.host, port: normalized.port, paperWidth: normalized.paperWidth,
      characterEncoding: normalized.characterEncoding, cutPaper: normalized.cutPaper, openCashDrawer: normalized.openCashDrawer };
    // A hardware form must never republish its stale copy of document templates.
    await sql`insert into pos_store_settings(store_id, printer_settings, updated_by)
      values(${storeId}::uuid, ${JSON.stringify(connection)}::jsonb, ${session.id}::uuid)
      on conflict(store_id) do update set printer_settings = (case when jsonb_typeof(pos_store_settings.printer_settings) = 'object'
        then pos_store_settings.printer_settings else '{}'::jsonb end) || excluded.printer_settings,
        updated_by = excluded.updated_by, updated_at = now()`;
    return Response.json({ ok: true, selectedStoreId: storeId, settings: await getSettings(storeId) }, { headers: { "Cache-Control": "no-store" } });
  }

  if (body.section === "printing") {
    if (!access.stores.some(store => store.id === storeId)) return Response.json({ error: "権限がありません。" }, { status: 403 });
    const validation = validatePosPrintingSettings(body.printerSettings);
    if (validation.error) return Response.json({ error: validation.error }, { status: 400 });
    // Only the explicit six print fields are owned here. Merging inside the
    // upsert preserves concurrent connection, display, scale and other saves.
    await sql`insert into pos_store_settings(store_id, printer_settings, updated_by)
      values(${storeId}::uuid, ${JSON.stringify(validation.settings)}::jsonb, ${session.id}::uuid)
      on conflict(store_id) do update set printer_settings = (case when jsonb_typeof(pos_store_settings.printer_settings) = 'object'
        then pos_store_settings.printer_settings else '{}'::jsonb end) || excluded.printer_settings,
        updated_by = excluded.updated_by, updated_at = now()`;
    return Response.json({ ok: true, selectedStoreId: storeId, settings: await getSettings(storeId) }, { headers: { "Cache-Control": "no-store" } });
  }

  if (body.section === "discount") {
    if (!access.stores.some(store => store.id === storeId)) return Response.json({ error: "権限がありません。" }, { status: 403 });
    if (body.discountCampaignVersion !== 5 && (await getSettings(storeId))?.discountPresets.some(p => p.bowlDefaultChoice === "discount")) return Response.json({error:"特典の初期選択を保護するため、画面を更新してください。"},{status:409});
    if (![2, 3, 4, 5].includes(body.discountCampaignVersion ?? 0) && (await getSettings(storeId))?.discountPresets.some(p => p.campaignBasis === "bowl_choice")) return Response.json({ error:"1杯ごとの特典設定を保護するため、画面を更新してください。" }, {status:409});
    if (![3, 4, 5].includes(body.discountCampaignVersion ?? 0) && (await getSettings(storeId))?.discountPresets.some(p => (p.giftOptionIds?.length ?? 0) > 0 || (p.giftOptionGroupIds?.length ?? 0) > 0)) return Response.json({error:"選択肢のプレゼント設定を保護するため、画面を更新してください。"}, {status:409});
    if (![4, 5].includes(body.discountCampaignVersion ?? 0) && (await getSettings(storeId))?.discountPresets.some(p => p.campaignBasis === "bowl_choice" && p.bowlBenefitMode !== undefined && p.bowlBenefitMode !== "choice")) return Response.json({error:"特典の種類を保護するため、画面を更新してください。"}, {status:409});
    const campaignError = validatePosCampaignPresets(body.discountPresets);
    if (campaignError) return Response.json({ error: campaignError }, { status: 400 });
    if (![1, 2, 3, 4, 5].includes(body.discountCampaignVersion ?? 0) && (await getSettings(storeId))?.discountPresets.some(preset => preset.applicationMode === "campaign")) {
      return Response.json({ error: "キャンペーン設定を保護するため、画面を更新してから保存してください。" }, { status: 409 });
    }
    // Saving a discount must not republish a stale printing form from another tab.
    const saved = await sql`insert into pos_store_settings(store_id, discount_presets, updated_by)
      values(${storeId}::uuid, ${JSON.stringify(normalizeDiscountPresets(body.discountPresets))}::jsonb, ${session.id}::uuid)
      on conflict(store_id) do update set discount_presets = excluded.discount_presets,
        updated_by = excluded.updated_by, updated_at = now()
      where (${[1, 2, 3, 4, 5].includes(body.discountCampaignVersion ?? 0)} or not exists(select 1 from jsonb_array_elements(pos_store_settings.discount_presets) r where r->>'applicationMode' = 'campaign'))
        and (${body.discountCampaignVersion === 5} or not exists(select 1 from jsonb_array_elements(pos_store_settings.discount_presets) r where r->>'bowlDefaultChoice' = 'discount'))
        and (${[2, 3, 4, 5].includes(body.discountCampaignVersion ?? 0)} or not exists(select 1 from jsonb_array_elements(pos_store_settings.discount_presets) r where r->>'campaignBasis' = 'bowl_choice'))
        and (${[3, 4, 5].includes(body.discountCampaignVersion ?? 0)} or not exists(select 1 from jsonb_array_elements(pos_store_settings.discount_presets) r where jsonb_array_length(coalesce(r->'giftOptionIds', '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(r->'giftOptionGroupIds', '[]'::jsonb)) > 0))
        and (${[4, 5].includes(body.discountCampaignVersion ?? 0)} or not exists(select 1 from jsonb_array_elements(pos_store_settings.discount_presets) r where r->>'campaignBasis' = 'bowl_choice' and coalesce(r->>'bowlBenefitMode','choice') <> 'choice'))
      returning store_id`;
    if (!saved.length) return Response.json({ error: "キャンペーン設定を保護するため、画面を更新してから保存してください。" }, { status: 409 });
    return Response.json({ ok: true, selectedStoreId: storeId, settings: await getSettings(storeId) }, { headers: { "Cache-Control": "no-store" } });
  }

  if (body.section === "customerDisplayStandby") {
    if (!access.stores.some(store => store.id === storeId)) return Response.json({ error: "権限がありません。" }, { status: 403 });
    const validation = validatePosDisplayStandbySettings(body.customerDisplayStandby);
    if (validation.error) return Response.json({ error: validation.error }, { status: 400 });
    // The row-level JSONB update leaves advertising, weighing and unknown settings intact.
    await sql`insert into pos_store_settings(store_id, customer_display_media_settings, updated_by)
      values(${storeId}::uuid, jsonb_build_object('standby', ${JSON.stringify(validation.settings)}::jsonb), ${session.id}::uuid)
      on conflict(store_id) do update set customer_display_media_settings = jsonb_set(
        case when jsonb_typeof(pos_store_settings.customer_display_media_settings) = 'object'
          then pos_store_settings.customer_display_media_settings else '{}'::jsonb end,
        '{standby}', excluded.customer_display_media_settings->'standby', true),
        updated_by = excluded.updated_by, updated_at = now()`;
    return Response.json({ ok: true, selectedStoreId: storeId, settings: await getSettings(storeId) }, { headers: { "Cache-Control": "no-store" } });
  }

  if (body.section === "fulfillment") {
    const validation = validatePosFulfillmentWorkspaceSettings(body.fulfillmentWorkspace);
    if (validation.error) return Response.json({ error: validation.error }, { status: 400 });
    // Atomic JSONB updates preserve the independent print, scale and display settings.
    await sql`insert into pos_store_settings(store_id, printer_settings, updated_by)
      values(${storeId}::uuid, jsonb_build_object('fulfillmentWorkspace', ${JSON.stringify(validation.settings)}::jsonb), ${session.id}::uuid)
      on conflict(store_id) do update set printer_settings = jsonb_set(
        pos_store_settings.printer_settings, '{fulfillmentWorkspace}', excluded.printer_settings->'fulfillmentWorkspace', true),
        updated_by = excluded.updated_by, updated_at = now()`;
    return Response.json({ ok: true, selectedStoreId: storeId, settings: await getSettings(storeId) }, { headers: { "Cache-Control": "no-store" } });
  }
  const hasFulfillmentWorkspace = Object.prototype.hasOwnProperty.call(body, "fulfillmentWorkspace");
  const fulfillmentValidation = hasFulfillmentWorkspace ? validatePosFulfillmentWorkspaceSettings(body.fulfillmentWorkspace) : null;
  if (fulfillmentValidation?.error) return Response.json({ error: fulfillmentValidation.error }, { status: 400 });

  const hasFilterSettings=Object.prototype.hasOwnProperty.call(body,'scaleFilterSettings');
  const filterValidation=hasFilterSettings?validatePosScaleFilterSettings(body.scaleFilterSettings):{settings:defaultPosScaleFilterSettings()};
  if(filterValidation.error)return Response.json({error:filterValidation.error},{status:400});
  const filterSettings={...filterValidation.settings!,revision:hasFilterSettings?randomUUID():''};
  // Scale requests lock station first. Keep this order when configuration also resets sessions.
  const stationLocks=sql`select id from store_relay_stations where store_id::text=${storeId} order by id for update`;
  const filterLock=sql`select pg_advisory_xact_lock(hashtextextended(${`pos-scale-filter:${storeId}`},0))`;
  const resetFilterSessions=sql`update store_relay_stations s set scale_session=null,scale_tare_context='{}'::jsonb,
    scale_reading=null,scale_received_at=null,scale_sequence=-1,scale_filter_state='{}'::jsonb,updated_at=now()
    where s.store_id::text=${storeId} and exists(select 1 from pos_store_settings p where p.store_id=s.store_id
      and p.scale_filter_settings->>'revision'=${filterSettings.revision})`;
  if(body.section==='filter'){
    if(!hasFilterSettings)return Response.json({error:'重量の揺れを抑える設定を確認してください。'},{status:400});
    await sql.transaction([stationLocks,filterLock,sql`insert into pos_store_settings(store_id,scale_filter_settings,updated_by)
      values(${storeId}::uuid,${JSON.stringify(filterSettings)}::jsonb,${session.id}::uuid)
      on conflict(store_id) do update set scale_filter_settings=case
        when jsonb_build_object('enabled',coalesce(pos_store_settings.scale_filter_settings->'enabled','false'::jsonb),
          'toleranceGrams',coalesce(pos_store_settings.scale_filter_settings->'toleranceGrams','2'::jsonb),
          'settleMs',coalesce(pos_store_settings.scale_filter_settings->'settleMs','2000'::jsonb))=excluded.scale_filter_settings-'revision'
        then pos_store_settings.scale_filter_settings else excluded.scale_filter_settings end,updated_by=excluded.updated_by,updated_at=now()`,resetFilterSessions]);
    return Response.json({ok:true,selectedStoreId:storeId,settings:await getSettings(storeId)});
  }
  const hasTareSettings = Object.prototype.hasOwnProperty.call(body, 'scaleTareSettings');
  const tareValidation = hasTareSettings ? validatePosScaleTareSettings(body.scaleTareSettings) : { settings: defaultPosScaleTareSettings() };
  if (tareValidation.error) return Response.json({ error: tareValidation.error }, { status: 400 });
  const tareSettings = { ...tareValidation.settings!, revision: hasTareSettings ? randomUUID() : '' };
  const tareLock = sql`select pg_advisory_xact_lock(hashtextextended(${`pos-scale-tare:${storeId}`},0))`;
  if (body.section === 'tare') {
    if (!hasTareSettings) return Response.json({ error: 'ボウルの重量設定を確認してください。' }, { status: 400 });
    await sql.transaction([tareLock, sql`insert into pos_store_settings(store_id,scale_tare_settings,updated_by)
      values(${storeId}::uuid,${JSON.stringify(tareSettings)}::jsonb,${session.id}::uuid)
      on conflict(store_id) do update set scale_tare_settings=case
        when jsonb_build_object('enabled',coalesce(pos_store_settings.scale_tare_settings->'enabled','false'::jsonb),'presets',coalesce(pos_store_settings.scale_tare_settings->'presets','[{"id":"small","grams":null},{"id":"large","grams":null}]'::jsonb)) = excluded.scale_tare_settings - 'revision'
          then pos_store_settings.scale_tare_settings else excluded.scale_tare_settings end,
        updated_by=excluded.updated_by,updated_at=now()`]);
    return Response.json({ ok: true, selectedStoreId: storeId, settings: await getSettings(storeId) });
  }

  const priceTaxMode = normalizeText(body.priceTaxMode) || "tax_included";
  if (!priceTaxModes.has(priceTaxMode)) return Response.json({ error: "価格の税区分が正しくありません。" }, { status: 400 });

  const dineInTaxRate = normalizeRate(body.dineInTaxRate, 10);
  const takeoutTaxRate = normalizeRate(body.takeoutTaxRate, 8);
  const dineInEnabled = body.dineInEnabled !== false;
  const takeoutEnabled = body.takeoutEnabled !== false;
  if (!dineInEnabled && !takeoutEnabled) {
    return Response.json({ error: "店内飲食または持ち帰りのどちらかを有効にしてください。" }, { status: 400 });
  }
  const externalPaymentTerminalBrand = normalizeText(body.externalPaymentTerminalBrand) || "PayCAS";
  const savedDiscounts = (await getSettings(storeId))?.discountPresets ?? defaultDiscountPresets;
  const discountInput = body.discountPresets ?? savedDiscounts;
  if (body.discountPresets !== undefined && body.discountCampaignVersion !== 5 && savedDiscounts.some(p => p.bowlDefaultChoice === "discount")) return Response.json({error:"特典の初期選択を保護するため、画面を更新してください。"},{status:409});
  if (body.discountPresets !== undefined && ![2, 3, 4, 5].includes(body.discountCampaignVersion ?? 0) && savedDiscounts.some(p => p.campaignBasis === "bowl_choice")) return Response.json({error:"1杯ごとの特典設定を保護するため、画面を更新してください。"}, {status:409});
  if (body.discountPresets !== undefined && ![3, 4, 5].includes(body.discountCampaignVersion ?? 0) && savedDiscounts.some(p => (p.giftOptionIds?.length ?? 0) > 0 || (p.giftOptionGroupIds?.length ?? 0) > 0)) return Response.json({error:"選択肢のプレゼント設定を保護するため、画面を更新してください。"}, {status:409});
  if (body.discountPresets !== undefined && ![4, 5].includes(body.discountCampaignVersion ?? 0) && savedDiscounts.some(p => p.campaignBasis === "bowl_choice" && p.bowlBenefitMode !== undefined && p.bowlBenefitMode !== "choice")) return Response.json({error:"特典の種類を保護するため、画面を更新してください。"}, {status:409});
  const campaignError = validatePosCampaignPresets(discountInput);
  if (campaignError) return Response.json({ error: campaignError }, { status: 400 });
  if (body.discountPresets !== undefined && ![1, 2, 3, 4, 5].includes(body.discountCampaignVersion ?? 0) && savedDiscounts.some(preset => preset.applicationMode === "campaign")) {
    return Response.json({ error: "キャンペーン設定を保護するため、画面を更新してから保存してください。" }, { status: 409 });
  }
  const discountPresets = normalizeDiscountPresets(discountInput);
  const normalizedMediaSettings = normalizeCustomerDisplayMediaSettings(body.customerDisplayMediaSettings);
  const hasStandbySettings = Object.prototype.hasOwnProperty.call(body, "customerDisplayStandby");
  const standbyValidation = hasStandbySettings ? validatePosDisplayStandbySettings(body.customerDisplayStandby) : null;
  if (standbyValidation?.error) return Response.json({ error: standbyValidation.error }, { status: 400 });
  // A stale legacy nested standby value must never overwrite the separate designer.
  // New full-save clients opt in explicitly with the top-level section value.
  const customerDisplayMediaSettings = {
    mode: normalizedMediaSettings.mode,
    transition: normalizedMediaSettings.transition,
    slideDurationSeconds: normalizedMediaSettings.slideDurationSeconds,
    videoMuted: normalizedMediaSettings.videoMuted,
    videoLoop: normalizedMediaSettings.videoLoop,
    backgroundColor: normalizedMediaSettings.backgroundColor,
    assets: normalizedMediaSettings.assets,
    ...(hasStandbySettings ? { standby: standbyValidation?.settings } : {})
  };
  const printerSettings = normalizePosPrinterSettings(body.printerSettings);
  const printerSettingsSource = body.printerSettings && typeof body.printerSettings === "object" && !Array.isArray(body.printerSettings)
    ? body.printerSettings as Record<string, unknown> : {};
  const hasShowPrintQueue = Object.prototype.hasOwnProperty.call(printerSettingsSource, "showPrintQueue");
  const hasBowlTickets = Object.prototype.hasOwnProperty.call(printerSettingsSource, "bowlTickets");
  const hasReceiptCopies = Object.prototype.hasOwnProperty.call(printerSettingsSource, "receiptCopies");
  const brandSettings = normalizeBrandSettings(body.posBrandSettings);
  try {
    await sql.transaction([posMenuLock(storeId), ...(priceTaxMode === "tax_excluded" ? [posCounterMenuTaxIncludedGuard(storeId)] : []),
      ...(hasFilterSettings?[stationLocks]:[]),tareLock,filterLock, sql`
    insert into pos_store_settings (
      store_id,
      dine_in_enabled,
      takeout_enabled,
      dine_in_tax_rate,
      takeout_tax_rate,
      external_payment_terminal_brand,
      price_tax_mode,
      discount_presets,
      customer_display_media_settings,
      printer_settings,
      scale_tare_settings,
      scale_filter_settings,
      updated_by,
      updated_at
    )
    values (
      ${storeId},
      ${dineInEnabled},
      ${takeoutEnabled},
      ${dineInTaxRate},
      ${takeoutTaxRate},
      ${externalPaymentTerminalBrand},
      ${priceTaxMode},
      ${JSON.stringify(discountPresets)}::jsonb,
      ${JSON.stringify(customerDisplayMediaSettings)}::jsonb,
      ${JSON.stringify({ ...printerSettings, ...(hasFulfillmentWorkspace ? { fulfillmentWorkspace: fulfillmentValidation?.settings } : {}) })}::jsonb,
      ${JSON.stringify(tareSettings)}::jsonb,
      ${JSON.stringify(filterSettings)}::jsonb,
      ${session.id},
      now()
    )
    on conflict (store_id)
    do update set
      dine_in_enabled = excluded.dine_in_enabled,
      takeout_enabled = excluded.takeout_enabled,
      dine_in_tax_rate = excluded.dine_in_tax_rate,
      takeout_tax_rate = excluded.takeout_tax_rate,
      external_payment_terminal_brand = excluded.external_payment_terminal_brand,
      price_tax_mode = excluded.price_tax_mode,
      discount_presets = case when not ${body.discountPresets !== undefined} then pos_store_settings.discount_presets
        when ${body.discountCampaignVersion !== 5} and exists(select 1 from jsonb_array_elements(pos_store_settings.discount_presets) r where r->>'bowlDefaultChoice' = 'discount') then pos_store_settings.discount_presets
        when ${![4, 5].includes(body.discountCampaignVersion ?? 0)} and exists(select 1 from jsonb_array_elements(pos_store_settings.discount_presets) r where r->>'campaignBasis' = 'bowl_choice' and coalesce(r->>'bowlBenefitMode','choice') <> 'choice') then pos_store_settings.discount_presets
        when ${![3, 4, 5].includes(body.discountCampaignVersion ?? 0)} and exists(select 1 from jsonb_array_elements(pos_store_settings.discount_presets) r where jsonb_array_length(coalesce(r->'giftOptionIds', '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(r->'giftOptionGroupIds', '[]'::jsonb)) > 0) then pos_store_settings.discount_presets
        when ${![2, 3, 4, 5].includes(body.discountCampaignVersion ?? 0)} and exists(select 1 from jsonb_array_elements(pos_store_settings.discount_presets) r where r->>'campaignBasis' = 'bowl_choice') then pos_store_settings.discount_presets
        when ${![1, 2, 3, 4, 5].includes(body.discountCampaignVersion ?? 0)} and exists(select 1 from jsonb_array_elements(pos_store_settings.discount_presets) r where r->>'applicationMode' = 'campaign') then pos_store_settings.discount_presets
        else excluded.discount_presets end,
      customer_display_media_settings = (case when jsonb_typeof(pos_store_settings.customer_display_media_settings) = 'object'
        then pos_store_settings.customer_display_media_settings else '{}'::jsonb end) || excluded.customer_display_media_settings,
      printer_settings = excluded.printer_settings
        || case when not ${hasBowlTickets} and pos_store_settings.printer_settings ? 'bowlTickets'
          then jsonb_build_object('bowlTickets', pos_store_settings.printer_settings->'bowlTickets') else '{}'::jsonb end
        || case when not ${hasReceiptCopies} and pos_store_settings.printer_settings ? 'receiptCopies'
          then jsonb_build_object('receiptCopies', pos_store_settings.printer_settings->'receiptCopies') else '{}'::jsonb end
        || case when ${hasFulfillmentWorkspace} then jsonb_build_object('fulfillmentWorkspace', excluded.printer_settings->'fulfillmentWorkspace')
          when pos_store_settings.printer_settings ? 'fulfillmentWorkspace'
          then jsonb_build_object('fulfillmentWorkspace', pos_store_settings.printer_settings->'fulfillmentWorkspace') else '{}'::jsonb end
        || case when ${hasShowPrintQueue} then jsonb_build_object('showPrintQueue', excluded.printer_settings->'showPrintQueue')
          when pos_store_settings.printer_settings ? 'showPrintQueue'
          then jsonb_build_object('showPrintQueue', pos_store_settings.printer_settings->'showPrintQueue') else '{}'::jsonb end,
      scale_tare_settings = case when not ${hasTareSettings} then pos_store_settings.scale_tare_settings
        when jsonb_build_object('enabled',coalesce(pos_store_settings.scale_tare_settings->'enabled','false'::jsonb),'presets',coalesce(pos_store_settings.scale_tare_settings->'presets','[{"id":"small","grams":null},{"id":"large","grams":null}]'::jsonb)) = excluded.scale_tare_settings - 'revision'
          then pos_store_settings.scale_tare_settings else excluded.scale_tare_settings end,
      scale_filter_settings=case when not ${hasFilterSettings} then pos_store_settings.scale_filter_settings
        when jsonb_build_object('enabled',coalesce(pos_store_settings.scale_filter_settings->'enabled','false'::jsonb),
          'toleranceGrams',coalesce(pos_store_settings.scale_filter_settings->'toleranceGrams','2'::jsonb),
          'settleMs',coalesce(pos_store_settings.scale_filter_settings->'settleMs','2000'::jsonb))=excluded.scale_filter_settings-'revision'
        then pos_store_settings.scale_filter_settings else excluded.scale_filter_settings end,
      updated_by = excluded.updated_by,
      updated_at = now()
    `, ...(hasFilterSettings?[resetFilterSessions]:[])]);
  } catch (error) {
    if (priceTaxMode === "tax_excluded" && (error as { code?: string }).code === "22012") return Response.json({ error: sharedMenuBlocksTaxExcluded }, { status: 409 });
    throw error;
  }

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
