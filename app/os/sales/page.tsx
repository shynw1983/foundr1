"use client";

import {
  Boxes,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  LineChart,
  LogOut,
  Search,
  Settings,
  Trash2,
  Upload,
  WalletCards
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { UserBadge } from "../components/UserBadge";

type StoreOption = { id: string; name: string };
type SalesCalendarEvent = {
  id: string;
  sourceType: string;
  title: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  category: string;
  impactLevel: "reference" | "busy" | "major";
  flowDirection: "inbound" | "outbound" | "mixed";
  impactStartTime: string | null;
  impactEndTime: string | null;
  venue: string;
  sourceUrl: string;
  note: string;
};
type SalesEventImpact = SalesCalendarEvent & {
  impactedDayCount: number;
  actualSales: number;
  actualOrderCount: number;
  baselineSales: number;
  baselineOrderCount: number;
  deltaPercent: number | null;
  comparisonDayCount: number;
  observedDirection: "positive" | "negative" | "neutral";
};
type SalesDay = {
  date: string;
  orderCount: number;
  sales: number;
  inStoreSales: number;
  deliverySales: number;
  deliveryEstimatedDeposit: number;
  workMinutes: number;
  workloadAvailable: boolean;
  ordersPerHour: number;
  salesPerHour: number;
  orderRate: number;
  salesRate: number;
  loadLevel: string;
  loadLevelLabel: string;
  averageLoadLevel: string;
  averageLoadLevelLabel: string;
  peakLoadLevel: string;
  peakLoadLevelLabel: string;
  peakLoadLevelScore: number;
  peakHourOrderCount: number;
  peakHourSales: number;
  peakHourLoadScore: number;
  weatherCode: number | null;
  weatherLabel: string;
  temperatureMean: number | null;
  precipitation: number | null;
  calendarEvents: SalesCalendarEvent[];
};
type SalesHour = { hour: number; orderCount: number; sales: number };
type SalesTimeBand = {
  key: string;
  label: string;
  startHour: number;
  endHour: number;
  startLabel: string;
  endLabel: string;
  orderCount: number;
  sales: number;
  averageOrderValue: number;
  share: number;
};
type SalesWeekday = {
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
  temperatureMean: number | null;
};
type RevenueGroup = {
  key: string;
  label: string;
  orderCount: number;
  sales: number;
  feeRate: number;
  estimatedFee: number;
  estimatedDeposit: number;
  share: number;
};
type ImportBatch = {
  id: string;
  importMonth: string;
  salesSourceId: string;
  sourcePlatform: string;
  brandName: string;
  fileName: string;
  importedOrderCount: number;
  createdOrderCount: number;
  updatedOrderCount: number;
  rawRowCount: number;
  createdAt: string;
  deliveryImportPeriodKey?: string;
  deliveryImportPeriodLabel?: string;
  deliveryDownloadStartDate?: string;
  deliveryDownloadEndDate?: string;
};
type SalesSourceOption = {
  id: string;
  sourcePlatform: string;
  sourceLabel: string;
  baseLabel: string;
  sourceType: string;
  brandName: string;
  importSupported: boolean;
};
type SalesSummary = {
  month: string;
  startDate: string;
  endDate: string;
  stores: StoreOption[];
  selectedStoreId: string;
  canEditSalesAnalysisSettings: boolean;
  canDeleteTestSalesOrders: boolean;
  salesAnalysisSettings: SalesAnalysisSettings;
  salesAnalysisBaseline: {
    averageOrdersPerHour: number;
    averageSalesPerHour: number;
  };
  totals: {
    orderCount: number;
    sales: number;
    estimatedFee: number;
    estimatedDeposit: number;
    deliveryShare: number;
    averageOrderValue: number;
    salesPostedDayCount: number;
    workTrackedDayCount: number;
  };
  weatherLocation: {
    name: string;
    latitude: number;
    longitude: number;
  };
  revenueGroups: RevenueGroup[];
  daily: SalesDay[];
  weekdays: SalesWeekday[];
  hourly: SalesHour[];
  timeBands: SalesTimeBand[];
  eventImpacts: SalesEventImpact[];
  busiestDays: SalesDay[];
  quietestDays: SalesDay[];
  busiestWeekdays: SalesWeekday[];
  quietestWeekdays: SalesWeekday[];
  peakHours: SalesHour[];
  imports: ImportBatch[];
};
type SalesAnalysisSettings = {
  veryIdleRateMax: number;
  normalRateMax: number;
  busyRateMax: number;
  highRateMax: number;
};
type SalesAnalysisSettingKey = keyof SalesAnalysisSettings;
type ImportState = {
  canImport: boolean;
  stores: StoreOption[];
  selectedStoreId: string;
  salesSources: SalesSourceOption[];
  deliveryImportPeriods: DeliveryImportPeriod[];
  currentDueDeliveryImportPeriod: DeliveryImportPeriod | null;
};
type DeliveryImportPeriod = {
  key: string;
  importMonth: string;
  half: "first" | "second";
  label: string;
  targetStartDate: string;
  targetEndDate: string;
  downloadStartDate: string;
  downloadEndDate: string;
  dueDate: string;
};
type AiAnalysisState = {
  text: string;
  model: string;
  error: string;
};
type TestSalesOrder = {
  id: string;
  orderNo: string;
  channel: string;
  sourcePlatform: string;
  status: string;
  paymentStatus: string;
  total: number;
  sourceOrderId: string;
  orderedAtLabel: string;
  pickupCode: string;
  customerStatus: string;
  customerPaymentStatus: string;
  customerName: string;
  customerPhone: string;
  hasCustomerOrder: boolean;
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "経営分析", href: "/os/analytics", icon: LineChart },
  { label: "売上分析", href: "/os/analytics/sales", icon: ChartColumn },
  { label: "人件費分析", href: "/os/analytics/labor", icon: WalletCards },
  { label: "原価・経費分析", href: "/os/analytics/cost", icon: Boxes },
  { label: "経費設定", href: "/os/analytics/expenses", icon: Boxes },
  { label: "月次損益", href: "/os/analytics/profit", icon: LineChart },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

function getCurrentMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit"
  }).format(new Date());
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(amount);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).format(new Date(`${value}T00:00:00+09:00`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatRate(value: number) {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(value);
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours}時間${String(mins).padStart(2, "0")}分`;
}

function getWeatherIcon(code: number | null) {
  if (code === null) return "・";
  if (code === 0) return "☀";
  if ([1, 2].includes(code)) return "🌤";
  if ([3, 45, 48].includes(code)) return "☁";
  if (code >= 51 && code <= 67) return "☂";
  if (code >= 80 && code <= 82) return "☔";
  if (code >= 95) return "雷";
  return "☁";
}

function getDensityLevelClass(loadLevel: string) {
  if (loadLevel === "extreme") return "is-critical";
  if (loadLevel === "high") return "is-high";
  if (loadLevel === "busy") return "is-busy";
  if (loadLevel === "normal") return "is-normal";
  return "is-quiet";
}

function getFlowDirectionLabel(direction: SalesCalendarEvent["flowDirection"]) {
  if (direction === "inbound") return "流入";
  if (direction === "outbound") return "流出";
  return "混合";
}

function getObservedDirectionLabel(direction: SalesEventImpact["observedDirection"]) {
  if (direction === "positive") return "実績増";
  if (direction === "negative") return "実績減";
  return "差は小さい";
}

const defaultSalesAnalysisSettings: SalesAnalysisSettings = {
  veryIdleRateMax: 0.6,
  normalRateMax: 1.1,
  busyRateMax: 1.5,
  highRateMax: 2
};

function addDays(dateString: string, amount: number) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

function getRecentRange(days: number) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  return { startDate: addDays(today, -(days - 1)), endDate: today };
}

function getMonthRange(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  const endDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return { startDate: `${month}-01`, endDate: `${month}-${String(endDay).padStart(2, "0")}` };
}

function getCalendarDays(startDate: string, endDate: string, days: SalesDay[]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return [];
  const dayMap = new Map(days.map((day) => [day.date, day]));
  const firstWeekday = (new Date(`${startDate}T12:00:00+09:00`).getUTCDay() + 6) % 7;
  const cells: Array<SalesDay | null> = Array.from({ length: firstWeekday }, () => null);
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    cells.push(dayMap.get(date) ?? {
      date,
      orderCount: 0,
      sales: 0,
      inStoreSales: 0,
      deliverySales: 0,
      deliveryEstimatedDeposit: 0,
      workMinutes: 0,
      workloadAvailable: false,
      ordersPerHour: 0,
      salesPerHour: 0,
      orderRate: 0,
      salesRate: 0,
      loadLevel: "veryIdle",
      loadLevelLabel: "かなり空き",
      averageLoadLevel: "veryIdle",
      averageLoadLevelLabel: "かなり空き",
      peakLoadLevel: "veryIdle",
      peakLoadLevelLabel: "かなり空き",
      peakLoadLevelScore: 0,
      peakHourOrderCount: 0,
      peakHourSales: 0,
      peakHourLoadScore: 0,
      weatherCode: null,
      weatherLabel: "",
      temperatureMean: null,
      precipitation: null,
      calendarEvents: []
    });
    if (cells.length > 410) break;
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function buildSalesAnalysisFacts(summary: SalesSummary, storeName: string) {
  const averageOrdersPerHour = (days: SalesDay[]) => {
    const minutes = days.reduce((sum, day) => sum + day.workMinutes, 0);
    return minutes > 0 ? Math.round((days.reduce((sum, day) => sum + day.orderCount, 0) / (minutes / 60)) * 10) / 10 : 0;
  };
  const averageSalesPerHour = (days: SalesDay[]) => {
    const minutes = days.reduce((sum, day) => sum + day.workMinutes, 0);
    return minutes > 0 ? Math.round(days.reduce((sum, day) => sum + day.sales, 0) / (minutes / 60)) : 0;
  };
  const trackedActiveDays = summary.daily.filter((day) => day.orderCount > 0 && day.workloadAvailable);
  const rainyTrackedDays = trackedActiveDays.filter((day) => (day.precipitation ?? 0) > 0);
  const dryTrackedDays = trackedActiveDays.filter((day) => (day.precipitation ?? 0) <= 0);
  const totalWorkMinutes = trackedActiveDays.reduce((sum, day) => sum + day.workMinutes, 0);
  const trackedSales = trackedActiveDays.reduce((sum, day) => sum + day.sales, 0);
  const trackedOrders = trackedActiveDays.reduce((sum, day) => sum + day.orderCount, 0);
  const topSalesDay = [...trackedActiveDays].sort((a, b) => b.sales - a.sales || b.ordersPerHour - a.ordersPerHour)[0] ?? null;
  const topLoadDay = [...trackedActiveDays].sort((a, b) => b.ordersPerHour - a.ordersPerHour || b.salesPerHour - a.salesPerHour)[0] ?? null;
  const lowestLoadDay = [...trackedActiveDays].sort((a, b) => a.ordersPerHour - b.ordersPerHour || a.salesPerHour - b.salesPerHour)[0] ?? null;
  const weekdayLoadRanking = [...summary.weekdays]
    .filter((weekday) => weekday.dayCount > 0 && weekday.workMinutes > 0)
    .sort((a, b) => b.ordersPerHour - a.ordersPerHour || b.salesPerHour - a.salesPerHour)
    .map((weekday) => ({
      label: `${weekday.label}曜日`,
      dayCount: weekday.dayCount,
      orderCount: weekday.orderCount,
      sales: weekday.sales,
      workHours: Math.round((weekday.workMinutes / 60) * 10) / 10,
      ordersPerHour: Math.round(weekday.ordersPerHour * 10) / 10,
      salesPerHour: weekday.salesPerHour,
      rainyDayCount: weekday.rainyDayCount
    }));
  const revenueGroups = summary.revenueGroups.map((group) => ({
    label: group.label,
    orderCount: group.orderCount,
    sales: group.sales,
    estimatedFee: group.estimatedFee,
    estimatedDeposit: group.estimatedDeposit,
    share: Math.round(group.share * 10) / 10,
    feeRate: Math.round(group.feeRate * 1000) / 10,
    averageOrderValue: group.orderCount > 0 ? Math.round(group.sales / group.orderCount) : 0
  }));
  const untrackedDays = summary.daily
    .filter((day) => day.orderCount > 0 && !day.workloadAvailable)
    .map((day) => ({
      date: day.date,
      orderCount: day.orderCount,
      sales: day.sales
    }));
  return {
    storeName,
    period: { startDate: summary.startDate, endDate: summary.endDate },
    totals: {
      ...summary.totals,
      trackedWorkHours: Math.round((totalWorkMinutes / 60) * 10) / 10,
      trackedOrdersPerHour: totalWorkMinutes > 0 ? Math.round((trackedOrders / (totalWorkMinutes / 60)) * 10) / 10 : 0,
      trackedSalesPerHour: totalWorkMinutes > 0 ? Math.round(trackedSales / (totalWorkMinutes / 60)) : 0,
      estimatedDepositPerWorkHour: totalWorkMinutes > 0 ? Math.round(summary.totals.estimatedDeposit / (totalWorkMinutes / 60)) : 0
    },
    revenueGroups,
    keyDays: {
      topSalesDay,
      topLoadDay,
      lowestLoadDay
    },
    busiestDays: summary.busiestDays.map((day) => ({
      date: day.date,
      orderCount: day.orderCount,
      sales: day.sales,
      workMinutes: day.workMinutes,
      ordersPerHour: Math.round(day.ordersPerHour * 10) / 10,
      salesPerHour: day.salesPerHour,
      loadLevelLabel: day.loadLevelLabel
    })),
    quietestDays: summary.quietestDays.map((day) => ({
      date: day.date,
      orderCount: day.orderCount,
      sales: day.sales,
      workMinutes: day.workMinutes,
      ordersPerHour: Math.round(day.ordersPerHour * 10) / 10,
      salesPerHour: day.salesPerHour,
      loadLevelLabel: day.loadLevelLabel
    })),
    weekdays: summary.weekdays
      .filter((weekday) => weekday.dayCount > 0)
      .map((weekday) => ({
        label: `${weekday.label}曜日`,
        dayCount: weekday.dayCount,
        orderCount: weekday.orderCount,
        sales: weekday.sales,
        workMinutes: weekday.workMinutes,
        ordersPerHour: Math.round(weekday.ordersPerHour * 10) / 10,
        salesPerHour: weekday.salesPerHour
      })),
    weekdayLoadRanking,
    peakHours: summary.peakHours,
    weather: {
      location: summary.weatherLocation.name,
      rainyDays: summary.daily.filter((day) => (day.precipitation ?? 0) > 0).length,
      highSalesRainyDays: summary.busiestDays.filter((day) => (day.precipitation ?? 0) > 0).map((day) => day.date),
      rainyTrackedDayAverage: rainyTrackedDays.length > 0 ? {
        dayCount: rainyTrackedDays.length,
        ordersPerHour: averageOrdersPerHour(rainyTrackedDays),
        salesPerHour: averageSalesPerHour(rainyTrackedDays)
      } : null,
      dryTrackedDayAverage: dryTrackedDays.length > 0 ? {
        dayCount: dryTrackedDays.length,
        ordersPerHour: averageOrdersPerHour(dryTrackedDays),
        salesPerHour: averageSalesPerHour(dryTrackedDays)
      } : null
    },
    externalFactors: summary.eventImpacts.map((event) => ({
      title: event.title,
      period: `${event.startDate}${event.endDate === event.startDate ? "" : `–${event.endDate}`}`,
      impactWindow: `${event.impactStartTime ?? "00:00"}–${event.impactEndTime ?? "23:59"}`,
      flowDirection: event.flowDirection,
      actualSales: event.actualSales,
      actualOrderCount: event.actualOrderCount,
      baselineSales: event.baselineSales,
      baselineOrderCount: event.baselineOrderCount,
      deltaPercent: event.deltaPercent,
      comparisonDayCount: event.comparisonDayCount,
      note: event.note
    })),
    imports: summary.imports.map((item) => ({
      sourcePlatform: item.sourcePlatform,
      brandName: item.brandName,
      fileName: item.fileName,
      importedOrderCount: item.importedOrderCount,
      createdOrderCount: item.createdOrderCount,
      updatedOrderCount: item.updatedOrderCount,
      createdAt: item.createdAt
    })),
    untrackedDays
  };
}

const salesRangeStorageKey = "foundr1:sales:selected-range";
const salesMonthStorageKey = "foundr1:sales:selected-month";
const salesStoreStorageKey = "foundr1:sales:selected-store-id";
const rangePresetOptions = [
  { key: "7d", label: "近7日", days: 7 },
  { key: "15d", label: "近半月", days: 15 },
  { key: "1m", label: "近1か月", days: 30 },
  { key: "3m", label: "近3か月", days: 90 },
  { key: "6m", label: "近半年", days: 180 },
  { key: "1y", label: "近1年", days: 365 }
] as const;
type RangePresetKey = typeof rangePresetOptions[number]["key"] | "month" | "custom";

function getStoredSalesMonth() {
  if (typeof window === "undefined") return getCurrentMonth();
  const stored = window.localStorage.getItem(salesMonthStorageKey);
  return stored && /^\d{4}-\d{2}$/.test(stored) ? stored : getCurrentMonth();
}

function getStoredSalesStoreId() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(salesStoreStorageKey) ?? "";
}

function getStoredSalesRange() {
  const monthRange = getMonthRange(getStoredSalesMonth());
  if (typeof window === "undefined") return { preset: "month" as RangePresetKey, ...monthRange };
  const stored = window.localStorage.getItem(salesRangeStorageKey);
  if (!stored) return { preset: "month" as RangePresetKey, ...monthRange };
  try {
    const parsed = JSON.parse(stored) as { preset?: string; startDate?: string; endDate?: string };
    if (parsed.startDate && parsed.endDate && /^\d{4}-\d{2}-\d{2}$/.test(parsed.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(parsed.endDate)) {
      return {
        preset: (parsed.preset as RangePresetKey) || "custom",
        startDate: parsed.startDate,
        endDate: parsed.endDate
      };
    }
  } catch {
    return { preset: "month" as RangePresetKey, ...monthRange };
  }
  return { preset: "month" as RangePresetKey, ...monthRange };
}

function storeSalesSelection(nextMonth: string, nextStoreId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(salesMonthStorageKey, nextMonth);
  if (nextStoreId) window.localStorage.setItem(salesStoreStorageKey, nextStoreId);
}

function storeSalesRange(preset: RangePresetKey, startDate: string, endDate: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(salesRangeStorageKey, JSON.stringify({ preset, startDate, endDate }));
}

export default function SalesPage() {
  const [month, setMonth] = useState(getStoredSalesMonth);
  const [range, setRange] = useState(getStoredSalesRange);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [importState, setImportState] = useState<ImportState>({
    canImport: false,
    stores: [],
    selectedStoreId: "",
    salesSources: [],
    deliveryImportPeriods: [],
    currentDueDeliveryImportPeriod: null
  });
  const [filesBySource, setFilesBySource] = useState<Record<string, File | null>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [settingsDraft, setSettingsDraft] = useState<SalesAnalysisSettings>(defaultSalesAnalysisSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [uploadingSourceId, setUploadingSourceId] = useState("");
  const [message, setMessage] = useState("");
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysisState>({ text: "", model: "", error: "" });
  const [isGeneratingAnalysis, setIsGeneratingAnalysis] = useState(false);
  const [testOrderSourceType, setTestOrderSourceType] = useState("web");
  const [testOrderQuery, setTestOrderQuery] = useState("");
  const [testOrders, setTestOrders] = useState<TestSalesOrder[]>([]);
  const [selectedTestOrderIds, setSelectedTestOrderIds] = useState<string[]>([]);
  const [isLoadingTestOrders, setIsLoadingTestOrders] = useState(false);
  const [isDeletingTestOrders, setIsDeletingTestOrders] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");

  async function loadSales(nextMonth = month, nextStoreId = selectedStoreId, nextRange = range) {
    setIsLoading(true);
    const params = new URLSearchParams({
      month: nextMonth,
      startDate: nextRange.startDate,
      endDate: nextRange.endDate
    });
    if (nextStoreId) params.set("storeId", nextStoreId);
    const summaryResponse = await fetch(`/api/sales/summary?${params.toString()}`, { cache: "no-store" });

    let resolvedMonth = nextMonth;
    let resolvedStoreId = nextStoreId;
    if (summaryResponse.ok) {
      const body = await summaryResponse.json() as SalesSummary;
      setSummary(body);
      setSettingsDraft(body.salesAnalysisSettings);
      setSelectedStoreId(body.selectedStoreId);
      resolvedMonth = body.month;
      resolvedStoreId = body.selectedStoreId;
    }

    const importParams = new URLSearchParams({ month: resolvedMonth });
    if (resolvedStoreId) importParams.set("storeId", resolvedStoreId);
    const importsResponse = await fetch(`/api/sales/imports?${importParams.toString()}`, { cache: "no-store" });
    if (importsResponse.ok) {
      const body = await importsResponse.json() as ImportState;
      const salesSources = body.salesSources ?? [];
      setImportState({
        canImport: body.canImport,
        stores: body.stores ?? [],
        selectedStoreId: body.selectedStoreId ?? resolvedStoreId,
        salesSources,
        deliveryImportPeriods: body.deliveryImportPeriods ?? [],
        currentDueDeliveryImportPeriod: body.currentDueDeliveryImportPeriod ?? null
      });
      storeSalesSelection(resolvedMonth, resolvedStoreId || body.selectedStoreId || "");
    } else {
      storeSalesSelection(resolvedMonth, resolvedStoreId);
    }
    setIsLoading(false);
  }

  useEffect(() => {
    void loadSales(getStoredSalesMonth(), getStoredSalesStoreId(), getStoredSalesRange());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const calendarDays = useMemo(() => getCalendarDays(range.startDate, range.endDate, summary?.daily ?? []), [range.endDate, range.startDate, summary?.daily]);
  const sortedWeekdays = useMemo(() => (
    [...(summary?.weekdays ?? [])]
      .filter((weekday) => weekday.dayCount > 0)
      .sort((a, b) => b.ordersPerHour - a.ordersPerHour || b.salesPerHour - a.salesPerHour || b.orderCount - a.orderCount)
  ), [summary?.weekdays]);
  const selectedStoreName = summary?.stores.find((store) => store.id === selectedStoreId)?.name ?? "";
  const topTimeBandSales = summary?.timeBands[0]?.sales ?? 0;
  const currentSettings = settingsDraft ?? summary?.salesAnalysisSettings ?? defaultSalesAnalysisSettings;
  const settingsDisabled = !summary?.canEditSalesAnalysisSettings || isSavingSettings || !selectedStoreId;
  const importedSourceMap = useMemo(() => {
    const map = new Map<string, ImportBatch>();
    for (const item of summary?.imports ?? []) {
      if (item.salesSourceId) map.set(item.salesSourceId, item);
    }
    for (const source of importState.salesSources) {
      if (map.has(source.id)) continue;
      const fallback = (summary?.imports ?? []).find((item) => (
        item.sourcePlatform === source.sourcePlatform
        && (!source.brandName || item.brandName === source.brandName)
      ));
      if (fallback) map.set(source.id, fallback);
    }
    return map;
  }, [importState.salesSources, summary?.imports]);
  const importedDeliveryPeriodMap = useMemo(() => {
    const map = new Map<string, ImportBatch>();
    for (const item of summary?.imports ?? []) {
      if (!item.deliveryImportPeriodKey) continue;
      if (item.salesSourceId) map.set(`${item.salesSourceId}:${item.deliveryImportPeriodKey}`, item);
      for (const source of importState.salesSources) {
        if (source.sourcePlatform !== item.sourcePlatform) continue;
        if (source.brandName && item.brandName !== source.brandName) continue;
        map.set(`${source.id}:${item.deliveryImportPeriodKey}`, item);
      }
    }
    return map;
  }, [importState.salesSources, summary?.imports]);
  const dueDeliveryImportKey = importState.currentDueDeliveryImportPeriod?.key ?? "";
  const selectedTestOrders = useMemo(() => {
    const selectedIds = new Set(selectedTestOrderIds);
    return testOrders.filter((order) => selectedIds.has(order.id));
  }, [selectedTestOrderIds, testOrders]);
  const selectedTestOrderTotal = selectedTestOrders.reduce((sum, order) => sum + Number(order.total ?? 0), 0);

  function updateSettingsDraft(key: SalesAnalysisSettingKey, value: number) {
    setSettingsDraft((current) => ({ ...current, [key]: value }));
  }

  function toggleTestOrderSelection(orderId: string) {
    setSelectedTestOrderIds((current) => (
      current.includes(orderId)
        ? current.filter((id) => id !== orderId)
        : [...current, orderId]
    ));
  }

  async function loadTestOrders() {
    if (!selectedStoreId || !summary?.canDeleteTestSalesOrders) return;
    setIsLoadingTestOrders(true);
    setDeleteMessage("");
    const params = new URLSearchParams({
      storeId: selectedStoreId,
      startDate: range.startDate,
      endDate: range.endDate,
      sourceType: testOrderSourceType,
      query: testOrderQuery
    });
    const response = await fetch(`/api/sales/test-orders?${params.toString()}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as { orders?: TestSalesOrder[]; error?: string };
    setIsLoadingTestOrders(false);
    if (!response.ok) {
      setDeleteMessage(body.error ?? "削除候補を読み込めませんでした。");
      return;
    }
    setTestOrders(body.orders ?? []);
    setSelectedTestOrderIds([]);
    setDeleteConfirmation("");
  }

  async function deleteSelectedTestOrders() {
    if (!selectedStoreId || selectedTestOrderIds.length === 0) return;
    setIsDeletingTestOrders(true);
    setDeleteMessage("");
    const response = await fetch("/api/sales/test-orders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: selectedStoreId,
        startDate: range.startDate,
        endDate: range.endDate,
        salesOrderIds: selectedTestOrderIds,
        confirmation: deleteConfirmation
      })
    });
    const body = await response.json().catch(() => ({})) as {
      error?: string;
      deletedSalesOrderCount?: number;
      deletedCustomerOrderCount?: number;
    };
    setIsDeletingTestOrders(false);
    if (!response.ok) {
      setDeleteMessage(body.error ?? "テストデータを削除できませんでした。");
      return;
    }
    setDeleteMessage(`削除しました。売上 ${body.deletedSalesOrderCount ?? 0}件・Web/POS注文 ${body.deletedCustomerOrderCount ?? 0}件`);
    setSelectedTestOrderIds([]);
    setDeleteConfirmation("");
    await Promise.all([
      loadSales(month, selectedStoreId, range),
      loadTestOrders()
    ]);
  }

  async function saveSalesAnalysisSettings() {
    if (!selectedStoreId) return;
    setIsSavingSettings(true);
    const response = await fetch("/api/sales/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: selectedStoreId, ...currentSettings })
    });
    if (response.ok) {
      await loadSales(month, selectedStoreId, range);
      setSettingsOpen(false);
    } else {
      const body = await response.json().catch(() => ({})) as { error?: string };
      setMessage(body.error ?? "売上分析設定を保存できませんでした。");
    }
    setIsSavingSettings(false);
  }

  async function uploadSalesFile(source: SalesSourceOption, deliveryImportPeriod?: DeliveryImportPeriod) {
    const selectedFile = filesBySource[source.id];
    if (!selectedFile || !selectedStoreId || !source.id) return;
    const uploadKey = deliveryImportPeriod ? `${source.id}:${deliveryImportPeriod.key}` : source.id;
    setUploadingSourceId(uploadKey);
    setMessage("");
    const formData = new FormData();
    formData.set("storeId", selectedStoreId);
    formData.set("month", month);
    formData.set("salesSourceId", source.id);
    if (deliveryImportPeriod) formData.set("deliveryImportPeriodKey", deliveryImportPeriod.key);
    formData.set("file", selectedFile);
    const response = await fetch("/api/sales/imports", {
      method: "POST",
      body: formData
    });
    const body = await response.json().catch(() => ({})) as {
      error?: string;
      importedOrderCount?: number;
      createdOrderCount?: number;
      updatedOrderCount?: number;
      rawRowCount?: number;
    };
    setUploadingSourceId("");
    if (!response.ok) {
      setMessage(body.error ?? "売上ファイルを取り込めませんでした。");
      return;
    }
    setFilesBySource((current) => ({ ...current, [source.id]: null }));
    const periodLabel = deliveryImportPeriod ? `（${deliveryImportPeriod.label}分）` : "";
    setMessage(`${source.sourceLabel}${periodLabel} の売上ファイルを取り込みました。解析 ${body.importedOrderCount ?? 0} 件・新規 ${body.createdOrderCount ?? 0} 件・更新 ${body.updatedOrderCount ?? 0} 件 / 行 ${body.rawRowCount ?? 0} 件`);
    await loadSales(month, selectedStoreId);
  }

  async function generateAiAnalysis() {
    if (!summary) return;
    setIsGeneratingAnalysis(true);
    setAiAnalysis({ text: "", model: "", error: "" });
    const response = await fetch("/api/sales/ai-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeName: selectedStoreName,
        period: { startDate: range.startDate, endDate: range.endDate },
        facts: buildSalesAnalysisFacts(summary, selectedStoreName)
      })
    });
    const body = await response.json().catch(() => ({})) as { analysis?: string; model?: string; error?: string };
    setIsGeneratingAnalysis(false);
    if (!response.ok) {
      setAiAnalysis({ text: "", model: "", error: body.error ?? "AI分析を作成できませんでした。" });
      return;
    }
    setAiAnalysis({ text: body.analysis ?? "", model: body.model ?? "", error: "" });
  }

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="管理画面ナビゲーション">
        <a className="brand-block" href="/os" aria-label="OS ホームへ戻る">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>Foundr1 OS</h1>
          </div>
        </a>
        <MobileNavMenu navItems={navItems} />
        <div className="sidebar-user">
          <UserBadge />
        </div>
        <OsNavList navItems={navItems} />
      </aside>

      <section className="workspace sales-workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">POS・Web予約・デリバリーの統合分析</p>
            <h2>売上分析</h2>
            <span className="source-indicator">{isLoading ? "読み込み中" : `${selectedStoreName || "店舗"} / ${range.startDate} - ${range.endDate}`}</span>
          </div>
          <div className="timecard-toolbar">
            <input type="month" value={month} onChange={(event) => {
              const nextMonth = event.target.value;
              const nextRange = getMonthRange(nextMonth);
              setMonth(nextMonth);
              setRange({ preset: "month", ...nextRange });
              storeSalesSelection(nextMonth, selectedStoreId);
              storeSalesRange("month", nextRange.startDate, nextRange.endDate);
              void loadSales(nextMonth, selectedStoreId, { preset: "month", ...nextRange });
            }} />
            <select value={selectedStoreId} onChange={(event) => {
              setSelectedStoreId(event.target.value);
              setFilesBySource({});
              storeSalesSelection(month, event.target.value);
              void loadSales(month, event.target.value, range);
            }}>
              {(summary?.stores.length ? summary.stores : importState.stores).map((store) => (
                <option value={store.id} key={store.id}>{store.name}</option>
              ))}
            </select>
          </div>
        </header>

        <section className="panel sales-period-panel">
          <div className="sales-period-heading">
            <div>
              <h3>分析期間</h3>
              <p>売上・曜日・忙しさの集計期間です。ファイル取込の対象月とは別に指定できます。</p>
            </div>
            <span>{range.startDate} - {range.endDate}</span>
          </div>
          <div className="sales-period-controls">
            <button className={range.preset === "month" ? "secondary-button is-active" : "secondary-button"} type="button" onClick={() => {
              const nextRange = getMonthRange(month);
              setRange({ preset: "month", ...nextRange });
              storeSalesRange("month", nextRange.startDate, nextRange.endDate);
              void loadSales(month, selectedStoreId, { preset: "month", ...nextRange });
            }}>選択月</button>
            {rangePresetOptions.map((option) => (
              <button className={range.preset === option.key ? "secondary-button is-active" : "secondary-button"} type="button" key={option.key} onClick={() => {
                const nextRange = getRecentRange(option.days);
                setRange({ preset: option.key, ...nextRange });
                storeSalesRange(option.key, nextRange.startDate, nextRange.endDate);
                void loadSales(month, selectedStoreId, { preset: option.key, ...nextRange });
              }}>{option.label}</button>
            ))}
            <label>
              <span>開始日</span>
              <input type="date" value={range.startDate} onChange={(event) => {
                const nextRange = { preset: "custom" as RangePresetKey, startDate: event.target.value, endDate: range.endDate };
                setRange(nextRange);
                storeSalesRange("custom", nextRange.startDate, nextRange.endDate);
                if (nextRange.startDate <= nextRange.endDate) void loadSales(month, selectedStoreId, nextRange);
              }} />
            </label>
            <label>
              <span>終了日</span>
              <input type="date" value={range.endDate} onChange={(event) => {
                const nextRange = { preset: "custom" as RangePresetKey, startDate: range.startDate, endDate: event.target.value };
                setRange(nextRange);
                storeSalesRange("custom", nextRange.startDate, nextRange.endDate);
                if (nextRange.startDate <= nextRange.endDate) void loadSales(month, selectedStoreId, nextRange);
              }} />
            </label>
          </div>
        </section>

        <section className="metric-grid">
          <article className="metric-card">
            <span>売上高</span>
            <strong>{formatMoney(summary?.totals.sales ?? 0)}</strong>
            <small>注文 {summary?.totals.orderCount ?? 0}件 / 売上計上日数 {summary?.totals.salesPostedDayCount ?? 0}日 / 勤怠反映日数 {summary?.totals.workTrackedDayCount ?? 0}日</small>
          </article>
          <article className="metric-card">
            <span>推定入金額</span>
            <strong>{formatMoney(summary?.totals.estimatedDeposit ?? 0)}</strong>
            <small>手数料控除後の目安</small>
          </article>
          <article className="metric-card">
            <span>推定手数料</span>
            <strong>{formatMoney(summary?.totals.estimatedFee ?? 0)}</strong>
            <small>デリバリー 38.5%で概算</small>
          </article>
          <article className="metric-card">
            <span>デリバリー比率</span>
            <strong>{formatPercent(summary?.totals.deliveryShare ?? 0)}</strong>
            <small>平均客単価 {formatMoney(summary?.totals.averageOrderValue ?? 0)}</small>
          </article>
        </section>

        <details
          className="panel workload-settings-panel sales-analysis-settings-panel"
          open={settingsOpen}
          onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
        >
          <summary className="sales-analysis-settings-summary">
            <Settings size={18} />
            <div>
              <h3>売上分析の判定基準</h3>
              <p>月視図の「忙しい」「空き」は、従業員負荷とは別に、在店時間で割った売上・注文数が本期平均の何倍かで判定します。</p>
            </div>
          </summary>
          <div className="workload-settings-content">
            <div className="workload-settings-section">
              <h4>本期平均との比較</h4>
              <p>
                平均 注文 {formatRate(summary?.salesAnalysisBaseline.averageOrdersPerHour ?? 0)}件/時間、
                売上 {formatMoney(summary?.salesAnalysisBaseline.averageSalesPerHour ?? 0)} / 時間を基準にします。
              </p>
              <div className="workload-level-settings-grid">
                {([
                  ["かなり空き", "veryIdleRateMax", "平均のこの倍率まで"],
                  ["通常", "normalRateMax", "平均のこの倍率まで"],
                  ["忙しい", "busyRateMax", "平均のこの倍率まで"],
                  ["高負荷", "highRateMax", "平均のこの倍率まで"]
                ] as Array<[string, SalesAnalysisSettingKey, string]>).map(([label, key, note]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <div className="workload-setting-input-row">
                      <input
                        type="number"
                        min="0"
                        max="30"
                        step="0.1"
                        value={String(currentSettings[key])}
                        disabled={settingsDisabled}
                        onChange={(event) => updateSettingsDraft(key, Number(event.target.value))}
                      />
                      <em>倍</em>
                    </div>
                    <small>{note}</small>
                  </label>
                ))}
              </div>
              <small>注文/時間と売上/時間をそれぞれ平均比で判定し、高い方を採用します。高負荷の上限を超える日は「超負荷」です。</small>
            </div>
            <div className="workload-settings-actions">
              <button className="secondary-button" type="button" disabled={settingsDisabled} onClick={() => void saveSalesAnalysisSettings()}>
                {isSavingSettings ? "保存中" : "判定基準を保存"}
              </button>
            </div>
          </div>
        </details>

        <section className="panel sales-ai-panel">
          <div className="sales-ai-heading">
            <div>
              <p className="eyebrow">AI Review</p>
              <h3>AI月次分析</h3>
              <p>現在の分析期間から、売上の集計基準、忙しさ、人員配置、勤怠未反映の注意点と次月の具体策を整理します。</p>
            </div>
            <button className="primary-button" type="button" disabled={!summary || isGeneratingAnalysis} onClick={() => void generateAiAnalysis()}>
              {isGeneratingAnalysis ? "作成中" : "AI分析を作成"}
            </button>
          </div>
          {aiAnalysis.error ? <div className="inline-alert is-warning">{aiAnalysis.error}</div> : null}
          {aiAnalysis.text ? (
            <div className="sales-ai-output">
              <pre>{aiAnalysis.text}</pre>
              {aiAnalysis.model ? <small>Model: {aiAnalysis.model}</small> : null}
            </div>
          ) : (
            <p className="sales-ai-empty">ボタンを押すと、集計済みデータだけを使って経営レビューを作成します。</p>
          )}
        </section>

        <section className="sales-grid">
          <article className="panel sales-revenue-panel">
            <div className="panel-title">
              <ChartColumn size={18} />
              <div>
                <h3>売上の集計基準</h3>
                <p>店内・予約とデリバリーを分けて、入金額の目安を確認します。</p>
              </div>
            </div>
            <div className="sales-revenue-list">
              <div className="sales-revenue-row is-header">
                <span>区分</span>
                <span>売上高</span>
                <span>推定手数料</span>
                <span>推定入金額</span>
              </div>
              {(summary?.revenueGroups ?? []).map((group) => (
                <div className="sales-revenue-row" key={group.key}>
                  <div>
                    <strong>{group.label}</strong>
                    <small>{group.orderCount}件 / 手数料率 {formatPercent(group.feeRate * 100)}</small>
                  </div>
                  <span>{formatMoney(group.sales)}</span>
                  <span>{formatMoney(group.estimatedFee)}</span>
                  <strong>{formatMoney(group.estimatedDeposit)}</strong>
                </div>
              ))}
            </div>
          </article>

          <article className="panel sales-import-panel">
            <div className="panel-title">
              <Upload size={18} />
              <div>
                <h3>売上ファイル取込</h3>
                <p>店舗設定の売上源に合わせて、月初に手動ダウンロードしたCSV・Excelを取り込みます。</p>
              </div>
            </div>
            <p className="sales-import-guidance">
              営業日をまたぐ深夜営業を正しく分析するため、対象月の前日から翌日までの範囲で売上レポートを取得してください。
            </p>
            <div className="sales-source-upload-list" aria-label="売上源別の取込状況">
              {importState.salesSources.map((source) => {
                const isDeliverySource = source.sourceType === "delivery";
                const deliveryPeriods = isDeliverySource ? importState.deliveryImportPeriods : [];
                const imported = isDeliverySource ? null : importedSourceMap.get(source.id) ?? null;
                const selectedFile = filesBySource[source.id] ?? null;
                const isUploading = uploadingSourceId === source.id;
                const importedDeliveryPeriodCount = deliveryPeriods.filter((period) => importedDeliveryPeriodMap.has(`${source.id}:${period.key}`)).length;
                const hasSomeDeliveryPeriodsImported = importedDeliveryPeriodCount > 0;
                const allDeliveryPeriodsImported = deliveryPeriods.length > 0
                  && importedDeliveryPeriodCount === deliveryPeriods.length;
                const sourceStatusLabel = imported || allDeliveryPeriodsImported
                  ? "取込済み"
                  : hasSomeDeliveryPeriodsImported
                    ? "一部取込済み"
                    : source.importSupported
                      ? "未取込"
                      : "準備中";
                const sourceStatusClass = imported || allDeliveryPeriodsImported || hasSomeDeliveryPeriodsImported
                  ? "is-active"
                  : source.importSupported
                    ? ""
                    : "is-muted";
                return (
                  <div className={`sales-source-upload-row${imported || allDeliveryPeriodsImported || hasSomeDeliveryPeriodsImported ? " is-uploaded" : ""}`} key={source.id}>
                    <div className="sales-source-upload-main">
                      <div className="sales-source-upload-heading">
                        <strong>{source.sourceLabel}</strong>
                        <span className={`status-pill ${sourceStatusClass}`}>
                          {sourceStatusLabel}
                        </span>
                      </div>
                      <small>
                        {isDeliverySource && source.importSupported
                          ? "デリバリー売上は毎月2回、1〜15日分と16日〜月末分に分けて取り込みます。"
                          : imported
                          ? `${imported.fileName} / ${formatDateTime(imported.createdAt)} / 解析 ${imported.importedOrderCount}件・新規 ${imported.createdOrderCount}件・更新 ${imported.updatedOrderCount}件`
                          : source.importSupported
                            ? "この月の売上ファイルを取り込んでください。"
                            : `${source.sourceLabel} の売上ファイル取込は次フェーズで対応します。`}
                      </small>
                    </div>
                    {isDeliverySource && source.importSupported ? (
                      <div className="sales-delivery-period-list">
                        {deliveryPeriods.map((period) => {
                          const periodImported = importedDeliveryPeriodMap.get(`${source.id}:${period.key}`) ?? null;
                          const isPeriodUploading = uploadingSourceId === `${source.id}:${period.key}`;
                          const isDue = dueDeliveryImportKey === period.key;
                          return (
                            <div className={`sales-delivery-period-row${periodImported ? " is-uploaded" : ""}${isDue && !periodImported ? " is-due" : ""}`} key={period.key}>
                              <div className="sales-delivery-period-main">
                                <div className="sales-delivery-period-heading">
                                  <strong>{period.label}分</strong>
                                  <span className={`status-pill ${periodImported ? "is-active" : ""}`}>
                                    {periodImported ? "取込済み" : "未取込"}
                                  </span>
                                </div>
                                <small>
                                  対象 {period.targetStartDate}〜{period.targetEndDate} / 取得範囲 {period.downloadStartDate}〜{period.downloadEndDate} / 期限 {period.dueDate}
                                </small>
                                {periodImported ? (
                                  <small>{periodImported.fileName} / {formatDateTime(periodImported.createdAt)} / 解析 {periodImported.importedOrderCount}件・新規 {periodImported.createdOrderCount}件・更新 {periodImported.updatedOrderCount}件</small>
                                ) : null}
                              </div>
                              {!periodImported ? (
                                <button className="primary-button" type="button" disabled={!selectedFile || !selectedStoreId || !importState.canImport || Boolean(uploadingSourceId)} onClick={() => void uploadSalesFile(source, period)}>
                                  {isPeriodUploading ? "取込中" : "この期間を取込"}
                                </button>
                              ) : null}
                            </div>
                          );
                        })}
                        {!selectedFile && deliveryPeriods.some((period) => !importedDeliveryPeriodMap.has(`${source.id}:${period.key}`)) ? (
                          <small className="sales-delivery-period-note">未取込の期間を選ぶ前に、下のファイル選択でCSV・Excelを選択してください。</small>
                        ) : null}
                        {deliveryPeriods.length === 0 ? <small className="sales-delivery-period-note">対象月を選ぶと半月ごとの取込期間を表示します。</small> : null}
                        <div className="sales-source-upload-control">
                          <input
                            type="file"
                            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                            disabled={!importState.canImport || Boolean(uploadingSourceId)}
                            onChange={(event) => {
                              const nextFile = event.target.files?.[0] ?? null;
                              setFilesBySource((current) => ({ ...current, [source.id]: nextFile }));
                            }}
                          />
                        </div>
                      </div>
                    ) : source.importSupported && !imported ? (
                      <div className="sales-source-upload-control">
                        <input
                          type="file"
                          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                          disabled={!importState.canImport || Boolean(uploadingSourceId)}
                          onChange={(event) => {
                            const nextFile = event.target.files?.[0] ?? null;
                            setFilesBySource((current) => ({ ...current, [source.id]: nextFile }));
                          }}
                        />
                        <button className="primary-button" type="button" disabled={!selectedFile || !selectedStoreId || !importState.canImport || Boolean(uploadingSourceId)} onClick={() => void uploadSalesFile(source)}>
                          {isUploading ? "取込中" : "取込"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {message ? <p className="sales-import-message">{message}</p> : null}
            {!importState.canImport ? <p className="sales-import-message">売上データの取込は owner / manager が操作できます。</p> : null}
            {importState.canImport && importState.salesSources.length === 0 ? <p className="sales-import-message">この店舗の売上源が未設定です。店舗・ブランド設定で売上源を追加してください。</p> : null}
            <div className="sales-import-list">
              {(summary?.imports ?? []).map((item) => (
                <div className="sales-import-row" key={item.id}>
                  <div>
                    <strong>{item.fileName}</strong>
                    <small>{item.sourcePlatform} / {formatDateTime(item.createdAt)}</small>
                  </div>
                  <span>解析 {item.importedOrderCount}件 / 新規 {item.createdOrderCount}件 / 更新 {item.updatedOrderCount}件</span>
                </div>
              ))}
              {summary && summary.imports.length === 0 ? <div className="empty-state">この月の取込履歴はありません</div> : null}
            </div>
          </article>

          {summary?.canDeleteTestSalesOrders ? (
            <article className="panel sales-test-delete-panel">
              <div className="panel-title">
                <Trash2 size={18} />
                <div>
                  <h3>テストデータ削除</h3>
                  <p>取消・未払いの通常注文は残します。ここではテストや誤取込だけを選んで物理削除します。</p>
                </div>
              </div>
              <div className="sales-test-delete-controls">
                <label>
                  <span>区分</span>
                  <select value={testOrderSourceType} onChange={(event) => setTestOrderSourceType(event.target.value)}>
                    <option value="all">すべて</option>
                    <option value="web">Web予約</option>
                    <option value="pos">POS</option>
                    <option value="delivery">デリバリー取込</option>
                  </select>
                </label>
                <label>
                  <span>検索</span>
                  <input
                    value={testOrderQuery}
                    onChange={(event) => setTestOrderQuery(event.target.value)}
                    placeholder="注文番号・名前・電話"
                  />
                </label>
                <button className="secondary-button" type="button" disabled={!selectedStoreId || isLoadingTestOrders} onClick={() => void loadTestOrders()}>
                  <Search size={16} />{isLoadingTestOrders ? "検索中" : "候補を検索"}
                </button>
              </div>
              {deleteMessage ? <div className="inline-alert is-warning">{deleteMessage}</div> : null}
              <div className="sales-test-order-list">
                {testOrders.map((order) => (
                  <label className="sales-test-order-row" key={order.id}>
                    <input
                      type="checkbox"
                      checked={selectedTestOrderIds.includes(order.id)}
                      onChange={() => toggleTestOrderSelection(order.id)}
                    />
                    <div>
                      <strong>{order.orderNo || order.pickupCode || "注文番号なし"}</strong>
                      <small>
                        {order.orderedAtLabel} / {order.sourcePlatform} / {order.status}・{order.paymentStatus}
                        {order.hasCustomerOrder ? "" : " / 売上のみ残存"}
                      </small>
                      {(order.customerName || order.customerPhone) ? <small>{order.customerName} {order.customerPhone}</small> : null}
                    </div>
                    <b>{formatMoney(order.total)}</b>
                  </label>
                ))}
                {testOrders.length === 0 ? <div className="empty-state">候補を検索してください</div> : null}
              </div>
              <div className="sales-test-delete-actions">
                <div>
                  <strong>{selectedTestOrderIds.length}件選択</strong>
                  <small>合計 {formatMoney(selectedTestOrderTotal)} / 確認欄に DELETE と入力</small>
                </div>
                <input
                  value={deleteConfirmation}
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                  placeholder="DELETE"
                  aria-label="削除確認"
                />
                <button
                  className="danger-button"
                  type="button"
                  disabled={selectedTestOrderIds.length === 0 || deleteConfirmation !== "DELETE" || isDeletingTestOrders}
                  onClick={() => void deleteSelectedTestOrders()}
                >
                  {isDeletingTestOrders ? "削除中" : "選択データを削除"}
                </button>
              </div>
            </article>
          ) : null}

          <article className="panel">
            <div className="panel-title">
              <CalendarDays size={18} />
              <div>
                <h3>月視図カレンダー</h3>
                <p>日ごとの売上と天気を一覧します。忙しさは在店時間で割った本期平均と比較して判定します。</p>
              </div>
            </div>
            <div className="sales-calendar">
              {["月", "火", "水", "木", "金", "土", "日"].map((label) => (
                <span className="sales-calendar-weekday" key={label}>{label}</span>
              ))}
              {calendarDays.map((day, index) => {
                if (!day) return <span className="sales-calendar-cell is-empty" key={`empty-${index}`} />;
                return (
                  <div className={`sales-calendar-cell ${day.workloadAvailable ? getDensityLevelClass(day.loadLevel) : "is-untracked"}`} key={day.date}>
                    <div className="sales-calendar-cell-head">
                      <strong>{Number(day.date.slice(8))}</strong>
                      <span title={day.weatherLabel || "天気未取得"}>{getWeatherIcon(day.weatherCode)}</span>
                    </div>
                    <div className="sales-calendar-amounts">
                      <span><em>店内・予約</em><b>{formatMoney(day.inStoreSales)}</b></span>
                      <span><em>デリバリー入金目安</em><b>{formatMoney(day.deliveryEstimatedDeposit)}</b></span>
                    </div>
                    {day.calendarEvents.length ? (
                      <div className="sales-calendar-events" title={day.calendarEvents.map((event) => event.title).join(" / ")}>
                        {day.calendarEvents.slice(0, 2).map((event) => (
                          <span className={`is-${event.flowDirection}`} key={event.id}>{getFlowDirectionLabel(event.flowDirection)}・{event.title}</span>
                        ))}
                        {day.calendarEvents.length > 2 ? <small>ほか{day.calendarEvents.length - 2}件</small> : null}
                      </div>
                    ) : null}
                    {day.workloadAvailable ? (
                      <small>{day.loadLevelLabel} / 注文 平均比 {formatRate(day.orderRate)}倍</small>
                    ) : day.orderCount > 0 ? (
                      <small>勤怠未登録 / {day.orderCount}件</small>
                    ) : (
                      <small>注文なし</small>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="sales-calendar-note">天気: {summary?.weatherLocation.name ?? "店舗所在地"} の参考値</p>
          </article>
          <article className="panel sales-event-impact-panel">
            <div className="panel-title">
              <CalendarDays size={18} />
              <div>
                <h3>外部要因の時間帯別影響</h3>
                <p>同じ曜日・同じ時間帯の非重大イベント日を基準に比較します。流入・流出は想定される人流方向、実績増減は売上データの観測結果です。</p>
              </div>
            </div>
            <div className="sales-event-impact-list">
              {(summary?.eventImpacts ?? []).map((event) => (
                <article className={`is-${event.observedDirection}`} key={event.id}>
                  <div className="sales-event-impact-title">
                    <span className={`is-${event.flowDirection}`}>{getFlowDirectionLabel(event.flowDirection)}</span>
                    <div>
                      <strong>{event.title}</strong>
                      <small>{event.startDate}{event.endDate === event.startDate ? "" : `–${event.endDate}`} / {event.impactStartTime ?? "00:00"}–{event.impactEndTime ?? "23:59"} / {event.venue}</small>
                    </div>
                  </div>
                  <div className="sales-event-impact-metrics">
                    <span><small>影響時間内実績</small><strong>{formatMoney(event.actualSales)}</strong><em>{event.actualOrderCount}件</em></span>
                    <span><small>同曜日基準</small><strong>{event.comparisonDayCount ? formatMoney(event.baselineSales) : "比較不足"}</strong><em>{event.comparisonDayCount ? `${event.baselineOrderCount}件相当` : "基準日なし"}</em></span>
                    <span><small>{getObservedDirectionLabel(event.observedDirection)}</small><strong>{event.deltaPercent === null ? "–" : `${event.deltaPercent > 0 ? "+" : ""}${event.deltaPercent}%`}</strong><em>比較日 {event.comparisonDayCount}日</em></span>
                  </div>
                </article>
              ))}
              {summary && summary.eventImpacts.length === 0 ? <div className="empty-state">選択期間に対象イベントはありません</div> : null}
            </div>
          </article>
        </section>

        <section className="sales-grid">
          <article className="panel">
            <h3>忙しい日</h3>
            <div className="sales-rank-list">
              {(summary?.busiestDays ?? []).map((day) => (
                <div className={`sales-analysis-row ${getDensityLevelClass(day.loadLevel)}`} key={day.date}>
                  <div>
                    <span>{formatDate(day.date)}</span>
                    <small>{day.orderCount}件 / 在店 {formatDuration(day.workMinutes)} / 売上 {formatMoney(day.sales)}</small>
                  </div>
                  <div>
                    <strong>{day.loadLevelLabel}</strong>
                    <small>注文 平均比 {formatRate(day.orderRate)}倍 / 売上 平均比 {formatRate(day.salesRate)}倍</small>
                  </div>
                </div>
              ))}
            </div>
          </article>
          <article className="panel">
            <h3>空きやすい日</h3>
            <div className="sales-rank-list">
              {(summary?.quietestDays ?? []).map((day) => (
                <div className={`sales-analysis-row ${getDensityLevelClass(day.loadLevel)}`} key={day.date}>
                  <div>
                    <span>{formatDate(day.date)}</span>
                    <small>{day.orderCount}件 / 在店 {formatDuration(day.workMinutes)} / 売上 {formatMoney(day.sales)}</small>
                  </div>
                  <div>
                    <strong>{day.averageLoadLevelLabel}</strong>
                    <small>注文 平均比 {formatRate(day.orderRate)}倍 / ピーク {day.peakHourOrderCount}件/時間</small>
                  </div>
                </div>
              ))}
            </div>
          </article>
          <article className="panel">
            <h3>曜日別の忙しさ</h3>
            <div className="sales-weekday-list">
              {sortedWeekdays.map((weekday, index) => (
                <div className="sales-weekday-row" key={weekday.weekday}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{weekday.label}曜日</strong>
                    <small>{weekday.dayCount}日 / {weekday.orderCount}件 / 在店 {formatDuration(weekday.workMinutes)}</small>
                  </div>
                  <div className="sales-weekday-meter">
                    <i style={{ width: `${Math.max(8, (weekday.ordersPerHour / Math.max(1, sortedWeekdays[0]?.ordersPerHour ?? 1)) * 100)}%` }} />
                  </div>
                  <b>{formatRate(weekday.ordersPerHour)}件/時間</b>
                </div>
              ))}
            </div>
          </article>
          <article className="panel">
            <h3>ピーク時間</h3>
            <div className="sales-rank-list">
              {(summary?.peakHours ?? []).map((hour) => (
                <div className="sales-rank-row" key={hour.hour}>
                  <span>{String(hour.hour).padStart(2, "0")}:00</span>
                  <strong>{hour.orderCount}件</strong>
                  <small>{formatMoney(hour.sales)}</small>
                </div>
              ))}
            </div>
          </article>
          <article className="panel">
            <h3>時間帯別売上ランキング</h3>
            <div className="sales-time-band-list">
              {(summary?.timeBands ?? []).map((band, index) => (
                <div className="sales-time-band-row" key={band.key}>
                  <div className="sales-time-band-main">
                    <span>{index + 1}</span>
                    <div>
                      <strong>{band.label}</strong>
                      <small>{band.startLabel}-{band.endLabel} / {band.orderCount}件 / 客単価 {formatMoney(band.averageOrderValue)}</small>
                    </div>
                    <b>{formatMoney(band.sales)}</b>
                  </div>
                  <div className="sales-time-band-meter">
                    <i style={{ width: `${topTimeBandSales > 0 ? Math.max(6, (band.sales / topTimeBandSales) * 100) : 0}%` }} />
                  </div>
                  <small>構成比 {formatPercent(band.share)}</small>
                </div>
              ))}
              {summary && summary.timeBands.length === 0 ? <div className="empty-state">時間帯別の売上データはありません</div> : null}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
