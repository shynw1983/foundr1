import { getSessionStoreScope, requireOsSession } from "../../../../lib/api-auth";
import { getBusinessCalendarEvents, type BusinessCalendarEvent } from "../../../../lib/business-calendar";
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
const salesTimeBands = [
  { key: "midnight", label: "深夜", startHour: 0, endHour: 5 },
  { key: "morning", label: "早朝・午前", startHour: 5, endHour: 11 },
  { key: "lunch", label: "昼", startHour: 11, endHour: 14 },
  { key: "afternoon", label: "午後", startHour: 14, endHour: 17 },
  { key: "evening", label: "夕方", startHour: 17, endHour: 21 },
  { key: "night", label: "夜", startHour: 21, endHour: 24 }
];
const hourMs = 60 * 60 * 1000;
const salesAnalysisSettingsRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);
const salesTestDataDeleteRoles = new Set(["owner", "manager"]);
const salesAnalysisLevels = [
  { key: "veryIdle", label: "かなり空き", scoreKey: "scoreVeryIdle" },
  { key: "normal", label: "通常", scoreKey: "scoreNormal" },
  { key: "busy", label: "忙しい", scoreKey: "scoreBusy" },
  { key: "high", label: "高負荷", scoreKey: "scoreHigh" },
  { key: "extreme", label: "超負荷", scoreKey: "scoreExtreme" }
] as const;
const defaultSalesAnalysisSettings = {
  veryIdleRateMax: 0.6,
  normalRateMax: 1.1,
  busyRateMax: 1.5,
  highRateMax: 2,
  scoreVeryIdle: 20,
  scoreNormal: 60,
  scoreBusy: 90,
  scoreHigh: 120,
  scoreExtreme: 150
};
const workloadScoreSettings = {
  minOrderLoadScore: 1,
  amountScoreMultiplier: 1,
  scoreVeryIdle: defaultSalesAnalysisSettings.scoreVeryIdle,
  scoreNormal: defaultSalesAnalysisSettings.scoreNormal,
  scoreBusy: defaultSalesAnalysisSettings.scoreBusy,
  scoreHigh: defaultSalesAnalysisSettings.scoreHigh,
  scoreExtreme: defaultSalesAnalysisSettings.scoreExtreme
};
const defaultWeatherLocation = {
  name: "福岡市",
  latitude: 33.5902,
  longitude: 130.4017
};

type SalesAnalysisSettings = typeof defaultSalesAnalysisSettings;
type WorkloadScoreSettings = typeof workloadScoreSettings;

type WeatherDay = {
  date: string;
  weatherCode: number | null;
  weatherLabel: string;
  temperatureMean: number | null;
  precipitation: number | null;
};

type SalesOrderFact = {
  date: string;
  minuteOfDay: number;
  sales: number;
};

function timeTextToMinutes(value: string | null, fallback: number) {
  if (!value) return fallback;
  const [hours, minutes] = value.split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : fallback;
}

function isWithinMinuteWindow(minuteOfDay: number, startMinute: number, endMinute: number) {
  return startMinute <= endMinute
    ? minuteOfDay >= startMinute && minuteOfDay <= endMinute
    : minuteOfDay >= startMinute || minuteOfDay <= endMinute;
}

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

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  return Math.min(max, Math.max(min, numberFrom(value, fallback)));
}

function normalizeSalesAnalysisSettings(settings: Partial<SalesAnalysisSettings>): SalesAnalysisSettings {
  const veryIdleRateMax = clampNumber(settings.veryIdleRateMax, defaultSalesAnalysisSettings.veryIdleRateMax, 0, 10);
  const normalRateMax = Math.max(veryIdleRateMax + 0.1, clampNumber(settings.normalRateMax, defaultSalesAnalysisSettings.normalRateMax, 0.1, 15));
  const busyRateMax = Math.max(normalRateMax + 0.1, clampNumber(settings.busyRateMax, defaultSalesAnalysisSettings.busyRateMax, 0.2, 20));
  const highRateMax = Math.max(busyRateMax + 0.1, clampNumber(settings.highRateMax, defaultSalesAnalysisSettings.highRateMax, 0.3, 30));
  return {
    veryIdleRateMax: Math.round(veryIdleRateMax * 100) / 100,
    normalRateMax: Math.round(normalRateMax * 100) / 100,
    busyRateMax: Math.round(busyRateMax * 100) / 100,
    highRateMax: Math.round(highRateMax * 100) / 100,
    scoreVeryIdle: defaultSalesAnalysisSettings.scoreVeryIdle,
    scoreNormal: defaultSalesAnalysisSettings.scoreNormal,
    scoreBusy: defaultSalesAnalysisSettings.scoreBusy,
    scoreHigh: defaultSalesAnalysisSettings.scoreHigh,
    scoreExtreme: defaultSalesAnalysisSettings.scoreExtreme
  };
}

