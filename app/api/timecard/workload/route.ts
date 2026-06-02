import { getSessionStoreScope, requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import {
  getJstMonthLabel,
  getJstMonthRange,
  isTimecardPunchType,
  summarizeTimecardDays,
  type TimecardPunch
} from "../../../../lib/timecard";

const workloadSettingsRoles = new Set(["owner", "manager", "store_owner"]);
const managementRoles = new Set(["owner", "manager", "store_owner"]);
const hourMs = 60 * 60 * 1000;
const workloadSliceMinutes = 15;
const workloadLevels = [
  { key: "very_idle", label: "かなり空き", score: 20 },
  { key: "normal", label: "通常", score: 60 },
  { key: "busy", label: "忙しい", score: 90 },
  { key: "high", label: "高負荷", score: 120 },
  { key: "extreme", label: "超負荷", score: 150 }
] as const;
const defaultWorkloadSettings = {
  includeManagement: true,
  minOrderLoadScore: 1,
  amountScoreMultiplier: 1,
  highLoadOrderThreshold: 8,
  highLoadScoreThreshold: 8
};

type WorkloadSettings = typeof defaultWorkloadSettings;

type WorkloadOrder = {
  orderedAtMs: number;
  total: number;
  loadScore: number;
};

function numberFrom(value: unknown, fallback: number) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  return Math.min(max, Math.max(min, numberFrom(value, fallback)));
}

function normalizeWorkloadSettings(settings: Partial<WorkloadSettings>): WorkloadSettings {
  return {
    includeManagement: settings.includeManagement !== false,
    minOrderLoadScore: clampNumber(settings.minOrderLoadScore, defaultWorkloadSettings.minOrderLoadScore, 0.1, 10),
    amountScoreMultiplier: clampNumber(settings.amountScoreMultiplier, defaultWorkloadSettings.amountScoreMultiplier, 0.1, 5),
    highLoadOrderThreshold: Math.round(clampNumber(
      settings.highLoadOrderThreshold,
      defaultWorkloadSettings.highLoadOrderThreshold,
      1,
      50
    )),
    highLoadScoreThreshold: clampNumber(
      settings.highLoadScoreThreshold,
      defaultWorkloadSettings.highLoadScoreThreshold,
      1,
      100
    )
  };
}

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

function minutesBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
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

function getOrderLoadLevelIndex(ordersPerHour: number) {
  if (ordersPerHour <= 4) return 0;
  if (ordersPerHour <= 8) return 1;
  if (ordersPerHour <= 12) return 2;
  if (ordersPerHour <= 15) return 3;
  return 4;
}

function getSalesLoadLevelIndex(salesPerHour: number) {
  if (salesPerHour < 5000) return 0;
  if (salesPerHour < 10000) return 1;
  if (salesPerHour < 15000) return 2;
  if (salesPerHour < 20000) return 3;
  return 4;
}

function getLoadLevelMetrics(ordersPerHour: number, salesPerHour: number) {
  const levelIndex = Math.max(getOrderLoadLevelIndex(ordersPerHour), getSalesLoadLevelIndex(salesPerHour));
  const level = workloadLevels[levelIndex];
  return {
    loadLevel: level.key,
    loadLevelLabel: level.label,
    loadLevelScore: level.score
  };
}

function getActiveStaffCountDuringWindow(
  shiftIntervals: Array<{ startMs: number; endMs: number }>,
  windowStart: number,
  windowEnd: number
) {
  const sliceMs = workloadSliceMinutes * 60_000;
  let onePersonMinutes = 0;
  let totalSampledMinutes = 0;

  for (let time = windowStart; time < windowEnd; time += sliceMs) {
    const sliceEnd = Math.min(time + sliceMs, windowEnd);
    const sliceMinutes = Math.max(0, Math.round((sliceEnd - time) / 60_000));
    const activeCount = shiftIntervals.filter((candidate) => candidate.startMs < sliceEnd && candidate.endMs > time).length;
    totalSampledMinutes += sliceMinutes;
    if (activeCount === 1) onePersonMinutes += sliceMinutes;
  }

  return {
    onePersonMinutes,
    totalSampledMinutes
  };
}

function isMostlyOnePersonShift(
  shiftIntervals: Array<{ startMs: number; endMs: number }>,
  shiftStart: number,
  shiftEnd: number
) {
  const staff = getActiveStaffCountDuringWindow(shiftIntervals, shiftStart, shiftEnd);
  return staff.totalSampledMinutes > 0 && staff.onePersonMinutes / staff.totalSampledMinutes >= 0.5;
}

