import { getSessionStoreScope, requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { getJstMonthLabel, getJstMonthRange } from "../../../../lib/timecard";

async function getVisibleStores(allStores: boolean, storeIds: string[]) {
  if (allStores) {
    return sql`
      select id::text, name
      from stores
      where status = 'active'
      order by name
    `;
  }
  if (storeIds.length === 0) return [];
  return sql`
    select id::text, name
    from stores
    where status = 'active'
      and id::text = any(${storeIds})
    order by name
  `;
}

function getDaysInMonth(month: string) {
  const [year, monthText] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthText, 0)).getUTCDate();
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const url = new URL(request.url);
  const monthParam = url.searchParams.get("month") || getJstMonthLabel();
  const { month, startUtc, endUtc } = getJstMonthRange(monthParam);
  const scope = await getSessionStoreScope(session);
  const stores = await getVisibleStores(scope.allStores, scope.storeIds);
  const visibleStoreIds = stores.map((store) => String(store.id));
  const requestedStoreId = url.searchParams.get("storeId");
  const selectedStoreId = requestedStoreId && visibleStoreIds.includes(requestedStoreId)
    ? requestedStoreId
    : visibleStoreIds[0] ?? "";

  const orders = selectedStoreId ? await sql`
    select
      id::text,
      order_no as "orderNo",
      source_platform as "sourcePlatform",
      ordered_at as "orderedAt",
      subtotal,
      discount,
      tax,
      total,
      metadata
    from sales_orders
    where store_id::text = ${selectedStoreId}
      and ordered_at >= ${startUtc.toISOString()}
      and ordered_at < ${endUtc.toISOString()}
      and status <> 'cancelled'
      and payment_status <> 'failed'
      and total > 0
    order by ordered_at asc
  ` : [];

  const dayMap = new Map<string, { date: string; orderCount: number; sales: number }>();
  const hourMap = new Map<number, { hour: number; orderCount: number; sales: number }>();
  const platformMap = new Map<string, { sourcePlatform: string; orderCount: number; sales: number }>();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const hourFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    hour12: false
  });

  for (let day = 1; day <= getDaysInMonth(month); day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    dayMap.set(date, { date, orderCount: 0, sales: 0 });
  }
  for (let hour = 0; hour < 24; hour += 1) {
    hourMap.set(hour, { hour, orderCount: 0, sales: 0 });
  }

  for (const order of orders) {
    const orderedAt = new Date(String(order.orderedAt));
    const date = formatter.format(orderedAt);
    const hour = Number(hourFormatter.format(orderedAt));
    const sales = Number(order.total ?? 0);
    const dayEntry = dayMap.get(date) ?? { date, orderCount: 0, sales: 0 };
    dayEntry.orderCount += 1;
    dayEntry.sales += sales;
    dayMap.set(date, dayEntry);

    const hourEntry = hourMap.get(hour) ?? { hour, orderCount: 0, sales: 0 };
    hourEntry.orderCount += 1;
    hourEntry.sales += sales;
    hourMap.set(hour, hourEntry);

    const sourcePlatform = String(order.sourcePlatform);
    const platformEntry = platformMap.get(sourcePlatform) ?? { sourcePlatform, orderCount: 0, sales: 0 };
    platformEntry.orderCount += 1;
    platformEntry.sales += sales;
    platformMap.set(sourcePlatform, platformEntry);
  }

  const daily = Array.from(dayMap.values());
  const hourly = Array.from(hourMap.values());
  const totalOrders = orders.length;
  const totalSales = orders.reduce((sum, order) => sum + Number(order.total ?? 0), 0);
  const activeDays = daily.filter((day) => day.orderCount > 0);
  const busiestDays = [...activeDays].sort((a, b) => b.orderCount - a.orderCount || b.sales - a.sales).slice(0, 5);
  const quietestDays = [...activeDays].sort((a, b) => a.orderCount - b.orderCount || a.sales - b.sales).slice(0, 5);
  const peakHours = [...hourly].filter((hour) => hour.orderCount > 0).sort((a, b) => b.orderCount - a.orderCount || b.sales - a.sales).slice(0, 5);
  const imports = selectedStoreId ? await sql`
    select
      id::text,
      import_month as "importMonth",
      source_platform as "sourcePlatform",
      file_name as "fileName",
      imported_order_count as "importedOrderCount",
      raw_row_count as "rawRowCount",
      created_at as "createdAt"
    from sales_import_batches
    where store_id::text = ${selectedStoreId}
      and import_month = ${month}
    order by created_at desc
    limit 5
  ` : [];

  return Response.json({
    month,
    stores,
    selectedStoreId,
    totals: {
      orderCount: totalOrders,
      sales: totalSales,
      averageOrderValue: totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0,
      activeDayCount: activeDays.length
    },
    daily,
    hourly,
    busiestDays,
    quietestDays,
    peakHours,
    platforms: Array.from(platformMap.values()).sort((a, b) => b.orderCount - a.orderCount),
    imports: imports.map((row) => ({
      id: String(row.id),
      importMonth: String(row.importMonth),
      sourcePlatform: String(row.sourcePlatform),
      fileName: String(row.fileName),
      importedOrderCount: Number(row.importedOrderCount ?? 0),
      rawRowCount: Number(row.rawRowCount ?? 0),
      createdAt: new Date(String(row.createdAt)).toISOString()
    }))
  });
}
