import type { EmployeeSession } from "./auth";
import { sql } from "./db";
import { recordExternalServiceUsage } from "./external-service-usage";

export type ReceiptOcrItem = {
  name: string;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
  taxRate: string;
  taxMode: string;
  category: string;
  accountTitle: string;
  amount: number | null;
};

export type ReceiptOcrResult = {
  storeName: string;
  companyName: string;
  brandName: string;
  locationName: string;
  purchaseDate: string;
  purchaseTime: string;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  items: ReceiptOcrItem[];
};

export type ReceiptOcrSource = {
  sourceType: "procurement" | "expense" | "voucher";
  sourceId?: string;
  storeId?: string;
  supplierName?: string;
  receiptPhotoUrl: string;
  uploadedFileName?: string;
  usageType?: "unclassified" | "shiire" | "keihi";
  paymentType?: "company" | "reimbursement";
  createProductCandidates?: boolean;
};

const receiptOcrSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    storeName: { type: "string" },
    companyName: { type: "string", description: "Legal company or operating company name when visible, otherwise empty string" },
    brandName: { type: "string", description: "Retail chain, supermarket, restaurant, gas station, or public-facing brand name when visible, otherwise empty string" },
    locationName: { type: "string", description: "Store, branch, gas station, or location name when visible, otherwise empty string" },
    purchaseDate: { type: "string", description: "YYYY-MM-DD when visible, otherwise empty string" },
    purchaseTime: { type: "string", description: "HH:mm when visible, otherwise empty string" },
    subtotal: nullableNumberSchema(),
    tax: nullableNumberSchema(),
    total: nullableNumberSchema(),
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          quantity: nullableNumberSchema(),
          unit: { type: "string" },
          unitPrice: nullableNumberSchema(),
          taxRate: { type: "string" },
          taxMode: { type: "string", description: "内税, 外税, or 不明" },
          category: { type: "string" },
          accountTitle: { type: "string" },
          amount: nullableNumberSchema()
        },
        required: ["name", "quantity", "unit", "unitPrice", "taxRate", "taxMode", "category", "accountTitle", "amount"]
      }
    }
  },
  required: ["storeName", "companyName", "brandName", "locationName", "purchaseDate", "purchaseTime", "subtotal", "tax", "total", "items"]
};

function nullableNumberSchema() {
  return {
    anyOf: [
      { type: "number" },
      { type: "null" }
    ]
  };
}