function getOnePersonHighLoadMinutes(
  orders: WorkloadOrder[],
  shiftIntervals: Array<{ startMs: number; endMs: number }>,
  shiftStart: number,
  shiftEnd: number,
  settings: WorkloadSettings
) {
  const sorted = [...orders].sort((a, b) => a.orderedAtMs - b.orderedAtMs);
  const countedWindows: Array<{ start: number; end: number }> = [];
  let highLoadMinutes = 0;

  for (const order of sorted) {
    const windowStart = Math.max(shiftStart, order.orderedAtMs);
    const windowEnd = Math.min(shiftEnd, windowStart + hourMs);
    if (windowEnd - windowStart < 30 * 60_000) continue;

    const windowOrders = sorted.filter((candidate) => candidate.orderedAtMs >= windowStart && candidate.orderedAtMs <= windowEnd);
    const orderCount = windowOrders.length;
    const loadScore = windowOrders.reduce((sum, candidate) => sum + candidate.loadScore, 0);
    if (orderCount < settings.highLoadOrderThreshold && loadScore < settings.highLoadScoreThreshold) continue;
    const staff = getActiveStaffCountDuringWindow(shiftIntervals, windowStart, windowEnd);
    if (staff.onePersonMinutes < 30) continue;

    const overlapsCountedWindow = countedWindows.some((window) => window.start < windowEnd && window.end > windowStart);
    if (overlapsCountedWindow) continue;
    countedWindows.push({ start: windowStart, end: windowEnd });
    highLoadMinutes += staff.onePersonMinutes;
  }

  return highLoadMinutes;
}

function getIdleBlockMinutes(orderedTimes: number[], shiftStart: number, shiftEnd: number) {
  const sorted = [...orderedTimes].sort((a, b) => a - b);
  const points = [shiftStart, ...sorted, shiftEnd];
  let idleBlockCount = 0;
  let idleMinutes = 0;

  for (let index = 1; index < points.length; index += 1) {
    const gapMinutes = Math.max(0, Math.round((points[index] - points[index - 1]) / 60_000));
    if (gapMinutes >= 30) {
      idleBlockCount += 1;
      idleMinutes += gapMinutes;
    }
  }

  return { idleBlockCount, idleMinutes };
}

