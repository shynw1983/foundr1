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
        const analyzed = await analyzeReceiptImage(file);
        const supplierName = buildVendorName(analyzed.result.companyName, analyzed.result.brandName, analyzed.result.locationName, analyzed.result.storeName);
        ocrResultId = await saveReceiptOcrResult({
          sourceType: "voucher",
          storeId,
          supplierName,
          receiptPhotoUrl: receiptUrl,
          uploadedFileName: file.name || "",
          usageType,
          paymentType,
          createProductCandidates: usageType === "shiire"
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
    id?: string;
    usageType?: string;
    paymentType?: string;
    reimbursementStatus?: string;
  };
  const id = String(body.id ?? "").trim();
  if (!id) return Response.json({ error: "証憑IDがありません。" }, { status: 400 });

  const rows = await sql`
    select
      id::text,
      store_id::text as "storeId",
      created_by::text as "createdBy",
      usage_type as "usageType"
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

  await sql`
    update receipt_ocr_results
    set
      usage_type = ${nextUsageType},
      payment_type = ${nextPaymentType},
      reimbursement_status = ${nextReimbursementStatus},
      updated_at = now()
    where id::text = ${id}
  `;

  if (nextUsageType === "shiire" && String(voucher.usageType ?? "") !== "shiire") {
    await createProductCandidatesForOcrResult(id, session);
  }

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
    itemCount: Number(row.itemCount ?? 0),
    createdByName: String(row.createdByName ?? ""),
    createdLabel: String(row.createdLabel ?? ""),
    canDelete: String(row.sourceType ?? "") === "voucher"
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

function isPdfFile(file: File) {
  return file.type.toLowerCase() === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
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
