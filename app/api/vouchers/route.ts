import { del, put } from "@vercel/blob";
import { canAccessStore, getSessionStoreScope, requireOsSession, requireWritableOsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";
import { recordExternalServiceUsage } from "../../../lib/external-service-usage";
import { analyzeReceiptImage, createProductCandidatesForOcrResult, normalizeReceiptProductName, recordReceiptItemPrice, saveReceiptOcrResult } from "../../../lib/receipt-ocr";
import { resolveReceiptSupplierLink } from "../../../lib/supplier-ocr-linking";
import type { ReceiptOcrResult } from "../../../lib/receipt-ocr";
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
  "保険料",
  "修繕費",
  "消耗品費",
  "事務用品費",
  "減価償却費",
  "福利厚生費",
  "法定福利費",
  "給料賃金",
  "外注工賃",
  "支払報酬料",
  "利子割引料",
  "地代家賃",
  "貸倒金",
  "支払手数料",
  "車両費",
  "リース料",
  "新聞図書費",
  "図書研修費",
  "研修採用費",
  "会議費",
  "諸会費",
  "衛生管理費",
  "雑費"
]);
const fixedAccountTitles = new Set(["地代家賃", "リース料", "損害保険料", "保険料", "減価償却費", "利子割引料"]);
const variableAccountTitles = new Set(["水道光熱費", "通信費", "旅費交通費", "車両費", "荷造運賃", "支払手数料"]);

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const url = new URL(request.url);
  if (url.searchParams.get("export") === "tax_accountant_csv") {
    return exportTaxAccountantCsv(session, request);
  }
  if (url.searchParams.get("view") === "confirmed_accounting_lines") {
    return listConfirmedAccountingLines(session, request);
  }

  const [stores, vouchers, products] = await Promise.all([
    listAccessibleStores(session),
    listAccessibleVouchers(session),
    listProductOptions()
  ]);

  return Response.json({
    canUpload: ["owner", "manager", "store_owner", "store_manager", "staff"].includes(session.role),
    canManageAll: ["owner", "manager"].includes(session.role),
    stores,
    products,
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
        const duplicate = await findDuplicateVoucherResult(storeId, analyzed.result);
        if (duplicate) {
          const pathname = extractBlobPathname(receiptUrl);
          if (pathname) await del(pathname).catch(() => undefined);
          results.push({ ok: true, duplicate: true, existingOcrResultId: duplicate.id, receiptUrl: duplicate.receiptPhotoUrl });
          continue;
        }
        ocrResultId = await saveReceiptOcrResult({
          sourceType: "voucher",
          storeId,
          supplierName,
          receiptPhotoUrl: receiptUrl,
          uploadedFileName: file.name || "",
          usageType: inferVoucherUsageTypeFromOcr(usageType, analyzed.result),
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
    lineNo?: string | number;
    lines?: Array<{
      accountTitle?: string;
      subAccountTitle?: string;
      amount?: string | number;
      taxRate?: string;
      taxMode?: string;
      taxAmount?: string | number;
      quantity?: string | number;
      unit?: string;
      unitPrice?: string | number;
      ocrItemId?: string;
      note?: string;
    }>;
    vendorName?: string;
    companyName?: string;
    brandName?: string;
    locationName?: string;
    transactionDate?: string;
    transactionTime?: string;
    receiptTotal?: string | number;
    receiptTaxTotal?: string | number;
    receiptTaxLines?: Array<{ taxRate?: string; taxAmount?: string | number }>;
    note?: string;
    ocrItemId?: string;
    summaryKey?: string;
    rawName?: string;
    accountTitle?: string;
    subAccountTitle?: string;
    amount?: string | number;
    taxRate?: string;
    taxMode?: string;
    taxAmount?: string | number;
    quantity?: string | number;
    productId?: string;
    productName?: string;
    category?: string;
    subcategory?: string;
    unit?: string;
    unitPrice?: string | number;
    referencePrice?: string | number;
    receiptUnitPrice?: string | number;
    updateReferencePrice?: boolean;
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

  if (body.action === "ignore_product_item" || body.action === "unignore_product_item") {
    if (nextUsageType !== "shiire") {
      return Response.json({ error: "商品マスタ対象外の設定は仕入の証憑で行ってください。" }, { status: 400 });
    }
    let itemId = String(body.ocrItemId ?? "").trim();
    let createdItemId = "";
    if (!itemId) {
      const item = await createManualVoucherOcrItem(id, body);
      itemId = String(item.id ?? "");
      createdItemId = itemId;
    }

    const itemRows = await sql`
      select id::text
      from receipt_ocr_items
      where id::text = ${itemId}
        and receipt_ocr_result_id::text = ${id}
      limit 1
    `;
    if (!itemRows[0]) return Response.json({ error: "明細が見つかりません。" }, { status: 404 });

    await setVoucherItemProductIgnored(id, itemId, body.action === "ignore_product_item");
    return Response.json({ ok: true, itemId: createdItemId || itemId });
  }

  if (body.action === "link_product_to_item" || body.action === "create_product_from_item") {
    if (nextUsageType !== "shiire") {
      return Response.json({ error: "商品マスタ紐付けは仕入の証憑で行ってください。" }, { status: 400 });
    }
    const itemId = String(body.ocrItemId ?? "").trim();
    const item = itemId
      ? await getVoucherOcrItemForProductLink(id, itemId)
      : await createManualVoucherOcrItem(id, body);
    if (!item) return Response.json({ error: "明細が見つかりません。" }, { status: 404 });

    const productId = body.action === "create_product_from_item"
      ? await createProductFromVoucherItem(item, body, session.id)
      : String(body.productId ?? "").trim();
    if (!productId) return Response.json({ error: "紐付ける商品を選択してください。" }, { status: 400 });

    const receiptUnitPrice = normalizeNullableUnitPrice(body.receiptUnitPrice) ?? normalizeNullableUnitPrice(body.unitPrice) ?? normalizeNullableUnitPrice(item.unitPrice);
    const itemForLink = {
      ...item,
      unit: String(body.unit ?? item.unit ?? "個").trim().slice(0, 20) || "個",
      unitPrice: receiptUnitPrice
    };
    await updateReceiptOcrItemForProductLink(id, itemId, body, receiptUnitPrice);
    await linkVoucherItemToProduct(itemForLink, productId, session.id, receiptUnitPrice);

    if (body.updateReferencePrice) {
      const nextReferencePrice = normalizeNullableUnitPrice(body.referencePrice) ?? receiptUnitPrice;
      if (nextReferencePrice && nextReferencePrice > 0) {
        await sql`
          update products
          set reference_price = ${nextReferencePrice}, updated_at = now()
          where id::text = ${productId}
        `;
      }
    }
    return Response.json({ ok: true, productId, itemId: String(item.id ?? "") });
  }

  if (body.action === "update_confirmed_accounting_summary_note") {
    if (String(voucher.status ?? "") !== "confirmed") {
      return Response.json({ error: "確定済みの証憑だけ編集できます。" }, { status: 400 });
    }
    const summaryKey = String(body.summaryKey ?? "").trim();
    if (!summaryKey) return Response.json({ error: "摘要を保存する集計キーがありません。" }, { status: 400 });
    const note = String(body.note ?? "").trim().slice(0, 240);

    await sql`
      update receipt_ocr_results
      set
        raw_result = jsonb_set(
          coalesce(raw_result, '{}'::jsonb),
          '{accountingSummaryNotes}',
          coalesce(raw_result->'accountingSummaryNotes', '{}'::jsonb) || jsonb_build_object(${summaryKey}, ${note}),
          true
        ),
        updated_at = now()
      where id::text = ${id}
    `;

    return Response.json({ ok: true });
  }

  if (body.action === "update_confirmed_voucher_basic") {
    if (String(voucher.status ?? "") !== "confirmed") {
      return Response.json({ error: "確定済みの証憑だけ編集できます。" }, { status: 400 });
    }

    const rawRows = await sql`
      select raw_result as "rawResult"
      from receipt_ocr_results
      where id::text = ${id}
      limit 1
    `;
    const rawResult = isPlainObject(rawRows[0]?.rawResult) ? rawRows[0].rawResult : {};
    const accountingLines = Array.isArray(rawResult.accountingLines) ? [...rawResult.accountingLines] : [];
    const receiptTaxLines = normalizeReceiptTaxLines(body.receiptTaxLines, normalizeNullableMoney(body.receiptTaxTotal) ?? Number(voucher.tax ?? 0));
    const adjustedAccountingLines = applyAccountingLinesTaxBreakdown(accountingLines, receiptTaxLines);
    const normalizedLines = normalizeAccountingLines(adjustedAccountingLines, voucher, nextUsageType);
    const lineTotal = normalizedLines.reduce((sum, line) => sum + line.amount, 0);
    const tax = calculateReceiptTaxLinesTotal(receiptTaxLines);
    const receiptTotal = normalizeNullableMoney(body.receiptTotal) ?? normalizeNullableMoney(voucher.total) ?? lineTotal;
    const companyName = String(body.companyName ?? voucher.companyName ?? "").trim();
    const brandName = String(body.brandName ?? voucher.brandName ?? "").trim();
    const locationName = String(body.locationName ?? voucher.locationName ?? "").trim();
    const vendorName = String(body.vendorName ?? buildVendorName(companyName, brandName, locationName, String(voucher.vendorName ?? ""))).trim();
    const supplierLink = await resolveReceiptSupplierLink({ vendorName, companyName, brandName, locationName });

    await sql`
      update receipt_ocr_results
      set
        usage_type = ${nextUsageType},
        payment_type = ${nextPaymentType},
        reimbursement_status = ${nextReimbursementStatus},
        vendor_name = ${vendorName},
        company_name = ${companyName},
        brand_name = ${brandName},
        location_name = ${locationName},
        supplier_id = ${supplierLink.supplierId || null},
        supplier_location_id = ${supplierLink.supplierLocationId || null},
        supplier_match_status = ${supplierLink.matchStatus},
        tax = ${tax},
        total = ${receiptTotal},
        raw_result = jsonb_set(
          jsonb_set(coalesce(raw_result, '{}'::jsonb), '{accountingLines}', ${JSON.stringify(normalizedLines)}::jsonb, true),
          '{receiptTaxLines}',
          ${JSON.stringify(receiptTaxLines)}::jsonb,
          true
        ),
        updated_at = now()
      where id::text = ${id}
    `;

    return Response.json({ ok: true, lineCount: normalizedLines.length, amount: receiptTotal, tax });
  }

  if (body.action === "update_confirmed_accounting_line") {
    if (String(voucher.status ?? "") !== "confirmed") {
      return Response.json({ error: "確定済みの証憑明細だけ編集できます。" }, { status: 400 });
    }
    const lineNo = Number(body.lineNo);
    if (!Number.isInteger(lineNo) || lineNo <= 0) {
      return Response.json({ error: "編集する明細番号がありません。" }, { status: 400 });
    }

    const rawRows = await sql`
      select raw_result as "rawResult"
      from receipt_ocr_results
      where id::text = ${id}
      limit 1
    `;
    const rawResult = isPlainObject(rawRows[0]?.rawResult) ? rawRows[0].rawResult : {};
    const accountingLines = Array.isArray(rawResult.accountingLines) ? [...rawResult.accountingLines] : [];
    const index = lineNo - 1;
    if (!accountingLines[index] || !isPlainObject(accountingLines[index])) {
      return Response.json({ error: "編集する明細が見つかりません。" }, { status: 404 });
    }

    const currentLine = accountingLines[index] as Record<string, unknown>;
    const amount = normalizeNullableMoney(body.lines?.[0]?.amount) ?? normalizeNullableMoney(currentLine.amount) ?? 0;
    const taxRate = normalizeTaxRate(body.lines?.[0]?.taxRate ?? currentLine.taxRate);
    const taxMode = normalizeTaxMode(body.lines?.[0]?.taxMode ?? currentLine.taxMode);
    const providedTaxAmount = normalizeNullableMoney(body.lines?.[0]?.taxAmount);
    const nextLine = {
      ...currentLine,
      accountTitle: normalizeAccountTitle(body.lines?.[0]?.accountTitle ?? currentLine.accountTitle, nextUsageType),
      subAccountTitle: normalizeSubAccountTitle(body.lines?.[0]?.subAccountTitle ?? currentLine.subAccountTitle),
      amount,
      taxRate,
      taxMode,
      taxAmount: providedTaxAmount ?? calculateTaxAmount(amount, taxRate, taxMode),
      quantity: normalizeNullableNumber(body.lines?.[0]?.quantity ?? currentLine.quantity),
      unit: String(body.lines?.[0]?.unit ?? currentLine.unit ?? "個").trim().slice(0, 20) || "個",
      unitPrice: normalizeNullableUnitPrice(body.lines?.[0]?.unitPrice ?? currentLine.unitPrice),
      ocrItemId: String(body.lines?.[0]?.ocrItemId ?? currentLine.ocrItemId ?? "").trim(),
      note: String(body.lines?.[0]?.note ?? currentLine.note ?? "").trim()
    };
    accountingLines[index] = nextLine;
    const receiptTaxLines = normalizeReceiptTaxLines(body.receiptTaxLines, normalizeNullableMoney(body.receiptTaxTotal) ?? Number(voucher.tax ?? 0));
    const adjustedAccountingLines = applyAccountingLinesTaxBreakdown(accountingLines, receiptTaxLines);
    const normalizedLines = normalizeAccountingLines(adjustedAccountingLines, voucher, nextUsageType);
    const lineTotal = normalizedLines.reduce((sum, line) => sum + line.amount, 0);
    const tax = calculateReceiptTaxLinesTotal(receiptTaxLines);
    const receiptTotal = normalizeNullableMoney(body.receiptTotal) ?? normalizeNullableMoney(voucher.total) ?? lineTotal;
    const companyName = String(body.companyName ?? voucher.companyName ?? "").trim();
    const brandName = String(body.brandName ?? voucher.brandName ?? "").trim();
    const locationName = String(body.locationName ?? voucher.locationName ?? "").trim();
    const vendorName = String(body.vendorName ?? buildVendorName(companyName, brandName, locationName, String(voucher.vendorName ?? ""))).trim();
    const supplierLink = await resolveReceiptSupplierLink({ vendorName, companyName, brandName, locationName });

    await sql`
      update receipt_ocr_results
      set
        usage_type = ${nextUsageType},
        payment_type = ${nextPaymentType},
        reimbursement_status = ${nextReimbursementStatus},
        vendor_name = ${vendorName},
        company_name = ${companyName},
        brand_name = ${brandName},
        location_name = ${locationName},
        supplier_id = ${supplierLink.supplierId || null},
        supplier_location_id = ${supplierLink.supplierLocationId || null},
        supplier_match_status = ${supplierLink.matchStatus},
        tax = ${tax},
        total = ${receiptTotal},
        raw_result = jsonb_set(
          jsonb_set(coalesce(raw_result, '{}'::jsonb), '{accountingLines}', ${JSON.stringify(normalizedLines)}::jsonb, true),
          '{receiptTaxLines}',
          ${JSON.stringify(receiptTaxLines)}::jsonb,
          true
        ),
        updated_at = now()
      where id::text = ${id}
    `;

    if (nextUsageType === "shiire") {
      await updateReceiptOcrItemDetails(id, normalizedLines);
    }

    return Response.json({ ok: true, lineCount: normalizedLines.length, amount: receiptTotal, tax });
  }

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

    const receiptTaxLines = normalizeReceiptTaxLines(body.receiptTaxLines, normalizeNullableMoney(body.receiptTaxTotal) ?? Number(voucher.tax ?? 0));
    const adjustedBodyLines = Array.isArray(body.lines)
      ? applyAccountingLinesTaxBreakdown(body.lines, receiptTaxLines)
      : body.lines;
    const lines = normalizeAccountingLines(adjustedBodyLines, voucher, nextUsageType);
    const amount = lines.reduce((sum, line) => sum + line.amount, 0);
    const taxAmount = calculateReceiptTaxLinesTotal(receiptTaxLines);
    const receiptTotal = normalizeNullableMoney(body.receiptTotal) ?? amount;
    const transactionDate = normalizeDate(body.transactionDate) || normalizeDate(String(voucher.purchaseDate ?? ""));
    const transactionTime = normalizeTime(body.transactionTime) || normalizeTime(String(voucher.purchaseTime ?? ""));
    const companyName = String(body.companyName ?? voucher.companyName ?? "").trim();
    const brandName = String(body.brandName ?? voucher.brandName ?? "").trim();
    const locationName = String(body.locationName ?? voucher.locationName ?? "").trim();
    const vendorName = String(body.vendorName ?? buildVendorName(companyName, brandName, locationName, String(voucher.vendorName ?? ""))).trim();
    const supplierLink = await resolveReceiptSupplierLink({ vendorName, companyName, brandName, locationName });
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
        supplier_id = ${supplierLink.supplierId || null},
        supplier_location_id = ${supplierLink.supplierLocationId || null},
        supplier_match_status = ${supplierLink.matchStatus},
        purchase_date = ${transactionDate},
        purchase_time = ${transactionTime || null},
        tax = ${taxAmount},
        total = ${receiptTotal},
        raw_result = jsonb_set(
          jsonb_set(coalesce(raw_result, '{}'::jsonb), '{accountingLines}', ${JSON.stringify(lines)}::jsonb, true),
          '{receiptTaxLines}',
          ${JSON.stringify(receiptTaxLines)}::jsonb,
          true
        ),
        confirmed_at = now(),
        confirmed_by = ${session.id},
        updated_at = now()
      where id::text = ${id}
    `;

    if (nextUsageType === "shiire") {
      await updateReceiptOcrItemDetails(id, lines);
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
      coalesce(suppliers.name, '') as "linkedSupplierName",
      coalesce(supplier_locations.name, '') as "linkedSupplierLocationName",
      coalesce(receipt_ocr_results.supplier_match_status, 'unmatched') as "supplierMatchStatus",
      coalesce(to_char(receipt_ocr_results.purchase_date, 'YYYY-MM-DD'), '') as "purchaseDate",
      coalesce(to_char(receipt_ocr_results.purchase_time, 'HH24:MI'), '') as "purchaseTime",
      receipt_ocr_results.total::float,
      receipt_ocr_results.tax::float,
      coalesce(receipt_ocr_results.raw_result->'accountingLines', '[]'::jsonb) as "accountingLines",
      coalesce(receipt_ocr_results.raw_result->'receiptTaxLines', '[]'::jsonb) as "receiptTaxLines",
      coalesce(item_counts.item_count, 0)::int as "itemCount",
      coalesce(employees.name, '') as "createdByName",
      coalesce(to_char(receipt_ocr_results.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI'), '') as "createdLabel"
    from receipt_ocr_results
    left join stores on stores.id = receipt_ocr_results.store_id
    left join employees on employees.id = receipt_ocr_results.created_by
    left join suppliers on suppliers.id = receipt_ocr_results.supplier_id
    left join supplier_locations on supplier_locations.id = receipt_ocr_results.supplier_location_id
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
      receipt_ocr_items.id::text,
      receipt_ocr_items.receipt_ocr_result_id::text as "ocrResultId",
      receipt_ocr_items.raw_name as "rawName",
      coalesce(receipt_ocr_items.tax_rate, '') as "taxRate",
      coalesce(receipt_ocr_items.tax_mode, '') as "taxMode",
      receipt_ocr_items.quantity::float,
      coalesce(receipt_ocr_items.unit, '') as unit,
      receipt_ocr_items.unit_price::float as "unitPrice",
      coalesce(receipt_ocr_items.category, '') as category,
      coalesce(receipt_ocr_items.account_title, '') as "accountTitle",
      receipt_ocr_items.amount::float,
      coalesce(receipt_ocr_items.match_status, '') as "matchStatus",
      receipt_ocr_items.matched_product_id::text as "matchedProductId",
      coalesce(products.name, '') as "matchedProductName"
    from receipt_ocr_items
    left join products on products.id = receipt_ocr_items.matched_product_id
    where receipt_ocr_items.receipt_ocr_result_id::text = any(${ocrResultIds})
    order by receipt_ocr_items.receipt_ocr_result_id, receipt_ocr_items.line_index
  ` : [];
  const itemsByResultId = new Map<string, Array<{
    id: string;
    rawName: string;
    taxRate: string;
    taxMode: string;
    quantity: number | null;
    unit: string;
    unitPrice: number | null;
    category: string;
    accountTitle: string;
    amount: number;
    matchStatus: string;
    matchedProductId: string;
    matchedProductName: string;
  }>>();
  for (const item of itemRows) {
    const ocrResultId = String(item.ocrResultId ?? "");
    const items = itemsByResultId.get(ocrResultId) ?? [];
    items.push({
      id: String(item.id ?? ""),
      rawName: String(item.rawName ?? ""),
      taxRate: String(item.taxRate ?? ""),
      taxMode: String(item.taxMode ?? ""),
      quantity: item.quantity === null || item.quantity === undefined ? null : Number(item.quantity),
      unit: String(item.unit ?? "個").trim() || "個",
      unitPrice: item.unitPrice === null || item.unitPrice === undefined ? null : Number(item.unitPrice),
      category: String(item.category ?? ""),
      accountTitle: String(item.accountTitle ?? ""),
      amount: Number(item.amount ?? 0),
      matchStatus: String(item.matchStatus ?? ""),
      matchedProductId: String(item.matchedProductId ?? ""),
      matchedProductName: String(item.matchedProductName ?? "")
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
    linkedSupplierName: String(row.linkedSupplierName ?? ""),
    linkedSupplierLocationName: String(row.linkedSupplierLocationName ?? ""),
    supplierMatchStatus: String(row.supplierMatchStatus ?? "unmatched"),
    purchaseDate: String(row.purchaseDate ?? ""),
    purchaseTime: String(row.purchaseTime ?? ""),
    total: Number(row.total ?? 0),
    tax: Number(row.tax ?? 0),
    accountingLines: normalizeStoredAccountingLines(row.accountingLines),
    receiptTaxLines: normalizeReceiptTaxLines(row.receiptTaxLines, Number(row.tax ?? 0)),
    itemCount: Number(row.itemCount ?? 0),
    createdByName: String(row.createdByName ?? ""),
    createdLabel: String(row.createdLabel ?? ""),
    canDelete: String(row.sourceType ?? "") === "voucher",
    items: itemsByResultId.get(String(row.id ?? "")) ?? []
  }));
}

async function exportTaxAccountantCsv(session: NonNullable<Awaited<ReturnType<typeof requireOsSession>>>, request: Request) {
  const scope = await getSessionStoreScope(session);
  const scopedStoreIds = scope.storeIds.length ? scope.storeIds : ["00000000-0000-0000-0000-000000000000"];
  const url = new URL(request.url);
  const fromDate = normalizeDate(url.searchParams.get("from") ?? "");
  const toDate = normalizeDate(url.searchParams.get("to") ?? "");
  const origin = url.origin;

  const rows = await sql`
    with expanded_lines as (
      select
        receipt_ocr_results.id::text as "voucherId",
        stores.name as "storeName",
        receipt_ocr_results.created_at as "createdAt",
        coalesce(to_char(receipt_ocr_results.purchase_date, 'YYYY-MM-DD'), '') as "purchaseDate",
        coalesce(to_char(receipt_ocr_results.purchase_time, 'HH24:MI'), '') as "purchaseTime",
        receipt_ocr_results.usage_type as "usageType",
        receipt_ocr_results.payment_type as "paymentType",
        receipt_ocr_results.reimbursement_status as "reimbursementStatus",
        coalesce(receipt_ocr_results.total::float, 0) as "receiptTotal",
        coalesce(receipt_ocr_results.raw_result->'accountingSummaryNotes', '{}'::jsonb)::text as "summaryNotes",
        coalesce(receipt_ocr_results.company_name, '') as "companyName",
        coalesce(receipt_ocr_results.brand_name, '') as "brandName",
        coalesce(receipt_ocr_results.location_name, '') as "locationName",
        coalesce(receipt_ocr_results.vendor_name, '') as "vendorName",
        line.ordinality::int as "lineNo",
        coalesce(line.value->>'accountTitle', '') as "accountTitle",
        coalesce(line.value->>'subAccountTitle', '') as "subAccountTitle",
        coalesce((nullif(line.value->>'amount', ''))::float, 0) as amount,
        coalesce(line.value->>'taxRate', '') as "taxRate",
        coalesce(line.value->>'taxMode', '') as "taxMode",
        coalesce((nullif(line.value->>'taxAmount', ''))::float, 0) as "taxAmount",
        (nullif(line.value->>'quantity', ''))::float as quantity,
        coalesce(nullif(line.value->>'unit', ''), '個') as unit,
        coalesce(line.value->>'note', '') as note
      from receipt_ocr_results
      join stores on stores.id = receipt_ocr_results.store_id
      cross join lateral jsonb_array_elements(coalesce(receipt_ocr_results.raw_result->'accountingLines', '[]'::jsonb)) with ordinality as line(value, ordinality)
      where receipt_ocr_results.status = 'confirmed'
        and (${scope.allStores} or receipt_ocr_results.created_by = ${session.id} or receipt_ocr_results.store_id::text = any(${scopedStoreIds}))
        and (${fromDate || null}::date is null or receipt_ocr_results.purchase_date >= ${fromDate || null}::date)
        and (${toDate || null}::date is null or receipt_ocr_results.purchase_date <= ${toDate || null}::date)
    )
    select
      "voucherId",
      "storeName",
      "purchaseDate",
      "purchaseTime",
      "usageType",
      "paymentType",
      "reimbursementStatus",
      max("receiptTotal") as "receiptTotal",
      max("summaryNotes") as "summaryNotes",
      "companyName",
      "brandName",
      "locationName",
      "vendorName",
      min("lineNo") as "lineNo",
      count(*)::int as "lineCount",
      "accountTitle",
      "subAccountTitle",
      sum(amount) as amount,
      "taxRate",
      "taxMode",
      sum("taxAmount") as "taxAmount",
      case when count(distinct nullif(unit, '')) <= 1 and count(quantity) > 0 then sum(quantity) else null end as quantity,
      case when count(distinct nullif(unit, '')) <= 1 then max(unit) else '' end as unit,
      case when count(distinct nullif(unit, '')) <= 1 and coalesce(sum(quantity), 0) > 0 then sum(amount) / sum(quantity) else null end as "unitPrice",
      case when count(*) = 1 then max(note) else concat('集計 ', count(*)::text, '行') end as note,
      jsonb_agg(jsonb_build_object(
        'note', note,
        'amount', amount,
        'taxAmount', "taxAmount",
        'taxMode', "taxMode",
        'quantity', quantity,
        'lineNo', "lineNo"
      ) order by "lineNo" asc) as "summaryItems",
      min("createdAt") as "createdAt"
    from expanded_lines
    group by
      "voucherId",
      "storeName",
      "purchaseDate",
      "purchaseTime",
      "usageType",
      "paymentType",
      "reimbursementStatus",
      "companyName",
      "brandName",
      "locationName",
      "vendorName",
      "accountTitle",
      "subAccountTitle",
      "taxRate",
      "taxMode"
    order by "purchaseDate" asc nulls last, "purchaseTime" asc nulls last, "createdAt" asc, min("lineNo") asc
  `;

  const headers = [
    "取引日",
    "時刻",
    "店舗",
    "取引先",
    "用途",
    "支払区分",
    "精算状態",
    "勘定科目",
    "補助科目",
    "税込金額",
    "税率",
    "税区分",
    "消費税",
    "集計行数",
    "摘要",
    "証憑ID",
    "行番号",
    "証憑URL"
  ];

  const adjustedRows = adjustRowsToReceiptTotals(rows);
  const csvRows = adjustedRows.map((row) => {
    const vendorName = buildVendorName(
      String(row.companyName ?? ""),
      String(row.brandName ?? ""),
      String(row.locationName ?? ""),
      String(row.vendorName ?? "")
    );
    const taxIncludedAmount = row.taxIncludedAmount;
    const summaryKey = buildAccountingSummaryKey(row);
    const summaryNote = getAccountingSummaryNote(row.summaryNotes, summaryKey)
      ?? buildAutomaticAccountingSummaryNote(parseAccountingSummaryItems(row.summaryItems))
      ?? String(row.note ?? "");
    return [
      String(row.purchaseDate ?? ""),
      String(row.purchaseTime ?? ""),
      String(row.storeName ?? ""),
      vendorName,
      getUsageTypeExportLabel(String(row.usageType ?? "")),
      getPaymentTypeExportLabel(String(row.paymentType ?? "")),
      getReimbursementExportLabel(String(row.reimbursementStatus ?? "")),
      String(row.accountTitle ?? ""),
      String(row.subAccountTitle ?? ""),
      String(taxIncludedAmount),
      String(row.taxRate ?? ""),
      String(row.taxMode ?? ""),
      String(Math.round(Number(row.taxAmount ?? 0))),
      String(Number(row.lineCount ?? 1)),
      summaryNote,
      String(row.voucherId ?? ""),
      String(row.lineNo ?? ""),
      `${origin}/api/vouchers/${encodeURIComponent(String(row.voucherId ?? ""))}/preview`
    ];
  });

  const csv = "\ufeff" + [headers, ...csvRows].map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
  const filename = `foundr1-tax-accountant-vouchers-${fromDate || "all"}-${toDate || "all"}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}

async function listConfirmedAccountingLines(session: NonNullable<Awaited<ReturnType<typeof requireOsSession>>>, request: Request) {
  const scope = await getSessionStoreScope(session);
  const scopedStoreIds = scope.storeIds.length ? scope.storeIds : ["00000000-0000-0000-0000-000000000000"];
  const url = new URL(request.url);
  const fromDate = normalizeDate(url.searchParams.get("from") ?? "");
  const toDate = normalizeDate(url.searchParams.get("to") ?? "");

  const rows = await sql`
    select
      receipt_ocr_results.id::text as "voucherId",
      stores.name as "storeName",
      receipt_ocr_results.created_at as "createdAt",
      coalesce(to_char(receipt_ocr_results.purchase_date, 'YYYY-MM-DD'), '') as "purchaseDate",
      coalesce(to_char(receipt_ocr_results.purchase_time, 'HH24:MI'), '') as "purchaseTime",
      receipt_ocr_results.usage_type as "usageType",
      receipt_ocr_results.payment_type as "paymentType",
      receipt_ocr_results.reimbursement_status as "reimbursementStatus",
      coalesce(receipt_ocr_results.total::float, 0) as "receiptTotal",
      coalesce(receipt_ocr_results.raw_result->'accountingSummaryNotes', '{}'::jsonb)::text as "summaryNotes",
      coalesce(receipt_ocr_results.company_name, '') as "companyName",
      coalesce(receipt_ocr_results.brand_name, '') as "brandName",
      coalesce(receipt_ocr_results.location_name, '') as "locationName",
      coalesce(receipt_ocr_results.vendor_name, '') as "vendorName",
      line.ordinality::int as "lineNo",
      coalesce(line.value->>'accountTitle', '') as "accountTitle",
      coalesce(line.value->>'subAccountTitle', '') as "subAccountTitle",
      coalesce((nullif(line.value->>'amount', ''))::float, 0) as amount,
      coalesce(line.value->>'taxRate', '') as "taxRate",
      coalesce(line.value->>'taxMode', '') as "taxMode",
      coalesce((nullif(line.value->>'taxAmount', ''))::float, 0) as "taxAmount",
      (nullif(line.value->>'quantity', ''))::float as quantity,
      coalesce(nullif(line.value->>'unit', ''), '個') as unit,
      (nullif(line.value->>'unitPrice', ''))::float as "unitPrice",
      coalesce(line.value->>'ocrItemId', '') as "ocrItemId",
      coalesce(line.value->>'note', '') as note
    from receipt_ocr_results
    join stores on stores.id = receipt_ocr_results.store_id
    cross join lateral jsonb_array_elements(coalesce(receipt_ocr_results.raw_result->'accountingLines', '[]'::jsonb)) with ordinality as line(value, ordinality)
    where receipt_ocr_results.status = 'confirmed'
      and (${scope.allStores} or receipt_ocr_results.created_by = ${session.id} or receipt_ocr_results.store_id::text = any(${scopedStoreIds}))
      and (${fromDate || null}::date is null or receipt_ocr_results.purchase_date >= ${fromDate || null}::date)
      and (${toDate || null}::date is null or receipt_ocr_results.purchase_date <= ${toDate || null}::date)
    order by receipt_ocr_results.purchase_date asc nulls last, receipt_ocr_results.purchase_time asc nulls last, receipt_ocr_results.created_at asc, line.ordinality asc
    limit 3000
  `;

  type ConfirmedAccountingDetail = {
    voucherId: string;
    lineNo: number;
    accountTitle: string;
    subAccountTitle: string;
    amount: number;
    taxRate: string;
    taxMode: string;
    taxAmount: number;
    quantity: string;
    unit: string;
    unitPrice: string;
    ocrItemId: string;
    note: string;
  };

  const groups = new Map<string, {
    voucherId: string;
    lineNo: number;
    purchaseDate: string;
    purchaseTime: string;
    storeName: string;
    vendorName: string;
    usageType: string;
    paymentType: string;
    reimbursementStatus: string;
    summaryKey: string;
    manualSummaryNote: boolean;
    accountTitle: string;
    subAccountTitle: string;
    amount: number;
    taxRate: string;
    taxMode: string;
    taxAmount: number;
    receiptTotal: number;
    quantity: number | null;
    unit: string;
    unitPrice: number | null;
    lineCount: number;
    note: string;
    createdAt: string;
    details: ConfirmedAccountingDetail[];
  }>();

  for (const row of rows) {
    const vendorName = buildVendorName(
      String(row.companyName ?? ""),
      String(row.brandName ?? ""),
      String(row.locationName ?? ""),
      String(row.vendorName ?? "")
    );
    const summaryKey = buildAccountingSummaryKey(row);
    const key = [String(row.voucherId ?? ""), summaryKey].join("\u001f");
    const manualSummaryNote = getAccountingSummaryNote(row.summaryNotes, summaryKey);
    const amount = Math.round(Number(row.amount ?? 0));
    const taxAmount = Math.round(Number(row.taxAmount ?? 0));
    const receiptTotal = Math.round(Number(row.receiptTotal ?? 0));
    const taxIncludedAmount = calculateAccountingTaxIncludedAmount(amount, taxAmount, row.taxMode);
    const quantity = row.quantity === null || row.quantity === undefined ? null : Number(row.quantity);
    const unit = String(row.unit ?? "個").trim() || "個";
    const detail = {
      voucherId: String(row.voucherId ?? ""),
      lineNo: Number(row.lineNo ?? 0),
      accountTitle: String(row.accountTitle ?? ""),
      subAccountTitle: String(row.subAccountTitle ?? ""),
      amount,
      taxRate: String(row.taxRate ?? ""),
      taxMode: String(row.taxMode ?? ""),
      taxAmount,
      quantity: quantity === null || !Number.isFinite(quantity) ? "" : String(quantity),
      unit,
      unitPrice: row.unitPrice === null || row.unitPrice === undefined ? "" : String(Math.round(Number(row.unitPrice) * 100) / 100),
      ocrItemId: String(row.ocrItemId ?? ""),
      note: String(row.note ?? "")
    };
    const existing = groups.get(key);
    if (existing) {
      existing.amount += amount;
      existing.taxAmount += taxAmount;
      existing.lineCount += 1;
      existing.details.push(detail);
      if (unit && existing.unit && existing.unit !== unit) existing.unit = "";
      if (!existing.unit && existing.lineCount === 2 && existing.details[0]?.unit !== unit) existing.quantity = null;
      if (existing.quantity !== null && Number.isFinite(quantity ?? NaN)) existing.quantity += quantity ?? 0;
      else existing.quantity = null;
      if (!existing.manualSummaryNote) existing.note = `集計 ${existing.lineCount}行`;
      const existingTaxIncludedAmount = calculateAccountingTaxIncludedAmount(existing.amount, existing.taxAmount, existing.taxMode);
      existing.unitPrice = existing.unit && existing.quantity && existing.quantity > 0
        ? Math.round((existingTaxIncludedAmount / existing.quantity) * 100) / 100
        : null;
      continue;
    }

    groups.set(key, {
      voucherId: detail.voucherId,
      lineNo: detail.lineNo,
      purchaseDate: String(row.purchaseDate ?? ""),
      purchaseTime: String(row.purchaseTime ?? ""),
      storeName: String(row.storeName ?? ""),
      vendorName,
      usageType: getUsageTypeExportLabel(String(row.usageType ?? "")),
      paymentType: getPaymentTypeExportLabel(String(row.paymentType ?? "")),
      reimbursementStatus: getReimbursementExportLabel(String(row.reimbursementStatus ?? "")),
      summaryKey,
      manualSummaryNote: manualSummaryNote !== null,
      accountTitle: detail.accountTitle,
      subAccountTitle: detail.subAccountTitle,
      amount,
      taxRate: detail.taxRate,
      taxMode: detail.taxMode,
      taxAmount,
      receiptTotal,
      quantity: quantity === null || !Number.isFinite(quantity) ? null : quantity,
      unit,
      unitPrice: quantity !== null && Number.isFinite(quantity) && quantity > 0
        ? Math.round((taxIncludedAmount / quantity) * 100) / 100
        : null,
      lineCount: 1,
      note: manualSummaryNote ?? detail.note,
      createdAt: String(row.createdAt ?? ""),
      details: [detail]
    });
  }

  for (const group of groups.values()) {
    if (!group.manualSummaryNote) {
      group.note = buildAutomaticAccountingSummaryNote(group.details) ?? group.note;
    }
  }

  return Response.json({
    lines: adjustRowsToReceiptTotals([...groups.values()])
      .slice(0, 500)
      .map((row) => ({
      voucherId: String(row.voucherId ?? ""),
      lineNo: Number(row.lineNo ?? 0),
      summaryKey: String(row.summaryKey ?? ""),
      purchaseDate: String(row.purchaseDate ?? ""),
      purchaseTime: String(row.purchaseTime ?? ""),
      storeName: String(row.storeName ?? ""),
      vendorName: String(row.vendorName ?? ""),
      usageType: String(row.usageType ?? ""),
      paymentType: String(row.paymentType ?? ""),
      reimbursementStatus: String(row.reimbursementStatus ?? ""),
      accountTitle: String(row.accountTitle ?? ""),
      subAccountTitle: String(row.subAccountTitle ?? ""),
      amount: Math.round(Number(row.amount ?? 0)),
      taxIncludedAmount: row.taxIncludedAmount,
      taxRate: String(row.taxRate ?? ""),
      taxMode: String(row.taxMode ?? ""),
      taxAmount: Math.round(Number(row.taxAmount ?? 0)),
      quantity: row.quantity === null || row.quantity === undefined ? "" : String(Number(row.quantity)),
      unit: String(row.unit ?? "個").trim() || "個",
      unitPrice: row.quantity && Number.isFinite(Number(row.quantity)) && Number(row.quantity) > 0
        ? String(Math.round((row.taxIncludedAmount / Number(row.quantity)) * 100) / 100)
        : row.unitPrice === null || row.unitPrice === undefined ? "" : String(Math.round(Number(row.unitPrice) * 100) / 100),
      lineCount: Number(row.lineCount ?? 1),
      note: String(row.note ?? ""),
      details: row.details
    }))
  });
}

async function listProductOptions() {
  const rows = await sql`
    select
      id::text,
      name,
      category,
      subcategory,
      unit,
      reference_price::float as "referencePrice",
      coalesce(product_family_name, '') as "productFamilyName",
      coalesce(variant_name, '') as "variantName",
      coalesce(package_spec, '') as "packageSpec",
      package_quantity::float as "packageQuantity",
      coalesce(package_quantity_unit, '') as "packageQuantityUnit",
      coalesce((
        select suppliers.name
        from product_supplier_options
        join suppliers on suppliers.id = product_supplier_options.supplier_id
        where product_supplier_options.product_id = products.id
          and product_supplier_options.role = 'メイン'
          and product_supplier_options.is_active = true
        order by suppliers.name
        limit 1
      ), '') as "mainSupplier"
    from products
    order by category asc, subcategory asc, coalesce(product_family_name, name) asc, variant_sort_order asc, name asc
    limit 800
  `;
  return rows.map((row) => ({
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    category: String(row.category ?? ""),
    subcategory: String(row.subcategory ?? ""),
    unit: String(row.unit ?? ""),
    referencePrice: Number(row.referencePrice ?? 0),
    productFamilyName: String(row.productFamilyName ?? ""),
    variantName: String(row.variantName ?? ""),
    packageSpec: String(row.packageSpec ?? ""),
    packageQuantity: row.packageQuantity === null || row.packageQuantity === undefined ? "" : String(Number(row.packageQuantity)),
    packageQuantityUnit: String(row.packageQuantityUnit ?? ""),
    mainSupplier: String(row.mainSupplier ?? "")
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inferVoucherUsageTypeFromOcr(selectedUsageType: VoucherUsageType, result: ReceiptOcrResult): VoucherUsageType {
  if (selectedUsageType !== "unclassified") return selectedUsageType;
  const purpose = String(result.financialPurpose ?? "").trim();
  if (purpose === "仕入") return "shiire";
  if (purpose === "経費" || purpose === "租税公課" || purpose === "給与関連" || purpose === "固定資産") return "keihi";
  const accountTitles = result.items.map((item) => String(item.accountTitle ?? "").trim());
  if (accountTitles.some((title) => title === "仕入高")) return "shiire";
  if (accountTitles.some((title) => validExpenseAccountTitles.has(title))) return "keihi";
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
  quantity?: string | number;
  unit?: string;
  unitPrice?: string | number;
  ocrItemId?: string;
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
    quantity: 1,
    unit: "個",
    unitPrice: "",
    ocrItemId: "",
    note: ""
  }];

  return inputLines.map((line) => {
    const amount = Math.round(Number(line.amount ?? 0));
    const taxRate = normalizeTaxRate(line.taxRate);
    const taxMode = normalizeTaxMode(line.taxMode);
    const taxAmountText = String(line.taxAmount ?? "").trim();
    const rawTaxAmount = Number(line.taxAmount);
    const hasProvidedTaxAmount = taxAmountText !== "" && Number.isFinite(rawTaxAmount);
    const taxAmount = hasProvidedTaxAmount
      ? Math.max(0, Math.round(rawTaxAmount))
      : calculateTaxAmount(amount, taxRate, taxMode);
    const quantity = normalizeAccountingQuantity(line.quantity);
    return {
      accountTitle: normalizeAccountTitle(line.accountTitle, usageType),
      subAccountTitle: normalizeSubAccountTitle(line.subAccountTitle),
      amount,
      taxRate,
      taxMode,
      taxAmount,
      quantity,
      unit: String(line.unit ?? "個").trim().slice(0, 20) || "個",
      unitPrice: normalizeNullableUnitPrice(line.unitPrice) ?? calculateAccountingUnitPrice(amount, taxRate, taxMode, quantity),
      ocrItemId: String(line.ocrItemId ?? "").trim(),
      note: String(line.note ?? "").trim()
    };
  }).filter((line) => line.amount > 0);
}

function normalizeReceiptTaxLines(value: unknown, fallbackTaxTotal: number) {
  const normalizedFallbackTaxTotal = Math.max(0, Math.round(Number(fallbackTaxTotal || 0)));
  const inputLines = Array.isArray(value) && value.length
    ? value
    : [{ taxRate: normalizedFallbackTaxTotal === 0 ? "非課税" : "8%", taxAmount: normalizedFallbackTaxTotal }];
  return inputLines.map((line) => {
    const row = isPlainObject(line) ? line : {};
    return {
      taxRate: normalizeTaxRate(row.taxRate) || "8%",
      taxAmount: Math.max(0, Math.round(Number(row.taxAmount ?? 0)))
    };
  });
}

function calculateReceiptTaxLinesTotal(lines: Array<{ taxAmount?: unknown }>) {
  return lines.reduce((sum, line) => sum + Math.round(Number(line.taxAmount ?? 0)), 0);
}

function applyAccountingLinesTaxBreakdown<T>(lines: T[], taxLines: Array<{ taxRate: string; taxAmount: number }>): T[] {
  const mutableLines = lines.map((line) => isPlainObject(line) ? { ...line } : line) as T[];
  for (const taxLine of taxLines) {
    const taxRate = normalizeTaxRate(taxLine.taxRate);
    if (!taxRate) continue;
    const targetTaxTotal = Math.max(0, Math.round(Number(taxLine.taxAmount ?? 0)));
    const targetIndexes = mutableLines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => isPlainObject(line) && normalizeTaxRate(line.taxRate) === taxRate)
      .map(({ index }) => index)
      .reverse();
    if (!targetIndexes.length) continue;
    const currentTaxTotal = targetIndexes.reduce((sum, index) => {
      const line = mutableLines[index];
      if (!isPlainObject(line)) return sum;
      return sum + Math.round(Number(line.taxAmount ?? 0));
    }, 0);
    let remainingDelta = targetTaxTotal - currentTaxTotal;
    if (!remainingDelta) continue;
    for (const index of targetIndexes) {
      if (!remainingDelta) break;
      const line = mutableLines[index];
      if (!isPlainObject(line)) continue;
      const lineRecord = line as Record<string, unknown>;
      const currentTaxAmount = Math.max(0, Math.round(Number(lineRecord.taxAmount ?? 0)));
      if (remainingDelta > 0) {
        lineRecord.taxAmount = currentTaxAmount + remainingDelta;
        remainingDelta = 0;
        break;
      }
      const reduction = Math.min(currentTaxAmount, Math.abs(remainingDelta));
      lineRecord.taxAmount = currentTaxAmount - reduction;
      remainingDelta += reduction;
    }
  }
  return mutableLines;
}

function applyAccountingLinesTaxTotal<T>(lines: T[], targetTaxTotal: number): T[] {
  const mutableLines = lines.map((line) => isPlainObject(line) ? { ...line } : line) as T[];
  const currentTaxTotal = mutableLines.reduce((sum, line) => {
    if (!isPlainObject(line)) return sum;
    return sum + Math.round(Number(line.taxAmount ?? 0));
  }, 0);
  let remainingDelta = Math.round(targetTaxTotal) - currentTaxTotal;
  if (!remainingDelta) return mutableLines;

  const candidates = mutableLines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => (
      isPlainObject(line)
      && normalizeTaxMode(line.taxMode) !== "対象外"
      && Boolean(normalizeTaxRate(line.taxRate))
    ));
  const targetIndexes = candidates.length ? candidates.map((candidate) => candidate.index).reverse() : mutableLines.map((_, index) => index).reverse();

  for (const index of targetIndexes) {
    if (!remainingDelta) break;
    const line = mutableLines[index];
    if (!isPlainObject(line)) continue;
    const lineRecord = line as Record<string, unknown>;
    const currentTaxAmount = Math.max(0, Math.round(Number(lineRecord.taxAmount ?? 0)));
    if (remainingDelta > 0) {
      lineRecord.taxAmount = currentTaxAmount + remainingDelta;
      remainingDelta = 0;
      break;
    }
    const reduction = Math.min(currentTaxAmount, Math.abs(remainingDelta));
    lineRecord.taxAmount = currentTaxAmount - reduction;
    remainingDelta += reduction;
  }

  return mutableLines;
}

async function updateReceiptOcrItemDetails(ocrResultId: string, lines: ReturnType<typeof normalizeAccountingLines>) {
  for (const line of lines) {
    if (!line.ocrItemId) continue;
    await sql`
      update receipt_ocr_items
      set
        quantity = ${line.quantity},
        unit = ${line.unit},
        unit_price = ${line.unitPrice},
        updated_at = now()
      where id::text = ${line.ocrItemId}
        and receipt_ocr_result_id::text = ${ocrResultId}
    `;
  }
}

async function getVoucherOcrItemForProductLink(ocrResultId: string, itemId: string) {
  const itemRows = await sql`
    select
      receipt_ocr_items.id::text,
      receipt_ocr_items.raw_name as "rawName",
      receipt_ocr_items.normalized_name as "normalizedName",
      receipt_ocr_items.category,
      receipt_ocr_items.unit,
      receipt_ocr_items.unit_price::float as "unitPrice",
      receipt_ocr_results.vendor_name as "vendorName",
      receipt_ocr_results.supplier_name as "supplierName"
    from receipt_ocr_items
    join receipt_ocr_results on receipt_ocr_results.id = receipt_ocr_items.receipt_ocr_result_id
    where receipt_ocr_items.id::text = ${itemId}
      and receipt_ocr_items.receipt_ocr_result_id::text = ${ocrResultId}
    limit 1
  `;
  return itemRows[0] ?? null;
}

async function createManualVoucherOcrItem(ocrResultId: string, body: Record<string, unknown>) {
  const rawName = String(body.rawName ?? body.productName ?? body.name ?? body.note ?? "").trim();
  const normalizedName = normalizeReceiptProductName(rawName || "手動追加明細");
  const category = String(body.category ?? body.subAccountTitle ?? "").trim();
  const itemRows = await sql`
    with inserted as (
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
        match_status,
        updated_at
      )
      values (
        ${ocrResultId},
        (select coalesce(max(line_index), -1) + 1 from receipt_ocr_items where receipt_ocr_result_id::text = ${ocrResultId}),
        ${rawName || "手動追加明細"},
        ${normalizedName},
        ${normalizeNullableNumber(body.quantity)},
        ${String(body.unit ?? "個").trim().slice(0, 20) || "個"},
        ${normalizeNullableUnitPrice(body.unitPrice ?? body.receiptUnitPrice)},
        ${body.taxRate ? normalizeTaxRate(body.taxRate) : ""},
        ${body.taxMode ? normalizeTaxMode(body.taxMode) : ""},
        ${category},
        ${String(body.accountTitle ?? "").trim().slice(0, 80)},
        ${normalizeNullableMoney(body.amount)},
        'unmatched',
        now()
      )
      returning
        id,
        receipt_ocr_result_id,
        raw_name,
        normalized_name,
        category,
        unit,
        unit_price
    )
    select
      inserted.id::text,
      inserted.raw_name as "rawName",
      inserted.normalized_name as "normalizedName",
      inserted.category,
      inserted.unit,
      inserted.unit_price::float as "unitPrice",
      receipt_ocr_results.vendor_name as "vendorName",
      receipt_ocr_results.supplier_name as "supplierName"
    from inserted
    join receipt_ocr_results on receipt_ocr_results.id = inserted.receipt_ocr_result_id
    limit 1
  `;
  return itemRows[0] ?? null;
}

async function updateReceiptOcrItemForProductLink(
  ocrResultId: string,
  itemId: string,
  body: Record<string, unknown>,
  receiptUnitPrice: number | null
) {
  await sql`
    update receipt_ocr_items
    set
      amount = coalesce(${normalizeNullableMoney(body.amount)}, amount),
      tax_rate = coalesce(${body.taxRate ? normalizeTaxRate(String(body.taxRate)) : null}, tax_rate),
      tax_mode = coalesce(${body.taxMode ? normalizeTaxMode(String(body.taxMode)) : null}, tax_mode),
      quantity = coalesce(${normalizeNullableNumber(body.quantity)}, quantity),
      unit = coalesce(${String(body.unit ?? "").trim().slice(0, 20) || null}, unit),
      unit_price = coalesce(${receiptUnitPrice}, unit_price),
      updated_at = now()
    where id::text = ${itemId}
      and receipt_ocr_result_id::text = ${ocrResultId}
  `;
}

async function setVoucherItemProductIgnored(ocrResultId: string, itemId: string, ignored: boolean) {
  await sql`
    update receipt_ocr_items
    set
      matched_product_id = null,
      match_status = ${ignored ? "ignored" : "unmatched"},
      updated_at = now()
    where id::text = ${itemId}
      and receipt_ocr_result_id::text = ${ocrResultId}
  `;

  await sql`
    delete from product_candidates
    where receipt_ocr_item_id::text = ${itemId}
  `;
}

async function createProductFromVoucherItem(item: Record<string, unknown>, body: Record<string, unknown>, employeeId: string) {
  const name = String(body.productName ?? body.name ?? item.rawName ?? "").trim();
  if (!name) return "";
  const category = String(body.category ?? item.category ?? "食材").trim() || "食材";
  const subcategory = String(body.subcategory ?? "未分類").trim() || "未分類";
  const unit = String(body.unit ?? item.unit ?? "個").trim() || "個";
  const referencePrice = Number(body.referencePrice ?? body.receiptUnitPrice ?? item.unitPrice ?? 0);

  const rows = await sql`
    insert into products (
      name,
      category,
      subcategory,
      unit,
      reference_price,
      brand_scope,
      usage_type,
      japanese_note,
      updated_at
    )
    values (
      ${name},
      ${category},
      ${subcategory},
      ${unit},
      ${Number.isFinite(referencePrice) ? referencePrice : 0},
      ${"unset"},
      ${category === "包材" ? "packaging" : category === "消耗品" || category === "清掃用品" ? "consumable" : "ingredient"},
      ${`[情報未補完] レシート OCR から追加: ${String(item.rawName ?? "")}`},
      now()
    )
    returning id::text
  `;
  return String(rows[0]?.id ?? "");
}

async function linkVoucherItemToProduct(item: Record<string, unknown>, productId: string, employeeId: string, receiptUnitPrice: number | null = null) {
  const rawName = String(item.rawName ?? "").trim();
  const normalizedName = String(item.normalizedName || normalizeReceiptProductName(rawName));
  const supplierName = String(item.supplierName || item.vendorName || "").trim();
  const itemId = String(item.id ?? "").trim();

  await sql`
    insert into product_match_dictionary (
      supplier_name,
      raw_name,
      normalized_name,
      product_id,
      category,
      unit,
      created_by,
      updated_at
    )
    values (
      ${supplierName},
      ${rawName},
      ${normalizedName},
      ${productId},
      ${String(item.category ?? "")},
      ${String(item.unit ?? "個").trim() || "個"},
      ${employeeId},
      now()
    )
    on conflict (supplier_name, normalized_name)
    do update set
      product_id = excluded.product_id,
      category = excluded.category,
      unit = excluded.unit,
      updated_at = now()
  `;

  await sql`
    update receipt_ocr_items
    set matched_product_id = ${productId}, match_status = 'matched', updated_at = now()
    where id::text = ${itemId}
  `;
  await recordReceiptItemPrice(itemId, productId, employeeId, {
    price: receiptUnitPrice ?? undefined,
    unit: String(item.unit ?? "個").trim() || "個"
  });
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
  return lines.map((line, index) => {
    const row = line as Record<string, unknown>;
    return {
      lineNo: index + 1,
      accountTitle: String(row.accountTitle ?? ""),
      subAccountTitle: String(row.subAccountTitle ?? ""),
      amount: Number(row.amount ?? 0),
      taxRate: String(row.taxRate ?? ""),
      taxMode: String(row.taxMode ?? ""),
      taxAmount: Number(row.taxAmount ?? 0),
      quantity: row.quantity === null || row.quantity === undefined ? null : Number(row.quantity),
      unit: String(row.unit ?? "個").trim() || "個",
      unitPrice: row.unitPrice === null || row.unitPrice === undefined ? null : Number(row.unitPrice),
      ocrItemId: String(row.ocrItemId ?? ""),
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

function normalizeNullableNumber(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeAccountingQuantity(value: unknown) {
  const quantity = normalizeNullableNumber(value);
  return quantity && quantity > 0 ? quantity : 1;
}

function normalizeNullableMoney(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function normalizeNullableUnitPrice(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
}

function normalizeTaxRate(value: unknown) {
  const text = String(value ?? "").replace("%", "").trim();
  if (text === "8" || text === "8.0") return "8%";
  if (text === "10" || text === "10.0") return "10%";
  if (text === "非課税" || text === "不課税" || text === "対象外") return text;
  if (text === "0") return "非課税";
  return "";
}

function normalizeTaxMode(value: unknown) {
  const mode = String(value ?? "").trim();
  return mode === "内税" || mode === "外税" || mode === "対象外" ? mode : "不明";
}

function calculateTaxAmount(amount: number, taxRate: string, taxMode: string) {
  const rate = taxRate === "8%" ? 8 : taxRate === "10%" ? 10 : 0;
  if (!rate || amount <= 0) return 0;
  if (taxMode === "外税") return Math.round(amount * rate / 100);
  if (taxMode === "内税") return Math.round(amount * rate / (100 + rate));
  return 0;
}

function calculateAccountingUnitPrice(amount: number, taxRate: string, taxMode: string, quantity: number) {
  if (!Number.isFinite(amount) || !Number.isFinite(quantity) || amount <= 0 || quantity <= 0) return null;
  const rate = taxRate === "8%" ? 8 : taxRate === "10%" ? 10 : 0;
  const taxIncludedAmount = taxMode === "外税" && rate > 0 ? amount * (1 + rate / 100) : amount;
  const unitPrice = taxIncludedAmount / quantity;
  return Number.isFinite(unitPrice) && unitPrice > 0 ? Math.round(unitPrice * 100) / 100 : null;
}

function calculateAccountingTaxIncludedAmount(amount: unknown, taxAmount: unknown, taxMode: unknown) {
  const roundedAmount = Math.round(Number(amount ?? 0));
  const roundedTaxAmount = Math.round(Number(taxAmount ?? 0));
  if (String(taxMode ?? "").trim() === "外税") return roundedAmount + Math.max(0, roundedTaxAmount);
  return roundedAmount;
}

function adjustRowsToReceiptTotals<T extends { voucherId?: unknown; receiptTotal?: unknown; amount?: unknown; taxAmount?: unknown; taxMode?: unknown; lineNo?: unknown }>(
  rows: T[]
) {
  const adjustedRows = rows.map((row) => ({
    ...row,
    taxIncludedAmount: calculateAccountingTaxIncludedAmount(row.amount, row.taxAmount, row.taxMode)
  }));
  const rowsByVoucher = new Map<string, Array<typeof adjustedRows[number]>>();

  for (const row of adjustedRows) {
    const voucherId = String(row.voucherId ?? "");
    if (!voucherId) continue;
    const group = rowsByVoucher.get(voucherId) ?? [];
    group.push(row);
    rowsByVoucher.set(voucherId, group);
  }

  for (const voucherRows of rowsByVoucher.values()) {
    const receiptTotal = Math.round(Number(voucherRows[0]?.receiptTotal ?? 0));
    if (!Number.isFinite(receiptTotal) || receiptTotal <= 0) continue;

    const rowTotal = voucherRows.reduce((sum, row) => sum + row.taxIncludedAmount, 0);
    const difference = receiptTotal - rowTotal;
    if (!difference) continue;

    const targetRow = [...voucherRows].sort((a, b) => Number(b.lineNo ?? 0) - Number(a.lineNo ?? 0))[0];
    if (targetRow) targetRow.taxIncludedAmount += difference;
  }

  return adjustedRows;
}

type AccountingSummaryItem = {
  note?: unknown;
  amount?: unknown;
  taxAmount?: unknown;
  taxMode?: unknown;
  quantity?: unknown;
  lineNo?: unknown;
};

function parseAccountingSummaryItems(value: unknown): AccountingSummaryItem[] {
  if (Array.isArray(value)) return value as AccountingSummaryItem[];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as AccountingSummaryItem[] : [];
  } catch {
    return [];
  }
}

function buildAutomaticAccountingSummaryNote(items: AccountingSummaryItem[]) {
  const rankedItems = items
    .map((item) => ({
      name: normalizeAccountingSummaryItemName(item.note),
      taxIncludedAmount: calculateAccountingTaxIncludedAmount(item.amount, item.taxAmount, item.taxMode),
      quantity: Number(item.quantity ?? 0),
      lineNo: Number(item.lineNo ?? 0)
    }))
    .filter((item) => item.name)
    .sort((a, b) => {
      if (b.taxIncludedAmount !== a.taxIncludedAmount) return b.taxIncludedAmount - a.taxIncludedAmount;
      if (Number.isFinite(b.quantity) && Number.isFinite(a.quantity) && b.quantity !== a.quantity) return b.quantity - a.quantity;
      return a.lineNo - b.lineNo;
    });

  const names: string[] = [];
  for (const item of rankedItems) {
    if (names.includes(item.name)) continue;
    names.push(item.name);
    if (names.length >= 5) break;
  }
  if (!names.length) return null;
  return `${names.join("、")}${names.length > 1 ? "等" : ""}`;
}

function normalizeAccountingSummaryItemName(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/^\s*(?:提案[:：]\s*)?/, "")
    .replace(/\s+/g, " ")
    .replace(/^集計\s*\d+\s*行$/, "")
    .trim();
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

async function findDuplicateVoucherResult(storeId: string, result: ReceiptOcrResult) {
  const purchaseDate = normalizeDuplicateDate(result.purchaseDate);
  const purchaseTime = normalizeDuplicateTime(result.purchaseTime);
  const total = Math.round(Number(result.total ?? 0));
  const tax = Math.round(Number(result.tax ?? 0));
  const merchantKey = normalizeDuplicateMerchant(buildVendorName(result.companyName, result.brandName, result.locationName, result.storeName));
  if (!storeId || !purchaseDate || !merchantKey || !Number.isFinite(total) || total <= 0) return null;

  const rows = await sql`
    select
      id::text,
      receipt_photo_url as "receiptPhotoUrl",
      coalesce(vendor_name, '') as "vendorName",
      coalesce(company_name, '') as "companyName",
      coalesce(brand_name, '') as "brandName",
      coalesce(location_name, '') as "locationName"
    from receipt_ocr_results
    where source_type = 'voucher'
      and store_id::text = ${storeId}
      and status <> 'failed'
      and purchase_date = ${purchaseDate}::date
      and (${purchaseTime || null}::time is null or purchase_time = ${purchaseTime || null}::time)
      and abs(coalesce(total, 0) - ${total}) <= 1
      and abs(coalesce(tax, 0) - ${tax}) <= 1
      and created_at >= now() - interval '1 year'
    order by created_at desc
    limit 8
  `;

  return rows.find((row) => {
    const rowMerchantKey = normalizeDuplicateMerchant(buildVendorName(
      String(row.companyName ?? ""),
      String(row.brandName ?? ""),
      String(row.locationName ?? ""),
      String(row.vendorName ?? "")
    ));
    return rowMerchantKey === merchantKey;
  }) ?? null;
}

function normalizeDuplicateDate(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeDuplicateTime(value: unknown) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeDuplicateMerchant(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[株式会社有限会社㈱()（）・.,，。]/g, "")
    .trim();
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

function buildAccountingSummaryKey(value: Record<string, unknown>) {
  return [
    String(value.accountTitle ?? ""),
    String(value.subAccountTitle ?? ""),
    String(value.taxRate ?? ""),
    String(value.taxMode ?? "")
  ].join("\u001f");
}

function getAccountingSummaryNote(notesValue: unknown, summaryKey: string) {
  let notes = notesValue;
  if (typeof notesValue === "string") {
    try {
      notes = JSON.parse(notesValue);
    } catch {
      notes = {};
    }
  }
  if (!isPlainObject(notes)) return null;
  const note = String((notes as Record<string, unknown>)[summaryKey] ?? "").trim();
  return note ? note : null;
}

function escapeCsvCell(value: unknown) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, "\"\"")}"`;
  return text;
}

function getUsageTypeExportLabel(value: string) {
  if (value === "shiire") return "仕入";
  if (value === "keihi") return "経費";
  return "未分類";
}

function getPaymentTypeExportLabel(value: string) {
  if (value === "reimbursement") return "立替";
  return "会社支払";
}

function getReimbursementExportLabel(value: string) {
  if (value === "pending") return "精算待ち";
  if (value === "paid") return "精算済み";
  if (value === "rejected") return "却下";
  return "-";
}

function extractBlobPathname(photoUrl: string) {
  try {
    const url = photoUrl.startsWith("http") ? new URL(photoUrl) : new URL(photoUrl, "https://foundr1.local");
    return url.searchParams.get("pathname") ?? "";
  } catch {
    return "";
  }
}
