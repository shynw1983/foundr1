import { requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { getStoreReceptionState } from "../../../../lib/store-business-hours";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

type HourlyPoint = {
  hour: number;
  label: string;
  todaySales: number;
  todayOrders: number;
  lastWeekSales: number;
  lastWeekOrders: number;
};

type StoreCondition = {
  id: string;
  name: string;
  todaySales: number;
  todayOrders: number;
  activeOrders: number;
  workingStaff: number;
  breakStaff: number;
  isAcceptingWeb: boolean;
  minimumPickupMinutes: number | null;
  statusNote: string;
};

function buildHourlySeries(rows: Array<Record<string, unknown>>): HourlyPoint[] {
  const byHour = new Map<number, { todaySales: number; todayOrders: number; lastWeekSales: number; lastWeekOrders: number }>();
  let minHour = 10;
  let maxHour = 21;

  for (const row of rows) {
    const hour = Number(row.hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    const todaySales = Number(row.todaySales ?? 0);
    const todayOrders = Number(row.todayOrders ?? 0);
    const lastWeekSales = Number(row.lastWeekSales ?? 0);
    const lastWeekOrders = Number(row.lastWeekOrders ?? 0);
    byHour.set(hour, { todaySales, todayOrders, lastWeekSales, lastWeekOrders });
    if (todaySales > 0 || lastWeekSales > 0 || todayOrders > 0 || lastWeekOrders > 0) {
      if (hour < minHour) minHour = hour;
      if (hour > maxHour) maxHour = hour;
    }
  }

  const points: HourlyPoint[] = [];
  for (let hour = minHour; hour <= maxHour; hour += 1) {
    const entry = byHour.get(hour);
    points.push({
      hour,
      label: `${hour}時`,
      todaySales: entry?.todaySales ?? 0,
      todayOrders: entry?.todayOrders ?? 0,
      lastWeekSales: entry?.lastWeekSales ?? 0,
      lastWeekOrders: entry?.lastWeekOrders ?? 0
    });
  }
  return points;
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) {
    return Response.json({ error: "ログインしてください。" }, { status: 401 });
  }

  const access = await getStoreOrderAccess(session);
  const requestedStoreId = new URL(request.url).searchParams.get("storeId")?.trim() ?? "";

  let storeFilter: string | null = null;
  if (requestedStoreId && requestedStoreId !== "all") {
    storeFilter = getScopedStoreFilter(access, requestedStoreId);
    if (storeFilter === "__forbidden__") {
      return Response.json({ error: "権限がありません。" }, { status: 403 });
    }
  } else if (!access.allStores && access.stores.length === 1) {
    storeFilter = access.stores[0]?.id ?? null;
  }

  const accessibleStoreIds = access.stores.map((store) => store.id);
  const canViewSalesStats = access.canViewSalesStats;

  const [hourlyRows, summaryRows, storeSalesRows, punchRows, operationRows] = await Promise.all([
    canViewSalesStats
      ? sql`
          with scoped as (
            select
              extract(hour from (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo'))::int as hour,
              (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date as biz_date,
              amount
            from store_customer_orders
            where payment_status in ('paid', 'partial_refunded')
              and (${access.allStores} or store_id::text = any(${access.storeIds}))
              and (${storeFilter}::text is null or store_id::text = ${storeFilter})
              and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date in (
                (now() at time zone 'Asia/Tokyo')::date,
                ((now() at time zone 'Asia/Tokyo')::date - 7)
              )
          )
          select
            hour,
            coalesce(sum(amount) filter (where biz_date = (now() at time zone 'Asia/Tokyo')::date), 0)::int as "todaySales",
            count(*) filter (where biz_date = (now() at time zone 'Asia/Tokyo')::date)::int as "todayOrders",
            coalesce(sum(amount) filter (where biz_date = ((now() at time zone 'Asia/Tokyo')::date - 7)), 0)::int as "lastWeekSales",
            count(*) filter (where biz_date = ((now() at time zone 'Asia/Tokyo')::date - 7))::int as "lastWeekOrders"
          from scoped
          group by hour
          order by hour
        `
      : Promise.resolve([]),
    canViewSalesStats
      ? sql`
          select
            coalesce(sum(amount) filter (
              where payment_status in ('paid', 'partial_refunded')
                and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
            ), 0)::int as "todaySales",
            count(*) filter (
              where payment_status in ('paid', 'partial_refunded')
                and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
            )::int as "todayOrders",
            count(*) filter (
              where status in ('new', 'preparing', 'ready')
                and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
            )::int as "activeOrders",
            coalesce(sum(amount) filter (
              where payment_status in ('paid', 'partial_refunded')
                and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date = ((now() at time zone 'Asia/Tokyo')::date - 7)
            ), 0)::int as "lastWeekSales",
            count(*) filter (
              where payment_status in ('paid', 'partial_refunded')
                and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
                and order_source in ('store_pos', 'table_qr')
            )::int as "posOrders",
            count(*) filter (
              where payment_status in ('paid', 'partial_refunded')
                and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
                and order_source in ('uber_eats', 'rocket_now', 'demae_can', 'wolt')
            )::int as "deliveryOrders",
            count(*) filter (
              where payment_status in ('paid', 'partial_refunded')
                and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
                and order_source not in ('store_pos', 'table_qr', 'uber_eats', 'rocket_now', 'demae_can', 'wolt')
            )::int as "webOrders"
          from store_customer_orders
          where (${access.allStores} or store_id::text = any(${access.storeIds}))
            and (${storeFilter}::text is null or store_id::text = ${storeFilter})
            and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date in (
              (now() at time zone 'Asia/Tokyo')::date,
              ((now() at time zone 'Asia/Tokyo')::date - 7)
            )
        `
      : Promise.resolve([]),
    canViewSalesStats && accessibleStoreIds.length
      ? sql`
          select
            store_id::text as "storeId",
            coalesce(sum(amount) filter (where payment_status in ('paid', 'partial_refunded')), 0)::int as "todaySales",
            count(*) filter (where payment_status in ('paid', 'partial_refunded'))::int as "todayOrders",
            count(*) filter (where status in ('new', 'preparing', 'ready'))::int as "activeOrders"
          from store_customer_orders
          where store_id::text = any(${accessibleStoreIds})
            and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
          group by store_id
        `
      : Promise.resolve([]),
    accessibleStoreIds.length
      ? sql`
          select distinct on (store_id, employee_id)
            store_id::text as "storeId",
            employee_id::text as "employeeId",
            punch_type as "punchType"
          from timecard_punches
          where store_id::text = any(${accessibleStoreIds})
            and punched_at >= now() - interval '36 hours'
          order by store_id, employee_id, punched_at desc
        `
      : Promise.resolve([]),
    accessibleStoreIds.length
      ? sql`
          select
            stores.id::text as "storeId",
            stores.business_hours as "businessHours",
            case
              when store_operations.temporary_status_until is not null and store_operations.temporary_status_until <= now() then true
              when store_operations.reservation_acceptance_mode = 'force_open' then true
              when store_operations.reservation_acceptance_mode = 'force_closed' then false
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
          where stores.id::text = any(${accessibleStoreIds})
        `
      : Promise.resolve([])
  ]);

  const rawSummary = (summaryRows[0] ?? {}) as Record<string, unknown>;
  const todaySales = Number(rawSummary.todaySales ?? 0);
  const todayOrders = Number(rawSummary.todayOrders ?? 0);
  const activeOrders = Number(rawSummary.activeOrders ?? 0);
  const lastWeekSales = Number(rawSummary.lastWeekSales ?? 0);
  const avgOrderValue = todayOrders > 0 ? Math.round(todaySales / todayOrders) : 0;
  const deltaPct = lastWeekSales > 0 ? Math.round(((todaySales - lastWeekSales) / lastWeekSales) * 1000) / 10 : null;

  const salesByStore = new Map<string, { todaySales: number; todayOrders: number; activeOrders: number }>();
  for (const row of storeSalesRows as Array<Record<string, unknown>>) {
    salesByStore.set(String(row.storeId), {
      todaySales: Number(row.todaySales ?? 0),
      todayOrders: Number(row.todayOrders ?? 0),
      activeOrders: Number(row.activeOrders ?? 0)
    });
  }

  const staffByStore = new Map<string, { working: number; onBreak: number }>();
  for (const row of punchRows as Array<Record<string, unknown>>) {
    const storeId = String(row.storeId);
    const punchType = String(row.punchType ?? "");
    if (!["clock_in", "break_start", "break_end"].includes(punchType)) continue;
    const current = staffByStore.get(storeId) ?? { working: 0, onBreak: 0 };
    if (punchType === "break_start") current.onBreak += 1;
    else current.working += 1;
    staffByStore.set(storeId, current);
  }

  const operationByStore = new Map<string, Record<string, unknown>>();
  for (const row of operationRows as Array<Record<string, unknown>>) {
    operationByStore.set(String(row.storeId), row);
  }

  const stores: StoreCondition[] = access.stores.map((store) => {
    const sales = salesByStore.get(store.id);
    const staff = staffByStore.get(store.id);
    const op = operationByStore.get(store.id);
    const reception = op
      ? getStoreReceptionState({
          businessHours: op.businessHours,
          reservationsEnabled: op.reservationsEnabled !== false,
          statusNote: String(op.statusNote ?? "")
        })
      : null;

    return {
      id: store.id,
      name: store.name,
      todaySales: sales?.todaySales ?? 0,
      todayOrders: sales?.todayOrders ?? 0,
      activeOrders: sales?.activeOrders ?? 0,
      workingStaff: (staff?.working ?? 0) + (staff?.onBreak ?? 0),
      breakStaff: staff?.onBreak ?? 0,
      isAcceptingWeb: reception ? reception.isAcceptingNow : false,
      minimumPickupMinutes: op?.minimumPickupMinutes === null || op?.minimumPickupMinutes === undefined
        ? null
        : Number(op.minimumPickupMinutes),
      statusNote: String(op?.statusNote ?? "")
    };
  });

  return Response.json({
    canViewSalesStats,
    canSelectAllStores: access.allStores || access.stores.length > 1,
    selectedStoreId: storeFilter ?? "all",
    generatedAt: new Date().toISOString(),
    summary: {
      todaySales,
      todayOrders,
      activeOrders,
      avgOrderValue,
      lastWeekSales,
      deltaPct,
      channelBreakdown: {
        pos: Number(rawSummary.posOrders ?? 0),
        web: Number(rawSummary.webOrders ?? 0),
        delivery: Number(rawSummary.deliveryOrders ?? 0)
      }
    },
    hourlySeries: canViewSalesStats ? buildHourlySeries(hourlyRows as Array<Record<string, unknown>>) : [],
    stores
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
