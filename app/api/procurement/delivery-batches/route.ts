import { canAccessStore, requireWritableOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

const additionalPurchaseNotePrefix = "追加購入";

export async function POST(request: Request) {
  const session = await requireWritableOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json() as {
    orderId?: string;
    itemIds?: string[];
  };

  if (!body.orderId || !Array.isArray(body.itemIds) || body.itemIds.length === 0) {
    return Response.json({ error: "orderId and itemIds are required" }, { status: 400 });
  }

  const orders = await sql`
    select id, store_id::text as "storeId"
    from purchase_orders
    where order_no = ${body.orderId}
    limit 1
  `;
  const purchaseOrderId = orders[0]?.id;

  if (!purchaseOrderId) {
    return Response.json({ error: "purchase order was not found" }, { status: 404 });
  }

  if (!await canAccessStore(session, orders[0]?.storeId)) {
    return Response.json({ error: "この依頼を操作する権限がありません。" }, { status: 403 });
  }

  const uniqueItemIds = Array.from(new Set(body.itemIds.map(String)));
  const itemCountRows = await sql`
    select count(*)::int as count
    from purchase_order_items
    where purchase_order_id = ${purchaseOrderId}
      and id::text = any(${uniqueItemIds})
  `;

  if (Number(itemCountRows[0]?.count ?? 0) !== uniqueItemIds.length) {
    return Response.json({ error: "この依頼に含まれない項目があります。" }, { status: 400 });
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

  for (const itemId of uniqueItemIds) {
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

  for (const itemId of uniqueItemIds) {
    await sql`
      update purchase_order_items
      set status = 'in_delivery'
      where id = ${itemId}
    `;
  }

  return Response.json({
    id: batch.id,
    orderId: body.orderId,
    itemIds: uniqueItemIds,
    batchNo: batch.batchNo,
    status: batch.status,
    createdLabel: batch.createdLabel
  });
}

export async function PATCH(request: Request) {
  const session = await requireWritableOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json() as {
    batchId?: string;
    status?: "delivered" | "received";
  };

  if (!body.batchId || !["delivered", "received"].includes(body.status ?? "")) {
    return Response.json({ error: "batchId and valid status are required" }, { status: 400 });
  }

  const batchRows = await sql`
    select purchase_orders.store_id::text as "storeId"
    from delivery_batches
    join purchase_orders on purchase_orders.id = delivery_batches.purchase_order_id
    where delivery_batches.id = ${body.batchId}
    limit 1
  `;

  if (!batchRows[0]) {
    return Response.json({ error: "配送バッチが見つかりません。" }, { status: 404 });
  }

  if (!await canAccessStore(session, batchRows[0].storeId)) {
    return Response.json({ error: "この配送バッチを操作する権限がありません。" }, { status: 403 });
  }

  if (body.status === "received") {
    await sql`
      update delivery_batches
      set
        status = 'received',
        store_confirmed_at = now(),
        store_confirmed_by = ${session.id}
      where id = ${body.batchId}
        and status = 'delivered'
    `;

    await sql`
      update purchase_order_items
      set status = 'received'
      where id in (
        select purchase_order_item_id
        from delivery_batch_items
        where delivery_batch_id = ${body.batchId}
      )
    `;

    return Response.json({ ok: true });
  }

  const deliveredRows = await sql`
    update delivery_batches
    set
      status = 'delivered',
      delivered_at = now()
    where id = ${body.batchId}
      and status = 'in_delivery'
    returning purchase_order_id as "purchaseOrderId"
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

  if (deliveredRows[0]?.purchaseOrderId) {
    await sql`
      insert into os_notifications (
        recipient_employee_id,
        notification_type,
        title,
        message,
        href
      )
      select distinct
        employees.id,
        'store_confirmation_required',
        '店舗確認が必要です',
        concat(stores.name, ' に ', item_counts.item_count, ' 件の納品済み商品があります。'),
        concat('/os/orders#order-', purchase_orders.order_no)
      from purchase_orders
      join stores on stores.id = purchase_orders.store_id
      cross join lateral (
        select count(*)::int as item_count
        from delivery_batch_items
        join purchase_order_items on purchase_order_items.id = delivery_batch_items.purchase_order_item_id
        where delivery_batch_items.delivery_batch_id = ${body.batchId}
          and coalesce(purchase_order_items.procurement_note, '') not like ${`${additionalPurchaseNotePrefix}%`}
      ) item_counts
      join employees on employees.status = 'active'
      left join employee_scopes
        on employee_scopes.employee_id = employees.id
        and employee_scopes.scope_type = 'store'
      where purchase_orders.id = ${deliveredRows[0].purchaseOrderId}
        and item_counts.item_count > 0
        and (
          employees.role in ('owner', 'manager')
          or employee_scopes.store_id = purchase_orders.store_id
        )
    `;
  }

  return Response.json({ ok: true });
}
