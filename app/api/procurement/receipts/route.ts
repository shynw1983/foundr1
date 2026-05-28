import { put } from "@vercel/blob";
import { canAccessStore, requireWritableOpsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

const maxReceiptSizeBytes = 4 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await requireWritableOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const formData = await request.formData();
  const orderId = String(formData.get("orderId") ?? "").trim();
  const supplierName = String(formData.get("supplier") ?? "").trim();
  const file = formData.get("receipt");

  if (!orderId || !supplierName) {
    return Response.json({ error: "orderId and supplier are required" }, { status: 400 });
  }

  const orderRows = await sql`
    select
      purchase_orders.id,
      purchase_orders.store_id::text as "storeId",
      purchase_orders.order_no as "orderNo"
    from purchase_orders
    where purchase_orders.order_no = ${orderId}
    limit 1
  `;
  const order = orderRows[0];

  if (!order) {
    return Response.json({ error: "発注依頼が見つかりません。" }, { status: 404 });
  }

  if (!await canAccessStore(session, order.storeId)) {
    return Response.json({ error: "この発注依頼を操作する権限がありません。" }, { status: 403 });
  }

  try {
    const receiptUrl = await uploadReceiptIfNeeded(file, `${order.orderNo}-${supplierName}`);
    const supplierRows = await sql`
      select id
      from suppliers
      where name = ${supplierName}
      limit 1
    `;

    await sql`
      insert into purchase_order_supplier_fulfillments (
        purchase_order_id,
        supplier_id,
        supplier_name,
        receipt_photo_url,
        updated_at
      )
      values (
        ${order.id},
        ${supplierRows[0]?.id ?? null},
        ${supplierName},
        ${receiptUrl},
        now()
      )
      on conflict (purchase_order_id, supplier_name)
      do update set
        supplier_id = excluded.supplier_id,
        receipt_photo_url = excluded.receipt_photo_url,
        updated_at = now()
    `;

    return Response.json({ ok: true, receiptUrl });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "レシート写真を保存できませんでした。" },
      { status: 400 }
    );
  }
}

async function uploadReceiptIfNeeded(file: FormDataEntryValue | null, name: string) {
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("レシート写真を選択してください。");
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("画像ファイルを選択してください。");
  }

  if (file.size > maxReceiptSizeBytes) {
    throw new Error("レシート写真は4MB以下にしてください。");
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Vercel Blob が未設定です。BLOB_READ_WRITE_TOKEN を接続してください。");
  }

  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const safeName = name.replace(/[^\w.-]+/g, "-").toLowerCase() || "receipt";
  const blob = await put(`purchase-receipts/${safeName}-${Date.now()}.${extension}`, file, {
    access: "private"
  });

  return `/api/products/photo/view?pathname=${encodeURIComponent(blob.pathname)}&v=${Date.now()}`;
}
