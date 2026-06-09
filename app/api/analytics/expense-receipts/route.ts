import { del, put } from "@vercel/blob";
import { canAccessStore, getSessionStoreScope, requireOsSession, requireWritableOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { recordExternalServiceUsage } from "../../../../lib/external-service-usage";
import { analyzeReceiptImage, saveReceiptOcrResult } from "../../../../lib/receipt-ocr";
import { validateReceiptUpload } from "../../../../lib/upload-security";

const maxReceiptSizeBytes = 4 * 1024 * 1024;
const maxReceiptPdfSizeBytes = 50 * 1024 * 1024;
const expenseEditRoles = new Set(["owner", "manager"]);

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const url = new URL(request.url);
  const storeId = String(url.searchParams.get("storeId") ?? "");
  if (!storeId || !await canAccessStore(session, storeId)) {
    return Response.json({ error: "この店舗の経費レシートを表示する権限がありません。" }, { status: 403 });
  }

  const rows = await sql`
    select
      expense_receipts.id::text,
      expense_receipts.store_id::text as "storeId",
      expense_receipts.receipt_photo_url as "receiptPhotoUrl",
      expense_receipts.receipt_ocr_result_id::text as "ocrResultId",
      expense_receipts.vendor_name as "vendorName",
      expense_receipts.company_name as "companyName",
      expense_receipts.brand_name as "brandName",
      expense_receipts.location_name as "locationName",
      coalesce(to_char(expense_receipts.purchase_date, 'YYYY-MM-DD'), '') as "purchaseDate",
      coalesce(to_char(expense_receipts.purchase_time, 'HH24:MI'), '') as "purchaseTime",
      expense_receipts.category,
      expense_receipts.account_title as "accountTitle",
      expense_receipts.subtotal::float,
      expense_receipts.tax::float,
      expense_receipts.total::float,
      expense_receipts.note,
      expense_receipts.status,
      row_number() over (
        partition by expense_receipts.store_id, coalesce(expense_receipts.purchase_date, expense_receipts.created_at::date)
        order by
          coalesce(expense_receipts.purchase_date, expense_receipts.created_at::date) desc,
          expense_receipts.purchase_time desc nulls last,
          expense_receipts.created_at desc,
          expense_receipts.id
      )::int as "receiptSequence",
      coalesce(to_char(expense_receipts.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI'), '') as "createdLabel"
    from expense_receipts
    where expense_receipts.store_id::text = ${storeId}
    order by expense_receipts.created_at desc
    limit 50
  `;
  const ocrResultIds = rows.map((row) => String(row.ocrResultId ?? "")).filter(Boolean);
  const itemRows = ocrResultIds.length ? await sql`
    select
      receipt_ocr_result_id::text as "ocrResultId",
      raw_name as "rawName",
      coalesce(tax_rate, '') as "taxRate",
      coalesce(tax_mode, '') as "taxMode",
      coalesce(category, '') as category,
      coalesce(account_title, '') as "accountTitle",
      amount::float
    from receipt_ocr_items
    where receipt_ocr_result_id::text = any(${ocrResultIds})
    order by receipt_ocr_result_id, line_index
  ` : [];
  const itemsByResultId = new Map<string, Array<{ rawName: string; taxRate: string; taxMode: string; category: string; accountTitle: string; amount: number }>>();
  for (const item of itemRows) {
    const ocrResultId = String(item.ocrResultId ?? "");
    const items = itemsByResultId.get(ocrResultId) ?? [];
    items.push({
      rawName: String(item.rawName ?? ""),
      taxRate: String(item.taxRate ?? ""),
      taxMode: String(item.taxMode ?? ""),
      category: String(item.category ?? ""),
      accountTitle: String(item.accountTitle ?? ""),
      amount: Number(item.amount ?? 0)
    });
    itemsByResultId.set(ocrResultId, items);
  }

  const scope = await getSessionStoreScope(session);
  return Response.json({
    canEditExpenseReceipts: expenseEditRoles.has(session.role),
    scopedStoreCount: scope.allStores ? null : scope.storeIds.length,
    receipts: rows.map((row) => ({
      id: String(row.id),
      storeId: String(row.storeId),
      receiptPhotoUrl: String(row.receiptPhotoUrl ?? ""),
      ocrResultId: String(row.ocrResultId ?? ""),
      vendorName: String(row.vendorName ?? ""),
      companyName: String(row.companyName ?? ""),
      brandName: String(row.brandName ?? ""),
      locationName: String(row.locationName ?? ""),
      purchaseDate: String(row.purchaseDate ?? ""),
      purchaseTime: String(row.purchaseTime ?? ""),
      category: String(row.category ?? "misc"),
      accountTitle: String(row.accountTitle ?? ""),
      subtotal: Number(row.subtotal ?? 0),
      tax: Number(row.tax ?? 0),
      total: Number(row.total ?? 0),
      note: String(row.note ?? ""),
      status: String(row.status ?? "draft"),
      createdLabel: String(row.createdLabel ?? ""),
      downloadFileName: buildExpenseReceiptFileName(row),
      items: itemsByResultId.get(String(row.ocrResultId ?? "")) ?? []
    }))
  });
}

