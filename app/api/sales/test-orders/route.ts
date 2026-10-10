import { canAccessStore, requireOsSession } from "../../../../lib/api-auth";
import { writeAuditLog } from "../../../../lib/audit-log";
import { sql } from "../../../../lib/db";
import { reconcileMemberAccountFromLoyaltyLedger, reverseLoyaltyForRefundedOrder } from "../../../../lib/loyalty";
import { randomUUID } from "crypto";

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
      sales_orders.id::text,
      sales_orders.source_order_id::text as "sourceOrderId",
      store_customer_orders.member_id::text as "memberId"
    from sales_orders
    left join store_customer_orders on store_customer_orders.id = sales_orders.source_order_id
    where sales_orders.id::text = any(${salesOrderIds})
      and sales_orders.store_id::text = ${storeId}
      and sales_orders.ordered_at >= ${startUtc.toISOString()}
      and sales_orders.ordered_at < ${endUtc.toISOString()}
  `;
  if (targets.length !== salesOrderIds.length) {
    return Response.json({ error: "削除対象に、期間外または権限外の注文が含まれています。" }, { status: 400 });
  }

  const targetSalesOrderIds = targets.map((row) => String(row.id));
  const customerOrderIds = Array.from(new Set(targets.map((row) => String(row.sourceOrderId ?? "")).filter(isUuid)));
  const affectedMemberIds = Array.from(new Set(targets.map((row) => String(row.memberId ?? "")).filter(isUuid)));
  const deletionClaimId=randomUUID();

  // Protect the original inventory ledger before any loyalty/projection writes.
  // The durable temporary issue also fences a source writer that marks Ready
  // after this transaction releases the source row locks.
  if (customerOrderIds.length) {
    const claims = await sql.transaction([
      sql`select id from store_customer_orders where id::text=any(${customerOrderIds}) order by id for update`,
      sql`select order_id::text from inventory_order_usage_events where order_id::text=any(${customerOrderIds})`,
      sql`insert into inventory_order_usage_issues(order_id,store_id,code,details)
        select id,store_id,'source_deletion_pending',jsonb_build_object('actorId',${session.id}::text,'claimId',${deletionClaimId}::text) from store_customer_orders
        where id::text=any(${customerOrderIds}) and not exists(select 1 from inventory_order_usage_events where order_id::text=any(${customerOrderIds}))
        on conflict(order_id,code) do update set details=excluded.details,updated_at=now(),resolved_at=null
          where inventory_order_usage_issues.resolved_at is not null returning order_id::text`
    ]);
    if (claims[1]?.length || claims[2]?.length !== customerOrderIds.length) {
      await sql`delete from inventory_order_usage_issues where order_id::text=any(${customerOrderIds})
        and code='source_deletion_pending' and details->>'claimId'=${deletionClaimId}`;
      return Response.json({ error: "在庫流水が記録された注文は削除できません。注文と在庫履歴を保持してください。" }, { status: 409 });
    }
  }

  try {

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

  for (const memberId of affectedMemberIds) {
    await reconcileMemberAccountFromLoyaltyLedger(memberId);
  }

  await writeAuditLog({
    actorEmployeeId: session.id,
    action: "sales.test_orders_deleted",
    targetType: "store",
    targetId: storeId,
    metadata: {
      startDate,
      endDate,
      salesOrderIds: targetSalesOrderIds,
      customerOrderIds,
      affectedMemberIds,
      deletedSalesOrderCount: deletedSalesRows.length,
      deletedCustomerOrderCount
    },
    request
  });

  return Response.json({
    ok: true,
    deletedSalesOrderCount: deletedSalesRows.length,
    deletedCustomerOrderCount
  });
  } catch {
    return Response.json({error:"注文の削除を完了できませんでした。残っている注文を確認してください。"},{status:503});
  } finally {
    // Successful source deletion cascades this issue; a failed deletion leaves
    // the original order available for an explicit inventory retry.
    if (customerOrderIds.length) try { await sql`delete from inventory_order_usage_issues
      where order_id::text=any(${customerOrderIds}) and code='source_deletion_pending' and details->>'claimId'=${deletionClaimId}`; } catch { /* retain the fence if the database is unavailable */ }
  }
}
