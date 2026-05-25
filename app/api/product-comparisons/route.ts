import { put } from "@vercel/blob";
import { requireOpsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";

const allowedRoles = new Set(["owner", "manager", "buyer"]);
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
      coalesce(employees.name, '') as "createdBy",
      to_char(product_comparisons.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "createdLabel"
    from product_comparisons
    left join products on products.id = product_comparisons.base_product_id
    left join suppliers on suppliers.id = product_comparisons.candidate_supplier_id
    left join employees on employees.id = product_comparisons.created_by
    order by product_comparisons.created_at desc
  `;

  return Response.json({ comparisons: rows });
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
  const candidateOriginalPrice = normalizeNumber(formData.get("candidatePrice"));
  const candidateCurrencyInput = String(formData.get("candidateCurrency") ?? "JPY").trim().toUpperCase();
  const isImported = formData.get("isImported") === "on" || formData.get("isImported") === "true";
  const candidateCurrency = isImported && candidateCurrencyInput === "CNY" ? "CNY" : "JPY";
  const exchangeRate = candidateCurrency === "JPY" ? 1 : normalizeNumber(formData.get("exchangeRate"));
  const candidatePrice = candidateOriginalPrice * exchangeRate;
  const candidateQuantity = normalizeNumber(formData.get("candidateQuantity")) || 1;
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
  const freightCost = isImported ? freightRatePerKg * candidateWeightKg * importQuantity : freightCostInput;

  await sql`
    insert into product_comparisons (
      base_product_id,
      candidate_product_name,
      candidate_supplier_id,
      candidate_supplier_name,
      candidate_origin,
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