export async function POST(request: Request) {
  const session = await requireWritableOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });
  if (!expenseEditRoles.has(session.role)) return Response.json({ error: "経費レシートを登録する権限がありません。" }, { status: 403 });

  const formData = await request.formData();
  const storeId = String(formData.get("storeId") ?? "").trim();
  const file = formData.get("receipt");
  if (!storeId || !await canAccessStore(session, storeId)) {
    return Response.json({ error: "この店舗の経費レシートを登録する権限がありません。" }, { status: 403 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "レシート写真を選択してください。" }, { status: 400 });
  }

  try {
    const receiptUrl = await uploadExpenseReceipt(file, storeId);
    let ocrResultId = "";
    let ocrError = "";
    let vendorName = "";
    let companyName = "";
    let brandName = "";
    let locationName = "";
    let purchaseDate = "";
    let purchaseTime = "";
    let subtotal: number | null = null;
    let tax: number | null = null;
    let total: number | null = null;

    try {
      const analyzed = await analyzeReceiptImage(file);
      vendorName = analyzed.result.storeName;
      companyName = analyzed.result.companyName;
      brandName = analyzed.result.brandName;
      locationName = analyzed.result.locationName;
      purchaseDate = analyzed.result.purchaseDate;
      purchaseTime = analyzed.result.purchaseTime;
      subtotal = analyzed.result.subtotal;
      tax = analyzed.result.tax;
      total = analyzed.result.total;
      vendorName = buildVendorName(companyName, brandName, locationName, vendorName);
      ocrResultId = await saveReceiptOcrResult({
        sourceType: "expense",
        storeId,
        supplierName: vendorName,
        receiptPhotoUrl: receiptUrl,
        usageType: "keihi",
        paymentType: "company"
      }, analyzed.result, analyzed.model, session);
    } catch (error) {
      ocrError = error instanceof Error ? error.message : "レシート OCR に失敗しました。";
      ocrResultId = await saveReceiptOcrResult({
        sourceType: "expense",
        storeId,
        receiptPhotoUrl: receiptUrl,
        usageType: "keihi",
        paymentType: "company"
      }, null, process.env.OPENAI_RECEIPT_OCR_MODEL || "", session, ocrError);
    }

    const rows = await sql`
      insert into expense_receipts (
        store_id,
        receipt_photo_url,
        receipt_ocr_result_id,
        vendor_name,
        company_name,
        brand_name,
        location_name,
        purchase_date,
        purchase_time,
        subtotal,
        tax,
        total,
        status,
        created_by,
        updated_at
      )
      values (
        ${storeId},
        ${receiptUrl},
        ${ocrResultId || null},
        ${vendorName},
        ${companyName},
        ${brandName},
        ${locationName},
        ${purchaseDate || null},
        ${purchaseTime || null},
        ${subtotal},
        ${tax},
        ${total ?? 0},
        ${ocrError ? "ocr_failed" : "draft"},
        ${session.id},
        now()
      )
      returning id::text
    `;

    if (ocrResultId) {
      await sql`
        update receipt_ocr_results
        set source_id = ${rows[0]?.id ?? null}, updated_at = now()
        where id::text = ${ocrResultId}
      `;
    }

    return Response.json({ ok: true, id: String(rows[0]?.id ?? ""), receiptUrl, ocrResultId, ocrError });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "経費レシートを保存できませんでした。" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const session = await requireWritableOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });
  if (!expenseEditRoles.has(session.role)) return Response.json({ error: "経費レシートを削除する権限がありません。" }, { status: 403 });

  const url = new URL(request.url);
  const id = String(url.searchParams.get("id") ?? "").trim();
  if (!id) return Response.json({ error: "レシート ID がありません。" }, { status: 400 });

  const rows = await sql`
    select
      id::text,
      store_id::text as "storeId",
      receipt_photo_url as "receiptPhotoUrl",
      receipt_ocr_result_id::text as "ocrResultId"
    from expense_receipts
    where id::text = ${id}
    limit 1
  `;
  const receipt = rows[0];
  if (!receipt) return Response.json({ error: "経費レシートが見つかりません。" }, { status: 404 });
  if (!await canAccessStore(session, String(receipt.storeId))) {
    return Response.json({ error: "この経費レシートを削除する権限がありません。" }, { status: 403 });
  }

  const ocrResultId = String(receipt.ocrResultId ?? "");
  if (ocrResultId) {
    await sql`
      delete from product_candidates
      using receipt_ocr_items
      where product_candidates.receipt_ocr_item_id = receipt_ocr_items.id
        and receipt_ocr_items.receipt_ocr_result_id::text = ${ocrResultId}
    `;
  }

  await sql`delete from expense_receipts where id::text = ${id}`;
  if (ocrResultId) {
    await sql`delete from receipt_ocr_results where id::text = ${ocrResultId}`;
  }

  const pathname = extractPrivateBlobPathname(String(receipt.receiptPhotoUrl ?? ""));
  if (pathname && process.env.BLOB_READ_WRITE_TOKEN) {
    await del(pathname).catch(() => null);
  }

  return Response.json({ ok: true });
}

