import { canAccessStore, requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { reverseLoyaltyForRefundedOrder } from "../../../../lib/loyalty";

export const dynamic = "force-dynamic";

const deleteRoles = new Set(["owner", "manager"]);
const deliveryPlatforms = ["uber_eats", "rocket_now", "demae_can"];

function isDateString(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function addDays(dateString: string, amount: number) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

function getJstDateRange(startDate: string, endDate: string) {
  const startUtc = new Date(`${startDate}T00:00:00+09:00`);
  const endUtc = new Date(`${addDays(endDate, 1)}T00:00:00+09:00`);
  return { startUtc, endUtc };
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function getCandidateOrders(input: {
  storeId: string;
  startUtc: string;
  endUtc: string;
  sourceType: string;
  query: string;
}) {
  const queryPattern = `%${input.query}%`;

  if (input.sourceType === "pos") {
    return sql`
      select
        sales_orders.id::text as id,
        sales_orders.order_no as "orderNo",
        sales_orders.channel,
        sales_orders.source_platform as "sourcePlatform",
        sales_orders.status,
        sales_orders.payment_status as "paymentStatus",
        sales_orders.total::int,
        sales_orders.source_order_id::text as "sourceOrderId",
        to_char(sales_orders.ordered_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "orderedAtLabel",
        coalesce(store_customer_orders.pickup_code, '') as "pickupCode",
        coalesce(store_customer_orders.status, '') as "customerStatus",
        coalesce(store_customer_orders.payment_status, '') as "customerPaymentStatus",
        coalesce(store_customer_orders.customer_summary #>> '{customer,name}', '') as "customerName",
        coalesce(store_customer_orders.customer_summary #>> '{customer,phone}', '') as "customerPhone",
        (store_customer_orders.id is not null) as "hasCustomerOrder"
      from sales_orders
      left join store_customer_orders on store_customer_orders.id = sales_orders.source_order_id
      where sales_orders.store_id::text = ${input.storeId}
        and sales_orders.ordered_at >= ${input.startUtc}
        and sales_orders.ordered_at < ${input.endUtc}
        and (
          ${input.query === ""}
          or sales_orders.order_no ilike ${queryPattern}
          or sales_orders.source_platform ilike ${queryPattern}
          or store_customer_orders.pickup_code ilike ${queryPattern}
          or store_customer_orders.customer_summary #>> '{customer,name}' ilike ${queryPattern}
          or store_customer_orders.customer_summary #>> '{customer,phone}' ilike ${queryPattern}
        )
        and sales_orders.channel = 'in_store'
        and sales_orders.source_platform = 'pos'
      order by sales_orders.ordered_at desc
      limit 100
    `;
  }
  if (input.sourceType === "web") {
    return sql`
      select
        sales_orders.id::text as id,
        sales_orders.order_no as "orderNo",
        sales_orders.channel,
        sales_orders.source_platform as "sourcePlatform",
        sales_orders.status,
        sales_orders.payment_status as "paymentStatus",
        sales_orders.total::int,
        sales_orders.source_order_id::text as "sourceOrderId",
        to_char(sales_orders.ordered_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "orderedAtLabel",
        coalesce(store_customer_orders.pickup_code, '') as "pickupCode",
        coalesce(store_customer_orders.status, '') as "customerStatus",
        coalesce(store_customer_orders.payment_status, '') as "customerPaymentStatus",
        coalesce(store_customer_orders.customer_summary #>> '{customer,name}', '') as "customerName",
        coalesce(store_customer_orders.customer_summary #>> '{customer,phone}', '') as "customerPhone",
        (store_customer_orders.id is not null) as "hasCustomerOrder"
      from sales_orders
      left join store_customer_orders on store_customer_orders.id = sales_orders.source_order_id
      where sales_orders.store_id::text = ${input.storeId}
        and sales_orders.ordered_at >= ${input.startUtc}
        and sales_orders.ordered_at < ${input.endUtc}
        and (
          ${input.query === ""}
          or sales_orders.order_no ilike ${queryPattern}
          or sales_orders.source_platform ilike ${queryPattern}
          or store_customer_orders.pickup_code ilike ${queryPattern}
          or store_customer_orders.customer_summary #>> '{customer,name}' ilike ${queryPattern}
          or store_customer_orders.customer_summary #>> '{customer,phone}' ilike ${queryPattern}
        )
        and sales_orders.channel = 'web_reservation'
      order by sales_orders.ordered_at desc
      limit 100
    `;
  }
  if (input.sourceType === "delivery") {
    return sql`
      select
        sales_orders.id::text as id,
        sales_orders.order_no as "orderNo",
        sales_orders.channel,
        sales_orders.source_platform as "sourcePlatform",
        sales_orders.status,
        sales_orders.payment_status as "paymentStatus",
        sales_orders.total::int,
        sales_orders.source_order_id::text as "sourceOrderId",
        to_char(sales_orders.ordered_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "orderedAtLabel",
        coalesce(store_customer_orders.pickup_code, '') as "pickupCode",
        coalesce(store_customer_orders.status, '') as "customerStatus",
        coalesce(store_customer_orders.payment_status, '') as "customerPaymentStatus",
        coalesce(store_customer_orders.customer_summary #>> '{customer,name}', '') as "customerName",
        coalesce(store_customer_orders.customer_summary #>> '{customer,phone}', '') as "customerPhone",
        (store_customer_orders.id is not null) as "hasCustomerOrder"
      from sales_orders
      left join store_customer_orders on store_customer_orders.id = sales_orders.source_order_id
      where sales_orders.store_id::text = ${input.storeId}
        and sales_orders.ordered_at >= ${input.startUtc}
        and sales_orders.ordered_at < ${input.endUtc}
        and (
          ${input.query === ""}
          or sales_orders.order_no ilike ${queryPattern}
          or sales_orders.source_platform ilike ${queryPattern}
          or store_customer_orders.pickup_code ilike ${queryPattern}
          or store_customer_orders.customer_summary #>> '{customer,name}' ilike ${queryPattern}
          or store_customer_orders.customer_summary #>> '{customer,phone}' ilike ${queryPattern}
        )
        and (
          sales_orders.channel = 'delivery'
          or sales_orders.source_platform = any(${deliveryPlatforms})
        )
      order by sales_orders.ordered_at desc
      limit 100
    `;
  }

  return sql`
    select
      sales_orders.id::text as id,
      sales_orders.order_no as "orderNo",
      sales_orders.channel,
      sales_orders.source_platform as "sourcePlatform",
      sales_orders.status,
      sales_orders.payment_status as "paymentStatus",
      sales_orders.total::int,
      sales_orders.source_order_id::text as "sourceOrderId",
      to_char(sales_orders.ordered_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "orderedAtLabel",
      coalesce(store_customer_orders.pickup_code, '') as "pickupCode",
      coalesce(store_customer_orders.status, '') as "customerStatus",
      coalesce(store_customer_orders.payment_status, '') as "customerPaymentStatus",
      coalesce(store_customer_orders.customer_summary #>> '{customer,name}', '') as "customerName",
      coalesce(store_customer_orders.customer_summary #>> '{customer,phone}', '') as "customerPhone",
      (store_customer_orders.id is not null) as "hasCustomerOrder"
    from sales_orders
    left join store_customer_orders on store_customer_orders.id = sales_orders.source_order_id
    where sales_orders.store_id::text = ${input.storeId}
      and sales_orders.ordered_at >= ${input.startUtc}
      and sales_orders.ordered_at < ${input.endUtc}
      and (
        ${input.query === ""}
        or sales_orders.order_no ilike ${queryPattern}
        or sales_orders.source_platform ilike ${queryPattern}
        or store_customer_orders.pickup_code ilike ${queryPattern}
        or store_customer_orders.customer_summary #>> '{customer,name}' ilike ${queryPattern}
        or store_customer_orders.customer_summary #>> '{customer,phone}' ilike ${queryPattern}
      )
    order by sales_orders.ordered_at desc
    limit 100
  `;
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  if (!deleteRoles.has(session.role)) return Response.json({ error: "テストデータ削除は owner / manager のみ操作できます。" }, { status: 403 });

  const url = new URL(request.url);
  const storeId = normalizeText(url.searchParams.get("storeId"));
  const startDate = normalizeText(url.searchParams.get("startDate"));
  const endDate = normalizeText(url.searchParams.get("endDate"));
  const sourceType = normalizeText(url.searchParams.get("sourceType")) || "all";
  const query = normalizeText(url.searchParams.get("query"));

  if (!storeId || !isUuid(storeId)) return Response.json({ error: "店舗を選択してください。" }, { status: 400 });
  if (!isDateString(startDate) || !isDateString(endDate) || startDate > endDate) {
    return Response.json({ error: "検索期間を正しく指定してください。" }, { status: 400 });
  }
  if (!await canAccessStore(session, storeId)) return Response.json({ error: "この店舗を操作する権限がありません。" }, { status: 403 });

  const { startUtc, endUtc } = getJstDateRange(startDate, endDate);
  const orders = await getCandidateOrders({
    storeId,
    startUtc: startUtc.toISOString(),
    endUtc: endUtc.toISOString(),
    sourceType,
    query
  });

  return Response.json({ orders, canDelete: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  if (!deleteRoles.has(session.role)) return Response.json({ error: "テストデータ削除は owner / manager のみ操作できます。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as {
    storeId?: string;
    startDate?: string;
    endDate?: string;
    salesOrderIds?: string[];
    confirmation?: string;
  };
  const storeId = normalizeText(body.storeId);
  const startDate = normalizeText(body.startDate);
  const endDate = normalizeText(body.endDate);
  const salesOrderIds = Array.from(new Set((body.salesOrderIds ?? []).map((id) => normalizeText(id)).filter(isUuid)));

  if (body.confirmation !== "DELETE") return Response.json({ error: "確認欄に DELETE と入力してください。" }, { status: 400 });
  if (!storeId || !isUuid(storeId)) return Response.json({ error: "店舗を選択してください。" }, { status: 400 });
  if (!isDateString(startDate) || !isDateString(endDate) || startDate > endDate) {
    return Response.json({ error: "削除対象期間を正しく指定してください。" }, { status: 400 });
  }
  if (salesOrderIds.length === 0) return Response.json({ error: "削除する注文を選択してください。" }, { status: 400 });
  if (salesOrderIds.length > 50) return Response.json({ error: "一度に削除できる注文は50件までです。" }, { status: 400 });
  if (!await canAccessStore(session, storeId)) return Response.json({ error: "この店舗を操作する権限がありません。" }, { status: 403 });

  const { startUtc, endUtc } = getJstDateRange(startDate, endDate);
  const targets = await sql`
    select
      id::text,
      source_order_id::text as "sourceOrderId"
    from sales_orders
    where id::text = any(${salesOrderIds})
      and store_id::text = ${storeId}
      and ordered_at >= ${startUtc.toISOString()}
      and ordered_at < ${endUtc.toISOString()}
  `;
  if (targets.length !== salesOrderIds.length) {
    return Response.json({ error: "削除対象に、期間外または権限外の注文が含まれています。" }, { status: 400 });
  }

  const targetSalesOrderIds = targets.map((row) => String(row.id));
  const customerOrderIds = Array.from(new Set(targets.map((row) => String(row.sourceOrderId ?? "")).filter(isUuid)));

  for (const orderId of customerOrderIds) {
    await reverseLoyaltyForRefundedOrder(orderId, "テストデータ削除による会員特典取消");
  }

  if (customerOrderIds.length > 0) {
    await sql`
      delete from loyalty_settlement_entries
      where order_id::text = any(${customerOrderIds})
    `;
    await sql`
      delete from loyalty_point_ledger
      where order_id::text = any(${customerOrderIds})
    `;
    await sql`
      delete from loyalty_stamp_ledger
      where order_id::text = any(${customerOrderIds})
    `;
    await sql`
      update member_coupons
      set
        status = 'available',
        used_order_id = null,
        used_store_id = null,
        used_at = null,
        metadata = metadata || ${JSON.stringify({ restoredByTestDataDeleteAt: new Date().toISOString(), restoredByEmployeeId: session.id })}::jsonb
      where used_order_id::text = any(${customerOrderIds})
    `;
  }

  const deletedSalesRows = await sql`
    delete from sales_orders
    where id::text = any(${targetSalesOrderIds})
    returning id::text
  `;

  let deletedCustomerOrderCount = 0;
  if (customerOrderIds.length > 0) {
    const deletedCustomerRows = await sql`
      delete from store_customer_orders
      where id::text = any(${customerOrderIds})
      returning id::text
    `;
    deletedCustomerOrderCount = deletedCustomerRows.length;
  }

  return Response.json({
    ok: true,
    deletedSalesOrderCount: deletedSalesRows.length,
    deletedCustomerOrderCount
  });
}
