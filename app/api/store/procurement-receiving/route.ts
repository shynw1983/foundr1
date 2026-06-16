import { canAccessStore, getSessionStoreScope, requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

type ReceivingPayload = {
  type?: "batch" | "items";
  batchId?: string;
  itemIds?: string[];
};

function normalizeItemIds(value: unknown) {
  return Array.from(new Set(Array.isArray(value) ? value.map(String).filter(Boolean) : []));
}

export async function GET() {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const scope = await getSessionStoreScope(session);
  const batches = await sql`
    select
      concat('batch:', delivery_batches.id::text) as id,
      'batch' as type,
      delivery_batches.id::text as "batchId",
      purchase_orders.order_no as "orderId",
      stores.id::text as "storeId",
      stores.name as "storeName",
      concat(purchase_orders.order_no, '-', delivery_batches.batch_no) as label,
      delivery_batches.status,
      to_char(delivery_batches.delivered_at at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') as "deliveredLabel",
      to_char(delivery_batches.store_confirmed_at at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') as "confirmedLabel",
      coalesce(json_agg(json_build_object(
        'id', purchase_order_items.id::text,
        'name', coalesce(products.name, purchase_order_items.temporary_product_name, '商品'),
        'requestedQuantity', purchase_order_items.requested_quantity,
        'actualQuantity', purchase_order_items.actual_quantity,
        'unit', coalesce(nullif(purchase_order_items.requested_unit, ''), purchase_order_items.temporary_product_unit, products.unit, ''),
        'note', coalesce(purchase_order_items.procurement_note, purchase_order_items.note, '')
      ) order by coalesce(products.name, purchase_order_items.temporary_product_name, '商品')) filter (where purchase_order_items.id is not null), '[]'::json) as items
    from delivery_batches
    join purchase_orders on purchase_orders.id = delivery_batches.purchase_order_id
    join stores on stores.id = purchase_orders.store_id
    left join delivery_batch_items on delivery_batch_items.delivery_batch_id = delivery_batches.id
    left join purchase_order_items on purchase_order_items.id = delivery_batch_items.purchase_order_item_id
    left join products on products.id = purchase_order_items.product_id
    where delivery_batches.status in ('delivered', 'received')
      and (
        ${scope.allStores}
        or purchase_orders.store_id::text = any(${scope.storeIds})
      )
    group by delivery_batches.id, purchase_orders.order_no, stores.id, stores.name
    order by delivery_batches.delivered_at desc nulls last, delivery_batches.created_at desc
    limit 50
  `;

  const directGroups = await sql`
    select
      concat('items:', purchase_orders.order_no) as id,
      'items' as type,
      null::text as "batchId",
      purchase_orders.order_no as "orderId",
      stores.id::text as "storeId",
      stores.name as "storeName",
      concat(purchase_orders.order_no, '-NET') as label,
      case
        when bool_and(purchase_order_items.status = 'received') then 'received'
        else 'delivered'
      end as status,
      '' as "deliveredLabel",
      to_char(max(purchase_order_items.store_feedback_confirmed_at) at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') as "confirmedLabel",
      coalesce(json_agg(json_build_object(
        'id', purchase_order_items.id::text,
        'name', coalesce(products.name, purchase_order_items.temporary_product_name, '商品'),
        'requestedQuantity', purchase_order_items.requested_quantity,
        'actualQuantity', purchase_order_items.actual_quantity,
        'unit', coalesce(nullif(purchase_order_items.requested_unit, ''), purchase_order_items.temporary_product_unit, products.unit, ''),
        'note', coalesce(purchase_order_items.procurement_note, purchase_order_items.note, '')
      ) order by coalesce(products.name, purchase_order_items.temporary_product_name, '商品')), '[]'::json) as items
    from purchase_order_items
    join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
    join stores on stores.id = purchase_orders.store_id
    left join products on products.id = purchase_order_items.product_id
    left join delivery_batch_items on delivery_batch_items.purchase_order_item_id = purchase_order_items.id
    where delivery_batch_items.purchase_order_item_id is null
      and purchase_order_items.status in ('delivered', 'received')
      and (
        ${scope.allStores}
        or purchase_orders.store_id::text = any(${scope.storeIds})
      )
    group by purchase_orders.order_no, stores.id, stores.name
    order by purchase_orders.order_no desc
    limit 50
  `;

  return Response.json({
    confirmations: [...batches, ...directGroups]
  });
}

export async function PATCH(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as ReceivingPayload;

  if (body.type === "batch") {
    const batchId = String(body.batchId ?? "");
    if (!batchId) return Response.json({ error: "配送バッチが見つかりません。" }, { status: 400 });

    const batchRows = await sql`
      select purchase_orders.store_id::text as "storeId"
      from delivery_batches
      join purchase_orders on purchase_orders.id = delivery_batches.purchase_order_id
      where delivery_batches.id = ${batchId}
      limit 1
    `;
    if (!batchRows[0]) return Response.json({ error: "配送バッチが見つかりません。" }, { status: 404 });
    if (!await canAccessStore(session, batchRows[0].storeId)) {
      return Response.json({ error: "この納品を確認する権限がありません。" }, { status: 403 });
    }

    await sql`
      update delivery_batches
      set
        status = 'received',
        store_confirmed_at = now(),
        store_confirmed_by = ${session.id}
      where id = ${batchId}
        and status = 'delivered'
    `;
    await sql`
      update purchase_order_items
      set status = 'received'
      where id in (
        select purchase_order_item_id
        from delivery_batch_items
        where delivery_batch_id = ${batchId}
      )
    `;

    return Response.json({ ok: true });
  }

  if (body.type === "items") {
    const itemIds = normalizeItemIds(body.itemIds);
    if (itemIds.length === 0) return Response.json({ error: "確認対象がありません。" }, { status: 400 });

    const storeRows = await sql`
      select distinct purchase_orders.store_id::text as "storeId"
      from purchase_order_items
      join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
      where purchase_order_items.id::text = any(${itemIds})
    `;
    if (storeRows.length === 0) return Response.json({ error: "確認対象が見つかりません。" }, { status: 404 });
    for (const row of storeRows) {
      if (!await canAccessStore(session, row.storeId)) {
        return Response.json({ error: "この納品を確認する権限がありません。" }, { status: 403 });
      }
    }

    await sql`
      update purchase_order_items
      set
        status = 'received',
        store_feedback_confirmed_at = coalesce(store_feedback_confirmed_at, now()),
        store_feedback_confirmed_by = coalesce(store_feedback_confirmed_by, ${session.id})
      where id::text = any(${itemIds})
        and status = 'delivered'
    `;

    return Response.json({ ok: true });
  }

  return Response.json({ error: "確認種別が正しくありません。" }, { status: 400 });
}
