import { requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const { id } = await context.params;
  const productId = String(id ?? "").trim();
  if (!productId) return Response.json({ error: "商品を指定してください。" }, { status: 400 });

  const productRows = await sql`
    select id::text, name, reference_price::float as "referencePrice", unit
    from products
    where id::text = ${productId}
    limit 1
  `;
  if (!productRows.length) return Response.json({ error: "商品が見つかりません。" }, { status: 404 });

  const rows = await sql`
    select
      price_records.id::text,
      price_records.price::float,
      price_records.unit,
      price_records.source,
      price_records.receipt_note as "receiptNote",
      price_records.recorded_at as "recordedAt",
      suppliers.name as "supplierName",
      coalesce(receipt_ocr_results.purchase_date::text, '') as "purchaseDate",
      coalesce(receipt_ocr_results.vendor_name, receipt_ocr_results.supplier_name, suppliers.name, '') as "vendorName"
    from price_records
    left join suppliers on suppliers.id = price_records.supplier_id
    left join receipt_ocr_items
      on price_records.source = 'receipt_ocr'
      and receipt_ocr_items.id::text = price_records.receipt_note
    left join receipt_ocr_results on receipt_ocr_results.id = receipt_ocr_items.receipt_ocr_result_id
    where price_records.product_id::text = ${productId}
      and price_records.price > 0
    order by coalesce(receipt_ocr_results.purchase_date::timestamptz, price_records.recorded_at) desc, price_records.recorded_at desc
    limit 30
  `;

  return Response.json({
    product: productRows[0],
    records: rows.map((row) => ({
      id: String(row.id ?? ""),
      price: Number(row.price ?? 0),
      unit: String(row.unit ?? ""),
      source: String(row.source ?? ""),
      receiptNote: String(row.receiptNote ?? ""),
      recordedAt: String(row.recordedAt ?? ""),
      purchaseDate: String(row.purchaseDate ?? ""),
      supplierName: String(row.supplierName ?? ""),
      vendorName: String(row.vendorName ?? "")
    }))
  });
}
