import { del, put } from "@vercel/blob";
import { canAccessStore, getSessionStoreScope, requireOsSession, requireWritableOsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";
import { recordExternalServiceUsage } from "../../../lib/external-service-usage";
import { analyzeReceiptImage, createProductCandidatesForOcrResult, saveReceiptOcrResult } from "../../../lib/receipt-ocr";
import { validateReceiptUpload } from "../../../lib/upload-security";

type VoucherUsageType = "unclassified" | "shiire" | "keihi";
type VoucherPaymentType = "company" | "reimbursement";

const maxReceiptSizeBytes = 4 * 1024 * 1024;
const maxReceiptPdfSizeBytes = 50 * 1024 * 1024;
const managerRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);
const validExpenseAccountTitles = new Set([
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

export async function GET() {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const [stores, vouchers] = await Promise.all([
    listAccessibleStores(session),
    listAccessibleVouchers(session)
  ]);

  return Response.json({
    canUpload: ["owner", "manager", "store_owner", "store_manager", "staff"].includes(session.role),
    canManageAll: ["owner", "manager"].includes(session.role),
    stores,
    vouchers
  });
}

export async function POST(request: Request) {
  const session = await requireWritableOsSession();
  if (!session) return Response.json({ error: "証憑をアップロードする権限がありません。" }, { status: 403 });

  const formData = await request.formData();
  const storeId = String(formData.get("storeId") ?? "").trim();
  const usageType = normalizeUsageType(String(formData.get("usageType") ?? "unclassified"));
  const paymentType = normalizePaymentType(String(formData.get("paymentType") ?? "company"));
  const files = collectVoucherFiles(formData);

  if (!storeId || !await canAccessStore(session, storeId)) {
    return Response.json({ error: "この店舗の証憑を登録する権限がありません。" }, { status: 403 });
  }
  if (!files.length) return Response.json({ error: "写真またはPDFを選択してください。" }, { status: 400 });
  if (files.length > 12) return Response.json({ error: "一度にアップロードできる写真は12枚までです。" }, { status: 400 });

  const pdfFiles = files.filter((file) => isPdfFile(file));
  if (pdfFiles.length > 1 || (pdfFiles.length === 1 && files.length > 1)) {
    return Response.json({ error: "PDFは単体でアップロードしてください。複数ページは1つのPDFにまとめてください。" }, { status: 400 });
  }

  const results = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    try {
      const receiptUrl = await uploadVoucherDocument(file, storeId, index);
      let ocrResultId = "";
      let ocrError = "";
      try {
        const analyzed = await analyzeReceiptWithRetry(file);
        const supplierName = buildVendorName(analyzed.result.companyName, analyzed.result.brandName, analyzed.result.locationName, analyzed.result.storeName);
        ocrResultId = await saveReceiptOcrResult({
          sourceType: "voucher",
          storeId,
          supplierName,
          receiptPhotoUrl: receiptUrl,
          uploadedFileName: file.name || "",
          usageType,
          paymentType,
          createProductCandidates: false
        }, analyzed.result, analyzed.model, session);
      } catch (error) {
        ocrError = error instanceof Error ? error.message : "OCRに失敗しました。";
        ocrResultId = await saveReceiptOcrResult({
          sourceType: "voucher",
          storeId,
          receiptPhotoUrl: receiptUrl,
          uploadedFileName: file.name || "",
          usageType,
          paymentType
        }, null, process.env.OPENAI_RECEIPT_OCR_MODEL || "", session, ocrError);
      }

      results.push({ ok: true, ocrResultId, receiptUrl, ocrError });
    } catch (error) {
      results.push({
        ok: false,
        fileName: file.name || `file-${index + 1}`,
        error: error instanceof Error ? error.message : "証憑を保存できませんでした。"
      });
    }
  }

  return Response.json({ ok: results.every((result) => result.ok), results });
}

export async function PATCH(request: Request) {
  const session = await requireWritableOsSession();
  if (!session) return Response.json({ error: "証憑を更新する権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as {
    action?: string;
    id?: string;
    usageType?: string;
    paymentType?: string;
    reimbursementStatus?: string;
    lines?: Array<{
      accountTitle?: string;
      subAccountTitle?: string;
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
  if (!id) return Response.json({ error: "証憑IDがありません。" }, { status: 400 });

  const rows = await sql`
    select
      id::text,
      store_id::text as "storeId",
      created_by::text as "createdBy",
      usage_type as "usageType",
      payment_type as "paymentType",
      reimbursement_status as "reimbursementStatus",
      source_type as "sourceType",
      vendor_name as "vendorName",
      company_name as "companyName",
      brand_name as "brandName",
      location_name as "locationName",
      coalesce(to_char(purchase_date, 'YYYY-MM-DD'), '') as "purchaseDate",
      coalesce(to_char(purchase_time, 'HH24:MI'), '') as "purchaseTime",
      tax::float,
      total::float,
      status
    from receipt_ocr_results
    where id::text = ${id}
    limit 1
  `;
  const voucher = rows[0];
  if (!voucher) return Response.json({ error: "証憑が見つかりません。" }, { status: 404 });
  if (!await canManageVoucher(session, String(voucher.storeId ?? ""), String(voucher.createdBy ?? ""))) {
    return Response.json({ error: "この証憑を更新する権限がありません。" }, { status: 403 });
  }

  const nextUsageType = normalizeUsageType(String(body.usageType ?? voucher.usageType ?? "unclassified"));
  const nextPaymentType = normalizePaymentType(String(body.paymentType ?? "company"));
  const nextReimbursementStatus = nextPaymentType === "reimbursement"
    ? normalizeReimbursementStatus(String(body.reimbursementStatus ?? "pending"))
    : "none";

  if (body.action === "confirm_accounting") {
    if (String(voucher.sourceType ?? "") !== "voucher") {
      return Response.json({ error: "購入管理または経費台帳に紐付いた証憑は元の画面で登録してください。" }, { status: 400 });
    }
    if (String(voucher.status ?? "") === "confirmed") {
      return Response.json({ error: "この証憑は登録済みです。" }, { status: 400 });
    }
    if (nextUsageType === "unclassified") {
      return Response.json({ error: "用途を仕入または経費にしてください。" }, { status: 400 });
    }

    const lines = normalizeAccountingLines(body.lines, voucher, nextUsageType);
    const amount = lines.reduce((sum, line) => sum + line.amount, 0);
    const taxAmount = lines.reduce((sum, line) => sum + line.taxAmount, 0);
    const transactionDate = normalizeDate(body.transactionDate) || normalizeDate(String(voucher.purchaseDate ?? ""));
    const transactionTime = normalizeTime(body.transactionTime) || normalizeTime(String(voucher.purchaseTime ?? ""));
    const companyName = String(body.companyName ?? voucher.companyName ?? "").trim();
    const brandName = String(body.brandName ?? voucher.brandName ?? "").trim();
    const locationName = String(body.locationName ?? voucher.locationName ?? "").trim();
    const vendorName = String(body.vendorName ?? buildVendorName(companyName, brandName, locationName, String(voucher.vendorName ?? ""))).trim();
    const receiptNote = String(body.note ?? "").trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      return Response.json({ error: "会計明細の金額を入力してください。" }, { status: 400 });
    }
    if (!Number.isFinite(taxAmount) || taxAmount < 0 || taxAmount > amount) {
      return Response.json({ error: "消費税は税込金額以下で入力してください。" }, { status: 400 });
    }
    if (!transactionDate) {
      return Response.json({ error: "日付を入力してください。" }, { status: 400 });
    }

    if (nextUsageType === "keihi") {
      const startMonth = transactionDate.slice(0, 7);
      for (const [index, line] of lines.entries()) {
        const category = getExpenseCategoryFromAccountTitle(line.accountTitle);
        const name = vendorName ? `${line.accountTitle} / ${vendorName}` : line.accountTitle;
        const noteParts = [
          line.note,
          line.taxRate ? `税率 ${line.taxRate}` : "",
          line.taxMode,
          lines.length > 1 ? `証憑分割 ${index + 1}/${lines.length}` : "",
          `証憑ID ${id}`,
          receiptNote
        ].map((part) => part.trim()).filter(Boolean);

        await sql`
          insert into analytics_expenses (
            store_id,
            category,
            account_title,
            sub_account_title,
            name,
            amount,
            tax_rate,
            tax_mode,
            tax_amount,
            vendor_name,
            transaction_date,
            transaction_time,
            start_month,
            end_month,
            note,
            created_by,
            updated_by,
            updated_at
          )
          values (
            ${String(voucher.storeId)},
            ${category},
            ${line.accountTitle},
            ${line.subAccountTitle},
            ${name},
            ${line.amount},
            ${line.taxRate},
            ${line.taxMode},
            ${line.taxAmount},
            ${vendorName},
            ${transactionDate},
            ${transactionTime || null},
            ${startMonth},
            ${startMonth},
            ${noteParts.join(" / ")},
            ${session.id},
            ${session.id},
            now()
          )
        `;
      }
    }

    await sql`
      update receipt_ocr_results
      set
        usage_type = ${nextUsageType},
        payment_type = ${nextPaymentType},
        reimbursement_status = ${nextReimbursementStatus},
        status = 'confirmed',
        vendor_name = ${vendorName},
        company_name = ${companyName},
        brand_name = ${brandName},
        location_name = ${locationName},
        purchase_date = ${transactionDate},
        purchase_time = ${transactionTime || null},
        tax = ${taxAmount},
        total = ${amount},
        raw_result = jsonb_set(raw_result, '{accountingLines}', ${JSON.stringify(lines)}::jsonb, true),
        confirmed_at = now(),
        confirmed_by = ${session.id},
        updated_at = now()
      where id::text = ${id}
    `;

    if (nextUsageType === "shiire") {
      await createProductCandidatesForOcrResult(id, session);
    }

    return Response.json({ ok: true, lineCount: lines.length, amount });
  }

  await sql`
    update receipt_ocr_results
    set
      usage_type = ${nextUsageType},
      payment_type = ${nextPaymentType},
      reimbursement_status = ${nextReimbursementStatus},
      updated_at = now()
    where id::text = ${id}
  `;

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await requireWritableOsSession();
  if (!session) return Response.json({ error: "証憑を削除する権限がありません。" }, { status: 403 });

  const url = new URL(request.url);
  const id = String(url.searchParams.get("id") ?? "").trim();
  if (!id) return Response.json({ error: "証憑IDがありません。" }, { status: 400 });

  const rows = await sql`
    select
      id::text,
      store_id::text as "storeId",
      created_by::text as "createdBy",
      source_type as "sourceType",
      receipt_photo_url as "receiptPhotoUrl"
    from receipt_ocr_results
    where id::text = ${id}
    limit 1
  `;
  const voucher = rows[0];
  if (!voucher) return Response.json({ error: "証憑が見つかりません。" }, { status: 404 });
  if (String(voucher.sourceType ?? "") !== "voucher") {
    return Response.json({ error: "購入管理または経費台帳に紐付いた証憑は元の画面で管理してください。" }, { status: 400 });
  }
  if (!await canManageVoucher(session, String(voucher.storeId ?? ""), String(voucher.createdBy ?? ""))) {
    return Response.json({ error: "この証憑を削除する権限がありません。" }, { status: 403 });
  }

  const pathname = extractBlobPathname(String(voucher.receiptPhotoUrl ?? ""));
  await sql`
    delete from product_candidates
    using receipt_ocr_items
    where product_candidates.receipt_ocr_item_id = receipt_ocr_items.id
      and receipt_ocr_items.receipt_ocr_result_id::text = ${id}
  `;
  await sql`delete from receipt_ocr_results where id::text = ${id}`;
  if (pathname) await del(pathname).catch(() => undefined);

  return Response.json({ ok: true });
}

async function listAccessibleStores(session: NonNullable<Awaited<ReturnType<typeof requireOsSession>>>) {
  const scope = await getSessionStoreScope(session);
  const rows = scope.allStores ? await sql`
    select id::text, name
    from stores
    where status = 'active'
    order by name
  ` : scope.storeIds.length ? await sql`
    select id::text, name
    from stores
    where status = 'active'
      and id::text = any(${scope.storeIds})
    order by name
  ` : [];

  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name ?? "")
  }));
}

