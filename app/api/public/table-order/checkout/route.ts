import { sql } from "../../../../../lib/db";
import { publishCustomerOrderEvent } from "../../../../../lib/order-realtime";
import { findCustomerOrderById } from "../../../../../lib/customer-orders";

export const dynamic = "force-dynamic";

const checkoutTypes = new Set(["pay_at_counter", "online_payment", "staff_to_table"]);

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function getJstDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function getCheckoutMessage(type: string) {
  if (type === "pay_at_counter") {
    return "レジまでお越しください。スタッフがテーブル番号を確認します。";
  }
  if (type === "staff_to_table") {
    return "スタッフをお呼びしました。この画面を開いたままお待ちください。";
  }
  return "オンライン決済は準備中です。現在はレジ会計またはスタッフ呼び出しをご利用ください。";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { token?: string; checkoutType?: string };
  const token = normalizeText(body.token);
  const checkoutType = normalizeText(body.checkoutType);
  if (!token || !checkoutTypes.has(checkoutType)) {
    return Response.json({ error: "会計方法を選択してください。" }, { status: 400 });
  }

  const tableRows = await sql`
    select
      store_tables.id::text as "tableId",
      coalesce(nullif(store_tables.display_name, ''), store_tables.label) as "tableDisplayName",
      store_tables.label as "tableLabel",
      store_tables.table_ordering_enabled as "tableOrderingEnabled",
      stores.id::text as "storeId",
      stores.name as "storeName",
      coalesce(brands.id::text, fallback_brands.id::text, '') as "brandId",
      coalesce(brands.name, fallback_brands.name, '') as "brandName",
      coalesce(pos_store_settings.dine_in_enabled, true) as "dineInEnabled"
    from store_tables
    join stores on stores.id = store_tables.store_id
    left join brands on brands.id = store_tables.brand_id
    left join lateral (
      select brands.id, brands.name
      from store_brands
      join brands on brands.id = store_brands.brand_id
      where store_brands.store_id = stores.id
        and brands.status = 'active'
      order by brands.name
      limit 1
    ) fallback_brands on true
    left join pos_store_settings on pos_store_settings.store_id = stores.id
    where store_tables.qr_token = ${token}
      and store_tables.status = 'active'
      and stores.status = 'active'
      and (brands.id is null or brands.status = 'active')
    limit 1
  `;
  const table = tableRows[0] as {
    tableId: string;
    tableDisplayName: string;
    tableLabel: string;
    tableOrderingEnabled: boolean;
    storeId: string;
    storeName: string;
    brandId: string;
    brandName: string;
    dineInEnabled: boolean;
  } | undefined;
  if (!table || !table.brandId || !table.tableOrderingEnabled || !table.dineInEnabled) {
    return Response.json({ error: "このテーブルでは現在会計できません。" }, { status: 400 });
  }

  const businessDate = getJstDate();
  const tableSessionKey = `${table.tableId}:${businessDate.replaceAll("-", "")}`;
  const orders = await sql`
    select
      id::text,
      amount
    from store_customer_orders
    where store_table_id::text = ${table.tableId}
      and table_session_key = ${tableSessionKey}
      and order_source = 'table_qr'
      and status <> 'cancelled'
      and payment_status <> 'paid'
    order by created_at asc
  `;
  if (!orders.length) {
    return Response.json({ error: "未会計の追加注文がありません。" }, { status: 400 });
  }

  const totalAmount = orders.reduce((sum, order) => sum + Number(order.amount ?? 0), 0);
  const requestedAt = new Date().toISOString();
  const checkoutPayload = {
    checkoutStatus: "requested",
    checkoutRequestType: checkoutType,
    checkoutRequestedAt: requestedAt,
    paymentIntent: checkoutType,
    tableSessionKey
  };

  await sql`
    update store_customer_orders
    set
      customer_summary = customer_summary || ${JSON.stringify(checkoutPayload)}::jsonb,
      updated_at = now()
    where id::text = any(${orders.map((order) => String(order.id))})
  `;

  const latestOrderId = String(orders[orders.length - 1]?.id ?? "");
  if (latestOrderId) {
    await publishCustomerOrderEvent("order.updated", await findCustomerOrderById(latestOrderId));
  }

  return Response.json({
    ok: true,
    checkoutType,
    message: getCheckoutMessage(checkoutType),
    totalAmount,
    table: {
      id: table.tableId,
      label: table.tableDisplayName || table.tableLabel,
      storeName: table.storeName,
      brandName: table.brandName
    },
    onlinePaymentReady: false
  });
}
