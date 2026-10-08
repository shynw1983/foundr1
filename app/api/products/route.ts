import { requireMasterOsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";
import { normalizeCatalogVisibility, productCatalogVisibilities, resolveProductCatalogConfiguration } from "../../../lib/product-catalog-policy";
import { roleHasPermission } from "../../../lib/role-permissions";

type ProductPayload = {
  id?: string;
  currentName?: string;
  name?: string;
  productBrandName?: string;
  manufacturer?: string;
  category?: string;
  subcategory?: string;
  unit?: string;
  referencePrice?: number;
  originCountries?: string[];
  packageQuantity?: number | string;
  packageQuantityUnit?: string;
  productFamilyName?: string;
  variantName?: string;
  isDefaultVariant?: boolean;
  variantSortOrder?: number | string;
  brand?: string;
  mainSupplier?: string;
  backupSupplier?: string;
  mainPurchaseUrl?: string;
  backupPurchaseUrl?: string;
  isImported?: boolean;
  importOriginCountry?: string;
  importCurrency?: string;
  importOriginalPrice?: number | string;
  importExchangeRate?: number | string;
  importPriceJpy?: number | string;
  importFreightRateOriginalPerKg?: number | string;
  importFreightRateJpyPerKg?: number | string;
  importWeightStrategy?: string;
  importWeightKg?: number | string;
  importFreightCostJpy?: number | string;
  importTaxCostJpy?: number | string;
  importOtherCostJpy?: number | string;
  specNote?: string;
  japaneseNote?: string;
  photoUrl?: string;
  storageType?: string;
  usageType?: string;
  catalogVisibility?: string;
  isOrderable?: boolean;
  catalogStoreIds?: string[];
};

export async function PUT(request: Request) {
  const session = await requireMasterOsSession();
  if (!session || !(await roleHasPermission(session.role, "products.manage"))) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json() as ProductPayload;
  const requestedId = String(body.id ?? "").trim();
  const currentName = String(body.currentName ?? "").trim();
  const existingRows = requestedId || currentName ? await sql`
    select products.id::text as id, products.catalog_visibility as "catalogVisibility", products.is_orderable as "isOrderable",
      coalesce((select array_agg(grants.store_id::text) from product_catalog_store_grants grants where grants.product_id = products.id), '{}'::text[]) as "catalogStoreIds"
    from products
    where (${requestedId !== ""} and products.id::text = ${requestedId})
      or (${requestedId === ""} and products.name = ${currentName})
  ` : [];
  if ((requestedId || currentName) && existingRows.length === 0) {
    return Response.json({ error: "商品が見つかりません。" }, { status: 404 });
  }
  if (existingRows.length > 1) {
    return Response.json({ error: "同名の商品が複数あります。商品IDを指定して編集してください。" }, { status: 409 });
  }
  const id = String(existingRows[0]?.id ?? "");
  if (body.catalogVisibility !== undefined && !productCatalogVisibilities.includes(body.catalogVisibility as typeof productCatalogVisibilities[number])) {
    return Response.json({ error: "商品公開範囲が不正です。" }, { status: 400 });
  }
  if (body.isOrderable !== undefined && typeof body.isOrderable !== "boolean") {
    return Response.json({ error: "発注可否が不正です。" }, { status: 400 });
  }
  if (body.catalogStoreIds !== undefined && (!Array.isArray(body.catalogStoreIds) || body.catalogStoreIds.some((value) =>
    typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())
  ))) {
    return Response.json({ error: "公開する店舗を正しく指定してください。" }, { status: 400 });
  }
  const catalogConfiguration = resolveProductCatalogConfiguration({
    catalogVisibility: body.catalogVisibility === undefined ? undefined : normalizeCatalogVisibility(body.catalogVisibility),
    isOrderable: body.isOrderable,
    catalogStoreIds: body.catalogStoreIds?.map((value) => value.trim().toLowerCase())
  }, existingRows[0] ? {
    catalogVisibility: normalizeCatalogVisibility(existingRows[0].catalogVisibility),
    isOrderable: existingRows[0].isOrderable === true,
    catalogStoreIds: Array.isArray(existingRows[0].catalogStoreIds) ? existingRows[0].catalogStoreIds.map(String) : []
  } : undefined);
  if (catalogConfiguration.catalogStoreIds.length > 0) {
    const storeRows = await sql`select id::text as id from stores where id::text = any(${catalogConfiguration.catalogStoreIds})`;
    if (storeRows.length !== catalogConfiguration.catalogStoreIds.length) {
      return Response.json({ error: "公開する店舗が見つかりません。" }, { status: 400 });
    }
  }
  const name = String(body.name ?? "").trim();
  const productBrandName = String(body.productBrandName ?? "").trim();
  const manufacturer = String(body.manufacturer ?? "").trim();
  const category = String(body.category ?? "").trim() || "未分類";
  const subcategory = String(body.subcategory ?? "").trim() || "未分類";
  const unit = String(body.unit ?? "").trim() || "個";
  const referencePrice = Number(body.referencePrice ?? 0);
  const packageQuantity = parseOptionalNumber(body.packageQuantity);
  const packageQuantityUnit = String(body.packageQuantityUnit ?? "").trim();
  const originCountries = Array.isArray(body.originCountries)
    ? body.originCountries.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const productFamilyName = String(body.productFamilyName ?? "").trim() || name;
  const variantName = String(body.variantName ?? "").trim();
  const isDefaultVariant = body.isDefaultVariant === true || String(body.isDefaultVariant ?? "") === "true";
  const variantSortOrder = parseOptionalInteger(body.variantSortOrder);
  const specNote = String(body.specNote ?? "");
  const japaneseNote = String(body.japaneseNote ?? "");
  const photoUrl = String(body.photoUrl ?? "");
  const storageType = String(body.storageType ?? "");
  const usageType = String(body.usageType ?? "ingredient").trim() || "ingredient";
  const selectedBrands = String(body.brand ?? "")
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
  const isImported = body.isImported === true || String(body.isImported ?? "") === "true";
  const importOriginCountry = isImported
    ? String(body.importOriginCountry ?? "中国").trim() || "中国"
    : "";
  const importCurrencyInput = String(body.importCurrency ?? "CNY").trim().toUpperCase();
  const importCurrency = importCurrencyInput === "JPY" ? "JPY" : "CNY";
  const importExchangeRate = isImported && importCurrency !== "JPY"
    ? parsePositiveNumber(body.importExchangeRate, 1)
    : 1;
  const importOriginalPrice = isImported ? parseOptionalNumber(body.importOriginalPrice) : null;
  const importPriceJpy = isImported
    ? parsePositiveNumber(body.importPriceJpy, Number(importOriginalPrice ?? 0) * importExchangeRate)
    : null;
  const importFreightRateOriginalPerKg = isImported
    ? parsePositiveNumber(body.importFreightRateOriginalPerKg, 20)
    : 20;
  const importFreightRateJpyPerKg = isImported
    ? parsePositiveNumber(body.importFreightRateJpyPerKg, importFreightRateOriginalPerKg * importExchangeRate)
    : 0;
  const importWeightStrategy = isImported && String(body.importWeightStrategy ?? "") === "actual_weight"
    ? "actual_weight"
    : "standard_1kg";
  const importWeightKg = isImported
    ? parsePositiveNumber(body.importWeightKg, importWeightStrategy === "standard_1kg" ? 1 : 0)
    : 1;
  const importFreightCostJpy = isImported
    ? parsePositiveNumber(body.importFreightCostJpy, importFreightRateJpyPerKg * importWeightKg)
    : 0;
  const importTaxCostJpy = isImported ? parsePositiveNumber(body.importTaxCostJpy, 0) : 0;
  const importOtherCostJpy = isImported ? parsePositiveNumber(body.importOtherCostJpy, 0) : 0;
  const brandScope = selectedBrands.includes("共通")
    ? "common"
    : selectedBrands.filter((brandName) => brandName !== "未設定").length > 0
      ? "specific"
      : "unset";

  if (!name) {
    return Response.json({ error: "商品名を入力してください。" }, { status: 400 });
  }

  if (isImported && (!Number.isFinite(importFreightRateOriginalPerKg) || importFreightRateOriginalPerKg <= 0)) {
    return Response.json({ error: "海外輸入品は運賃単価を入力してください。" }, { status: 400 });
  }

  if (isImported && importWeightStrategy === "actual_weight" && (!Number.isFinite(importWeightKg) || importWeightKg <= 0)) {
    return Response.json({ error: "実重量で計算する場合は輸入計算重量を入力してください。" }, { status: 400 });
  }

  const rows = id
    ? await sql`
        update products
        set
          name = ${name},
          product_brand_name = ${productBrandName},
          manufacturer = ${manufacturer},
          category = ${category},
          subcategory = ${subcategory},
          unit = ${unit},
          reference_price = ${Number.isFinite(referencePrice) ? referencePrice : 0},
          origin_countries = ${originCountries},
          package_quantity = ${packageQuantity},
          package_quantity_unit = ${packageQuantity ? packageQuantityUnit || unit : ""},
          product_family_name = ${productFamilyName},
          variant_name = ${variantName},
          is_default_variant = ${isDefaultVariant},
          variant_sort_order = ${variantSortOrder},
          spec_note = ${specNote},
          japanese_note = ${japaneseNote},
          photo_url = ${photoUrl},
          brand_scope = ${brandScope},
          is_imported = ${isImported},
          import_origin_country = ${importOriginCountry},
          import_currency = ${importCurrency},
          import_original_price = ${importOriginalPrice},
          import_exchange_rate = ${importExchangeRate},
          import_price_jpy = ${importPriceJpy},
          import_freight_rate_original_per_kg = ${importFreightRateOriginalPerKg},
          import_freight_rate_jpy_per_kg = ${importFreightRateJpyPerKg},
          import_weight_strategy = ${importWeightStrategy},
          import_weight_kg = ${importWeightKg},
          import_freight_cost_jpy = ${importFreightCostJpy},
          import_tax_cost_jpy = ${importTaxCostJpy},
          import_other_cost_jpy = ${importOtherCostJpy},
          storage_type = ${storageType},
          usage_type = ${usageType},
          updated_at = now()
        where id = ${id}
        returning id
      `
    : await sql`
        insert into products (
          name,
          product_brand_name,
          manufacturer,
          category,
          subcategory,
          unit,
          reference_price,
          origin_countries,
          package_quantity,
          package_quantity_unit,
          product_family_name,
          variant_name,
          is_default_variant,
          variant_sort_order,
          spec_note,
          japanese_note,
          photo_url,
          brand_scope,
          is_imported,
          import_origin_country,
          import_currency,
          import_original_price,
          import_exchange_rate,
          import_price_jpy,
          import_freight_rate_original_per_kg,
          import_freight_rate_jpy_per_kg,
          import_weight_strategy,
          import_weight_kg,
          import_freight_cost_jpy,
          import_tax_cost_jpy,
          import_other_cost_jpy,
          storage_type,
          usage_type,
          updated_at
        )
        values (
          ${name},
          ${productBrandName},
          ${manufacturer},
          ${category},
          ${subcategory},
          ${unit},
          ${Number.isFinite(referencePrice) ? referencePrice : 0},
          ${originCountries},
          ${packageQuantity},
          ${packageQuantity ? packageQuantityUnit || unit : ""},
          ${productFamilyName},
          ${variantName},
          ${isDefaultVariant},
          ${variantSortOrder},
          ${specNote},
          ${japaneseNote},
          ${photoUrl},
          ${brandScope},
          ${isImported},
          ${importOriginCountry},
          ${importCurrency},
          ${importOriginalPrice},
          ${importExchangeRate},
          ${importPriceJpy},
          ${importFreightRateOriginalPerKg},
          ${importFreightRateJpyPerKg},
          ${importWeightStrategy},
          ${importWeightKg},
          ${importFreightCostJpy},
          ${importTaxCostJpy},
          ${importOtherCostJpy},
          ${storageType},
          ${usageType},
          now()
        )
        returning id
      `;

  const productId = rows[0]?.id;

  if (!productId) {
    return Response.json({ error: "商品が見つかりません。" }, { status: 404 });
  }

  const specificBrandNames = brandScope === "specific"
    ? selectedBrands.filter((item) => item !== "未設定" && item !== "共通")
    : [];
  await sql`
    delete from product_brand_usages
    where product_id = ${productId}
      and brand_id not in (select id from brands where name = any(${specificBrandNames}))
  `;
  if (brandScope === "specific") {
    for (const brandName of selectedBrands.filter((item) => item !== "未設定" && item !== "共通")) {
      await sql`
        insert into product_brand_usages (product_id, brand_id)
        select ${productId}, brands.id
        from brands
        where brands.name = ${brandName}
        on conflict do nothing
      `;
    }
  }

  await sql`
    with policy as (
      update products set catalog_visibility = ${catalogConfiguration.catalogVisibility},
        is_orderable = ${catalogConfiguration.isOrderable}
      where id = ${productId}
      returning id
    ), removed_grants as (
      delete from product_catalog_store_grants
      where product_id = ${productId}
        and store_id::text <> all(${catalogConfiguration.catalogStoreIds})
      returning product_id
    )
    insert into product_catalog_store_grants (product_id, store_id)
    select policy.id, grant_store.store_id::uuid
    from policy cross join unnest(${catalogConfiguration.catalogStoreIds}::text[]) as grant_store(store_id)
    on conflict do nothing
  `;

  await sql`
    delete from product_supplier_options
    where product_id = ${productId}
      and role in ('メイン', '予備')
  `;

  for (const option of [
    { role: "メイン", supplier: body.mainSupplier, purchaseUrl: body.mainPurchaseUrl, price: Number.isFinite(referencePrice) ? referencePrice : 0 },
    { role: "予備", supplier: body.backupSupplier, purchaseUrl: body.backupPurchaseUrl, price: null }
  ]) {
    const supplierName = String(option.supplier ?? "").trim();
    if (!supplierName) continue;

    await sql`
      insert into product_supplier_options (product_id, supplier_id, role, reference_price, purchase_url, is_active)
      select ${productId}, suppliers.id, ${option.role}, ${option.price}, ${String(option.purchaseUrl ?? "").trim() || null}, true
      from suppliers
      where suppliers.name = ${supplierName}
      on conflict (product_id, supplier_id, role)
      do update set
        reference_price = excluded.reference_price,
        purchase_url = excluded.purchase_url,
        is_active = true
    `;
  }

  return Response.json({ ok: true });
}