async function listAccessibleVouchers(session: NonNullable<Awaited<ReturnType<typeof requireOsSession>>>) {
  const scope = await getSessionStoreScope(session);
  const scopedStoreIds = scope.storeIds.length ? scope.storeIds : ["00000000-0000-0000-0000-000000000000"];
  const rows = await sql`
    select
      receipt_ocr_results.id::text,
      receipt_ocr_results.source_type as "sourceType",
      receipt_ocr_results.store_id::text as "storeId",
      coalesce(stores.name, '') as "storeName",
      receipt_ocr_results.receipt_photo_url as "receiptPhotoUrl",
      receipt_ocr_results.uploaded_file_name as "uploadedFileName",
      receipt_ocr_results.usage_type as "usageType",
      receipt_ocr_results.payment_type as "paymentType",
      receipt_ocr_results.reimbursement_status as "reimbursementStatus",
      receipt_ocr_results.status,
      receipt_ocr_results.vendor_name as "vendorName",
      receipt_ocr_results.company_name as "companyName",
      receipt_ocr_results.brand_name as "brandName",
      receipt_ocr_results.location_name as "locationName",
      coalesce(to_char(receipt_ocr_results.purchase_date, 'YYYY-MM-DD'), '') as "purchaseDate",
      coalesce(to_char(receipt_ocr_results.purchase_time, 'HH24:MI'), '') as "purchaseTime",
      receipt_ocr_results.total::float,
      receipt_ocr_results.tax::float,
      coalesce(receipt_ocr_results.raw_result->'accountingLines', '[]'::jsonb) as "accountingLines",
      coalesce(item_counts.item_count, 0)::int as "itemCount",
      coalesce(employees.name, '') as "createdByName",
      coalesce(to_char(receipt_ocr_results.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI'), '') as "createdLabel"
    from receipt_ocr_results
    left join stores on stores.id = receipt_ocr_results.store_id
    left join employees on employees.id = receipt_ocr_results.created_by
    left join lateral (
      select count(*)::int as item_count
      from receipt_ocr_items
      where receipt_ocr_items.receipt_ocr_result_id = receipt_ocr_results.id
    ) item_counts on true
    where ${scope.allStores}
       or receipt_ocr_results.created_by = ${session.id}
       or receipt_ocr_results.store_id::text = any(${scopedStoreIds})
    order by receipt_ocr_results.created_at desc
    limit 100
  `;
  const ocrResultIds = rows.map((row) => String(row.id ?? "")).filter(Boolean);
  const itemRows = ocrResultIds.length ? await sql`
    select
      id::text,
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
  const itemsByResultId = new Map<string, Array<{
    id: string;
    rawName: string;
    taxRate: string;
    taxMode: string;
    category: string;
    accountTitle: string;
    amount: number;
  }>>();
  for (const item of itemRows) {
    const ocrResultId = String(item.ocrResultId ?? "");
    const items = itemsByResultId.get(ocrResultId) ?? [];
    items.push({
      id: String(item.id ?? ""),
      rawName: String(item.rawName ?? ""),
      taxRate: String(item.taxRate ?? ""),
      taxMode: String(item.taxMode ?? ""),
      category: String(item.category ?? ""),
      accountTitle: String(item.accountTitle ?? ""),
      amount: Number(item.amount ?? 0)
    });
    itemsByResultId.set(ocrResultId, items);
  }

  return rows.map((row) => ({
    id: String(row.id),
    sourceType: String(row.sourceType ?? ""),
    storeId: String(row.storeId ?? ""),
    storeName: String(row.storeName ?? ""),
    receiptPhotoUrl: String(row.receiptPhotoUrl ?? ""),
    uploadedFileName: String(row.uploadedFileName ?? ""),
    usageType: String(row.usageType ?? "unclassified"),
    paymentType: String(row.paymentType ?? "company"),
    reimbursementStatus: String(row.reimbursementStatus ?? "none"),
    status: String(row.status ?? "draft"),
    vendorName: String(row.vendorName ?? ""),
    companyName: String(row.companyName ?? ""),
    brandName: String(row.brandName ?? ""),
    locationName: String(row.locationName ?? ""),
    purchaseDate: String(row.purchaseDate ?? ""),
    purchaseTime: String(row.purchaseTime ?? ""),
    total: Number(row.total ?? 0),
    tax: Number(row.tax ?? 0),
    accountingLines: normalizeStoredAccountingLines(row.accountingLines),
    itemCount: Number(row.itemCount ?? 0),
    createdByName: String(row.createdByName ?? ""),
    createdLabel: String(row.createdLabel ?? ""),
    canDelete: String(row.sourceType ?? "") === "voucher",
    items: itemsByResultId.get(String(row.id ?? "")) ?? []
  }));
}

async function canManageVoucher(session: NonNullable<Awaited<ReturnType<typeof requireOsSession>>>, storeId: string, createdBy: string) {
  if (managerRoles.has(session.role) && await canAccessStore(session, storeId)) return true;
  return createdBy === session.id;
}

function collectVoucherFiles(formData: FormData) {
  return [...formData.getAll("receipts"), formData.get("receipt")]
    .filter((file): file is File => file instanceof File && file.size > 0);
}

function normalizeUsageType(value: string): VoucherUsageType {
  if (value === "shiire" || value === "keihi") return value;
  return "unclassified";
}

function normalizePaymentType(value: string): VoucherPaymentType {
  return value === "reimbursement" ? "reimbursement" : "company";
}

function normalizeReimbursementStatus(value: string) {
  if (value === "paid" || value === "rejected") return value;
  return "pending";
}

function normalizeAccountingLines(lines: Array<{
  accountTitle?: string;
  subAccountTitle?: string;
  amount?: string | number;
  taxRate?: string;
  taxMode?: string;
  taxAmount?: string | number;
  note?: string;
}> | undefined, voucher: { total?: unknown; tax?: unknown }, usageType: VoucherUsageType) {
  const fallbackAccountTitle = usageType === "shiire" ? "仕入高" : "雑費";
  const inputLines = Array.isArray(lines) && lines.length ? lines : [{
    accountTitle: fallbackAccountTitle,
    subAccountTitle: "",
    amount: voucher.total,
    taxRate: "",
    taxMode: "不明",
    taxAmount: voucher.tax,
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
      accountTitle: normalizeAccountTitle(line.accountTitle, usageType),
      subAccountTitle: normalizeSubAccountTitle(line.subAccountTitle),
      amount,
      taxRate,
      taxMode,
      taxAmount,
      note: String(line.note ?? "").trim()
    };
  }).filter((line) => line.amount > 0);
}

function normalizeStoredAccountingLines(value: unknown) {
  let parsedValue = value;
  if (typeof value === "string") {
    try {
      parsedValue = JSON.parse(value);
    } catch {
      parsedValue = [];
    }
  }
  const lines = Array.isArray(parsedValue) ? parsedValue : [];
  return lines.map((line) => {
    const row = line as Record<string, unknown>;
    return {
      accountTitle: String(row.accountTitle ?? ""),
      subAccountTitle: String(row.subAccountTitle ?? ""),
      amount: Number(row.amount ?? 0),
      taxRate: String(row.taxRate ?? ""),
      taxMode: String(row.taxMode ?? ""),
      taxAmount: Number(row.taxAmount ?? 0),
      note: String(row.note ?? "")
    };
  }).filter((line) => line.amount > 0);
}

function normalizeAccountTitle(value: unknown, usageType: VoucherUsageType) {
  const title = String(value ?? "").trim();
  if (usageType === "shiire") return title === "仕入高" ? "仕入高" : "仕入高";
  return validExpenseAccountTitles.has(title) ? title : "雑費";
}

function normalizeSubAccountTitle(value: unknown) {
  return String(value ?? "").trim().slice(0, 80);
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

function normalizeDate(value: unknown) {
  const date = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return "";
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

function getExpenseCategoryFromAccountTitle(accountTitle: string) {
  if (fixedAccountTitles.has(accountTitle)) return "fixed";
  if (variableAccountTitles.has(accountTitle)) return "variable";
  return "misc";
}

function isPdfFile(file: File) {
  return file.type.toLowerCase() === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

async function analyzeReceiptWithRetry(file: File) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await analyzeReceiptImage(file);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(1200 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OCRに失敗しました。");
}

async function uploadVoucherDocument(file: File, storeId: string, index: number) {
  const extension = validateReceiptUpload(file, maxReceiptSizeBytes, maxReceiptPdfSizeBytes, "証憑");
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Vercel Blob が未設定です。BLOB_READ_WRITE_TOKEN を接続してください。");
  }

  const safeName = sanitizeFileStem(file.name || `voucher-${index + 1}`) || `voucher-${index + 1}`;
  const blob = await put(`voucher-documents/${storeId}-${Date.now()}-${index + 1}-${safeName}.${extension}`, file, {
    access: "private"
  });
  await recordExternalServiceUsage({
    serviceKey: "vercel_blob",
    metricKey: "storage_bytes",
    quantity: file.size,
    unit: "bytes",
    source: "voucher_document",
    metadata: { pathname: blob.pathname }
  });
  return `/api/products/photo/view?pathname=${encodeURIComponent(blob.pathname)}&v=${Date.now()}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeFileStem(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function buildVendorName(companyName: string, brandName: string, locationName: string, fallback: string) {
  return [brandName || companyName, locationName].filter(Boolean).join(" ").trim() || fallback || "";
}

function extractBlobPathname(photoUrl: string) {
  try {
    const url = photoUrl.startsWith("http") ? new URL(photoUrl) : new URL(photoUrl, "https://foundr1.local");
    return url.searchParams.get("pathname") ?? "";
  } catch {
    return "";
  }
}
