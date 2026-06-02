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

function getDatesBetween(startDate: string, endDate: string) {
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    dates.push(date);
    if (dates.length > 400) break;
  }
  return dates;
}

const deliveryFeeRate = 0.385;
const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];
const managementRoles = new Set(["owner", "manager", "store_owner"]);
const hourMs = 60 * 60 * 1000;
const workloadLevels = [
  { key: "veryIdle", label: "かなり空き", scoreKey: "scoreVeryIdle" },
  { key: "normal", label: "通常", scoreKey: "scoreNormal" },
  { key: "busy", label: "忙しい", scoreKey: "scoreBusy" },
  { key: "high", label: "高負荷", scoreKey: "scoreHigh" },
  { key: "extreme", label: "超負荷", scoreKey: "scoreExtreme" }
] as const;
const defaultWorkloadSettings = {
  includeManagement: true,
  minOrderLoadScore: 1,
  amountScoreMultiplier: 1,
  orderVeryIdleMax: 4,
  orderNormalMax: 8,
  orderBusyMax: 12,
  orderHighMax: 15,
  salesVeryIdleMax: 4999,
  salesNormalMax: 9999,
  salesBusyMax: 14999,
  salesHighMax: 19999,
  scoreVeryIdle: 20,
  scoreNormal: 60,
  scoreBusy: 90,
  scoreHigh: 120,
  scoreExtreme: 150
};
const defaultWeatherLocation = {
  name: "福岡市",
  latitude: 33.5902,
  longitude: 130.4017
};

type WorkloadSettings = typeof defaultWorkloadSettings;

type WeatherDay = {
  date: string;
  weatherCode: number | null;
  weatherLabel: string;
  temperatureMean: number | null;
  precipitation: number | null;
};

type WorkloadOrder = {
  orderedAtMs: number;
  total: number;
  loadScore: number;
};

function getRevenueGroup(channel: string, sourcePlatform: string) {
  if (channel === "delivery" || ["uber_eats", "rocket_now", "demae_can"].includes(sourcePlatform)) {
    return { key: "delivery", label: "デリバリー", feeRate: deliveryFeeRate };
  }

  return { key: "in_store", label: "店内・予約", feeRate: 0 };
}

function numberFrom(value: unknown, fallback: number) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : fallback;
}

function normalizeWorkloadSettings(settings: Partial<WorkloadSettings>): WorkloadSettings {
  return {
    includeManagement: settings.includeManagement !== false,
    minOrderLoadScore: numberFrom(settings.minOrderLoadScore, defaultWorkloadSettings.minOrderLoadScore),
    amountScoreMultiplier: numberFrom(settings.amountScoreMultiplier, defaultWorkloadSettings.amountScoreMultiplier),
    orderVeryIdleMax: numberFrom(settings.orderVeryIdleMax, defaultWorkloadSettings.orderVeryIdleMax),
    orderNormalMax: numberFrom(settings.orderNormalMax, defaultWorkloadSettings.orderNormalMax),
    orderBusyMax: numberFrom(settings.orderBusyMax, defaultWorkloadSettings.orderBusyMax),
    orderHighMax: numberFrom(settings.orderHighMax, defaultWorkloadSettings.orderHighMax),
    salesVeryIdleMax: numberFrom(settings.salesVeryIdleMax, defaultWorkloadSettings.salesVeryIdleMax),
    salesNormalMax: numberFrom(settings.salesNormalMax, defaultWorkloadSettings.salesNormalMax),
    salesBusyMax: numberFrom(settings.salesBusyMax, defaultWorkloadSettings.salesBusyMax),
    salesHighMax: numberFrom(settings.salesHighMax, defaultWorkloadSettings.salesHighMax),
    scoreVeryIdle: numberFrom(settings.scoreVeryIdle, defaultWorkloadSettings.scoreVeryIdle),
    scoreNormal: numberFrom(settings.scoreNormal, defaultWorkloadSettings.scoreNormal),
    scoreBusy: numberFrom(settings.scoreBusy, defaultWorkloadSettings.scoreBusy),
    scoreHigh: numberFrom(settings.scoreHigh, defaultWorkloadSettings.scoreHigh),
    scoreExtreme: numberFrom(settings.scoreExtreme, defaultWorkloadSettings.scoreExtreme)
  };
}

