import { requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { getStoreReceptionState } from "../../../../lib/store-business-hours";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

type PeriodKey = "today" | "yesterday" | "this_week" | "last_week" | "last_month";

type SeriesPoint = {
  key: string;
  label: string;
  currentSales: number;
  currentOrders: number;
  previousSales: number;
  previousOrders: number;
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

function parsePeriod(raw: string | null): PeriodKey {
  if (raw === "yesterday" || raw === "this_week" || raw === "last_week" || raw === "last_month") {
    return raw;
  }
  return "today";
}

function getTokyoTodayParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day)
  };
}

function toIsoDate(date: Date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatSlashDate(iso: string) {
  return iso.replace(/-/g, "/");
}

function addUtcDays(date: Date, days: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function computePeriodBounds(period: PeriodKey) {
  const { year, month, day } = getTokyoTodayParts();
  const todayUtc = new Date(Date.UTC(year, month - 1, day));
  const weekdayMon0 = (todayUtc.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6

  if (period === "today") {
    const start = toIsoDate(todayUtc);
    const prev = toIsoDate(addUtcDays(todayUtc, -7));
    return {
      granularity: "hourly" as const,
      currentStart: start,
      currentEnd: start,
      previousStart: prev,
      previousEnd: prev,
      rangeLabel: formatSlashDate(start),
      compareRangeLabel: `${formatSlashDate(prev)}（先週同曜日）`
    };
  }

  if (period === "yesterday") {
    const yest = addUtcDays(todayUtc, -1);
    const start = toIsoDate(yest);
    const prev = toIsoDate(addUtcDays(yest, -7));
    return {
      granularity: "hourly" as const,
      currentStart: start,
      currentEnd: start,
      previousStart: prev,
      previousEnd: prev,
      rangeLabel: formatSlashDate(start),
      compareRangeLabel: `${formatSlashDate(prev)}（前週同曜日）`
    };
  }

  if (period === "this_week") {
    const weekStart = addUtcDays(todayUtc, -weekdayMon0);
    const prevStart = addUtcDays(weekStart, -7);
    const prevEnd = addUtcDays(todayUtc, -7);
    const cs = toIsoDate(weekStart);
    const ce = toIsoDate(todayUtc);
    const ps = toIsoDate(prevStart);
    const pe = toIsoDate(prevEnd);
    return {
      granularity: "daily" as const,
      currentStart: cs,
      currentEnd: ce,
      previousStart: ps,
      previousEnd: pe,
      rangeLabel: `${formatSlashDate(cs)}〜${formatSlashDate(ce)}`,
      compareRangeLabel: `${formatSlashDate(ps)}〜${formatSlashDate(pe)}`
    };
  }

  if (period === "last_week") {
    const thisWeekStart = addUtcDays(todayUtc, -weekdayMon0);
    const lwStart = addUtcDays(thisWeekStart, -7);
    const lwEnd = addUtcDays(thisWeekStart, -1);
    const pwStart = addUtcDays(lwStart, -7);
    const pwEnd = addUtcDays(lwEnd, -7);
    const cs = toIsoDate(lwStart);
    const ce = toIsoDate(lwEnd);
    const ps = toIsoDate(pwStart);
    const pe = toIsoDate(pwEnd);
    return {
      granularity: "daily" as const,
      currentStart: cs,
      currentEnd: ce,
      previousStart: ps,
      previousEnd: pe,
      rangeLabel: `${formatSlashDate(cs)}〜${formatSlashDate(ce)}`,
      compareRangeLabel: `${formatSlashDate(ps)}〜${formatSlashDate(pe)}`
    };
  }

  // last_month
  const lmStart = new Date(Date.UTC(year, month - 2, 1));
  const lmEnd = new Date(Date.UTC(year, month - 1, 0));
  const pmStart = new Date(Date.UTC(year, month - 3, 1));
  const pmEnd = new Date(Date.UTC(year, month - 2, 0));
  const cs = toIsoDate(lmStart);
  const ce = toIsoDate(lmEnd);
  const ps = toIsoDate(pmStart);
  const pe = toIsoDate(pmEnd);
  return {
    granularity: "daily" as const,
    currentStart: cs,
    currentEnd: ce,
    previousStart: ps,
    previousEnd: pe,
    rangeLabel: `${formatSlashDate(cs)}〜${formatSlashDate(ce)}`,
    compareRangeLabel: `${formatSlashDate(ps)}〜${formatSlashDate(pe)}`
  };
}

function buildHourlySeries(rows: Array<Record<string, unknown>>): SeriesPoint[] {
  const byHour = new Map<number, { currentSales: number; currentOrders: number; previousSales: number; previousOrders: number }>();
  let minHour = 10;
  let maxHour = 21;

  for (const row of rows) {
    const hour = Number(row.bucket);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    const currentSales = Number(row.currentSales ?? 0);
    const currentOrders = Number(row.currentOrders ?? 0);
    const previousSales = Number(row.previousSales ?? 0);
    const previousOrders = Number(row.previousOrders ?? 0);
    byHour.set(hour, { currentSales, currentOrders, previousSales, previousOrders });
    if (currentSales > 0 || previousSales > 0 || currentOrders > 0 || previousOrders > 0) {
      if (hour < minHour) minHour = hour;
      if (hour > maxHour) maxHour = hour;
    }
  }

  const points: SeriesPoint[] = [];
  for (let hour = minHour; hour <= maxHour; hour += 1) {
    const entry = byHour.get(hour);
    points.push({
      key: String(hour),
      label: `${hour}時`,
      currentSales: entry?.currentSales ?? 0,
      currentOrders: entry?.currentOrders ?? 0,
      previousSales: entry?.previousSales ?? 0,
      previousOrders: entry?.previousOrders ?? 0
    });
  }
  return points;
}

function buildDailySeries(
  currentStart: string,
  currentEnd: string,
  previousStart: string,
  rows: Array<Record<string, unknown>>
): SeriesPoint[] {
  const byDayOffset = new Map<number, { currentSales: number; currentOrders: number; previousSales: number; previousOrders: number }>();
  for (const row of rows) {
    const offset = Number(row.bucket);
    if (!Number.isInteger(offset) || offset < 0) continue;
    byDayOffset.set(offset, {
      currentSales: Number(row.currentSales ?? 0),
      currentOrders: Number(row.currentOrders ?? 0),
      previousSales: Number(row.previousSales ?? 0),
      previousOrders: Number(row.previousOrders ?? 0)
    });
  }

  const startDate = new Date(`${currentStart}T00:00:00Z`);
  const endDate = new Date(`${currentEnd}T00:00:00Z`);
  const totalDays = Math.max(1, Math.min(31, Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1));

  const points: SeriesPoint[] = [];
  for (let i = 0; i < totalDays; i += 1) {
    const dayDate = addUtcDays(startDate, i);
    const m = dayDate.getUTCMonth() + 1;
    const d = dayDate.getUTCDate();
    const entry = byDayOffset.get(i);
    points.push({
      key: `${previousStart}:${i}`,
      label: `${m}/${d}`,
      currentSales: entry?.currentSales ?? 0,
      currentOrders: entry?.currentOrders ?? 0,
      previousSales: entry?.previousSales ?? 0,
      previousOrders: entry?.previousOrders ?? 0
    });
  }
  return points;
}

function computeDeltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) {
    return Response.json({ error: "ログインしてください。" }, { status: 401 });
  }

  const access = await getStoreOrderAccess(session);
  const url = new URL(request.url);
  const requestedStoreId = url.searchParams.get("storeId")?.trim() ?? "";
  const period = parsePeriod(url.searchParams.get("period"));
  const bounds = computePeriodBounds(period);

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

  const [seriesRows, summaryRows, storeSalesRows, punchRows, operationRows] = await Promise.all([
    canViewSalesStats
      ? bounds.granularity === "hourly"
        ? sql`
            with scoped as (
              select
                extract(hour from (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo'))::int as bucket,
                (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date as biz_date,
                amount
              from store_customer_orders
              where payment_status in ('paid', 'partial_refunded')
                and (${access.allStores} or store_id::text = any(${access.storeIds}))
                and (${storeFilter}::text is null or store_id::text = ${storeFilter})
                and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date in (
                  ${bounds.currentStart}::date,
                  ${bounds.previousStart}::date
                )
            )
            select
              bucket,
              coalesce(sum(amount) filter (where biz_date = ${bounds.currentStart}::date), 0)::int as "currentSales",
              count(*) filter (where biz_date = ${bounds.currentStart}::date)::int as "currentOrders",
              coalesce(sum(amount) filter (where biz_date = ${bounds.previousStart}::date), 0)::int as "previousSales",
              count(*) filter (where biz_date = ${bounds.previousStart}::date)::int as "previousOrders"
            from scoped
            group by bucket
            order by bucket
          `
        : sql`
            with scoped as (
              select
                (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date as biz_date,
                amount
              from store_customer_orders
              where payment_status in ('paid', 'partial_refunded')
                and (${access.allStores} or store_id::text = any(${access.storeIds}))
                and (${storeFilter}::text is null or store_id::text = ${storeFilter})
                and (
                  (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date between ${bounds.currentStart}::date and ${bounds.currentEnd}::date
                  or (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date between ${bounds.previousStart}::date and ${bounds.previousEnd}::date
                )
            ),
            bucketed as (
              select
                case
                  when biz_date between ${bounds.currentStart}::date and ${bounds.currentEnd}::date then (biz_date - ${bounds.currentStart}::date)
                  else (biz_date - ${bounds.previousStart}::date)
                end as bucket,
                (biz_date between ${bounds.currentStart}::date and ${bounds.currentEnd}::date) as is_current,
                amount
              from scoped
            )
            select
              bucket::int as bucket,
              coalesce(sum(amount) filter (where is_current), 0)::int as "currentSales",
              count(*) filter (where is_current)::int as "currentOrders",
              coalesce(sum(amount) filter (where not is_current), 0)::int as "previousSales",
              count(*) filter (where not is_current)::int as "previousOrders"
            from bucketed
            group by bucket
            order by bucket
          `
      : Promise.resolve([]),
    canViewSalesStats
      ? sql`
          select
            coalesce(sum(amount) filter (
              where payment_status in ('paid', 'partial_refunded')
                and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date between ${bounds.currentStart}::date and ${bounds.currentEnd}::date
            ), 0)::int as "currentSales",
            count(*) filter (
              where payment_status in ('paid', 'partial_refunded')
                and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date between ${bounds.currentStart}::date and ${bounds.currentEnd}::date
            )::int as "currentOrders",
            count(*) filter (
              where status in ('new', 'preparing', 'ready')
                and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
            )::int as "activeOrders",
            coalesce(sum(amount) filter (
              where payment_status in ('paid', 'partial_refunded')
                and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date between ${bounds.previousStart}::date and ${bounds.previousEnd}::date
            ), 0)::int as "previousSales",
            count(*) filter (
              where payment_status in ('paid', 'partial_refunded')
                and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date between ${bounds.previousStart}::date and ${bounds.previousEnd}::date
            )::int as "previousOrders",
            count(*) filter (
              where payment_status in ('paid', 'partial_refunded')
                and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date between ${bounds.currentStart}::date and ${bounds.currentEnd}::date
                and order_source in ('store_pos', 'table_qr')
            )::int as "posOrders",
            count(*) filter (
              where payment_status in ('paid', 'partial_refunded')
                and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date between ${bounds.currentStart}::date and ${bounds.currentEnd}::date
                and order_source in ('uber_eats', 'rocket_now', 'demae_can', 'wolt')
            )::int as "deliveryOrders",
            count(*) filter (
              where payment_status in ('paid', 'partial_refunded')
                and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date between ${bounds.currentStart}::date and ${bounds.currentEnd}::date
                and order_source not in ('store_pos', 'table_qr', 'uber_eats', 'rocket_now', 'demae_can', 'wolt')
            )::int as "webOrders"
          from store_customer_orders
          where (${access.allStores} or store_id::text = any(${access.storeIds}))
            and (${storeFilter}::text is null or store_id::text = ${storeFilter})
            and (
              (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date between ${bounds.currentStart}::date and ${bounds.currentEnd}::date
              or (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date between ${bounds.previousStart}::date and ${bounds.previousEnd}::date
              or (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
            )
        `
      : Promise.resolve([]),
    canViewSalesStats && accessibleStoreIds.length
      ? sql`
          select
            store_id::text as "storeId",
            coalesce(sum(amount) filter (
              where payment_status in ('paid', 'partial_refunded')
                and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date between ${bounds.currentStart}::date and ${bounds.currentEnd}::date
            ), 0)::int as "periodSales",
            count(*) filter (
              where payment_status in ('paid', 'partial_refunded')
                and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date between ${bounds.currentStart}::date and ${bounds.currentEnd}::date
            )::int as "periodOrders",
            count(*) filter (
              where status in ('new', 'preparing', 'ready')
                and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
            )::int as "activeOrders"
          from store_customer_orders
          where store_id::text = any(${accessibleStoreIds})
            and (
              (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date between ${bounds.currentStart}::date and ${bounds.currentEnd}::date
              or (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date
            )
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
  const currentSales = Number(rawSummary.currentSales ?? 0);
  const currentOrders = Number(rawSummary.currentOrders ?? 0);
  const activeOrders = Number(rawSummary.activeOrders ?? 0);
  const previousSales = Number(rawSummary.previousSales ?? 0);
  const previousOrders = Number(rawSummary.previousOrders ?? 0);
  const avgOrderValue = currentOrders > 0 ? Math.round(currentSales / currentOrders) : 0;

  const salesByStore = new Map<string, { periodSales: number; periodOrders: number; activeOrders: number }>();
  for (const row of storeSalesRows as Array<Record<string, unknown>>) {
    salesByStore.set(String(row.storeId), {
      periodSales: Number(row.periodSales ?? 0),
      periodOrders: Number(row.periodOrders ?? 0),
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
      todaySales: sales?.periodSales ?? 0,
      todayOrders: sales?.periodOrders ?? 0,
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

  const series = canViewSalesStats
    ? bounds.granularity === "hourly"
      ? buildHourlySeries(seriesRows as Array<Record<string, unknown>>)
      : buildDailySeries(bounds.currentStart, bounds.currentEnd, bounds.previousStart, seriesRows as Array<Record<string, unknown>>)
    : [];

  return Response.json({
    canViewSalesStats,
    canSelectAllStores: access.allStores || access.stores.length > 1,
    selectedStoreId: storeFilter ?? "all",
    period,
    granularity: bounds.granularity,
    rangeLabel: bounds.rangeLabel,
    compareRangeLabel: bounds.compareRangeLabel,
    generatedAt: new Date().toISOString(),
    summary: {
      todaySales: currentSales,
      todayOrders: currentOrders,
      activeOrders,
      avgOrderValue,
      lastWeekSales: previousSales,
      previousOrders,
      deltaPct: computeDeltaPct(currentSales, previousSales),
      deltaOrdersPct: computeDeltaPct(currentOrders, previousOrders),
      channelBreakdown: {
        pos: Number(rawSummary.posOrders ?? 0),
        web: Number(rawSummary.webOrders ?? 0),
        delivery: Number(rawSummary.deliveryOrders ?? 0)
      }
    },
    series,
    stores
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
