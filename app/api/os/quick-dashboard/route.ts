import { cookies } from "next/headers";
import { getSessionStoreScope, osStoreContextCookieName, requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { normalizeQuickDashboardPreferences } from "../../../../lib/quick-dashboard";
import { getStoreReceptionState } from "../../../../lib/store-business-hours";

export const dynamic = "force-dynamic";

const allStoreRoles = new Set(["owner", "manager"]);
const quickDashboardRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session || !quickDashboardRoles.has(session.role)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const scope = await getSessionStoreScope(session);
  const stores = allStoreRoles.has(session.role) ? await sql`
    select id::text, name
    from stores
    where status = 'active'
    order by name
  ` : await sql`
    select stores.id::text, stores.name
    from stores
    where stores.status = 'active'
      and stores.id::text = any(${scope.storeIds})
    order by stores.name
  `;
  const allowedStoreIds = new Set(stores.map((store) => String(store.id)));
  const requestedStoreId = new URL(request.url).searchParams.get("storeId")?.trim() ?? "";
  const cookieStore = await cookies();
  const contextStoreId = String(cookieStore.get(osStoreContextCookieName)?.value ?? "").trim();
  const employeeRows = await sql`
    select coalesce(ui_preferences, '{}'::jsonb) as "uiPreferences"
    from employees
    where id = ${session.id}::uuid
  `;
  const uiPreferences = (employeeRows[0]?.uiPreferences ?? {}) as Record<string, unknown>;
  const preferences = normalizeQuickDashboardPreferences(uiPreferences.quickDashboard);
  const preferredStoreId = String(preferences.selectedStoreId ?? "");
  const selectedStoreCandidates = allStoreRoles.has(session.role)
    ? [requestedStoreId, contextStoreId]
    : [requestedStoreId, preferredStoreId];
  const selectedStoreId = selectedStoreCandidates
    .find((storeId) => storeId && allowedStoreIds.has(storeId)) ?? String(stores[0]?.id ?? "");

  if (!selectedStoreId) {
    return Response.json({ stores: [], selectedStoreId: "", staff: [], operation: null, metrics: {}, preferences });
  }

  const [punchRows, operationRows, metricRows] = await Promise.all([
    sql`
      select
        timecard_punches.employee_id::text as "employeeId",
        employees.name as "employeeName",
        timecard_punches.punch_type as "punchType",
        timecard_punches.punched_at as "punchedAt"
      from timecard_punches
      join employees on employees.id = timecard_punches.employee_id
      where timecard_punches.store_id = ${selectedStoreId}::uuid
        and timecard_punches.punched_at >= now() - interval '36 hours'
      order by timecard_punches.employee_id, timecard_punches.punched_at desc
    `,
    sql`
      select
        stores.business_hours as "businessHours",
        case
          when store_operations.temporary_status_until is not null and store_operations.temporary_status_until <= now() then true
          else coalesce(store_operations.reservations_enabled, true)
        end as "reservationsEnabled",
        case
          when store_operations.temporary_status_until is not null and store_operations.temporary_status_until <= now() then ''
          else coalesce(store_operations.status_note, '')
        end as "statusNote",
        case
          when store_operations.minimum_pickup_reset_at is not null and store_operations.minimum_pickup_reset_at <= now() then null
          else store_operations.minimum_pickup_minutes
        end as "minimumPickupMinutes"
      from stores
      left join store_operations on store_operations.store_id = stores.id
      where stores.id = ${selectedStoreId}::uuid
      limit 1
    `,
    sql`
      select
        count(*) filter (
          where store_customer_orders.status in ('new', 'preparing', 'ready')
        )::int as "activeOrders",
        count(*) filter (
          where store_customer_orders.payment_status = 'paid'
            and (coalesce(store_customer_orders.paid_at, store_customer_orders.created_at) at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
        )::int as "paidOrders",
        coalesce(sum(store_customer_orders.amount) filter (
          where store_customer_orders.payment_status = 'paid'
            and (coalesce(store_customer_orders.paid_at, store_customer_orders.created_at) at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
        ), 0)::int as "grossSales",
        (
          select count(*)::int
          from purchase_order_items
          join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
          where purchase_orders.store_id = ${selectedStoreId}::uuid
            and purchase_order_items.status not in ('purchased', 'in_delivery', 'delivered', 'received', 'unavailable')
        ) as "pendingPurchaseItems"
      from store_customer_orders
      where store_customer_orders.store_id = ${selectedStoreId}::uuid
    `
  ]);

  const punchesByEmployee = new Map<string, Array<Record<string, unknown>>>();
  punchRows.forEach((row) => {
    const employeeId = String(row.employeeId);
    const rows = punchesByEmployee.get(employeeId) ?? [];
    rows.push(row);
    punchesByEmployee.set(employeeId, rows);
  });
  const staff = Array.from(punchesByEmployee.values()).flatMap((rows) => {
    const latest = rows[0];
    const punchType = String(latest?.punchType ?? "");
    if (!["clock_in", "break_start", "break_end"].includes(punchType)) return [];
    const clockIn = rows.find((row) => String(row.punchType) === "clock_in");
    return [{
      employeeId: String(latest.employeeId),
      name: String(latest.employeeName ?? ""),
      status: punchType === "break_start" ? "break" : "working",
      clockInAt: clockIn?.punchedAt ? new Date(String(clockIn.punchedAt)).toISOString() : "",
      latestPunchAt: new Date(String(latest.punchedAt)).toISOString()
    }];
  });

  const operation = operationRows[0] as Record<string, unknown> | undefined;
  const operationPayload = operation ? {
    reservationsEnabled: operation.reservationsEnabled !== false,
    statusNote: String(operation.statusNote ?? ""),
    minimumPickupMinutes: operation.minimumPickupMinutes === null ? null : Number(operation.minimumPickupMinutes),
    receptionState: getStoreReceptionState({
      businessHours: operation.businessHours,
      reservationsEnabled: operation.reservationsEnabled !== false,
      statusNote: String(operation.statusNote ?? "")
    })
  } : null;

  return Response.json({
    stores: stores.map((store) => ({ id: String(store.id), name: String(store.name) })),
    selectedStoreId,
    canChangeGlobalStore: allStoreRoles.has(session.role),
    staff,
    operation: operationPayload,
    metrics: metricRows[0] ?? { activeOrders: 0, paidOrders: 0, grossSales: 0, pendingPurchaseItems: 0 },
    preferences
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
