import { NextResponse } from "next/server";
import { getSessionStoreScope, requireOpsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";

type ReportRow = {
  id: string;
  source: "history" | "current";
  orderId: string;
  itemId: string;
  product: string;
  store: string;
  type: "price" | "quantity" | "note" | "unavailable" | "other";
  status: "open" | "resolved";
  message: string;
  resolutionNote: string;
  createdLabel: string;
  resolvedLabel: string;
  resolvedBy: string;
};

export async function GET() {
  const session = await requireOpsSession();
  if (!session) return NextResponse.json({ error: "権限がありません。" }, { status: 403 });

  const scope = await getSessionStoreScope(session);
  const [historyRows, priceRows, quantityRows, noteRows] = await Promise.all([
    sql`
      select
        purchase_exceptions.id::text as id,
        'history' as source,
        purchase_orders.order_no as "orderId",
        coalesce(purchase_order_items.id::text, '') as "itemId",
        coalesce(products.name, '商品未設定') as product,
        stores.name as store,
        case
          when purchase_exceptions.exception_type = 'price' then 'price'
          when purchase_exceptions.exception_type = 'quantity' then 'quantity'
          when purchase_exceptions.exception_type = 'note' then 'note'
          when purchase_exceptions.exception_type = 'unavailable' then 'unavailable'
          else 'other'
        end as type,
        case when purchase_exceptions.status = 'resolved' then 'resolved' else 'open' end as status,
        purchase_exceptions.message,
        coalesce(purchase_exceptions.resolution_note, '') as "resolutionNote",
        to_char(purchase_exceptions.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "createdLabel",
        coalesce(to_char(purchase_exceptions.resolved_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI'), '') as "resolvedLabel",
        coalesce(employees.name, '') as "resolvedBy"
      from purchase_exceptions
      join purchase_orders on purchase_orders.id = purchase_exceptions.purchase_order_id
      join stores on stores.id = purchase_orders.store_id
      left join purchase_order_items on purchase_order_items.id = purchase_exceptions.purchase_order_item_id
      left join products on products.id = purchase_order_items.product_id
      left join employees on employees.id = purchase_exceptions.resolved_by
      where (${scope.allStores} or purchase_orders.store_id::text = any(${scope.storeIds}))
    `,
    sql`
      select
        concat(purchase_order_items.id::text, '-price-current') as id,
        'current' as source,
        purchase_orders.order_no as "orderId",
        purchase_order_items.id::text as "itemId",
        products.name as product,
        stores.name as store,
        'price' as type,
        'open' as status,
        concat(
          '実際 ¥',
          trim(to_char(coalesce(purchase_order_items.actual_price, purchase_actuals.actual_price), 'FM999,999,999')),
          ' / 基準 ¥',
          trim(to_char(products.reference_price, 'FM999,999,999')),
          ' (',
          case when coalesce(purchase_order_items.actual_price, purchase_actuals.actual_price) > products.reference_price then '+' else '' end,
          round(((coalesce(purchase_order_items.actual_price, purchase_actuals.actual_price) - products.reference_price) / products.reference_price) * 100, 1),
          '%)'
        ) as message,
        '' as "resolutionNote",
        to_char(purchase_orders.updated_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "createdLabel",
        '' as "resolvedLabel",
        '' as "resolvedBy"
      from purchase_order_items
      join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
      join stores on stores.id = purchase_orders.store_id
      join products on products.id = purchase_order_items.product_id
      left join lateral (
        select purchase_actuals.actual_price
        from purchase_actuals
        where purchase_actuals.purchase_order_item_id = purchase_order_items.id
        order by purchase_actuals.recorded_at desc
        limit 1
      ) purchase_actuals on true
      where (${scope.allStores} or purchase_orders.store_id::text = any(${scope.storeIds}))
        and coalesce(purchase_order_items.actual_price, purchase_actuals.actual_price) > 0
        and products.reference_price > 0
        and coalesce(purchase_order_items.actual_price, purchase_actuals.actual_price) <> products.reference_price
        and not exists (
          select 1
          from purchase_exceptions
          where purchase_exceptions.purchase_order_item_id = purchase_order_items.id
            and purchase_exceptions.exception_type = 'price'
            and purchase_exceptions.status = 'resolved'
        )
    `,
    sql`
      select
        concat(purchase_order_items.id::text, '-quantity-current') as id,
        'current' as source,
        purchase_orders.order_no as "orderId",
        purchase_order_items.id::text as "itemId",
        products.name as product,
        stores.name as store,
        'quantity' as type,
        'open' as status,
        concat(
          '依頼 ',
          trim(to_char(purchase_order_items.requested_quantity, 'FM999,999,999.##')),
          ' ',
          purchase_order_items.requested_unit,
          ' / 実数 ',
          trim(to_char(coalesce(purchase_order_items.actual_quantity, purchase_actuals.actual_quantity), 'FM999,999,999.##')),
          ' ',
          purchase_order_items.requested_unit
        ) as message,
        '' as "resolutionNote",
        to_char(purchase_orders.updated_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "createdLabel",
        '' as "resolvedLabel",
        '' as "resolvedBy"
      from purchase_order_items
      join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
      join stores on stores.id = purchase_orders.store_id
      join products on products.id = purchase_order_items.product_id
      left join lateral (
        select purchase_actuals.actual_quantity
        from purchase_actuals
        where purchase_actuals.purchase_order_item_id = purchase_order_items.id
        order by purchase_actuals.recorded_at desc
        limit 1
      ) purchase_actuals on true
      where (${scope.allStores} or purchase_orders.store_id::text = any(${scope.storeIds}))
        and coalesce(purchase_order_items.actual_quantity, purchase_actuals.actual_quantity) is not null
        and coalesce(purchase_order_items.actual_quantity, purchase_actuals.actual_quantity) <> purchase_order_items.requested_quantity
        and not exists (
          select 1
          from purchase_exceptions
          where purchase_exceptions.purchase_order_item_id = purchase_order_items.id
            and purchase_exceptions.exception_type = 'quantity'
            and purchase_exceptions.status = 'resolved'
        )
    `,
    sql`
      select
        concat(purchase_order_items.id::text, '-note-current') as id,
        'current' as source,
        purchase_orders.order_no as "orderId",
        purchase_order_items.id::text as "itemId",
        products.name as product,
        stores.name as store,
        'note' as type,
        'open' as status,
        purchase_order_items.note as message,
        '' as "resolutionNote",
        to_char(purchase_orders.updated_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "createdLabel",
        '' as "resolvedLabel",
        '' as "resolvedBy"
      from purchase_order_items
      join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
      join stores on stores.id = purchase_orders.store_id
      join products on products.id = purchase_order_items.product_id
      where (${scope.allStores} or purchase_orders.store_id::text = any(${scope.storeIds}))
        and coalesce(purchase_order_items.note, '') <> ''
        and purchase_order_items.status <> 'unavailable'
        and purchase_order_items.store_feedback_confirmed_at is null
    `
  ]);

  const reports = [...historyRows, ...priceRows, ...quantityRows, ...noteRows]
    .map((row) => row as ReportRow)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return b.createdLabel.localeCompare(a.createdLabel);
    });

  return NextResponse.json({ reports });
}
