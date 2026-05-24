import { requireWritableOpsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

export async function PATCH(request: Request) {
  const session = await requireWritableOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json() as {
    itemId?: string;
    purchased?: boolean;
    actualQuantity?: number;
    actualPrice?: string;
    note?: string;
    priceExceptionNote?: string;
    supplier?: string;
  };

  if (!body.itemId) {
    return Response.json({ error: "itemId is required" }, { status: 400 });
  }

  const actualQuantity = Number.isFinite(body.actualQuantity) ? body.actualQuantity : null;
  const actualPriceText = String(body.actualPrice ?? "").trim();
  const normalizedActualPrice = actualPriceText.replace(/[¥￥,\s]/g, "");
  const actualPrice = normalizedActualPrice ? Number(normalizedActualPrice) : null;
  const note = body.note ?? "";
  const priceExceptionNote = body.priceExceptionNote ?? "";
  const supplierName = String(body.supplier ?? "").trim();
  const supplierRows = supplierName
    ? await sql`
        select id
        from suppliers
        where name = ${supplierName}
        limit 1
      `
    : [];
  const supplierId = supplierRows[0]?.id ?? null;

  if (supplierName && !supplierId) {
    return Response.json({ error: "仕入れ先が見つかりません。" }, { status: 400 });
  }

  if (body.purchased === false) {
    await sql`
      delete from delivery_batch_items
      where purchase_order_item_id = ${body.itemId}
    `;
  }

  await sql`
    update purchase_order_items
    set
      status = case
        when ${body.purchased === false} then 'requested'
        when status in ('in_delivery', 'delivered') then status
        when ${body.purchased === true} then 'purchased'
        else status
      end,
      actual_quantity = coalesce(${actualQuantity}, actual_quantity),
      actual_price = ${Number.isFinite(actualPrice) ? actualPrice : null},
      procurement_note = ${note},
      price_exception_note = ${priceExceptionNote},
      selected_supplier_id = coalesce(${supplierId}, selected_supplier_id)
    where id = ${body.itemId}
  `;

  if (body.purchased) {
    await sql`
      delete from purchase_actuals
      where purchase_order_item_id = ${body.itemId}
    `;

    await sql`
      insert into purchase_actuals (
        purchase_order_item_id,
        supplier_id,
        actual_quantity,
        actual_unit,
        actual_price,
        price_is_exception,
        note
      )
      select
        purchase_order_items.id,
        coalesce(${supplierId}, purchase_order_items.selected_supplier_id),
        coalesce(${actualQuantity}, purchase_order_items.requested_quantity),
        purchase_order_items.requested_unit,
        ${Number.isFinite(actualPrice) ? actualPrice : null},
        ${priceExceptionNote.length > 0},
        ${priceExceptionNote || note}
      from purchase_order_items
      where purchase_order_items.id = ${body.itemId}
    `;
  }

  return Response.json({ ok: true });
}
