import { requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { localizeMaamaaProductionSummary, refreshActiveProductionTasksForStore } from "../../../../lib/order-production";
import { normalizePosPrinterSettings, resolvePosKitchenTicketTemplate } from "../../../../lib/pos-printer";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../lib/store-order-access";
import { scheduledOrderReminderLeadMinutes } from "../../../../lib/store-order-alert-timing";

export const dynamic = "force-dynamic";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

async function resolveStoreId(request: Request, session: NonNullable<Awaited<ReturnType<typeof requireOsSession>>>) {
  const access = await getStoreOrderAccess(session);
  const requestedStoreId = new URL(request.url).searchParams.get("storeId");
  const storeFilter = getScopedStoreFilter(access, requestedStoreId) ?? access.stores[0]?.id ?? "";
  return { access, selectedStoreId: storeFilter, forbidden: storeFilter === "__forbidden__" };
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const { selectedStoreId, forbidden } = await resolveStoreId(request, session);
  if (forbidden || !selectedStoreId) return Response.json({ error: "権限がありません。" }, { status: 403 });

  await refreshActiveProductionTasksForStore(selectedStoreId);

  const rows = await sql`
    select
      order_production_tasks.id::text as "taskId",
      order_production_tasks.order_id::text as "orderId",
      coalesce(order_production_tasks.brand_id::text, '') as "brandId",
      coalesce(brands.name, order_production_tasks.production_area_label, '厨房') as "brandName",
      order_production_tasks.production_area as "productionArea",
      order_production_tasks.production_area_label as "productionAreaLabel",
      order_production_tasks.print_status as "printStatus",
      order_production_tasks.item_summary as "itemSummary",
      store_customer_orders.pickup_code as "pickupCode",
      coalesce(store_customer_orders.customer_summary ->> 'orderType', '') as "orderType",
      coalesce(store_customer_orders.customer_summary ->> 'note', '') as note,
      store_customer_orders.customer_summary as "customerSummary",
      coalesce(stores.name, 'Foundr1 STORE') as "storeName",
      to_char(store_customer_orders.created_at at time zone 'Asia/Tokyo', 'HH24:MI') as "createdTime"
    from order_production_tasks
    join store_customer_orders on store_customer_orders.id = order_production_tasks.order_id
    left join stores on stores.id = store_customer_orders.store_id
    left join brands on brands.id = order_production_tasks.brand_id
    where order_production_tasks.store_id::text = ${selectedStoreId}
      and store_customer_orders.payment_status = 'paid'
      and store_customer_orders.status not in ('cancelled', 'refund_pending')
      and (
        order_production_tasks.print_status = 'reprint_pending'
        or (
          store_customer_orders.status in ('new', 'preparing', 'ready')
          and order_production_tasks.status in ('new', 'preparing')
          and (
            store_customer_orders.created_at > now() - interval '6 hours'
            or (
              store_customer_orders.order_source = 'maamaa_web'
              and coalesce(store_customer_orders.customer_summary ->> 'pickupTiming', '') = 'scheduled'
            )
          )
          and (
            store_customer_orders.order_source <> 'maamaa_web'
            or coalesce(store_customer_orders.customer_summary ->> 'pickupTiming', '') <> 'scheduled'
            or ((store_customer_orders.pickup_date::text || ' ' || store_customer_orders.pickup_time)::timestamp at time zone 'Asia/Tokyo')
              <= now() + (${scheduledOrderReminderLeadMinutes} * interval '1 minute')
          )
          and (
            order_production_tasks.print_status = 'pending'
            or (order_production_tasks.print_status = 'failed' and order_production_tasks.updated_at < now() - interval '2 minutes')
            or (order_production_tasks.print_status = 'printing' and order_production_tasks.updated_at < now() - interval '5 minutes')
          )
        )
      )
    order by
      case when order_production_tasks.print_status = 'reprint_pending' then 0 else 1 end,
      store_customer_orders.created_at asc,
      order_production_tasks.created_at asc
    limit 1
  `;
  const settingsRows = await sql`
    select coalesce(printer_settings, '{}'::jsonb) as "printerSettings"
    from pos_store_settings
    where store_id::text = ${selectedStoreId}
    limit 1
  `;
  const printerSettings = normalizePosPrinterSettings(settingsRows[0]?.printerSettings);
  const jobs = rows.map((rawRow) => {
    const row = rawRow as Record<string, unknown>;
    const brandId = normalizeText(row.brandId);
    const brandName = normalizeText(row.brandName);
    const language = /maamaa|まぁ麻|麻辣/i.test(brandName)
      ? resolvePosKitchenTicketTemplate(printerSettings, brandId || null).language
      : "ja";
    const { customerSummary, ...job } = row;
    return {
      ...job,
      itemSummary: localizeMaamaaProductionSummary(
        normalizeText(row.itemSummary),
        customerSummary,
        language
      )
    };
  });

  return Response.json({
    selectedStoreId,
    printerSettings,
    jobs
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { storeId?: string; taskId?: string; printStatus?: string };
  const access = await getStoreOrderAccess(session);
  const storeId = getScopedStoreFilter(access, body.storeId);
  if (storeId === "__forbidden__" || !storeId) return Response.json({ error: "店舗を選択してください。" }, { status: 400 });

  const taskId = normalizeText(body.taskId);
  const printStatus = normalizeText(body.printStatus);
  if (!taskId || !["reprint_pending", "printing", "printed", "failed"].includes(printStatus)) {
    return Response.json({ error: "更新内容が不正です。" }, { status: 400 });
  }

  const rows = printStatus === "reprint_pending"
    ? await sql`
      update order_production_tasks
      set print_status = 'reprint_pending', updated_at = now()
      where id::text = ${taskId}
        and store_id::text = ${storeId}
        and (
          print_status <> 'printing'
          or updated_at < now() - interval '2 minutes'
        )
        and exists (
          select 1
          from store_customer_orders
          where store_customer_orders.id = order_production_tasks.order_id
            and store_customer_orders.payment_status = 'paid'
            and store_customer_orders.status not in ('cancelled', 'refund_pending')
        )
      returning id::text
    `
    : printStatus === "printing"
    ? await sql`
      update order_production_tasks
      set print_status = 'printing', updated_at = now()
      where id::text = ${taskId}
        and store_id::text = ${storeId}
        and (
          print_status in ('pending', 'failed', 'reprint_pending')
          or (print_status = 'printing' and updated_at < now() - interval '5 minutes')
        )
      returning id::text
    `
    : await sql`
      update order_production_tasks
      set print_status = ${printStatus}, updated_at = now()
      where id::text = ${taskId}
        and store_id::text = ${storeId}
        and print_status = 'printing'
      returning id::text
    `;

  return Response.json({ ok: Boolean(rows[0]?.id) });
}