export async function PATCH(request: Request) {
  const session = await requireWritableOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });
  if (!expenseEditRoles.has(session.role)) return Response.json({ error: "経費レシートを登録済みにする権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as {
    id?: string;
    lines?: Array<{
      accountTitle?: string;
      amount?: string | number;
      taxRate?: string;
      taxMode?: string;
      taxAmount?: string | number;
      note?: string;
    }>;
    vendorName?: string;
    companyName?: string;
    brandName?: string;
    locationName?: string;
    transactionDate?: string;
    transactionTime?: string;
    note?: string;
  };
  const id = String(body.id ?? "").trim();
  if (!id) return Response.json({ error: "レシート ID がありません。" }, { status: 400 });

  const rows = await sql`
    select
      id::text,
      store_id::text as "storeId",
      receipt_ocr_result_id::text as "ocrResultId",
      vendor_name as "vendorName",
      company_name as "companyName",
      brand_name as "brandName",
      location_name as "locationName",
      coalesce(to_char(purchase_date, 'YYYY-MM-DD'), '') as "purchaseDate",
      coalesce(to_char(purchase_time, 'HH24:MI'), '') as "purchaseTime",
      tax::float,
      total::float,
      status
    from expense_receipts
    where id::text = ${id}
    limit 1
  `;
  const receipt = rows[0];
  if (!receipt) return Response.json({ error: "経費レシートが見つかりません。" }, { status: 404 });
  if (!await canAccessStore(session, String(receipt.storeId))) {
    return Response.json({ error: "この経費レシートを登録する権限がありません。" }, { status: 403 });
  }
  if (String(receipt.status ?? "") === "confirmed") {
    return Response.json({ error: "この経費レシートは登録済みです。" }, { status: 400 });
  }

  const lines = normalizeExpenseLines(body.lines, receipt);
  const amount = lines.reduce((sum, line) => sum + line.amount, 0);
  const taxAmount = lines.reduce((sum, line) => sum + line.taxAmount, 0);
  const transactionDate = normalizeDate(body.transactionDate) || normalizeDate(String(receipt.purchaseDate ?? ""));
  const transactionTime = normalizeTime(body.transactionTime) || normalizeTime(String(receipt.purchaseTime ?? ""));
  const companyName = String(body.companyName ?? receipt.companyName ?? "").trim();
  const brandName = String(body.brandName ?? receipt.brandName ?? "").trim();
  const locationName = String(body.locationName ?? receipt.locationName ?? "").trim();
  const vendorName = String(body.vendorName ?? buildVendorName(companyName, brandName, locationName, String(receipt.vendorName ?? ""))).trim();
  const receiptNote = String(body.note ?? "").trim();
  const startMonth = transactionDate.slice(0, 7);
  const receiptAccountTitle = lines.length > 1 ? "複数科目" : lines[0]?.accountTitle ?? "雑費";
  const receiptCategory = lines.length > 1 ? "misc" : getExpenseCategoryFromAccountTitle(receiptAccountTitle);

  if (!Number.isFinite(amount) || amount <= 0) {
    return Response.json({ error: "経費明細の金額を入力してください。" }, { status: 400 });
  }
  if (!Number.isFinite(taxAmount) || taxAmount < 0 || taxAmount > amount) {
    return Response.json({ error: "消費税は税込金額以下で入力してください。" }, { status: 400 });
  }
  if (!transactionDate) {
    return Response.json({ error: "日付を入力してください。" }, { status: 400 });
  }

  const expenseIds: string[] = [];
  for (const [index, line] of lines.entries()) {
    const category = getExpenseCategoryFromAccountTitle(line.accountTitle);
    const name = vendorName ? `${line.accountTitle} / ${vendorName}` : line.accountTitle;
    const noteParts = [
      line.note,
      line.taxRate ? `税率 ${line.taxRate}` : "",
      line.taxMode,
      lines.length > 1 ? `レシート分割 ${index + 1}/${lines.length}` : "",
      receiptNote
    ].map((part) => part.trim()).filter(Boolean);

    const expenseRows = await sql`
      insert into analytics_expenses (
        store_id,
        category,
        account_title,
        name,
        amount,
        tax_rate,
        tax_mode,
        tax_amount,
        vendor_name,
        transaction_date,
        transaction_time,
        expense_receipt_id,
        start_month,
        end_month,
        note,
        created_by,
        updated_by,
        updated_at
      )
      values (
        ${String(receipt.storeId)},
        ${category},
        ${line.accountTitle},
        ${name},
        ${line.amount},
        ${line.taxRate},
        ${line.taxMode},
        ${line.taxAmount},
        ${vendorName},
        ${transactionDate},
        ${transactionTime || null},
        ${id},
        ${startMonth},
        ${startMonth},
        ${noteParts.join(" / ")},
        ${session.id},
        ${session.id},
        now()
      )
      returning id::text
    `;
    if (expenseRows[0]?.id) expenseIds.push(String(expenseRows[0].id));
  }

  await sql`
    update expense_receipts
    set
      category = ${receiptCategory},
      account_title = ${receiptAccountTitle},
      vendor_name = ${vendorName},
      company_name = ${companyName},
      brand_name = ${brandName},
      location_name = ${locationName},
      purchase_date = ${transactionDate},
      purchase_time = ${transactionTime || null},
      tax = ${taxAmount},
      total = ${amount},
      note = ${receiptNote},
      status = 'confirmed',
      confirmed_at = now(),
      confirmed_by = ${session.id},
      updated_at = now()
    where id::text = ${id}
  `;
  if (receipt.ocrResultId) {
    await sql`
      update receipt_ocr_results
      set
        status = 'confirmed',
        vendor_name = ${vendorName},
        company_name = ${companyName},
        brand_name = ${brandName},
        location_name = ${locationName},
        purchase_date = ${transactionDate},
        purchase_time = ${transactionTime || null},
        tax = ${taxAmount},
        total = ${amount},
        confirmed_at = now(),
        confirmed_by = ${session.id},
        updated_at = now()
      where id::text = ${String(receipt.ocrResultId)}
    `;
  }

  return Response.json({ ok: true, expenseIds, startMonth, amount, lineCount: lines.length });
}

