import { canAccessStore, requireWritableOpsSession } from "../../../../lib/api-auth";
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
    supplier?: string;
    deliveryStatus?: "pending" | "in_delivery" | "delivered" | "received";
    clearActualPrice?: boolean;
  };

  if (!body.itemId) {
    return Response.json({ error: "itemId is required" }, { status: 400 });
  }

  const itemRows = await sql`
    select purchase_orders.store_id::text as "storeId"
    from purchase_order_items
    join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
    where purchase_order_items.id = ${body.itemId}
    limit 1
  `;

  if (!itemRows[0]) {
    return Response.json({ error: "発注項目が見つかりません。" }, { status: 404 });
  }

  if (!await canAccessStore(session, itemRows[0].storeId)) {
    return Response.json({ error: "この発注項目を操作する権限がありません。" }, { status: 403 });
  }

  const actualQuantity = Number.isFinite(body.actualQuantity) ? body.actualQuantity : null;
  const hasActualPrice = body.actualPrice !== undefined || body.clearActualPrice === true;
  const actualPriceText = String(body.actualPrice ?? "").trim();
  const normalizedActualPrice = actualPriceText.replace(/[¥￥,\s]/g, "");
  const actualPrice = normalizedActualPrice ? Number(normalizedActualPrice) : null;
  const hasNote = body.note !== undefined;
  const note = body.note ?? "";
  const shouldClearPriceException = body.purchased !== undefined || hasActualPrice || hasNote;
  const deliveryStatus = ["in_delivery", "delivered", "received"].includes(body.deliveryStatus ?? "")
    ? body.deliveryStatus
    : null;
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
    return Response.json({ error: "発注先が見つかりません。" }, { status: 400 });
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
        when ${deliveryStatus}::text is not null then ${deliveryStatus}
        when status in ('in_delivery', 'delivered', 'received') then status
        when ${body.purchased === true} then 'purchased'
        else status
      end,
      actual_quantity = coalesce(${actualQuantity}, actual_quantity),
      actual_price = case
        when ${hasActualPrice} then ${body.clearActualPrice === true ? null : Number.isFinite(actualPrice) ? actualPrice : null}
        else actual_price
      end,
      procurement_note = case
        when ${hasNote} then ${note}
        else procurement_note
      end,
      price_exception_note = case
        when ${shouldClearPriceException} then ''
        else price_exception_note
      end,
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
        false,
        ${note}
      from purchase_order_items
      where purchase_order_items.id = ${body.itemId}
    `;

    if (Number.isFinite(actualPrice)) {
      await sql`
        delete from price_records
        where source = 'purchase_actual'
          and receipt_note = ${body.itemId}
      `;

      await sql`
        insert into price_records (
          product_id,
          supplier_id,
          price,
          unit,
          source,
          receipt_note,
          recorded_by
        )
        select
          purchase_order_items.product_id,
          coalesce(${supplierId}, purchase_order_items.selected_supplier_id),
          ${actualPrice},
          purchase_order_items.requested_unit,
          'purchase_actual',
          ${body.itemId},
          ${session.id}
        from purchase_order_items
        where purchase_order_items.id = ${body.itemId}
      `;
    }
  }

  return Response.json({ ok: true });
}
