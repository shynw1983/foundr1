import { sql } from "../../../../lib/db";

export async function POST(request: Request) {
  const body = await request.json() as {
    orderId?: string;
    itemIds?: string[];
  };

  if (!body.orderId || !body.itemIds || body.itemIds.length === 0) {
    return Response.json({ error: "orderId and itemIds are required" }, { status: 400 });
  }

  const orders = await sql`
    select id
    from purchase_orders
    where order_no = ${body.orderId}
    limit 1
  `;
  const purchaseOrderId = orders[0]?.id;

  if (!purchaseOrderId) {
    return Response.json({ error: "purchase order was not found" }, { status: 404 });
  }

  const batchRows = await sql`
    insert into delivery_batches (
      purchase_order_id,
      batch_no,
      status
    )
    values (
      ${purchaseOrderId},
      coalesce((
        select max(batch_no) + 1
        from delivery_batches
        where purchase_order_id = ${purchaseOrderId}
      ), 1),
      'in_delivery'
    )
    returning
      id::text,
      batch_no as "batchNo",
      status,
      to_char(created_at at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') as "createdLabel"
  `;
  const batch = batchRows[0];

  for (const itemId of body.itemIds) {
    await sql`
      insert into delivery_batch_items (
        delivery_batch_id,
        purchase_order_item_id
      )
      values (${batch.id}, ${itemId})
      on conflict (purchase_order_item_id)
      do update set delivery_batch_id = excluded.delivery_batch_id
    `;
  }

  for (const itemId of body.itemIds) {
    await sql`
      update purchase_order_items
      set status = 'in_delivery'
      where id = ${itemId}
    `;
  }

  return Response.json({
    id: batch.id,
    orderId: body.orderId,
    itemIds: body.itemIds,
    batchNo: batch.batchNo,
    status: batch.status,
    createdLabel: batch.createdLabel
  });
}

export async function PATCH(request: Request) {
  const body = await request.json() as {
    batchId?: string;
    status?: "delivered";
  };

  if (!body.batchId || body.status !== "delivered") {
    return Response.json({ error: "batchId and delivered status are required" }, { status: 400 });
  }

  await sql`
    update delivery_batches
    set
      status = 'delivered',
      delivered_at = now()
    where id = ${body.batchId}
  `;

  await sql`
    update purchase_order_items
    set status = 'delivered'
    where id in (
      select purchase_order_item_id
      from delivery_batch_items
      where delivery_batch_id = ${body.batchId}
    )
  `;

  return Response.json({ ok: true });
}