async function uploadExpenseReceipt(file: File, storeId: string) {
  const extension = validateReceiptUpload(file, maxReceiptSizeBytes, maxReceiptPdfSizeBytes, "レシート");

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Vercel Blob が未設定です。BLOB_READ_WRITE_TOKEN を接続してください。");
  }

  const safeName = storeId.replace(/[^\w.-]+/g, "-").toLowerCase() || "expense";
  const blob = await put(`expense-receipts/${safeName}-${Date.now()}.${extension}`, file, {
    access: "private"
  });
  await recordExternalServiceUsage({
    serviceKey: "vercel_blob",
    metricKey: "storage_bytes",
    quantity: file.size,
    unit: "bytes",
    source: "expense_receipt",
    metadata: { pathname: blob.pathname }
  });

  return `/api/products/photo/view?pathname=${encodeURIComponent(blob.pathname)}&v=${Date.now()}`;
}

function extractPrivateBlobPathname(receiptPhotoUrl: string) {
  try {
    const url = new URL(receiptPhotoUrl, "https://foundr1.local");
    return url.searchParams.get("pathname") ?? "";
  } catch {
    return "";
  }
}

function buildExpenseReceiptFileName(row: { purchaseDate?: unknown; purchaseTime?: unknown; createdLabel?: unknown; receiptSequence?: unknown; receiptPhotoUrl?: unknown }) {
  const date = String(row.purchaseDate ?? "").replace(/-/g, "") || normalizeDate("").replace(/-/g, "");
  const time = normalizeTime(row.purchaseTime) ? normalizeTime(row.purchaseTime).replace(":", "") : "0000";
  const sequence = String(Number(row.receiptSequence ?? 1) || 1).padStart(3, "0");
  const extension = getReceiptExtension(row.receiptPhotoUrl);
  return `${date}-${time}-${sequence}.${extension}`;
}