async function getSalesAnalysisSettings(storeId: string) {
  const rows = await sql`
    select
      coalesce(very_idle_rate_max, 0.6) as "veryIdleRateMax",
      coalesce(normal_rate_max, 1.1) as "normalRateMax",
      coalesce(busy_rate_max, 1.5) as "busyRateMax",
      coalesce(high_rate_max, 2) as "highRateMax"
    from sales_analysis_settings
    where store_id::text = ${storeId}
    limit 1
  `;
  return normalizeSalesAnalysisSettings(rows[0] ?? defaultSalesAnalysisSettings);
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

function getCoverageMinutes(intervals: Array<{ startMs: number; endMs: number }>) {
  const sorted = intervals
    .filter((interval) => interval.endMs > interval.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  let total = 0;
  let currentStart = 0;
  let currentEnd = 0;

  for (const interval of sorted) {
    if (currentEnd === 0) {
      currentStart = interval.startMs;
      currentEnd = interval.endMs;
      continue;
    }

    if (interval.startMs <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.endMs);
    } else {
      total += currentEnd - currentStart;
      currentStart = interval.startMs;
      currentEnd = interval.endMs;
    }
  }

  if (currentEnd > currentStart) total += currentEnd - currentStart;
  return Math.round(total / 60_000);
}

function getSalesAnalysisLevelIndex(valueRate: number, settings: SalesAnalysisSettings) {
  if (valueRate <= settings.veryIdleRateMax) return 0;
  if (valueRate <= settings.normalRateMax) return 1;
  if (valueRate <= settings.busyRateMax) return 2;
  if (valueRate <= settings.highRateMax) return 3;
  return 4;
}

function getSalesAnalysisLevelMetrics(orderRate: number, salesRate: number, settings: SalesAnalysisSettings) {
  const level = salesAnalysisLevels[Math.max(
    getSalesAnalysisLevelIndex(orderRate, settings),
    getSalesAnalysisLevelIndex(salesRate, settings)
  )];
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
  const salesAnalysisSettings = selectedStoreId ? await getSalesAnalysisSettings(selectedStoreId) : defaultSalesAnalysisSettings;
  const storeWeatherRows = selectedStoreId ? await sql`
    select
      coalesce(weather_location_name, name, '') as "weatherLocationName",
      coalesce(attendance_latitude, weather_latitude)::float as "weatherLatitude",
      coalesce(attendance_longitude, weather_longitude)::float as "weatherLongitude",
      coalesce(address, '') as "address",
      coalesce(social_insurance_prefecture, '') as "socialInsurancePrefecture"
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
  const storeLocationText = `${String(storeWeather.address ?? "")} ${weatherLocationName}`.trim();
  const storePrefecture = String(storeWeather.socialInsurancePrefecture ?? "");

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
      and status not in ('cancelled', 'refund_pending')
      and payment_status in ('paid', 'partial_refunded')
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
  const workDateEndExclusive = addDays(endDate, 1);
  const dailySummaries = summarizeTimecardDays(typedPunches, {
    workDateStart: startDate,
    workDateEndExclusive
  }).filter((summary) => summary.clockIn && summary.clockOut && summary.workMinutes > 0);
  const shiftIntervals = dailySummaries.map((summary) => ({
    workDate: summary.workDate,
    startMs: new Date(summary.clockIn as string).getTime(),
    endMs: new Date(summary.clockOut as string).getTime(),
    workMinutes: summary.workMinutes
  }));
  const dailyWorkMinutes = new Map<string, number>();
  const shiftIntervalsByDate = new Map<string, Array<{ startMs: number; endMs: number }>>();
  for (const shift of shiftIntervals) {
    const intervals = shiftIntervalsByDate.get(shift.workDate) ?? [];
    intervals.push({ startMs: shift.startMs, endMs: shift.endMs });
    shiftIntervalsByDate.set(shift.workDate, intervals);
  }
  for (const [workDate, intervals] of shiftIntervalsByDate.entries()) {
    dailyWorkMinutes.set(workDate, getCoverageMinutes(intervals));
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
          ? Math.max(workloadScoreSettings.minOrderLoadScore, (total / averageOrderTotal) * workloadScoreSettings.amountScoreMultiplier)
          : workloadScoreSettings.minOrderLoadScore
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
  const timeBandMap = new Map<string, {
    key: string;
    label: string;
    startHour: number;
    endHour: number;
    orderCount: number;
    sales: number;
  }>();
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
  const calendarEvents = selectedStoreId
    ? await getBusinessCalendarEvents({
      storeId: selectedStoreId,
      startDate,
      endDate: addDays(endDate, 1),
      storeLocationText,
      storePrefecture
    })
    : [];
  const calendarEventsByDate = new Map<string, BusinessCalendarEvent[]>();
  for (const date of getDatesBetween(startDate, endDate)) {
    calendarEventsByDate.set(date, calendarEvents.filter((event) => event.startDate <= date && event.endDate >= date));
  }

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
  for (const band of salesTimeBands) {
    timeBandMap.set(band.key, { ...band, orderCount: 0, sales: 0 });
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

    const timeBand = salesTimeBands.find((band) => hour >= band.startHour && hour < band.endHour);
    if (timeBand) {
      const timeBandEntry = timeBandMap.get(timeBand.key) ?? { ...timeBand, orderCount: 0, sales: 0 };
      timeBandEntry.orderCount += 1;
      timeBandEntry.sales += sales;
      timeBandMap.set(timeBand.key, timeBandEntry);
    }

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

  const rawDaily = Array.from(dayMap.values()).map((day) => {
    const workMinutes = dailyWorkMinutes.get(day.date) ?? 0;
    const workHours = workMinutes / 60;
    const ordersPerHour = workHours > 0 ? day.orderCount / workHours : 0;
    const salesPerHour = workHours > 0 ? Math.round(day.sales / workHours) : 0;
    const peakMetrics = dailyPeakMetrics.get(day.date) ?? {
      peakHourOrderCount: 0,
      peakHourSales: 0,
      peakHourLoadScore: 0
    };
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
      peakHourOrderCount: peakMetrics.peakHourOrderCount,
      peakHourSales: peakMetrics.peakHourSales,
      peakHourLoadScore: peakMetrics.peakHourLoadScore,
      weatherCode: weather.weatherCode,
      weatherLabel: weather.weatherLabel,
      temperatureMean: weather.temperatureMean,
      precipitation: weather.precipitation,
      calendarEvents: calendarEventsByDate.get(day.date) ?? []
    };
  });
  const activeRawDaily = rawDaily.filter((day) => day.workMinutes > 0 && day.orderCount > 0);
  const averageOrdersPerHour = activeRawDaily.length > 0
    ? activeRawDaily.reduce((sum, day) => sum + day.ordersPerHour, 0) / activeRawDaily.length
    : 0;
  const averageSalesPerHour = activeRawDaily.length > 0
    ? activeRawDaily.reduce((sum, day) => sum + day.salesPerHour, 0) / activeRawDaily.length
    : 0;
  const daily = rawDaily.map((day) => {
    const orderRate = averageOrdersPerHour > 0 ? day.ordersPerHour / averageOrdersPerHour : 0;
    const salesRate = averageSalesPerHour > 0 ? day.salesPerHour / averageSalesPerHour : 0;
    const salesAnalysisLevel = getSalesAnalysisLevelMetrics(orderRate, salesRate, salesAnalysisSettings);
    return {
      ...day,
      orderRate,
      salesRate,
      loadLevel: day.orderCount > 0 ? salesAnalysisLevel.loadLevel : "veryIdle",
      loadLevelLabel: day.orderCount > 0 ? salesAnalysisLevel.loadLevelLabel : "かなり空き",
      averageLoadLevel: day.orderCount > 0 ? salesAnalysisLevel.loadLevel : "veryIdle",
      averageLoadLevelLabel: day.orderCount > 0 ? salesAnalysisLevel.loadLevelLabel : "かなり空き",
      peakLoadLevel: day.orderCount > 0 ? salesAnalysisLevel.loadLevel : "veryIdle",
      peakLoadLevelLabel: day.orderCount > 0 ? salesAnalysisLevel.loadLevelLabel : "かなり空き",
      peakLoadLevelScore: day.orderCount > 0 ? salesAnalysisLevel.loadLevelScore : salesAnalysisSettings.scoreVeryIdle
    };
  });
  const minuteFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const orderFacts = orders.map((order) => {
    const orderedAt = new Date(String(order.orderedAt));
    const [hourText, minuteText] = minuteFormatter.format(orderedAt).split(":");
    return {
      date: formatter.format(orderedAt),
      minuteOfDay: Number(hourText) * 60 + Number(minuteText),
      sales: Number(order.total ?? 0)
    } satisfies SalesOrderFact;
  });
  const activeDayByDate = new Map(daily.map((day) => [day.date, day]));
  const majorEventDates = new Set(Array.from(calendarEventsByDate.entries())
    .filter(([, events]) => events.some((event) => event.impactLevel === "major"))
    .map(([date]) => date));
  const eventImpacts = calendarEvents.map((event) => {
    const impactStartTime = event.impactStartTime ?? event.startTime ?? "00:00";
    const impactEndTime = event.impactEndTime ?? event.endTime ?? "23:59";
    const startMinute = timeTextToMinutes(impactStartTime, 0);
    const endMinute = timeTextToMinutes(impactEndTime, 23 * 60 + 59);
    const eventDates = getDatesBetween(
      event.startDate < startDate ? startDate : event.startDate,
      event.endDate > endDate ? endDate : event.endDate
    );
    let actualSales = 0;
    let actualOrderCount = 0;
    let baselineSales = 0;
    let baselineOrderCount = 0;
    let comparisonDayCount = 0;
    for (const eventDate of eventDates) {
      const eventOrders = orderFacts.filter((order) => order.date === eventDate && isWithinMinuteWindow(order.minuteOfDay, startMinute, endMinute));
      actualSales += eventOrders.reduce((sum, order) => sum + order.sales, 0);
      actualOrderCount += eventOrders.length;
      const weekday = new Date(`${eventDate}T12:00:00+09:00`).getDay();
      const comparisonDates = getDatesBetween(startDate, endDate).filter((date) => (
        !eventDates.includes(date)
        && !majorEventDates.has(date)
        && new Date(`${date}T12:00:00+09:00`).getDay() === weekday
        && Boolean(activeDayByDate.get(date)?.workloadAvailable)
      ));
      if (!comparisonDates.length) continue;
      comparisonDayCount += comparisonDates.length;
      const comparisonMetrics = comparisonDates.map((date) => {
        const matchedOrders = orderFacts.filter((order) => order.date === date && isWithinMinuteWindow(order.minuteOfDay, startMinute, endMinute));
        return { sales: matchedOrders.reduce((sum, order) => sum + order.sales, 0), orderCount: matchedOrders.length };
      });
      baselineSales += comparisonMetrics.reduce((sum, item) => sum + item.sales, 0) / comparisonMetrics.length;
      baselineOrderCount += comparisonMetrics.reduce((sum, item) => sum + item.orderCount, 0) / comparisonMetrics.length;
    }
    const requiredComparisonDayCount = eventDates.length * 3;
    const hasEnoughComparison = comparisonDayCount >= requiredComparisonDayCount;
    const deltaPercent = hasEnoughComparison && baselineSales > 0
      ? Math.round(((actualSales - baselineSales) / baselineSales) * 1000) / 10
      : null;
    return {
      ...event,
      impactStartTime,
      impactEndTime,
      impactedDayCount: eventDates.length,
      actualSales,
      actualOrderCount,
      baselineSales: Math.round(baselineSales),
      baselineOrderCount: Math.round(baselineOrderCount * 10) / 10,
      deltaPercent,
      comparisonDayCount,
      requiredComparisonDayCount,
      hasEnoughComparison,
      observedDirection: deltaPercent === null || Math.abs(deltaPercent) < 10 ? "neutral" : deltaPercent > 0 ? "positive" : "negative"
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
  const timeBands = Array.from(timeBandMap.values())
    .map((band) => ({
      ...band,
      startLabel: `${String(band.startHour).padStart(2, "0")}:00`,
      endLabel: band.endHour === 24 ? "24:00" : `${String(band.endHour).padStart(2, "0")}:00`,
      averageOrderValue: band.orderCount > 0 ? Math.round(band.sales / band.orderCount) : 0,
      share: totalSales > 0 ? (band.sales / totalSales) * 100 : 0
    }))
    .sort((a, b) => b.sales - a.sales || b.orderCount - a.orderCount || a.startHour - b.startHour);
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
  const salesPostedDays = daily.filter((day) => day.orderCount > 0);
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
    limit 20
  ` : [];

  return Response.json({
    month,
    startDate,
    endDate,
    stores,
    selectedStoreId,
    canEditSalesAnalysisSettings: salesAnalysisSettingsRoles.has(session.role),
    canDeleteTestSalesOrders: salesTestDataDeleteRoles.has(session.role),
    salesAnalysisSettings,
    salesAnalysisBaseline: {
      averageOrdersPerHour,
      averageSalesPerHour
    },
    totals: {
      orderCount: totalOrders,
      sales: totalSales,
      estimatedFee: estimatedFeeTotal,
      estimatedDeposit: estimatedDepositTotal,
      deliveryShare: totalSales > 0 ? (deliverySales / totalSales) * 100 : 0,
      averageOrderValue: totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0,
      salesPostedDayCount: salesPostedDays.length,
      workTrackedDayCount: activeDays.length
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
    timeBands,
    eventImpacts,
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
      createdOrderCount: Number(row.metadata?.createdOrderCount ?? row.importedOrderCount ?? 0),
      updatedOrderCount: Number(row.metadata?.updatedOrderCount ?? 0),
      rawRowCount: Number(row.rawRowCount ?? 0),
      createdAt: new Date(String(row.createdAt)).toISOString(),
      brandName: String(row.metadata?.brandName ?? ""),
      deliveryImportPeriodKey: String(row.metadata?.deliveryImportPeriodKey ?? ""),
      deliveryImportPeriodLabel: String(row.metadata?.deliveryImportPeriodLabel ?? ""),
      deliveryDownloadStartDate: String(row.metadata?.deliveryDownloadStartDate ?? ""),
      deliveryDownloadEndDate: String(row.metadata?.deliveryDownloadEndDate ?? "")
    }))
  });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  if (!salesAnalysisSettingsRoles.has(session.role)) {
    return Response.json({ error: "売上分析設定を変更する権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Partial<SalesAnalysisSettings> & { storeId?: string };
  const storeId = String(body.storeId ?? "");
  if (!storeId) return Response.json({ error: "店舗を選択してください。" }, { status: 400 });

  const scope = await getSessionStoreScope(session);
  if (!scope.allStores && !scope.storeIds.includes(storeId)) {
    return Response.json({ error: "この店舗の設定を変更する権限がありません。" }, { status: 403 });
  }

  const settings = normalizeSalesAnalysisSettings({
    veryIdleRateMax: body.veryIdleRateMax,
    normalRateMax: body.normalRateMax,
    busyRateMax: body.busyRateMax,
    highRateMax: body.highRateMax
  });

  await sql`
    insert into sales_analysis_settings (
      store_id,
      very_idle_rate_max,
      normal_rate_max,
      busy_rate_max,
      high_rate_max,
      updated_by,
      updated_at
    )
    values (
      ${storeId},
      ${settings.veryIdleRateMax},
      ${settings.normalRateMax},
      ${settings.busyRateMax},
      ${settings.highRateMax},
      ${session.id},
      now()
    )
    on conflict (store_id)
    do update set
      very_idle_rate_max = excluded.very_idle_rate_max,
      normal_rate_max = excluded.normal_rate_max,
      busy_rate_max = excluded.busy_rate_max,
      high_rate_max = excluded.high_rate_max,
      updated_by = excluded.updated_by,
      updated_at = now()
  `;

  return Response.json({
    ok: true,
    settings
  });
}
