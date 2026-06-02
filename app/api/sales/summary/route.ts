import { getSessionStoreScope, requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import {
  getJstMonthLabel,
  getJstMonthRange,
  isTimecardPunchType,
  summarizeTimecardDays,
  type TimecardPunch
} from "../../../../lib/timecard";

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

const deliveryFeeRate = 0.385;
const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];
const defaultWeatherLocation = {
  name: "福岡市",
  latitude: 33.5902,
  longitude: 130.4017
};

type WeatherDay = {
  date: string;
  weatherCode: number | null;
  weatherLabel: string;
  temperatureMean: number | null;
  precipitation: number | null;
};

function getRevenueGroup(channel: string, sourcePlatform: string) {
  if (channel === "delivery" || ["uber_eats", "rocket_now", "demae_can"].includes(sourcePlatform)) {
    return { key: "delivery", label: "デリバリー", feeRate: deliveryFeeRate };
  }

  return { key: "in_store", label: "店内・予約", feeRate: 0 };
}

function getWeatherLabel(code: number | null) {
  if (code === null) return "未取得";
  if (code === 0) return "快晴";
  if ([1, 2, 3].includes(code)) return "晴れ・曇り";
  if ([45, 48].includes(code)) return "霧";
  if ([51, 53, 55, 56, 57].includes(code)) return "小雨";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "雨";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "雪";
  if ([95, 96, 99].includes(code)) return "雷雨";
  return "その他";
}

