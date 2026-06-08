import type { EmployeeSession } from "./auth";
import { sql } from "./db";
import { recordExternalServiceUsage } from "./external-service-usage";

export type ReceiptOcrItem = {
  name: string;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
  taxRate: string;
  category: string;
  amount: number | null;
};

export type ReceiptOcrResult = {
  storeName: string;
  purchaseDate: string;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  items: ReceiptOcrItem[];
};

export type ReceiptOcrSource = {
  sourceType: "procurement" | "expense";
  sourceId?: string;
  storeId?: string;
  supplierName?: string;
  receiptPhotoUrl: string;
};

const receiptOcrSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    storeName: { type: "string" },
    purchaseDate: { type: "string", description: "YYYY-MM-DD when visible, otherwise empty string" },
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
          category: { type: "string" },
          amount: nullableNumberSchema()
        },
        required: ["name", "quantity", "unit", "unitPrice", "taxRate", "category", "amount"]
      }
    }
  },
  required: ["storeName", "purchaseDate", "subtotal", "tax", "total", "items"]
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
  const mimeType = file.type || "image/jpeg";
  const buffer = Buffer.from(await file.arrayBuffer());
  const imageUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

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
                "Ignore payment method lines, subtotal labels, discounts, points, and tax-only rows as items.",
                "For item category, choose one of: 食材, 包材, 消耗品, 清掃用品, 設備, 雑費, 未分類.",
                "Use YYYY-MM-DD for purchaseDate when the date is visible."
              ].join("\n")
            }
          ]
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: "Read this receipt and extract store, date, totals, tax, and line items as JSON." },
            { type: "input_image", image_url: imageUrl, detail: "high" }
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

export async function saveReceiptOcrResult(source: ReceiptOcrSource, result: ReceiptOcrResult | null, model: string, session: EmployeeSession, errorMessage = "") {
  const rows = await sql`
    insert into receipt_ocr_results (
      source_type,
      source_id,
      store_id,
      supplier_name,
      receipt_photo_url,
      status,
      model,
      raw_result,
      vendor_name,
      purchase_date,
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
      ${errorMessage ? "failed" : "draft"},
      ${model},
      ${JSON.stringify(result ?? {})}::jsonb,
      ${result?.storeName || source.supplierName || ""},
      ${coerceDate(result?.purchaseDate) || null},
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
    await saveReceiptOcrItems(ocrResultId, result.items, source.supplierName || result.storeName, session);
  }
  return ocrResultId;
}

async function saveReceiptOcrItems(ocrResultId: string, items: ReceiptOcrItem[], supplierName: string, session: EmployeeSession) {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const rawName = String(item.name ?? "").trim();
    if (!rawName) continue;
    const normalizedName = normalizeReceiptProductName(rawName);
    const match = await findProductMatch(supplierName, normalizedName);
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
        category,
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
        ${item.category || ""},
        ${item.amount ?? null},
        ${match.productId || null},
        ${match.productId ? "matched" : "unmatched"},
        now()
      )
      returning id::text
    `;
    if (!match.productId) {
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
    purchaseDate: coerceDate(value.purchaseDate) || "",
    subtotal: coerceMoney(value.subtotal),
    tax: coerceMoney(value.tax),
    total: coerceMoney(value.total),
    items: Array.isArray(value.items) ? value.items.map((item) => ({
      name: String(item.name ?? "").trim(),
      quantity: coerceNullableNumber(item.quantity),
      unit: String(item.unit ?? "").trim(),
      unitPrice: coerceMoney(item.unitPrice),
      taxRate: String(item.taxRate ?? "").trim(),
      category: String(item.category ?? "").trim() || "未分類",
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