function getReceiptExtension(receiptPhotoUrl: unknown) {
  const pathname = extractPrivateBlobPathname(String(receiptPhotoUrl ?? ""));
  const match = pathname.match(/\.([a-z0-9]+)$/i);
  const extension = match ? match[1].toLowerCase() : "jpg";
  return ["jpg", "jpeg", "png", "webp", "heic", "pdf"].includes(extension) ? extension : "jpg";
}

function buildVendorName(companyName: string, brandName: string, locationName: string, fallback = "") {
  const displayParts = brandName ? [brandName, locationName] : [companyName, locationName];
  return displayParts.map((value) => value.trim()).filter(Boolean).join(" ") || fallback.trim();
}

function normalizeDate(value: unknown) {
  const date = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function normalizeTime(value: unknown) {
  const time = String(value ?? "").trim();
  const match = time.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeAccountTitle(value: unknown) {
  const title = String(value ?? "").trim();
  return validAccountTitles.has(title) ? title : "雑費";
}

function normalizeExpenseLines(lines: Array<{
  accountTitle?: string;
  amount?: string | number;
  taxRate?: string;
  taxMode?: string;
  taxAmount?: string | number;
  note?: string;
}> | undefined, receipt: { total?: unknown; tax?: unknown }) {
  const inputLines = Array.isArray(lines) && lines.length ? lines : [{
    accountTitle: "雑費",
    amount: receipt.total,
    taxRate: "",
    taxMode: "不明",
    taxAmount: receipt.tax,
    note: ""
  }];

  return inputLines.map((line) => {
    const amount = Math.round(Number(line.amount ?? 0));
    const taxRate = normalizeTaxRate(line.taxRate);
    const taxMode = normalizeTaxMode(line.taxMode);
    const rawTaxAmount = Number(line.taxAmount);
    const taxAmount = Number.isFinite(rawTaxAmount)
      ? Math.max(0, Math.round(rawTaxAmount))
      : calculateTaxAmount(amount, taxRate, taxMode);
    return {
      accountTitle: normalizeAccountTitle(line.accountTitle),
      amount,
      taxRate,
      taxMode,
      taxAmount,
      note: String(line.note ?? "").trim()
    };
  }).filter((line) => line.amount > 0);
}

function normalizeTaxRate(value: unknown) {
  const text = String(value ?? "").replace("%", "").trim();
  if (text === "8" || text === "8.0") return "8%";
  if (text === "10" || text === "10.0") return "10%";
  if (text === "非課税" || text === "0") return "非課税";
  return "";
}

function normalizeTaxMode(value: unknown) {
  const mode = String(value ?? "").trim();
  return mode === "内税" || mode === "外税" ? mode : "不明";
}

function calculateTaxAmount(amount: number, taxRate: string, taxMode: string) {
  const rate = taxRate === "8%" ? 8 : taxRate === "10%" ? 10 : 0;
  if (!rate || amount <= 0) return 0;
  if (taxMode === "外税") return Math.round(amount * rate / 100);
  return Math.round(amount * rate / (100 + rate));
}

function getExpenseCategoryFromAccountTitle(accountTitle: string) {
  if (fixedAccountTitles.has(accountTitle)) return "fixed";
  if (variableAccountTitles.has(accountTitle)) return "variable";
  return "misc";
}

const validAccountTitles = new Set([
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

const fixedAccountTitles = new Set(["地代家賃", "リース料", "損害保険料", "減価償却費", "利子割引料"]);
const variableAccountTitles = new Set(["水道光熱費", "通信費", "旅費交通費", "車両費", "荷造運賃", "支払手数料"]);
