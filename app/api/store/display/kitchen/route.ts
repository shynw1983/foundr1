import { requireOsSession } from "../../../../../lib/api-auth";
import { findCustomerOrderById } from "../../../../../lib/customer-orders";
import { sql } from "../../../../../lib/db";
import { localizeMaamaaProductionSummary, refreshActiveProductionTasksForStore, setProductionTaskStatus } from "../../../../../lib/order-production";
import { publishCustomerOrderEvent } from "../../../../../lib/order-realtime";
import { normalizePosPrinterSettings, resolvePosKitchenTicketTemplate } from "../../../../../lib/pos-printer";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

async function getKitchenTasks(storeId: string, area = "") {
  const [rows, areas, settingsRows] = await Promise.all([sql`
    select
      order_production_tasks.id::text,
      order_production_tasks.order_id::text as "orderId",
      coalesce(order_production_tasks.brand_id::text, '') as "brandId",
      coalesce(brands.name, order_production_tasks.production_area_label, '') as "brandName",
      order_production_tasks.production_area as "productionArea",
      order_production_tasks.production_area_label as "productionAreaLabel",
      order_production_tasks.status,
      order_production_tasks.print_status as "printStatus",
      order_production_tasks.item_summary as "itemSummary",
      coalesce(order_production_tasks.started_at::text, '') as "startedAt",
      coalesce(store_customer_orders.estimated_prep_minutes, 0)::int as "estimatedPrepMinutes",
      coalesce(store_customer_orders.estimated_ready_at::text, '') as "estimatedReadyAt",
      store_customer_orders.pickup_code as "pickupCode",
      coalesce(store_customer_orders.customer_summary ->> 'diningSeatLabel', nullif(store_tables.display_name, ''), store_tables.label, '') as "tableLabel",
      store_customer_orders.order_source as "orderSource",
      store_customer_orders.payment_status as "paymentStatus",
      coalesce(store_customer_orders.customer_summary ->> 'orderType', '') as "orderType",
      coalesce(store_customer_orders.customer_summary ->> 'note', '') as note,
      store_customer_orders.customer_summary as "customerSummary",
      store_customer_orders.created_at::text as "createdAt",
      to_char(store_customer_orders.created_at at time zone 'Asia/Tokyo', 'HH24:MI') as "createdTime"
    from order_production_tasks
    join store_customer_orders on store_customer_orders.id = order_production_tasks.order_id
    left join store_tables on store_tables.id = store_customer_orders.store_table_id
    left join brands on brands.id = order_production_tasks.brand_id
    where order_production_tasks.store_id::text = ${storeId}
      and store_customer_orders.payment_status = 'paid'
      and store_customer_orders.status not in ('completed', 'cancelled', 'refund_pending')
      and order_production_tasks.status in ('new', 'preparing', 'ready')
      and (${area} = '' or order_production_tasks.production_area = ${area})
    order by
      case order_production_tasks.status when 'preparing' then 0 when 'new' then 1 else 2 end,
      store_customer_orders.created_at asc
    limit 120
  `, sql`
    select distinct production_area as value, production_area_label as label
    from order_production_tasks
    where store_id::text = ${storeId}
      and created_at > now() - interval '14 days'
    order by production_area_label
  `, sql`
    select coalesce(printer_settings, '{}'::jsonb) as "printerSettings"
    from pos_store_settings
    where store_id::text = ${storeId}
    limit 1
  `]);
  const printerSettings = normalizePosPrinterSettings(settingsRows[0]?.printerSettings);
  const tasks = rows.map((rawRow) => {
    const row = rawRow as Record<string, unknown>;
    const brandId = normalizeText(row.brandId);
    const brandName = normalizeText(row.brandName);
    const kitchenLanguage = /maamaa|まぁ麻|麻辣/i.test(brandName)
      ? resolvePosKitchenTicketTemplate(printerSettings, brandId || null).language
      : "ja";
    const { customerSummary, ...task } = row;
    return {
      ...task,
      kitchenLanguage,
      itemSummary: localizeMaamaaProductionSummary(
        normalizeText(row.itemSummary),
        customerSummary,
        kitchenLanguage
      )
    };
  });
  const taskLanguages = new Set(tasks.map((task) => task.kitchenLanguage));
  const configuredMaamaaLanguage = printerSettings.kitchenTicketTemplateVariants
    .find((variant) => /maamaa|まぁ麻|麻辣/i.test(variant.brandName))?.template.language;
  return {
    tasks,
    areas,
    displayLanguage: taskLanguages.size === 1
      ? (taskLanguages.has("zh") ? "zh" : "ja")
      : (tasks.length === 0 && configuredMaamaaLanguage === "zh" ? "zh" : "ja")
  };
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, params.get("storeId")) ?? access.stores[0]?.id ?? "";
  if (storeFilter === "__forbidden__" || !storeFilter) return Response.json({ error: "権限がありません。" }, { status: 403 });

  await refreshActiveProductionTasksForStore(storeFilter);

  const { tasks, areas, displayLanguage } = await getKitchenTasks(storeFilter, normalizeText(params.get("area")));
  return Response.json({ access, selectedStoreId: storeFilter, tasks, areas, displayLanguage }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { storeId?: string; taskId?: string; orderId?: string; status?: string; area?: string };
  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, body.storeId) ?? access.stores[0]?.id ?? "";
  if (storeFilter === "__forbidden__" || !storeFilter) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const taskId = normalizeText(body.taskId);
  const requestedOrderId = normalizeText(body.orderId);
  const status = normalizeText(body.status);
  if (status === "completed" && requestedOrderId) {
    const completedRows = await sql`
      update store_customer_orders
      set status = 'completed', completed_at = coalesce(completed_at, now()), updated_at = now()
      where id::text = ${requestedOrderId}
        and store_id::text = ${storeFilter}
        and status = 'ready'
      returning id::text
    `;
    if (!completedRows[0]) return Response.json({ error: "受け渡し可能な注文が見つかりません。" }, { status: 409 });
    await publishCustomerOrderEvent("order.updated", await findCustomerOrderById(requestedOrderId));
    const { tasks, areas, displayLanguage } = await getKitchenTasks(storeFilter, normalizeText(body.area));
    return Response.json({ ok: true, tasks, areas, displayLanguage });
  }
  if (!taskId || !["new", "preparing", "ready"].includes(status)) return Response.json({ error: "更新内容が不正です。" }, { status: 400 });

  const taskRows = await sql`
    select id::text
    from order_production_tasks
    where id::text = ${taskId}
      and store_id::text = ${storeFilter}
    limit 1
  `;
  if (!taskRows[0]) return Response.json({ error: "制作タスクが見つかりません。" }, { status: 404 });
  const orderId = await setProductionTaskStatus(taskId, status as "new" | "preparing" | "ready", session.id);
  if (orderId) await publishCustomerOrderEvent("order.updated", await findCustomerOrderById(orderId));
  const { tasks, areas, displayLanguage } = await getKitchenTasks(storeFilter, normalizeText(body.area));
  return Response.json({ ok: true, tasks, areas, displayLanguage });
}
