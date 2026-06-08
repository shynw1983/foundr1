import { put } from "@vercel/blob";
import { canAccessStore, getSessionStoreScope, requireOsSession, requireWritableOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { recordExternalServiceUsage } from "../../../../lib/external-service-usage";
import { analyzeReceiptImage, saveReceiptOcrResult } from "../../../../lib/receipt-ocr";
import { validateImageUpload } from "../../../../lib/upload-security";

const maxReceiptSizeBytes = 4 * 1024 * 1024;
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
      coalesce(to_char(expense_receipts.purchase_date, 'YYYY-MM-DD'), '') as "purchaseDate",
      expense_receipts.category,
      expense_receipts.subtotal::float,
      expense_receipts.tax::float,
      expense_receipts.total::float,
      expense_receipts.note,
      expense_receipts.status,
      coalesce(to_char(expense_receipts.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI'), '') as "createdLabel"
    from expense_receipts
    where expense_receipts.store_id::text = ${storeId}
    order by expense_receipts.created_at desc
    limit 50
  `;

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
      purchaseDate: String(row.purchaseDate ?? ""),
      category: String(row.category ?? "misc"),
      subtotal: Number(row.subtotal ?? 0),
      tax: Number(row.tax ?? 0),
      total: Number(row.total ?? 0),
      note: String(row.note ?? ""),
      status: String(row.status ?? "draft"),
      createdLabel: String(row.createdLabel ?? "")
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
    let purchaseDate = "";
    let subtotal: number | null = null;
    let tax: number | null = null;
    let total: number | null = null;

    try {
      const analyzed = await analyzeReceiptImage(file);
      vendorName = analyzed.result.storeName;
      purchaseDate = analyzed.result.purchaseDate;
      subtotal = analyzed.result.subtotal;
      tax = analyzed.result.tax;
      total = analyzed.result.total;
      ocrResultId = await saveReceiptOcrResult({
        sourceType: "expense",
        storeId,
        supplierName: vendorName,
        receiptPhotoUrl: receiptUrl
      }, analyzed.result, analyzed.model, session);
    } catch (error) {
      ocrError = error instanceof Error ? error.message : "レシート OCR に失敗しました。";
      ocrResultId = await saveReceiptOcrResult({
        sourceType: "expense",
        storeId,
        receiptPhotoUrl: receiptUrl
      }, null, process.env.OPENAI_RECEIPT_OCR_MODEL || "", session, ocrError);
    }

    const rows = await sql`
      insert into expense_receipts (
        store_id,
        receipt_photo_url,
        receipt_ocr_result_id,
        vendor_name,
        purchase_date,
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
        ${purchaseDate || null},
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

async function uploadExpenseReceipt(file: File, storeId: string) {
  const extension = validateImageUpload(file, maxReceiptSizeBytes, "レシート写真");

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