async function getWorkloadSettings(storeId: string) {
  const rows = await sql`
    select
      coalesce(order_very_idle_max, 4) as "orderVeryIdleMax",
      coalesce(order_normal_max, 8) as "orderNormalMax",
      coalesce(order_busy_max, 12) as "orderBusyMax",
      coalesce(order_high_max, 15) as "orderHighMax",
      coalesce(include_management, true) as "includeManagement",
      coalesce(min_order_load_score, 1) as "minOrderLoadScore",
      coalesce(amount_score_multiplier, 1) as "amountScoreMultiplier",
      coalesce(sales_very_idle_max, 4999) as "salesVeryIdleMax",
      coalesce(sales_normal_max, 9999) as "salesNormalMax",
      coalesce(sales_busy_max, 14999) as "salesBusyMax",
      coalesce(sales_high_max, 19999) as "salesHighMax",
      coalesce(score_very_idle, 20) as "scoreVeryIdle",
      coalesce(score_normal, 60) as "scoreNormal",
      coalesce(score_busy, 90) as "scoreBusy",
      coalesce(score_high, 120) as "scoreHigh",
      coalesce(score_extreme, 150) as "scoreExtreme"
    from timecard_workload_settings
    where store_id::text = ${storeId}
    limit 1
  `;
  return normalizeWorkloadSettings(rows[0] ?? defaultWorkloadSettings);
}

function getPeakHourMetrics(orders: WorkloadOrder[]) {
  const sorted = [...orders].sort((a, b) => a.orderedAtMs - b.orderedAtMs);
  let peakOrderCount = 0;
  let peakSales = 0;
  let peakLoadScore = 0;
  let end = 0;
  for (let start = 0; start < sorted.length; start += 1) {
    while (end < sorted.length && sorted[end].orderedAtMs - sorted[start].orderedAtMs <= hourMs) end += 1;
    const windowOrders = sorted.slice(start, end);
    peakOrderCount = Math.max(peakOrderCount, windowOrders.length);
    peakSales = Math.max(peakSales, windowOrders.reduce((sum, order) => sum + order.total, 0));
    peakLoadScore = Math.max(peakLoadScore, windowOrders.reduce((sum, order) => sum + order.loadScore, 0));
  }
  return {
    peakOrderCount,
    peakSales,
    peakLoadScore
  };
}

function getLoadLevelIndex(ordersPerHour: number, salesPerHour: number, settings: WorkloadSettings) {
  const orderLevel = ordersPerHour <= settings.orderVeryIdleMax
    ? 0
    : ordersPerHour <= settings.orderNormalMax
      ? 1
      : ordersPerHour <= settings.orderBusyMax
        ? 2
        : ordersPerHour <= settings.orderHighMax
          ? 3
          : 4;
  const salesLevel = salesPerHour <= settings.salesVeryIdleMax
    ? 0
    : salesPerHour <= settings.salesNormalMax
      ? 1
      : salesPerHour <= settings.salesBusyMax
        ? 2
        : salesPerHour <= settings.salesHighMax
          ? 3
          : 4;
  return Math.max(orderLevel, salesLevel);
}

