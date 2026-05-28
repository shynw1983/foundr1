import { put } from "@vercel/blob";
import { canAccessStore, requireWritableOpsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

const maxReceiptSizeBytes = 4 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await requireWritableOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const formData = await request.formData();
  const itemId = String(formData.get("itemId") ?? "").trim();
  const file = formData.get("receipt");

  if (!itemId) {
    return Response.json({ error: "itemId is required" }, { status: 400 });
  }

  const itemRows = await sql`
    select
      purchase_orders.store_id::text as "storeId",
      purchase_orders.order_no as "orderNo",
      products.name as "productName"
    from purchase_order_items
    join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
    join products on products.id = purchase_order_items.product_id
    where purchase_order_items.id = ${itemId}
    limit 1
  `;
  const item = itemRows[0];

  if (!item) {
    return Response.json({ error: "発注項目が見つかりません。" }, { status: 404 });
  }

  if (!await canAccessStore(session, item.storeId)) {
    return Response.json({ error: "この発注項目を操作する権限がありません。" }, { status: 403 });
  }

  try {
    const receiptUrl = await uploadReceiptIfNeeded(file, `${item.orderNo}-${item.productName}`);

    await sql`
      update purchase_order_items
      set receipt_photo_url = ${receiptUrl}
      where id = ${itemId}
    `;

    await sql`
      update purchase_actuals
      set receipt_photo_url = ${receiptUrl}
      where id = (
        select id
        from purchase_actuals
        where purchase_order_item_id = ${itemId}
        order by recorded_at desc
        limit 1
      )
    `;

    return Response.json({ ok: true, receiptUrl });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "小票写真を保存できませんでした。" },
      { status: 400 }
    );
  }
}

async function uploadReceiptIfNeeded(file: FormDataEntryValue | null, name: string) {
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("小票写真を選択してください。");
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("画像ファイルを選択してください。");
  }

  if (file.size > maxReceiptSizeBytes) {
    throw new Error("小票写真は4MB以下にしてください。");
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
