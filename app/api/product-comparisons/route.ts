import { put } from "@vercel/blob";
import { requireOpsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";

const allowedRoles = new Set(["owner", "manager", "buyer"]);
const adminRoles = new Set(["owner", "manager"]);
const maxPhotoSizeBytes = 4 * 1024 * 1024;

export async function GET() {
  const session = await requireOpsSession();
  if (!session || !allowedRoles.has(session.role)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const rows = await sql`
    select
      product_comparisons.id::text as id,
      product_comparisons.base_product_id::text as "baseProductId",
      coalesce(products.name, '') as "baseProductName",
      coalesce(products.package_spec, '') as "basePackageSpec",
      product_comparisons.candidate_product_name as "candidateProductName",
      product_comparisons.candidate_supplier_id::text as "candidateSupplierId",
      coalesce(product_comparisons.candidate_supplier_name, suppliers.name, '') as "candidateSupplierName",
      coalesce(product_comparisons.candidate_origin, '') as "candidateOrigin",
      coalesce(product_comparisons.candidate_purchase_url, '') as "candidatePurchaseUrl",
      product_comparisons.candidate_price::float as "candidatePrice",
      coalesce(nullif(product_comparisons.candidate_original_price, 0), product_comparisons.candidate_price)::float as "candidateOriginalPrice",
      coalesce(product_comparisons.candidate_currency, 'JPY') as "candidateCurrency",
      coalesce(product_comparisons.exchange_rate, 1)::float as "exchangeRate",
      product_comparisons.candidate_quantity::float as "candidateQuantity",
      product_comparisons.candidate_unit as "candidateUnit",
      product_comparisons.candidate_weight_kg::float as "candidateWeightKg",
      product_comparisons.import_quantity::float as "importQuantity",
      product_comparisons.freight_rate_per_kg::float as "freightRatePerKg",
      coalesce(nullif(product_comparisons.freight_rate_original_per_kg, 0), product_comparisons.freight_rate_per_kg)::float as "freightRateOriginalPerKg",
      product_comparisons.base_price::float as "basePrice",
      product_comparisons.base_quantity::float as "baseQuantity",
      product_comparisons.base_unit as "baseUnit",
      product_comparisons.is_imported as "isImported",
      product_comparisons.freight_cost::float as "freightCost",
      product_comparisons.tax_cost::float as "taxCost",
      product_comparisons.other_cost::float as "otherCost",
      coalesce(product_comparisons.photo_url, '') as "photoUrl",
      coalesce(product_comparisons.note, '') as note,
      product_comparisons.created_by::text as "createdById",
      coalesce(employees.name, '') as "createdBy",
      product_comparisons.archived_at is not null as "isArchived",
      to_char(product_comparisons.archived_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "archivedLabel",
      to_char(product_comparisons.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "createdLabel"
    from product_comparisons
    left join products on products.id = product_comparisons.base_product_id
    left join suppliers on suppliers.id = product_comparisons.candidate_supplier_id
    left join employees on employees.id = product_comparisons.created_by
    order by product_comparisons.created_at desc
  `;

  return Response.json({
    comparisons: rows.map((row) => ({
      ...row,
      canEdit: canModifyComparison(session.role, session.id, row.createdById),
      canDelete: canModifyComparison(session.role, session.id, row.createdById),
      canArchive: canModifyComparison(session.role, session.id, row.createdById)
    }))
  });
}

export async function POST(request: Request) {
  const session = await requireOpsSession();
  if (!session || !allowedRoles.has(session.role)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const formData = await request.formData();
  const baseProductId = String(formData.get("baseProductId") ?? "").trim();
  const candidateProductName = String(formData.get("candidateProductName") ?? "").trim();
  const candidateSupplierNameInput = String(formData.get("candidateSupplierName") ?? "").trim();
  const candidateOrigin = String(formData.get("candidateOrigin") ?? "").trim();
  const candidatePurchaseUrl = String(formData.get("candidatePurchaseUrl") ?? "").trim();
  const candidateOriginalPrice = normalizeNumber(formData.get("candidatePrice"));
  const candidateCurrencyInput = String(formData.get("candidateCurrency") ?? "JPY").trim().toUpperCase();
  const isImported = formData.get("isImported") === "on" || formData.get("isImported") === "true";
  const candidateCurrency = isImported && candidateCurrencyInput === "CNY" ? "CNY" : "JPY";
  const exchangeRate = candidateCurrency === "JPY" ? 1 : normalizeNumber(formData.get("exchangeRate"));
  const candidatePrice = candidateOriginalPrice * exchangeRate;
  const candidateQuantity = normalizeNumber(formData.get("candidateQuantity"));
  const candidateUnit = String(formData.get("candidateUnit") ?? "g").trim() || "g";
  const candidateWeightKg = normalizeNumber(formData.get("candidateWeightKg"));
  const importQuantity = normalizeNumber(formData.get("importQuantity")) || 1;
  const freightRateOriginalPerKg = normalizeNumber(formData.get("freightRatePerKg"));
  const freightRatePerKg = freightRateOriginalPerKg * exchangeRate;
  const basePrice = normalizeNumber(formData.get("basePrice"));
  const baseQuantity = normalizeNumber(formData.get("baseQuantity")) || 1;
  const baseUnit = String(formData.get("baseUnit") ?? candidateUnit).trim() || candidateUnit;
  const freightCostInput = normalizeNumber(formData.get("freightCost"));
  const taxCost = normalizeNumber(formData.get("taxCost"));
  const otherCost = normalizeNumber(formData.get("otherCost"));
  const note = String(formData.get("note") ?? "").trim();
  const file = formData.get("photo");
  const totalWeightKg = inferCandidateTotalWeightKg(candidateUnit, candidateQuantity, candidateWeightKg, importQuantity);

  if (!baseProductId) {
    return Response.json({ error: "比較対象の商品を選択してください。" }, { status: 400 });
  }

  if (!candidateProductName) {
    return Response.json({ error: "候補商品の名前を入力してください。" }, { status: 400 });
  }

  if (!Number.isFinite(candidateOriginalPrice) || candidateOriginalPrice <= 0 || !Number.isFinite(basePrice) || basePrice <= 0) {
    return Response.json({ error: "現行品と候補品の価格を入力してください。" }, { status: 400 });
  }

  if (candidateCurrency !== "JPY" && (!Number.isFinite(exchangeRate) || exchangeRate <= 0)) {
    return Response.json({ error: "為替レートを入力してください。" }, { status: 400 });
  }

  if (isImported && candidateUnit === "箱" && (!Number.isFinite(candidateWeightKg) || candidateWeightKg <= 0)) {
    return Response.json({ error: "海外輸入品で候補単位が箱の場合は、候補1箱重量を入力してください。" }, { status: 400 });
  }

  const photoUrl = await uploadPhotoIfNeeded(file, candidateProductName, "product-comparisons");
  const freightCost = isImported && totalWeightKg > 0 && freightRatePerKg > 0
    ? freightRatePerKg * totalWeightKg
    : freightCostInput;

  await sql`
    insert into product_comparisons (
      base_product_id,
      candidate_product_name,
      candidate_supplier_id,
      candidate_supplier_name,
      candidate_origin,
      candidate_purchase_url,
      candidate_price,
      candidate_original_price,
      candidate_currency,
      exchange_rate,
      candidate_quantity,
      candidate_unit,
      candidate_weight_kg,
      import_quantity,
      freight_rate_per_kg,
      freight_rate_original_per_kg,
      base_price,
      base_quantity,
      base_unit,
      is_imported,
      freight_cost,
      tax_cost,
      other_cost,
      photo_url,
      note,
      created_by,
      updated_at
    ) values (
      ${baseProductId},
      ${candidateProductName},
      ${null},
      ${candidateSupplierNameInput},
      ${candidateOrigin},
      ${candidatePurchaseUrl},
      ${candidatePrice},
      ${candidateOriginalPrice},
      ${candidateCurrency},
      ${exchangeRate},
      ${candidateQuantity},
      ${candidateUnit},
      ${candidateWeightKg},
      ${importQuantity},
      ${freightRatePerKg},
      ${freightRateOriginalPerKg},
      ${basePrice},
      ${baseQuantity},
      ${baseUnit},
      ${isImported},
      ${freightCost},
      ${taxCost},
      ${otherCost},
      ${photoUrl},
      ${note},
      ${session.id},
      now()
    )
  `;

  return Response.json({ ok: true });
}

export async function PATCH(request: Request) {
  const session = await requireOpsSession();
  if (!session || !allowedRoles.has(session.role)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  if (request.headers.get("content-type")?.includes("application/json")) {
    const body = await request.json().catch(() => ({})) as { id?: string; action?: string };
    return updateComparisonArchive(session, String(body.id ?? "").trim(), String(body.action ?? ""));
  }

  const formData = await request.formData();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return Response.json({ error: "商品比較が見つかりません。" }, { status: 404 });

  const rows = await sql`
    select id, created_by::text as "createdById", photo_url as "photoUrl"
    from product_comparisons
    where id = ${id}
    limit 1
  `;
  const target = rows[0];
  if (!target) return Response.json({ error: "商品比較が見つかりません。" }, { status: 404 });
  if (!canModifyComparison(session.role, session.id, target.createdById)) {
    return Response.json({ error: "この商品比較を編集する権限がありません。" }, { status: 403 });
  }

  const parsed = parseComparisonForm(formData);
  const validationError = validateComparison(parsed);
  if (validationError) return validationError;
  const photoUrl = await uploadPhotoIfNeeded(formData.get("photo"), parsed.candidateProductName, "product-comparisons");

  await sql`
    update product_comparisons
    set
      base_product_id = ${parsed.baseProductId},
      candidate_product_name = ${parsed.candidateProductName},
      candidate_supplier_id = ${null},
      candidate_supplier_name = ${parsed.candidateSupplierNameInput},
      candidate_origin = ${parsed.candidateOrigin},
      candidate_purchase_url = ${parsed.candidatePurchaseUrl},
      candidate_price = ${parsed.candidatePrice},
      candidate_original_price = ${parsed.candidateOriginalPrice},
      candidate_currency = ${parsed.candidateCurrency},
      exchange_rate = ${parsed.exchangeRate},
      candidate_quantity = ${parsed.candidateQuantity},
      candidate_unit = ${parsed.candidateUnit},
      candidate_weight_kg = ${parsed.candidateWeightKg},
      import_quantity = ${parsed.importQuantity},
      freight_rate_per_kg = ${parsed.freightRatePerKg},
      freight_rate_original_per_kg = ${parsed.freightRateOriginalPerKg},
      base_price = ${parsed.basePrice},
      base_quantity = ${parsed.baseQuantity},
      base_unit = ${parsed.baseUnit},
      is_imported = ${parsed.isImported},
      freight_cost = ${parsed.freightCost},
      tax_cost = ${parsed.taxCost},
      other_cost = ${parsed.otherCost},
      photo_url = ${photoUrl || target.photoUrl || ""},
      note = ${parsed.note},
      updated_at = now()
    where id = ${id}
  `;

  return Response.json({ ok: true });
}

async function updateComparisonArchive(session: Awaited<ReturnType<typeof requireOpsSession>>, id: string, action: string) {
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });
  if (!id) return Response.json({ error: "商品比較が見つかりません。" }, { status: 404 });
  if (!["archive", "restore"].includes(action)) {
    return Response.json({ error: "操作を確認してください。" }, { status: 400 });
  }

  const rows = await sql`
    select id, created_by::text as "createdById"
    from product_comparisons
    where id = ${id}
    limit 1
  `;
  const target = rows[0];
  if (!target) return Response.json({ error: "商品比較が見つかりません。" }, { status: 404 });
  if (!canModifyComparison(session.role, session.id, target.createdById)) {
    return Response.json({ error: "この商品比較を更新する権限がありません。" }, { status: 403 });
  }

  await sql`
    update product_comparisons
    set
      archived_at = ${action === "archive" ? new Date().toISOString() : null},
      updated_at = now()
    where id = ${id}
  `;

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await requireOpsSession();
  if (!session || !allowedRoles.has(session.role)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { id?: string };
  const id = String(body.id ?? "").trim();
  if (!id) return Response.json({ error: "商品比較が見つかりません。" }, { status: 404 });

  const rows = await sql`
    select id, created_by::text as "createdById"
    from product_comparisons
    where id = ${id}
    limit 1
  `;
  const target = rows[0];
  if (!target) return Response.json({ error: "商品比較が見つかりません。" }, { status: 404 });
  if (!canModifyComparison(session.role, session.id, target.createdById)) {
    return Response.json({ error: "この商品比較を削除する権限がありません。" }, { status: 403 });
  }

  await sql`delete from product_comparisons where id = ${id}`;
  return Response.json({ ok: true });
}

function parseComparisonForm(formData: FormData) {
  const candidateOriginalPrice = normalizeNumber(formData.get("candidatePrice"));
  const candidateCurrencyInput = String(formData.get("candidateCurrency") ?? "JPY").trim().toUpperCase();
  const isImported = formData.get("isImported") === "on" || formData.get("isImported") === "true";
  const candidateCurrency = isImported && candidateCurrencyInput === "CNY" ? "CNY" : "JPY";
  const exchangeRate = candidateCurrency === "JPY" ? 1 : normalizeNumber(formData.get("exchangeRate"));
  const freightRateOriginalPerKg = normalizeNumber(formData.get("freightRatePerKg"));
  const freightRatePerKg = freightRateOriginalPerKg * exchangeRate;
  const candidateWeightKg = normalizeNumber(formData.get("candidateWeightKg"));
  const importQuantity = normalizeNumber(formData.get("importQuantity")) || 1;
  const freightCostInput = normalizeNumber(formData.get("freightCost"));
  const candidatePrice = candidateOriginalPrice * exchangeRate;
  const candidateQuantity = normalizeNumber(formData.get("candidateQuantity"));
  const candidateUnit = String(formData.get("candidateUnit") ?? "g").trim() || "g";
  const totalWeightKg = inferCandidateTotalWeightKg(candidateUnit, candidateQuantity, candidateWeightKg, importQuantity);
  const isWeightedImport = isImported && totalWeightKg > 0 && freightRatePerKg > 0;

  return {
    baseProductId: String(formData.get("baseProductId") ?? "").trim(),
    candidateProductName: String(formData.get("candidateProductName") ?? "").trim(),
    candidateSupplierNameInput: String(formData.get("candidateSupplierName") ?? "").trim(),
    candidateOrigin: String(formData.get("candidateOrigin") ?? "").trim(),
    candidatePurchaseUrl: String(formData.get("candidatePurchaseUrl") ?? "").trim(),
    candidateOriginalPrice,
    candidateCurrency,
    exchangeRate,
    candidatePrice,
    candidateQuantity,
    candidateUnit,
    candidateWeightKg,
    importQuantity,
    freightRateOriginalPerKg,
    freightRatePerKg,
    basePrice: normalizeNumber(formData.get("basePrice")),
    baseQuantity: normalizeNumber(formData.get("baseQuantity")) || 1,
    baseUnit: String(formData.get("baseUnit") ?? "g").trim() || "g",
    isImported,
    freightCost: isImported && isWeightedImport ? freightRatePerKg * totalWeightKg : freightCostInput,
    taxCost: normalizeNumber(formData.get("taxCost")),
    otherCost: normalizeNumber(formData.get("otherCost")),
    note: String(formData.get("note") ?? "").trim()
  };
}

function validateComparison(parsed: ReturnType<typeof parseComparisonForm>) {
  if (!parsed.baseProductId) {
    return Response.json({ error: "比較対象の商品を選択してください。" }, { status: 400 });
  }

  if (!parsed.candidateProductName) {
    return Response.json({ error: "候補商品の名前を入力してください。" }, { status: 400 });
  }

  if (!Number.isFinite(parsed.candidateOriginalPrice) || parsed.candidateOriginalPrice <= 0 || !Number.isFinite(parsed.basePrice) || parsed.basePrice <= 0) {
    return Response.json({ error: "現行品と候補品の価格を入力してください。" }, { status: 400 });
  }

  if (!Number.isFinite(parsed.candidateQuantity) || parsed.candidateQuantity <= 0) {
    return Response.json({ error: "候補規格数量を入力してください。" }, { status: 400 });
  }

  if (parsed.candidateCurrency !== "JPY" && (!Number.isFinite(parsed.exchangeRate) || parsed.exchangeRate <= 0)) {
    return Response.json({ error: "為替レートを入力してください。" }, { status: 400 });
  }

  if (parsed.isImported && parsed.candidateUnit === "箱" && (!Number.isFinite(parsed.candidateWeightKg) || parsed.candidateWeightKg <= 0)) {
    return Response.json({ error: "海外輸入品で候補単位が箱の場合は、候補1箱重量を入力してください。" }, { status: 400 });
  }

  return null;
}

function inferCandidateTotalWeightKg(unit: string, quantity: number, manualWeightKg: number, importQuantity: number) {
  if (unit === "kg") return quantity * importQuantity;
  if (unit === "g") return (quantity / 1000) * importQuantity;
  return manualWeightKg * importQuantity;
}

function canModifyComparison(role: string, employeeId: string, createdById?: string) {
  return adminRoles.has(role) || Boolean(createdById && createdById === employeeId);
}

function normalizeNumber(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").replace(/[¥￥,\s]/g, "");
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

async function uploadPhotoIfNeeded(file: FormDataEntryValue | null, name: string, folder: string) {
  if (!(file instanceof File) || file.size === 0) return "";

  if (!file.type.startsWith("image/")) {
    throw new Error("画像ファイルを選択してください。");
  }

  if (file.size > maxPhotoSizeBytes) {
    throw new Error("写真は4MB以下にしてください。");
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Vercel Blob が未設定です。BLOB_READ_WRITE_TOKEN を接続してください。");
  }

  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const safeName = name.replace(/[^\w.-]+/g, "-").toLowerCase() || "comparison";
  const blob = await put(`${folder}/${safeName}-${Date.now()}.${extension}`, file, {
    access: "private"
  });

  return `/api/products/photo/view?pathname=${encodeURIComponent(blob.pathname)}&v=${Date.now()}`;
}