function getLoadLevelMetrics(ordersPerHour: number, salesPerHour: number, settings: WorkloadSettings) {
  const level = workloadLevels[getLoadLevelIndex(ordersPerHour, salesPerHour, settings)];
  return {
    loadLevel: level.key,
    loadLevelLabel: level.label,
    loadLevelScore: settings[level.scoreKey]
  };
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
  const monthRange = getJstMonthRange(monthParam);
  const requestedStartDate = url.searchParams.get("startDate");
  const requestedEndDate = url.searchParams.get("endDate");
  const hasCustomRange = isDateString(requestedStartDate) && isDateString(requestedEndDate) && String(requestedStartDate) <= String(requestedEndDate);
  const startDate = hasCustomRange ? String(requestedStartDate) : `${monthRange.month}-01`;
  const endDate = hasCustomRange ? String(requestedEndDate) : `${monthRange.month}-${String(getDaysInMonth(monthRange.month)).padStart(2, "0")}`;
  const { startUtc, endUtc } = hasCustomRange ? getJstDateRange(startDate, endDate) : monthRange;
  const month = monthRange.month;
  const scope = await getSessionStoreScope(session);
  const stores = await getVisibleStores(scope.allStores, scope.storeIds);
  const visibleStoreIds = stores.map((store) => String(store.id));
  const requestedStoreId = url.searchParams.get("storeId");
  const selectedStoreId = requestedStoreId && visibleStoreIds.includes(requestedStoreId)
    ? requestedStoreId
    : visibleStoreIds[0] ?? "";
  const workloadSettings = selectedStoreId ? await getWorkloadSettings(selectedStoreId) : defaultWorkloadSettings;
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
      employees.role as "employeeRole",
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
  const employeeRoleById = new Map(punches.map((row) => [String(row.employeeId), String(row.employeeRole)]));
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
  const workDateEndExclusive = addDays(endDate, 1);
  const dailySummaries = summarizeTimecardDays(typedPunches, {
    workDateStart: startDate,
    workDateEndExclusive
  }).filter((summary) => (
    summary.clockIn
    && summary.clockOut
    && summary.workMinutes > 0
    && (workloadSettings.includeManagement || !managementRoles.has(employeeRoleById.get(summary.employeeId) ?? ""))
  ));
  const shiftIntervals = dailySummaries.map((summary) => ({
    workDate: summary.workDate,
    startMs: new Date(summary.clockIn as string).getTime(),
    endMs: new Date(summary.clockOut as string).getTime(),
    workMinutes: summary.workMinutes
  }));
  const dailyWorkMinutes = new Map<string, number>();
  for (const summary of dailySummaries) {
    dailyWorkMinutes.set(summary.workDate, (dailyWorkMinutes.get(summary.workDate) ?? 0) + summary.workMinutes);
  }
  const averageOrderTotal = orders.length > 0
    ? orders.reduce((sum, order) => sum + Number(order.total ?? 0), 0) / orders.length
    : 0;
  const dailyPeakMetrics = new Map<string, {
    peakHourOrderCount: number;
    peakHourSales: number;
    peakHourLoadScore: number;
  }>();
  for (const shift of shiftIntervals) {
    const shiftOrders = orders.filter((order) => {
      const orderedAt = new Date(String(order.orderedAt)).getTime();
      return orderedAt >= shift.startMs && orderedAt <= shift.endMs;
    });
    const workloadOrders = shiftOrders.map((order) => {
      const total = Number(order.total ?? 0);
      return {
        orderedAtMs: new Date(String(order.orderedAt)).getTime(),
        total,
        loadScore: averageOrderTotal > 0
          ? Math.max(workloadSettings.minOrderLoadScore, (total / averageOrderTotal) * workloadSettings.amountScoreMultiplier)
          : workloadSettings.minOrderLoadScore
      };
    });
    const peakMetrics = getPeakHourMetrics(workloadOrders);
    const entry = dailyPeakMetrics.get(shift.workDate) ?? {
      peakHourOrderCount: 0,
      peakHourSales: 0,
      peakHourLoadScore: 0
    };
    entry.peakHourOrderCount = Math.max(entry.peakHourOrderCount, peakMetrics.peakOrderCount);
    entry.peakHourSales = Math.max(entry.peakHourSales, peakMetrics.peakSales);
    entry.peakHourLoadScore = Math.max(entry.peakHourLoadScore, peakMetrics.peakLoadScore);
    dailyPeakMetrics.set(shift.workDate, entry);
  }

  const dayMap = new Map<string, {
    date: string;
    orderCount: number;
    sales: number;
    inStoreSales: number;
    deliverySales: number;
    deliveryEstimatedDeposit: number;
    workMinutes: number;
    ordersPerHour: number;
    salesPerHour: number;
    peakHourOrderCount: number;
    peakHourSales: number;
    peakHourLoadScore: number;
    peakLoadLevelScore: number;
  }>();
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
  const weatherByDate = selectedStoreId
    ? await getHistoricalWeather(weatherLatitude, weatherLongitude, startDate, endDate)
    : new Map<string, WeatherDay>();

  for (const date of getDatesBetween(startDate, endDate)) {
    dayMap.set(date, {
      date,
      orderCount: 0,
      sales: 0,
      inStoreSales: 0,
      deliverySales: 0,
      deliveryEstimatedDeposit: 0,
      workMinutes: 0,
      ordersPerHour: 0,
      salesPerHour: 0,
      peakHourOrderCount: 0,
      peakHourSales: 0,
      peakHourLoadScore: 0,
      peakLoadLevelScore: 0
    });
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
    const orderedAtMs = orderedAt.getTime();
    const matchedShift = shiftIntervals.find((shift) => orderedAtMs >= shift.startMs && orderedAtMs <= shift.endMs);
    const date = matchedShift?.workDate ?? formatter.format(orderedAt);
    const hour = Number(hourFormatter.format(orderedAt));
    const sales = Number(order.total ?? 0);
    const group = getRevenueGroup(String(order.channel), String(order.sourcePlatform));
    const dayEntry = dayMap.get(date) ?? {
      date,
      orderCount: 0,
      sales: 0,
      inStoreSales: 0,
      deliverySales: 0,
      deliveryEstimatedDeposit: 0,
      workMinutes: 0,
      ordersPerHour: 0,
      salesPerHour: 0,
      peakHourOrderCount: 0,
      peakHourSales: 0,
      peakHourLoadScore: 0,
      peakLoadLevelScore: 0
    };
    dayEntry.orderCount += 1;
    dayEntry.sales += sales;
    if (group.key === "delivery") {
      dayEntry.deliverySales += sales;
      dayEntry.deliveryEstimatedDeposit += Math.round(sales * (1 - group.feeRate));
    } else {
      dayEntry.inStoreSales += sales;
    }
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

  const daily = Array.from(dayMap.values()).map((day) => {
    const workMinutes = dailyWorkMinutes.get(day.date) ?? 0;
    const workHours = workMinutes / 60;
    const ordersPerHour = workHours > 0 ? day.orderCount / workHours : 0;
    const salesPerHour = workHours > 0 ? Math.round(day.sales / workHours) : 0;
    const peakMetrics = dailyPeakMetrics.get(day.date) ?? {
      peakHourOrderCount: 0,
      peakHourSales: 0,
      peakHourLoadScore: 0
    };
    const averageLoadLevel = getLoadLevelMetrics(ordersPerHour, salesPerHour, workloadSettings);
    const peakLoadLevel = getLoadLevelMetrics(peakMetrics.peakHourOrderCount, peakMetrics.peakHourSales, workloadSettings);
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
      workloadAvailable: workHours > 0,
      ordersPerHour,
      salesPerHour,
      loadLevel: peakMetrics.peakHourOrderCount > 0 ? peakLoadLevel.loadLevel : averageLoadLevel.loadLevel,
      loadLevelLabel: peakMetrics.peakHourOrderCount > 0 ? peakLoadLevel.loadLevelLabel : averageLoadLevel.loadLevelLabel,
      averageLoadLevel: averageLoadLevel.loadLevel,
      averageLoadLevelLabel: averageLoadLevel.loadLevelLabel,
      peakLoadLevel: peakLoadLevel.loadLevel,
      peakLoadLevelLabel: peakLoadLevel.loadLevelLabel,
      peakLoadLevelScore: peakMetrics.peakHourOrderCount > 0 ? peakLoadLevel.loadLevelScore : averageLoadLevel.loadLevelScore,
      peakHourOrderCount: peakMetrics.peakHourOrderCount,
      peakHourSales: peakMetrics.peakHourSales,
      peakHourLoadScore: peakMetrics.peakHourLoadScore,
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
    if (day.workMinutes > 0) {
      entry.dayCount += 1;
      entry.orderCount += day.orderCount;
      entry.sales += day.sales;
      entry.workMinutes += day.workMinutes;
    }
    entry.precipitationSum += day.precipitation ?? 0;
    entry.weatherDayCount += day.temperatureMean === null ? 0 : 1;
    entry.temperatureTotal += day.temperatureMean ?? 0;
    if ((day.precipitation ?? 0) > 0) entry.rainyDayCount += 1;
  }
  const weekdays = Array.from(weekdayMap.values()).map((weekday) => {
    const workHours = weekday.workMinutes / 60;
    return {
      ...weekday,
      ordersPerHour: workHours > 0 ? weekday.orderCount / workHours : 0,
      salesPerHour: workHours > 0 ? Math.round(weekday.sales / workHours) : 0,
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
  const activeDays = daily.filter((day) => day.workMinutes > 0);
  const busiestDays = [...activeDays].sort((a, b) => (
    b.peakLoadLevelScore - a.peakLoadLevelScore
    || b.peakHourLoadScore - a.peakHourLoadScore
    || b.peakHourOrderCount - a.peakHourOrderCount
    || b.ordersPerHour - a.ordersPerHour
  )).slice(0, 5);
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
    startDate,
    endDate,
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