export function normalizeReceiptProductName(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[()[\]{}（）【】「」『』]/g, " ")
    .replace(/[¥￥,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function analyzeReceiptImage(file: File): Promise<{ result: ReceiptOcrResult; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY が設定されていません。");

  const model = process.env.OPENAI_RECEIPT_OCR_MODEL || "gpt-4.1-mini";
  const fileInput = await buildReceiptFileInput(file);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "You extract Japanese restaurant purchase receipt data.",
                "Return JSON only and follow the schema exactly.",
                "Use visible receipt text only. Do not invent missing values.",
                "Separate companyName, brandName, and locationName when receipts show legal/operating company, public chain brand, and branch/store/site name.",
                "For example, if the receipt shows 相光石油株式会社 and セルフステーション平尾, set companyName to 相光石油株式会社, brandName to empty string, and locationName to セルフステーション平尾.",
                "For example, if the receipt shows 株式会社G-7スーパーマート, 業務スーパー, and 春吉店, set companyName to 株式会社G-7スーパーマート, brandName to 業務スーパー, and locationName to 春吉店.",
                "Set storeName to the best human-readable combined display name, usually brandName + locationName when brandName is visible, otherwise companyName + locationName.",
                "Ignore payment method lines, subtotal labels, discounts, points, and tax-only rows as items.",
                "For item category, choose one of: 食材, 包材, 消耗品, 清掃用品, 設備, 雑費, 未分類.",
                "For accountTitle, choose one Japanese accounting account from: 租税公課, 荷造運賃, 水道光熱費, 旅費交通費, 通信費, 広告宣伝費, 接待交際費, 損害保険料, 修繕費, 消耗品費, 減価償却費, 福利厚生費, 給料賃金, 外注工賃, 利子割引料, 地代家賃, 貸倒金, 支払手数料, 車両費, リース料, 新聞図書費, 研修採用費, 会議費, 諸会費, 衛生管理費, 雑費.",
                "Use 車両費 for gasoline, parking, tolls, vehicle maintenance, car-related purchases, and fuel station receipts when business vehicle use is likely.",
                "Use 旅費交通費 for trains, buses, taxis, business travel fares, and non-vehicle transportation.",
                "Use 消耗品費 for store supplies, stationery, packaging materials, small equipment under normal expense treatment, and daily-use consumables.",
                "Use 衛生管理費 for cleaning supplies, sanitation, pest control, waste disposal, and hygiene-related restaurant expenses.",
                "Use 支払手数料 for payment, banking, platform, delivery app, or transfer fees.",
                "Use 雑費 only when no other listed account clearly fits.",
                "Use YYYY-MM-DD for purchaseDate when the date is visible.",
                "Use HH:mm for purchaseTime when the time is visible.",
                "For each item taxRate, preserve visible 8% or 10% markers when present.",
                "For each item taxMode, use 内税 if tax is included in the displayed amount, 外税 if tax is added separately, otherwise 不明."
              ].join("\n")
            }
          ]
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: fileInput.kind === "pdf" ? "Read every page of this receipt PDF and extract one combined receipt JSON. If the PDF has multiple pages of the same receipt, merge the visible information without duplicating totals." : "Read this receipt and extract store, date, totals, tax, and line items as JSON." },
            fileInput.content
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "receipt_ocr_result",
          strict: true,
          schema: receiptOcrSchema
        }
      },
      max_output_tokens: 5000
    })
  });

  const body = await response.json().catch(() => ({})) as {
    error?: { message?: string };
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    };
  };
  if (!response.ok) throw new Error(body.error?.message || "レシート OCR に失敗しました。");

  const content = body.output_text
    ?? body.output?.flatMap((item) => item.content ?? []).map((contentItem) => contentItem.text ?? "").join("\n").trim()
    ?? "";
  const parsed = JSON.parse(content) as ReceiptOcrResult;

  await recordExternalServiceUsage({
    serviceKey: "openai",
    metricKey: "tokens",
    quantity: Number(body.usage?.total_tokens ?? 0),
    unit: "tokens",
    source: "receipt_ocr",
    metadata: {
      model,
      inputTokens: body.usage?.input_tokens ?? null,
      outputTokens: body.usage?.output_tokens ?? null
    }
  });

  return { result: normalizeReceiptOcrResult(parsed), model };
}

async function buildReceiptFileInput(file: File): Promise<{
  kind: "image" | "pdf";
  content:
    | { type: "input_image"; image_url: string; detail: "high" }
    | { type: "input_file"; filename: string; file_data: string };
}> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = getReceiptMimeType(file);
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
  if (mimeType === "application/pdf") {
    return {
      kind: "pdf",
      content: {
        type: "input_file",
        filename: sanitizeReceiptFilename(file.name || "receipt.pdf", "receipt.pdf"),
        file_data: dataUrl
      }
    };
  }
  return {
    kind: "image",
    content: {
      type: "input_image",
      image_url: dataUrl,
      detail: "high"
    }
  };
}