async function getHistoricalWeather(
  latitude: number,
  longitude: number,
  startDate: string,
  endDate: string
) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    start_date: startDate,
    end_date: endDate,
    daily: "weather_code,temperature_2m_mean,precipitation_sum",
    timezone: "Asia/Tokyo"
  });

  try {
    const response = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params.toString()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return new Map<string, WeatherDay>();
    const body = await response.json() as {
      daily?: {
        time?: string[];
        weather_code?: Array<number | null>;
        temperature_2m_mean?: Array<number | null>;
        precipitation_sum?: Array<number | null>;
      };
    };
    const dates = body.daily?.time ?? [];
    const weatherMap = new Map<string, WeatherDay>();
    dates.forEach((date, index) => {
      const weatherCode = body.daily?.weather_code?.[index] ?? null;
      weatherMap.set(date, {
        date,
        weatherCode,
        weatherLabel: getWeatherLabel(weatherCode),
        temperatureMean: body.daily?.temperature_2m_mean?.[index] ?? null,
        precipitation: body.daily?.precipitation_sum?.[index] ?? null
      });
    });
    return weatherMap;
  } catch (error) {
    console.error("Failed to fetch weather history", error);
    return new Map<string, WeatherDay>();
  }
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
  const storeWeatherRows = selectedStoreId ? await sql`
    select
      coalesce(weather_location_name, '') as "weatherLocationName",
      weather_latitude::float as "weatherLatitude",
      weather_longitude::float as "weatherLongitude"
    from stores
    where id::text = ${selectedStoreId}
    limit 1
  ` : [];
  const storeWeather = storeWeatherRows[0] ?? {};
  const weatherLocationName = String(storeWeather.weatherLocationName ?? "") || defaultWeatherLocation.name;
  const weatherLatitude = Number.isFinite(Number(storeWeather.weatherLatitude))
    ? Number(storeWeather.weatherLatitude)
    : defaultWeatherLocation.latitude;
  const weatherLongitude = Number.isFinite(Number(storeWeather.weatherLongitude))
    ? Number(storeWeather.weatherLongitude)
    : defaultWeatherLocation.longitude;

  const orders = selectedStoreId ? await sql`
    select
      id::text,
      order_no as "orderNo",
      channel,
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
  const punchWindowStartUtc = new Date(startUtc.getTime() - 36 * 60 * 60 * 1000);
  const punchWindowEndUtc = new Date(endUtc.getTime() + 36 * 60 * 60 * 1000);
  const punches = selectedStoreId ? await sql`
    select
      timecard_punches.id::text,
      timecard_punches.employee_id::text as "employeeId",
      employees.name as "employeeName",
      timecard_punches.store_id::text as "storeId",
      stores.name as "storeName",
      timecard_punches.punch_type as "punchType",
      timecard_punches.punched_at as "punchedAt",
      timecard_punches.source,
      timecard_punches.note
    from timecard_punches
    join employees on employees.id = timecard_punches.employee_id
    join stores on stores.id = timecard_punches.store_id
    where timecard_punches.store_id::text = ${selectedStoreId}
      and timecard_punches.punched_at >= ${punchWindowStartUtc.toISOString()}
      and timecard_punches.punched_at < ${punchWindowEndUtc.toISOString()}
    order by timecard_punches.punched_at asc
  ` : [];
  const typedPunches = punches.map((row) => {
    const punchType = String(row.punchType);
    return {
      id: String(row.id),
      employeeId: String(row.employeeId),
      employeeName: String(row.employeeName),
      storeId: String(row.storeId),
      storeName: String(row.storeName),
      punchType: isTimecardPunchType(punchType) ? punchType : "clock_in",
      punchedAt: new Date(String(row.punchedAt)).toISOString(),
      source: row.source ? String(row.source) : null,
      note: row.note ? String(row.note) : null
    };
  }) satisfies TimecardPunch[];

  const dayMap = new Map<string, { date: string; orderCount: number; sales: number; workMinutes: number; ordersPerHour: number; salesPerHour: number }>();
  const hourMap = new Map<number, { hour: number; orderCount: number; sales: number }>();
  const platformMap = new Map<string, { sourcePlatform: string; orderCount: number; sales: number }>();
  const revenueGroupMap = new Map<string, { key: string; label: string; orderCount: number; sales: number; feeRate: number }>();
  const weekdayMap = new Map<number, {
    weekday: number;
    label: string;
    dayCount: number;
    orderCount: number;
    sales: number;
    workMinutes: number;
    ordersPerHour: number;
    salesPerHour: number;
    precipitationSum: number;
    rainyDayCount: number;
    temperatureTotal: number;
    weatherDayCount: number;
  }>();
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
  const endDateInclusive = `${month}-${String(getDaysInMonth(month)).padStart(2, "0")}`;
  const weatherByDate = selectedStoreId
    ? await getHistoricalWeather(weatherLatitude, weatherLongitude, `${month}-01`, endDateInclusive)
    : new Map<string, WeatherDay>();

  for (let day = 1; day <= getDaysInMonth(month); day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    dayMap.set(date, { date, orderCount: 0, sales: 0, workMinutes: 0, ordersPerHour: 0, salesPerHour: 0 });
  }
  for (let hour = 0; hour < 24; hour += 1) {
    hourMap.set(hour, { hour, orderCount: 0, sales: 0 });
  }
  for (let weekday = 0; weekday < 7; weekday += 1) {
    weekdayMap.set(weekday, {
      weekday,
      label: weekdayLabels[weekday],
      dayCount: 0,
      orderCount: 0,
      sales: 0,
      workMinutes: 0,
      ordersPerHour: 0,
      salesPerHour: 0,
      precipitationSum: 0,
      rainyDayCount: 0,
      temperatureTotal: 0,
      weatherDayCount: 0
    });
  }

  for (const order of orders) {
    const orderedAt = new Date(String(order.orderedAt));
    const date = formatter.format(orderedAt);
    const hour = Number(hourFormatter.format(orderedAt));
    const sales = Number(order.total ?? 0);
    const dayEntry = dayMap.get(date) ?? { date, orderCount: 0, sales: 0, workMinutes: 0, ordersPerHour: 0, salesPerHour: 0 };
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

    const group = getRevenueGroup(String(order.channel), sourcePlatform);
    const groupEntry = revenueGroupMap.get(group.key) ?? {
      key: group.key,
      label: group.label,
      orderCount: 0,
      sales: 0,
      feeRate: group.feeRate
    };
    groupEntry.orderCount += 1;
    groupEntry.sales += sales;
    revenueGroupMap.set(group.key, groupEntry);
  }

  const workDateEndExclusive = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(endUtc);
  const dailyWorkMinutes = new Map<string, number>();
  summarizeTimecardDays(typedPunches, {
    workDateStart: month + "-01",
    workDateEndExclusive
  }).forEach((summary) => {
    if (summary.workMinutes > 0) {
      dailyWorkMinutes.set(summary.workDate, (dailyWorkMinutes.get(summary.workDate) ?? 0) + summary.workMinutes);
    }
  });

  const daily = Array.from(dayMap.values()).map((day) => {
    const workMinutes = dailyWorkMinutes.get(day.date) ?? 0;
    const workHours = workMinutes / 60;
    const weather = weatherByDate.get(day.date) ?? {
      date: day.date,
      weatherCode: null,
      weatherLabel: "未取得",
      temperatureMean: null,
      precipitation: null
    };
    return {
      ...day,
      workMinutes,
      ordersPerHour: workHours > 0 ? day.orderCount / workHours : day.orderCount,
      salesPerHour: workHours > 0 ? Math.round(day.sales / workHours) : day.sales,
      weatherCode: weather.weatherCode,
      weatherLabel: weather.weatherLabel,
      temperatureMean: weather.temperatureMean,
      precipitation: weather.precipitation
    };
  });
  for (const day of daily) {
    const weekday = new Date(`${day.date}T00:00:00+09:00`).getDay();
    const entry = weekdayMap.get(weekday);
    if (!entry) continue;
    entry.dayCount += day.orderCount > 0 || day.workMinutes > 0 ? 1 : 0;
    entry.orderCount += day.orderCount;
    entry.sales += day.sales;
    entry.workMinutes += day.workMinutes;
    entry.precipitationSum += day.precipitation ?? 0;
    entry.weatherDayCount += day.temperatureMean === null ? 0 : 1;
    entry.temperatureTotal += day.temperatureMean ?? 0;
    if ((day.precipitation ?? 0) > 0) entry.rainyDayCount += 1;
  }
  const weekdays = Array.from(weekdayMap.values()).map((weekday) => {
    const workHours = weekday.workMinutes / 60;
    return {
      ...weekday,
      ordersPerHour: workHours > 0 ? weekday.orderCount / workHours : weekday.orderCount,
      salesPerHour: workHours > 0 ? Math.round(weekday.sales / workHours) : weekday.sales,
      temperatureMean: weekday.weatherDayCount > 0 ? Math.round((weekday.temperatureTotal / weekday.weatherDayCount) * 10) / 10 : null
    };
  });
  const hourly = Array.from(hourMap.values());
  const totalOrders = orders.length;
  const totalSales = orders.reduce((sum, order) => sum + Number(order.total ?? 0), 0);
  const revenueGroups = ["in_store", "delivery"].map((key) => {
    const fallback = key === "delivery"
      ? { key, label: "デリバリー", orderCount: 0, sales: 0, feeRate: deliveryFeeRate }
      : { key, label: "店内・予約", orderCount: 0, sales: 0, feeRate: 0 };
    const group = revenueGroupMap.get(key) ?? fallback;
    const estimatedFee = Math.round(group.sales * group.feeRate);
    return {
      ...group,
      estimatedFee,
      estimatedDeposit: group.sales - estimatedFee,
      share: totalSales > 0 ? (group.sales / totalSales) * 100 : 0
    };
  });
  const estimatedFeeTotal = revenueGroups.reduce((sum, group) => sum + group.estimatedFee, 0);
  const estimatedDepositTotal = revenueGroups.reduce((sum, group) => sum + group.estimatedDeposit, 0);
  const deliverySales = revenueGroups.find((group) => group.key === "delivery")?.sales ?? 0;
  const activeDays = daily.filter((day) => day.orderCount > 0 || day.workMinutes > 0);
  const busiestDays = [...activeDays].sort((a, b) => b.ordersPerHour - a.ordersPerHour || b.salesPerHour - a.salesPerHour || b.orderCount - a.orderCount).slice(0, 5);
  const quietestDays = [...activeDays].sort((a, b) => a.ordersPerHour - b.ordersPerHour || a.salesPerHour - b.salesPerHour || a.orderCount - b.orderCount).slice(0, 5);
  const activeWeekdays = weekdays.filter((weekday) => weekday.dayCount > 0);
  const busiestWeekdays = [...activeWeekdays].sort((a, b) => b.ordersPerHour - a.ordersPerHour || b.salesPerHour - a.salesPerHour || b.orderCount - a.orderCount).slice(0, 3);
  const quietestWeekdays = [...activeWeekdays].sort((a, b) => a.ordersPerHour - b.ordersPerHour || a.salesPerHour - b.salesPerHour || a.orderCount - b.orderCount).slice(0, 3);
  const peakHours = [...hourly].filter((hour) => hour.orderCount > 0).sort((a, b) => b.orderCount - a.orderCount || b.sales - a.sales).slice(0, 5);
  const imports = selectedStoreId ? await sql`
    select
      id::text,
      sales_source_id::text as "salesSourceId",
      import_month as "importMonth",
      source_platform as "sourcePlatform",
      file_name as "fileName",
      imported_order_count as "importedOrderCount",
      raw_row_count as "rawRowCount",
      created_at as "createdAt",
      metadata
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
      estimatedFee: estimatedFeeTotal,
      estimatedDeposit: estimatedDepositTotal,
      deliveryShare: totalSales > 0 ? (deliverySales / totalSales) * 100 : 0,
      averageOrderValue: totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0,
      activeDayCount: activeDays.length
    },
    weatherLocation: {
      name: weatherLocationName,
      latitude: weatherLatitude,
      longitude: weatherLongitude
    },
    revenueGroups,
    daily,
    weekdays,
    hourly,
    busiestDays,
    quietestDays,
    busiestWeekdays,
    quietestWeekdays,
    peakHours,
    platforms: Array.from(platformMap.values()).sort((a, b) => b.orderCount - a.orderCount),
    imports: imports.map((row) => ({
      id: String(row.id),
      salesSourceId: row.salesSourceId ? String(row.salesSourceId) : String(row.metadata?.salesSourceId ?? ""),
      importMonth: String(row.importMonth),
      sourcePlatform: String(row.sourcePlatform),
      fileName: String(row.fileName),
      importedOrderCount: Number(row.importedOrderCount ?? 0),
      rawRowCount: Number(row.rawRowCount ?? 0),
      createdAt: new Date(String(row.createdAt)).toISOString(),
      brandName: String(row.metadata?.brandName ?? "")
    }))
  });
}
