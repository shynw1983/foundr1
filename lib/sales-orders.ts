import { sql } from "./db";

export async function syncWebReservationToSalesOrder(orderId: string) {
  const orderRows = await sql`
    select
      id,
      brand_id,
      store_id,
      order_source,
      pickup_code,
      status,
      payment_status,
      square_order_id,
      square_payment_id,
      square_receipt_url,
      pickup_date,
      pickup_time,
      amount,
      currency,
      customer_summary,
      paid_at,
      preparing_at,
      ready_at,
      completed_at,
      cancelled_at,
      created_at,
      updated_at
    from store_customer_orders
    where id = ${orderId}
    limit 1
  `;
  const order = orderRows[0] as any;
  if (!order) return null;

  const orderedAt = order.created_at ?? new Date();
  const salesOrderRows = await sql`
    insert into sales_orders (
      source_order_id,
      brand_id,
      store_id,
      channel,
      source_platform,
      order_no,
      pickup_code,
      status,
      payment_status,
      ordered_at,
      paid_at,
      preparing_at,
      ready_at,
      completed_at,
      cancelled_at,
      subtotal,
      total,
      currency,
      payment_provider,
      payment_reference,
      receipt_url,
      metadata,
      updated_at
    )
    values (
      ${order.id},
      ${order.brand_id},
      ${order.store_id},
      'web_reservation',
      ${order.order_source || "nanacha_web"},
      ${order.pickup_code},
      ${order.pickup_code},
      ${order.status},
      ${order.payment_status},
      ${orderedAt},
      ${order.paid_at},
      ${order.preparing_at},
      ${order.ready_at},
      ${order.completed_at},
      ${order.cancelled_at},
      ${order.amount},
      ${order.amount},
      ${order.currency || "JPY"},
      'square',
      ${order.square_payment_id || order.square_order_id || null},
      ${order.square_receipt_url || null},
      ${JSON.stringify({
        pickupDate: order.pickup_date,
        pickupTime: order.pickup_time,
        squareOrderId: order.square_order_id,
        squarePaymentId: order.square_payment_id,
        customerSummary: order.customer_summary ?? {}
      })},
      now()
    )
    on conflict (source_order_id)
    do update set
      brand_id = excluded.brand_id,
      store_id = excluded.store_id,
      source_platform = excluded.source_platform,
      order_no = excluded.order_no,
      pickup_code = excluded.pickup_code,
      status = excluded.status,
      payment_status = excluded.payment_status,
      paid_at = excluded.paid_at,
      preparing_at = excluded.preparing_at,
      ready_at = excluded.ready_at,
      completed_at = excluded.completed_at,
      cancelled_at = excluded.cancelled_at,
      subtotal = excluded.subtotal,
      total = excluded.total,
      currency = excluded.currency,
      payment_reference = excluded.payment_reference,
      receipt_url = excluded.receipt_url,
      metadata = excluded.metadata,
      updated_at = now()
    returning id::text
  `;
  const salesOrderId = salesOrderRows[0]?.id as string | undefined;
  if (!salesOrderId) return null;

  const itemRows = await sql`
    select
      store_customer_order_items.id,
      store_customer_order_items.menu_catalog_item_id,
      store_customer_order_items.item_name,
      coalesce(menu_catalog_items.category, '') as category,
      store_customer_order_items.size_key,
      store_customer_order_items.size_label,
      store_customer_order_items.temperature,
      store_customer_order_items.sweetness,
      store_customer_order_items.ice,
      store_customer_order_items.option_key,
      store_customer_order_items.option_label,
      store_customer_order_items.topping_keys,
      store_customer_order_items.topping_labels,
      store_customer_order_items.amount,
      store_customer_order_items.sort_order
    from store_customer_order_items
    left join menu_catalog_items on menu_catalog_items.id = store_customer_order_items.menu_catalog_item_id
    where store_customer_order_items.order_id = ${orderId}
    order by store_customer_order_items.sort_order
  `;

  for (const item of itemRows as any[]) {
    await sql`
      insert into sales_order_items (
        sales_order_id,
        source_item_id,
        menu_catalog_item_id,
        product_name_snapshot,
        category_snapshot,
        quantity,
        unit_price,
        option_total,
        line_total,
        modifiers_json,
        sort_order
      )
      values (
        ${salesOrderId},
        ${item.id},
        ${item.menu_catalog_item_id},
        ${item.item_name},
        ${item.category || null},
        1,
        ${item.amount},
        0,
        ${item.amount},
        ${JSON.stringify({
          size: { key: item.size_key, label: item.size_label },
          temperature: item.temperature,
          sweetness: item.sweetness,
          ice: item.ice,
          option: { key: item.option_key, label: item.option_label },
          toppings: { keys: item.topping_keys ?? [], labels: item.topping_labels ?? [] }
        })},
        ${item.sort_order ?? 0}
      )
      on conflict (source_item_id)
      do update set
        sales_order_id = excluded.sales_order_id,
        menu_catalog_item_id = excluded.menu_catalog_item_id,
        product_name_snapshot = excluded.product_name_snapshot,
        category_snapshot = excluded.category_snapshot,
        unit_price = excluded.unit_price,
        line_total = excluded.line_total,
        modifiers_json = excluded.modifiers_json,
        sort_order = excluded.sort_order
    `;
  }

  return salesOrderId;
}