async function getWorkloadSettings(storeId: string) {
  const rows = await sql`
    select
      coalesce(include_management, true) as "includeManagement",
      coalesce(min_order_load_score, 1) as "minOrderLoadScore",
      coalesce(amount_score_multiplier, 1) as "amountScoreMultiplier",
      coalesce(high_load_order_threshold, 8) as "highLoadOrderThreshold",
      coalesce(high_load_score_threshold, 8) as "highLoadScoreThreshold"
    from timecard_workload_settings
    where store_id::text = ${storeId}
    limit 1
  `;
  return normalizeWorkloadSettings(rows[0] ?? defaultWorkloadSettings);
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
  const settings = selectedStoreId ? await getWorkloadSettings(selectedStoreId) : defaultWorkloadSettings;

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

  const allDailySummaries = summarizeTimecardDays(typedPunches, {
    workDateStart: month + "-01",
    workDateEndExclusive: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(endUtc)
  }).filter((summary) => summary.clockIn && summary.clockOut && summary.workMinutes > 0);
  const excludedManagementShiftCount = settings.includeManagement
    ? 0
    : allDailySummaries.filter((summary) => managementRoles.has(employeeRoleById.get(summary.employeeId) ?? "")).length;
  const dailySummaries = settings.includeManagement
    ? allDailySummaries
    : allDailySummaries.filter((summary) => !managementRoles.has(employeeRoleById.get(summary.employeeId) ?? ""));

  const orders = selectedStoreId ? await sql`
    select
      id::text,
      order_no as "orderNo",
      ordered_at as "orderedAt",
      total,
      source_platform as "sourcePlatform"
    from sales_orders
    where store_id::text = ${selectedStoreId}
      and ordered_at >= ${startUtc.toISOString()}
      and ordered_at < ${endUtc.toISOString()}
      and status <> 'cancelled'
      and payment_status <> 'failed'
      and total > 0
    order by ordered_at asc
  ` : [];
  const averageOrderTotal = orders.length > 0
    ? orders.reduce((sum, order) => sum + Number(order.total ?? 0), 0) / orders.length
    : 0;

  const shiftIntervals = dailySummaries.map((summary) => ({
    ...summary,
    startMs: new Date(summary.clockIn as string).getTime(),
    endMs: new Date(summary.clockOut as string).getTime()
  }));
  const employeeMap = new Map<string, {
    employeeId: string;
    employeeName: string;
    workMinutes: number;
    workDays: number;
    orderCount: number;
    sales: number;
    peakHourOrderCount: number;
    peakHourSales: number;
    peakHourLoadScore: number;
    onePersonHighLoadMinutes: number;
    idleBlockCount: number;
    idleMinutes: number;
  }>();
  const busyShifts = [];

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
          ? Math.max(settings.minOrderLoadScore, (total / averageOrderTotal) * settings.amountScoreMultiplier)
          : settings.minOrderLoadScore
      };
    });
    const orderedTimes = workloadOrders.map((order) => order.orderedAtMs);
    const shiftSales = shiftOrders.reduce((sum, order) => sum + Number(order.total ?? 0), 0);
    const peakMetrics = getPeakHourMetrics(workloadOrders);
    const storeShiftIntervals = shiftIntervals.filter((candidate) => candidate.storeId === shift.storeId);
    const isOnePerson = isMostlyOnePersonShift(storeShiftIntervals, shift.startMs, shift.endMs);
    const onePersonHighLoadMinutes = getOnePersonHighLoadMinutes(
      workloadOrders,
      storeShiftIntervals,
      shift.startMs,
      shift.endMs,
      settings
    );
    const idle = getIdleBlockMinutes(orderedTimes, shift.startMs, shift.endMs);
    const entry = employeeMap.get(shift.employeeId) ?? {
      employeeId: shift.employeeId,
      employeeName: shift.employeeName,
      workMinutes: 0,
      workDays: 0,
      orderCount: 0,
      sales: 0,
      peakHourOrderCount: 0,
      peakHourSales: 0,
      peakHourLoadScore: 0,
      onePersonHighLoadMinutes: 0,
      idleBlockCount: 0,
      idleMinutes: 0
    };

    entry.workMinutes += shift.workMinutes;
    entry.workDays += 1;
    entry.orderCount += shiftOrders.length;
    entry.sales += shiftSales;
    entry.peakHourOrderCount = Math.max(entry.peakHourOrderCount, peakMetrics.peakOrderCount);
    entry.peakHourSales = Math.max(entry.peakHourSales, peakMetrics.peakSales);
    entry.peakHourLoadScore = Math.max(entry.peakHourLoadScore, peakMetrics.peakLoadScore);
    entry.onePersonHighLoadMinutes += onePersonHighLoadMinutes;
    entry.idleBlockCount += idle.idleBlockCount;
    entry.idleMinutes += idle.idleMinutes;
    employeeMap.set(shift.employeeId, entry);

    const shiftOrdersPerHour = shift.workMinutes > 0 ? shiftOrders.length / (shift.workMinutes / 60) : 0;
    const shiftSalesPerHour = shift.workMinutes > 0 ? Math.round(shiftSales / (shift.workMinutes / 60)) : 0;
    const shiftPeakLoadLevel = getLoadLevelMetrics(peakMetrics.peakOrderCount, peakMetrics.peakSales);
    busyShifts.push({
      employeeId: shift.employeeId,
      employeeName: shift.employeeName,
      workDate: shift.workDate,
      clockIn: shift.clockIn,
      clockOut: shift.clockOut,
      workMinutes: shift.workMinutes,
      orderCount: shiftOrders.length,
      sales: shiftSales,
      ordersPerHour: shiftOrdersPerHour,
      salesPerHour: shiftSalesPerHour,
      peakHourOrderCount: peakMetrics.peakOrderCount,
      peakHourSales: peakMetrics.peakSales,
      peakHourLoadScore: peakMetrics.peakLoadScore,
      peakLoadLevel: shiftPeakLoadLevel.loadLevel,
      peakLoadLevelLabel: shiftPeakLoadLevel.loadLevelLabel,
      peakLoadLevelScore: shiftPeakLoadLevel.loadLevelScore,
      isOnePerson,
      idleMinutes: idle.idleMinutes
    });
  }

  const employees = Array.from(employeeMap.values()).map((entry) => {
    const ordersPerHour = entry.workMinutes > 0 ? entry.orderCount / (entry.workMinutes / 60) : 0;
    const salesPerHour = entry.workMinutes > 0 ? Math.round(entry.sales / (entry.workMinutes / 60)) : 0;
    const averageLoadLevel = getLoadLevelMetrics(ordersPerHour, salesPerHour);
    const peakLoadLevel = getLoadLevelMetrics(entry.peakHourOrderCount, entry.peakHourSales);
    const onePersonHighLoadRate = entry.workMinutes > 0 ? entry.onePersonHighLoadMinutes / entry.workMinutes : 0;
    const evaluationScore = Math.round((
      peakLoadLevel.loadLevelScore * 0.6
      + averageLoadLevel.loadLevelScore * 0.3
      + Math.min(30, onePersonHighLoadRate * 100) * 0.1
    ) * 10) / 10;
    return {
      ...entry,
      ordersPerHour,
      salesPerHour,
      loadLevel: averageLoadLevel.loadLevel,
      loadLevelLabel: averageLoadLevel.loadLevelLabel,
      loadLevelScore: averageLoadLevel.loadLevelScore,
      peakLoadLevel: peakLoadLevel.loadLevel,
      peakLoadLevelLabel: peakLoadLevel.loadLevelLabel,
      peakLoadLevelScore: peakLoadLevel.loadLevelScore,
      evaluationScore
    };
  });

  return Response.json({
    month,
    stores,
    selectedStoreId,
    canEditSettings: workloadSettingsRoles.has(session.role),
    settings,
    excludedManagementShiftCount,
    totals: {
      workMinutes: employees.reduce((sum, entry) => sum + entry.workMinutes, 0),
      orderCount: employees.reduce((sum, entry) => sum + entry.orderCount, 0),
      sales: employees.reduce((sum, entry) => sum + entry.sales, 0)
    },
    employees: employees.sort((a, b) => b.ordersPerHour - a.ordersPerHour || b.orderCount - a.orderCount),
    busiestEmployees: [...employees].sort((a, b) => (
      b.evaluationScore - a.evaluationScore
      || b.onePersonHighLoadMinutes - a.onePersonHighLoadMinutes
      || b.peakHourLoadScore - a.peakHourLoadScore
      || b.ordersPerHour - a.ordersPerHour
      || b.peakHourOrderCount - a.peakHourOrderCount
    )).slice(0, 5),
    lightestEmployees: [...employees].filter((entry) => entry.workMinutes > 0).sort((a, b) => (
      (b.idleMinutes / b.workMinutes) - (a.idleMinutes / a.workMinutes)
      || a.ordersPerHour - b.ordersPerHour
      || b.idleMinutes - a.idleMinutes
    )).slice(0, 5),
    busiestShifts: busyShifts.sort((a, b) => (
      b.peakLoadLevelScore - a.peakLoadLevelScore
      || b.peakHourLoadScore - a.peakHourLoadScore
      || b.peakHourOrderCount - a.peakHourOrderCount
      || b.ordersPerHour - a.ordersPerHour
    )).slice(0, 8)
  });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  if (!workloadSettingsRoles.has(session.role)) {
    return Response.json({ error: "負荷分析設定を変更する権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Partial<WorkloadSettings> & { storeId?: string };
  const storeId = String(body.storeId ?? "");
  if (!storeId) return Response.json({ error: "店舗を選択してください。" }, { status: 400 });

  const scope = await getSessionStoreScope(session);
  if (!scope.allStores && !scope.storeIds.includes(storeId)) {
    return Response.json({ error: "この店舗の設定を変更する権限がありません。" }, { status: 403 });
  }

  const settings = normalizeWorkloadSettings({
    includeManagement: body.includeManagement,
    minOrderLoadScore: body.minOrderLoadScore,
    amountScoreMultiplier: body.amountScoreMultiplier,
    highLoadOrderThreshold: body.highLoadOrderThreshold,
    highLoadScoreThreshold: body.highLoadScoreThreshold
  });
  await sql`
    insert into timecard_workload_settings (
      store_id,
      include_management,
      min_order_load_score,
      amount_score_multiplier,
      high_load_order_threshold,
      high_load_score_threshold,
      updated_by,
      updated_at
    )
    values (
      ${storeId},
      ${settings.includeManagement},
      ${settings.minOrderLoadScore},
      ${settings.amountScoreMultiplier},
      ${settings.highLoadOrderThreshold},
      ${settings.highLoadScoreThreshold},
      ${session.id},
      now()
    )
    on conflict (store_id)
    do update set
      include_management = excluded.include_management,
      min_order_load_score = excluded.min_order_load_score,
      amount_score_multiplier = excluded.amount_score_multiplier,
      high_load_order_threshold = excluded.high_load_order_threshold,
      high_load_score_threshold = excluded.high_load_score_threshold,
      updated_by = excluded.updated_by,
      updated_at = now()
  `;

  return Response.json({
    ok: true,
    settings
  });
}