function getReceiptMimeType(file: File) {
  const type = file.type.toLowerCase();
  if (type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "application/pdf";
  return type || "image/jpeg";
}

function sanitizeReceiptFilename(value: string, fallback: string) {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

export async function saveReceiptOcrResult(source: ReceiptOcrSource, result: ReceiptOcrResult | null, model: string, session: EmployeeSession, errorMessage = "") {
  const rows = await sql`
    insert into receipt_ocr_results (
      source_type,
      source_id,
      store_id,
      supplier_name,
      receipt_photo_url,
      uploaded_file_name,
      usage_type,
      payment_type,
      reimbursement_status,
      status,
      model,
      raw_result,
      vendor_name,
      company_name,
      brand_name,
      location_name,
      purchase_date,
      purchase_time,
      subtotal,
      tax,
      total,
      error_message,
      created_by,
      updated_at
    )
    values (
      ${source.sourceType},
      ${source.sourceId || null},
      ${source.storeId || null},
      ${source.supplierName || ""},
      ${source.receiptPhotoUrl},
      ${source.uploadedFileName || ""},
      ${source.usageType ?? (source.sourceType === "procurement" ? "shiire" : source.sourceType === "expense" ? "keihi" : "unclassified")},
      ${source.paymentType || "company"},
      ${source.paymentType === "reimbursement" ? "pending" : "none"},
      ${errorMessage ? "failed" : "draft"},
      ${model},
      ${JSON.stringify(result ?? {})}::jsonb,
      ${result?.storeName || source.supplierName || ""},
      ${result?.companyName || ""},
      ${result?.brandName || ""},
      ${result?.locationName || ""},
      ${coerceDate(result?.purchaseDate) || null},
      ${coerceTime(result?.purchaseTime) || null},
      ${result?.subtotal ?? null},
      ${result?.tax ?? null},
      ${result?.total ?? null},
      ${errorMessage},
      ${session.id},
      now()
    )
    returning id::text
  `;
  const ocrResultId = String(rows[0]?.id ?? "");
  if (ocrResultId && result && !errorMessage) {
    await saveReceiptOcrItems(ocrResultId, result.items, source.supplierName || result.storeName, session, Boolean(source.createProductCandidates));
  }
  return ocrResultId;
}

export async function createProductCandidatesForOcrResult(ocrResultId: string, session: EmployeeSession) {
  const resultRows = await sql`
    select
      coalesce(supplier_name, '') as "supplierName",
      coalesce(vendor_name, '') as "vendorName"
    from receipt_ocr_results
    where id::text = ${ocrResultId}
    limit 1
  `;
  const result = resultRows[0];
  if (!result) return;

  const supplierName = String(result.supplierName || result.vendorName || "").trim();
  const itemRows = await sql`
    select
      id::text,
      raw_name as "rawName",
      normalized_name as "normalizedName",
      quantity::float,
      unit,
      unit_price::float as "unitPrice",
      tax_rate as "taxRate",
      tax_mode as "taxMode",
      category,
      account_title as "accountTitle",
      amount::float,
      match_status as "matchStatus"
    from receipt_ocr_items
    where receipt_ocr_result_id::text = ${ocrResultId}
      and match_status in ('not_applicable', 'unmatched')
    order by line_index
  `;

  for (const row of itemRows) {
    const rawName = String(row.rawName ?? "").trim();
    if (!rawName) continue;
    const normalizedName = String(row.normalizedName || normalizeReceiptProductName(rawName));
    const match = await findProductMatch(supplierName, normalizedName);
    if (match.productId) {
      await sql`
        update receipt_ocr_items
        set matched_product_id = ${match.productId}, match_status = 'matched', updated_at = now()
        where id::text = ${String(row.id)}
      `;
      continue;
    }

    await sql`
      update receipt_ocr_items
      set match_status = 'unmatched', updated_at = now()
      where id::text = ${String(row.id)}
    `;
    await createProductCandidate(String(row.id), {
      name: rawName,
      quantity: row.quantity === null || row.quantity === undefined ? null : Number(row.quantity),
      unit: String(row.unit ?? ""),
      unitPrice: row.unitPrice === null || row.unitPrice === undefined ? null : Number(row.unitPrice),
      taxRate: String(row.taxRate ?? ""),
      taxMode: String(row.taxMode ?? ""),
      category: String(row.category ?? ""),
      accountTitle: String(row.accountTitle ?? ""),
      amount: row.amount === null || row.amount === undefined ? null : Number(row.amount)
    }, normalizedName, supplierName, session);
  }
}

async function saveReceiptOcrItems(ocrResultId: string, items: ReceiptOcrItem[], supplierName: string, session: EmployeeSession, createProductCandidates: boolean) {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const rawName = String(item.name ?? "").trim();
    if (!rawName) continue;
    const normalizedName = normalizeReceiptProductName(rawName);
    const match = createProductCandidates ? await findProductMatch(supplierName, normalizedName) : { productId: "" };
    const itemRows = await sql`
      insert into receipt_ocr_items (
        receipt_ocr_result_id,
        line_index,
        raw_name,
        normalized_name,
        quantity,
        unit,
        unit_price,
        tax_rate,
        tax_mode,
        category,
        account_title,
        amount,
        matched_product_id,
        match_status,
        updated_at
      )
      values (
        ${ocrResultId},
        ${index},
        ${rawName},
        ${normalizedName},
        ${item.quantity ?? null},
        ${item.unit || ""},
        ${item.unitPrice ?? null},
        ${item.taxRate || ""},
        ${item.taxMode || ""},
        ${item.category || ""},
        ${item.accountTitle || ""},
        ${item.amount ?? null},
        ${match.productId || null},
        ${createProductCandidates ? match.productId ? "matched" : "unmatched" : "not_applicable"},
        now()
      )
      returning id::text
    `;
    if (createProductCandidates && !match.productId) {
      await createProductCandidate(String(itemRows[0]?.id ?? ""), item, normalizedName, supplierName, session);
    }
  }
}

async function findProductMatch(supplierName: string, normalizedName: string) {
  const dictionaryRows = await sql`
    select product_id::text as "productId"
    from product_match_dictionary
    where normalized_name = ${normalizedName}
      and (supplier_name = ${supplierName} or supplier_name = '')
    order by case when supplier_name = ${supplierName} then 0 else 1 end
    limit 1
  `;
  if (dictionaryRows[0]?.productId) return { productId: String(dictionaryRows[0].productId) };

  const productRows = await sql`
    select id::text as "productId"
    from products
    where lower(name) = lower(${normalizedName})
       or lower(name) = lower(${normalizedName.replace(/\s+/g, "")})
    limit 1
  `;
  return { productId: productRows[0]?.productId ? String(productRows[0].productId) : "" };
}

async function createProductCandidate(itemId: string, item: ReceiptOcrItem, normalizedName: string, supplierName: string, session: EmployeeSession) {
  const suggestedName = cleanSuggestedProductName(item.name);
  await sql`
    insert into product_candidates (
      receipt_ocr_item_id,
      raw_name,
      normalized_name,
      suggested_name,
      category,
      subcategory,
      unit,
      reference_price,
      supplier_name,
      status,
      created_by,
      updated_at
    )
    values (
      ${itemId || null},
      ${item.name},
      ${normalizedName},
      ${suggestedName},
      ${item.category || "未分類"},
      ${"未分類"},
      ${item.unit || "個"},
      ${item.unitPrice ?? item.amount ?? null},
      ${supplierName || ""},
      ${"pending"},
      ${session.id},
      now()
    )
    on conflict (normalized_name, supplier_name, status)
    do update set
      reference_price = coalesce(product_candidates.reference_price, excluded.reference_price),
      updated_at = now()
  `;
}

function normalizeReceiptOcrResult(value: ReceiptOcrResult): ReceiptOcrResult {
  return {
    storeName: String(value.storeName ?? "").trim(),
    companyName: String(value.companyName ?? "").trim(),
    brandName: String(value.brandName ?? "").trim(),
    locationName: String(value.locationName ?? "").trim(),
    purchaseDate: coerceDate(value.purchaseDate) || "",
    purchaseTime: coerceTime(value.purchaseTime) || "",
    subtotal: coerceMoney(value.subtotal),
    tax: coerceMoney(value.tax),
    total: coerceMoney(value.total),
    items: Array.isArray(value.items) ? value.items.map((item) => ({
      name: String(item.name ?? "").trim(),
      quantity: coerceNullableNumber(item.quantity),
      unit: String(item.unit ?? "").trim(),
      unitPrice: coerceMoney(item.unitPrice),
      taxRate: String(item.taxRate ?? "").trim(),
      taxMode: normalizeTaxMode(item.taxMode),
      category: String(item.category ?? "").trim() || "未分類",
      accountTitle: normalizeAccountTitle(item.accountTitle),
      amount: coerceMoney(item.amount)
    })).filter((item) => item.name) : []
  };
}

function cleanSuggestedProductName(value: string) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/\b\d+(\.\d+)?\s*(g|kg|ml|l|個|本|袋|枚|pack|pc)\b/gi, "")
    .trim() || String(value ?? "").trim();
}

function coerceMoney(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.round(numberValue) : null;
}

function coerceNullableNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function coerceDate(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function coerceTime(value: unknown) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeTaxMode(value: unknown) {
  const mode = String(value ?? "").trim();
  return mode === "内税" || mode === "外税" ? mode : "不明";
}

function normalizeAccountTitle(value: unknown) {
  const title = String(value ?? "").trim();
  return accountTitles.has(title) ? title : "雑費";
}

const accountTitles = new Set([
  "租税公課",
  "荷造運賃",
  "水道光熱費",
  "旅費交通費",
  "通信費",
  "広告宣伝費",
  "接待交際費",
  "損害保険料",
  "修繕費",
  "消耗品費",
  "減価償却費",
  "福利厚生費",
  "給料賃金",
  "外注工賃",
  "利子割引料",
  "地代家賃",
  "貸倒金",
  "支払手数料",
  "車両費",
  "リース料",
  "新聞図書費",
  "研修採用費",
  "会議費",
  "諸会費",
  "衛生管理費",
  "雑費"
]);