function parseOptionalNumber(value: unknown) {
  const normalized = String(value ?? "").replace(/[¥￥,\s]/g, "");
  if (!normalized) return null;
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

function parsePositiveNumber(value: unknown, fallback: number) {
  const parsed = parseOptionalNumber(value);
  return parsed ?? fallback;
}

function parseOptionalInteger(value: unknown) {
  const normalized = String(value ?? "").replace(/[,\s]/g, "");
  if (!normalized) return 0;
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : 0;
}

export async function DELETE(request: Request) {
  const session = await requireMasterOsSession();
  if (!session || !(await roleHasPermission(session.role, "products.manage"))) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json() as { id?: string; productName?: string };
  const requestedId = String(body.id ?? "").trim();
  const productName = String(body.productName ?? "").trim();

  if (!requestedId && !productName) {
    return Response.json({ error: "product id is required" }, { status: 400 });
  }
  const productRows = await sql`
    select id::text as id from products
    where (${requestedId !== ""} and id::text = ${requestedId})
      or (${requestedId === ""} and name = ${productName})
  `;
  if (productRows.length === 0) return Response.json({ error: "商品が見つかりません。" }, { status: 404 });
  if (productRows.length > 1) {
    return Response.json({ error: "同名の商品が複数あります。商品IDを指定して削除してください。" }, { status: 409 });
  }
  const id = String(productRows[0].id);

  const linkedItems = await sql`
    select count(*)::int as count
    from purchase_order_items
    where purchase_order_items.product_id = ${id}
  `;

  if (Number(linkedItems[0]?.count ?? 0) > 0) {
    return Response.json(
      { error: "この商品は発注履歴で使用されているため削除できません。" },
      { status: 409 }
    );
  }
  const inventoryReferences = await sql`
    select exists(select 1 from inventory_items where product_id = ${id})
      or exists(select 1 from inventory_checks where product_id = ${id}) as linked
  `;
  if (inventoryReferences[0]?.linked === true) {
    return Response.json({ error: "在庫記録のある商品は削除できません。発注停止を使用してください。" }, { status: 409 });
  }

  await sql`
    delete from products
    where id = ${id}
  `;

  return Response.json({ ok: true });
}
