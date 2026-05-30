import { sql } from "./db";

export type CustomerOrderRow = {
  id: string;
  brandId: string;
  storeId: string;
  storeName: string;
  pickupCode: string;
  status: string;
  paymentStatus: string;
  squareOrderId: string;
  squarePaymentId: string;
  squareReceiptUrl: string;
  pickupDate: string;
  pickupTime: string;
  amount: number;
  currency: string;
  drink: string;
  size: string;
  temperature: string;
  sweetness: string;
  ice: string;
  option: string;
  toppings: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string;
};

export type CustomerOrderItemInput = {
  menuCatalogItemId: string;
  itemName: string;
  sizeKey: string;
  sizeLabel: string;
  temperature: string;
  sweetness: string;
  ice: string;
  optionKey: string;
  optionLabel: string;
  toppingKeys: string[];
  toppingLabels: string[];
  amount: number;
};

export function createPickupCode(prefix = "N") {
  return `${prefix}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
}

export function toPublicCustomerOrder(order: CustomerOrderRow) {
  return {
    orderId: order.id,
    pickupCode: order.pickupCode,
    storeId: order.storeId,
    storeName: order.storeName,
    status: order.status,
    paymentStatus: order.paymentStatus,
    squareReceiptUrl: order.squareReceiptUrl,
    drink: order.drink,
    size: order.size,
    temperature: order.temperature,
    sweetness: order.sweetness,
    ice: order.ice,
    option: order.option,
    toppings: order.toppings,
    amount: order.amount,
    pickupDate: order.pickupDate,
    pickupTime: order.pickupTime
  };
}

export async function createCustomerOrder(input: {
  brandId: string;
  storeId: string;
  pickupCode: string;
  pickupDate: string;
  pickupTime: string;
  amount: number;
  currency?: string;
  customerSummary: Record<string, unknown>;
  drink: string;
  size: string;
  temperature: string;
  sweetness: string;
  ice: string;
  option: string;
  toppings: string;
  items: CustomerOrderItemInput[];
}) {
  const rows = await sql`
    insert into store_customer_orders (
      brand_id,
      store_id,
      pickup_code,
      pickup_date,
      pickup_time,
      amount,
      currency,
      customer_summary,
      drink,
      size,
      temperature,
      sweetness,
      ice,
      option_text,
      toppings
    )
    values (
      ${input.brandId},
      ${input.storeId},
      ${input.pickupCode},
      ${input.pickupDate},
      ${input.pickupTime},
      ${input.amount},
      ${input.currency ?? "JPY"},
      ${JSON.stringify(input.customerSummary)},
      ${input.drink},
      ${input.size},
      ${input.temperature},
      ${input.sweetness},
      ${input.ice},
      ${input.option},
      ${input.toppings}
    )
    returning id::text
  `;
  const orderId = rows[0]?.id as string;

  for (let index = 0; index < input.items.length; index += 1) {
    const item = input.items[index];
    await sql`
      insert into store_customer_order_items (
        order_id,
        menu_catalog_item_id,
        item_name,
        size_key,
        size_label,
        temperature,
        sweetness,
        ice,
        option_key,
        option_label,
        topping_keys,
        topping_labels,
        amount,
        sort_order
      )
      values (
        ${orderId},
        ${item.menuCatalogItemId},
        ${item.itemName},
        ${item.sizeKey},
        ${item.sizeLabel},
        ${item.temperature},
        ${item.sweetness},
        ${item.ice},
        ${item.optionKey},
        ${item.optionLabel},
        ${item.toppingKeys},
        ${item.toppingLabels},
        ${item.amount},
        ${index}
      )
    `;
  }

  return findCustomerOrderById(orderId);
}

export async function updateCustomerOrder(orderId: string, patch: Partial<{
  status: string;
  paymentStatus: string;
  squareOrderId: string;
  squarePaymentId: string;
  squareReceiptUrl: string;
  squarePaymentUpdatedAt: string;
  paidAt: string;
}>) {
  const rows = await sql`
    update store_customer_orders
    set
      status = coalesce(${patch.status ?? null}, status),
      payment_status = coalesce(${patch.paymentStatus ?? null}, payment_status),
      square_order_id = coalesce(${patch.squareOrderId ?? null}, square_order_id),
      square_payment_id = coalesce(${patch.squarePaymentId ?? null}, square_payment_id),
      square_receipt_url = coalesce(${patch.squareReceiptUrl ?? null}, square_receipt_url),
      square_payment_updated_at = coalesce(${patch.squarePaymentUpdatedAt ?? null}::timestamptz, square_payment_updated_at),
      paid_at = coalesce(${patch.paidAt ?? null}::timestamptz, paid_at),
      updated_at = now()
    where id = ${orderId}
    returning id::text
  `;
  return rows[0]?.id ? findCustomerOrderById(rows[0].id as string) : null;
}

export async function findCustomerOrderById(orderId: string) {
  const rows = await sql`
    select
      store_customer_orders.id::text,
      coalesce(store_customer_orders.brand_id::text, '') as "brandId",
      coalesce(store_customer_orders.store_id::text, '') as "storeId",
      coalesce(stores.name, '') as "storeName",
      store_customer_orders.pickup_code as "pickupCode",
      store_customer_orders.status,
      store_customer_orders.payment_status as "paymentStatus",
      coalesce(store_customer_orders.square_order_id, '') as "squareOrderId",
      coalesce(store_customer_orders.square_payment_id, '') as "squarePaymentId",
      coalesce(store_customer_orders.square_receipt_url, '') as "squareReceiptUrl",
      store_customer_orders.pickup_date::text as "pickupDate",
      store_customer_orders.pickup_time as "pickupTime",
      store_customer_orders.amount,
      store_customer_orders.currency,
      store_customer_orders.drink,
      store_customer_orders.size,
      store_customer_orders.temperature,
      store_customer_orders.sweetness,
      store_customer_orders.ice,
      store_customer_orders.option_text as "option",
      store_customer_orders.toppings,
      store_customer_orders.created_at as "createdAt",
      store_customer_orders.updated_at as "updatedAt",
      coalesce(store_customer_orders.paid_at::text, '') as "paidAt"
    from store_customer_orders
    left join stores on stores.id = store_customer_orders.store_id
    where store_customer_orders.id = ${orderId}
    limit 1
  `;
  return (rows[0] as CustomerOrderRow | undefined) ?? null;
}

export async function findCustomerOrderBySquareOrderId(squareOrderId: string) {
  const rows = await sql`
    select id::text
    from store_customer_orders
    where square_order_id = ${squareOrderId}
    limit 1
  `;
  return rows[0]?.id ? findCustomerOrderById(rows[0].id as string) : null;
}

export async function findPublicCustomerOrder(input: { orderId?: string | null; pickupCode?: string | null; pickupDate?: string | null }) {
  const orderId = String(input.orderId ?? "").trim();
  const pickupCode = String(input.pickupCode ?? "").trim();
  const pickupDate = String(input.pickupDate ?? "").trim();
  if (orderId) return findCustomerOrderById(orderId);
  if (!pickupCode) return null;

  const rows = pickupDate
    ? await sql`
        select id::text
        from store_customer_orders
        where pickup_code in (${pickupCode}, ${pickupCode.startsWith("N-") ? pickupCode.slice(2) : `N-${pickupCode}`})
          and pickup_date = ${pickupDate}
        order by created_at desc
        limit 1
      `
    : await sql`
        select id::text
        from store_customer_orders
        where pickup_code in (${pickupCode}, ${pickupCode.startsWith("N-") ? pickupCode.slice(2) : `N-${pickupCode}`})
        order by created_at desc
        limit 1
      `;

  return rows[0]?.id ? findCustomerOrderById(rows[0].id as string) : null;
}
