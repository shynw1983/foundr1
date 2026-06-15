import { requireOsSession } from "../../../../lib/api-auth";
import { findCustomerOrderById } from "../../../../lib/customer-orders";
import { sql } from "../../../../lib/db";
import { refreshActiveProductionTasksForStore, setProductionTaskStatus } from "../../../../lib/order-production";
import { publishCustomerOrderEvent } from "../../../../lib/order-realtime";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

async function getKitchenTasks(storeId: string, area = "") {
  const rows = await sql`
    select
      order_production_tasks.id::text,
      order_production_tasks.order_id::text as "orderId",
      order_production_tasks.production_area as "productionArea",
      order_production_tasks.production_area_label as "productionAreaLabel",
      order_production_tasks.status,
      order_production_tasks.print_status as "printStatus",
      order_production_tasks.item_summary as "itemSummary",
      store_customer_orders.pickup_code as "pickupCode",
      store_customer_orders.order_source as "orderSource",
      store_customer_orders.payment_status as "paymentStatus",
      coalesce(store_customer_orders.customer_summary ->> 'orderType', '') as "orderType",
      coalesce(store_customer_orders.customer_summary ->> 'note', '') as note,
      store_customer_orders.created_at::text as "createdAt",
      to_char(store_customer_orders.created_at at time zone 'Asia/Tokyo', 'HH24:MI') as "createdTime"
    from order_production_tasks
    join store_customer_orders on store_customer_orders.id = order_production_tasks.order_id
    where order_production_tasks.store_id::text = ${storeId}
      and store_customer_orders.payment_status = 'paid'
      and store_customer_orders.status not in ('completed', 'cancelled', 'refund_pending')
      and order_production_tasks.status in ('new', 'preparing', 'ready')
      and (${area} = '' or order_production_tasks.production_area = ${area})
    order by
      case order_production_tasks.status when 'preparing' then 0 when 'new' then 1 else 2 end,
      store_customer_orders.created_at asc
    limit 120
  `;
  const areas = await sql`
    select distinct production_area as value, production_area_label as label
    from order_production_tasks
    where store_id::text = ${storeId}
      and created_at > now() - interval '14 days'
    order by production_area_label
  `;
  return { tasks: rows, areas };
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, params.get("storeId")) ?? access.stores[0]?.id ?? "";
  if (storeFilter === "__forbidden__" || !storeFilter) return Response.json({ error: "権限がありません。" }, { status: 403 });

  await refreshActiveProductionTasksForStore(storeFilter);

  const { tasks, areas } = await getKitchenTasks(storeFilter, normalizeText(params.get("area")));
  return Response.json({ access, selectedStoreId: storeFilter, tasks, areas }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { storeId?: string; taskId?: string; status?: string; area?: string };
  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, body.storeId) ?? access.stores[0]?.id ?? "";
  if (storeFilter === "__forbidden__" || !storeFilter) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const taskId = normalizeText(body.taskId);
  const status = normalizeText(body.status);
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
  const { tasks, areas } = await getKitchenTasks(storeFilter, normalizeText(body.area));
  return Response.json({ ok: true, tasks, areas });
}
