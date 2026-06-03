"use client";

import {
  Boxes,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  LineChart,
  LogOut,
  Settings,
  Upload,
  WalletCards
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { UserBadge } from "../components/UserBadge";

type StoreOption = { id: string; name: string };
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
};
type SalesHour = { hour: number; orderCount: number; sales: number };
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
  rawRowCount: number;
  createdAt: string;
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
    activeDayCount: number;
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
};
type AiAnalysisState = {
  text: string;
  model: string;
  error: string;
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "経営分析", href: "/os/analytics", icon: LineChart },
  { label: "売上分析", href: "/os/analytics/sales", icon: ChartColumn },
  { label: "人件費分析", href: "/os/analytics/labor", icon: WalletCards },
  { label: "原価分析", href: "/os/analytics/cost", icon: Boxes },
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
      precipitation: null
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
    imports: summary.imports.map((item) => ({
      sourcePlatform: item.sourcePlatform,
      brandName: item.brandName,
      fileName: item.fileName,
      importedOrderCount: item.importedOrderCount,
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
  const [importState, setImportState] = useState<ImportState>({ canImport: false, stores: [], selectedStoreId: "", salesSources: [] });
  const [filesBySource, setFilesBySource] = useState<Record<string, File | null>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [settingsDraft, setSettingsDraft] = useState<SalesAnalysisSettings>(defaultSalesAnalysisSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [uploadingSourceId, setUploadingSourceId] = useState("");
  const [message, setMessage] = useState("");
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysisState>({ text: "", model: "", error: "" });
  const [isGeneratingAnalysis, setIsGeneratingAnalysis] = useState(false);

  async function loadSales(nextMonth = month, nextStoreId = selectedStoreId, nextRange = range) {
    setIsLoading(true);
    const params = new URLSearchParams({
      month: nextMonth,
      startDate: nextRange.startDate,
      endDate: nextRange.endDate
    });
    if (nextStoreId) params.set("storeId", nextStoreId);
    const importParams = new URLSearchParams({ month: nextMonth });
    if (nextStoreId) importParams.set("storeId", nextStoreId);
    const [summaryResponse, importsResponse] = await Promise.all([
      fetch(`/api/sales/summary?${params.toString()}`, { cache: "no-store" }),
      fetch(`/api/sales/imports?${importParams.toString()}`, { cache: "no-store" })
    ]);

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
    if (importsResponse.ok) {
      const body = await importsResponse.json() as ImportState;
      const salesSources = body.salesSources ?? [];
      setImportState({
        canImport: body.canImport,
        stores: body.stores ?? [],
        selectedStoreId: body.selectedStoreId ?? resolvedStoreId,
        salesSources
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

  function updateSettingsDraft(key: SalesAnalysisSettingKey, value: number) {
    setSettingsDraft((current) => ({ ...current, [key]: value }));
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

  async function uploadSalesFile(source: SalesSourceOption) {
    const selectedFile = filesBySource[source.id];
    if (!selectedFile || !selectedStoreId || !source.id) return;
    setUploadingSourceId(source.id);
    setMessage("");
    const formData = new FormData();
    formData.set("storeId", selectedStoreId);
    formData.set("month", month);
    formData.set("salesSourceId", source.id);
    formData.set("file", selectedFile);
    const response = await fetch("/api/sales/imports", {
      method: "POST",
      body: formData
    });
    const body = await response.json().catch(() => ({})) as { error?: string; importedOrderCount?: number; rawRowCount?: number };
    setUploadingSourceId("");
    if (!response.ok) {
      setMessage(body.error ?? "売上ファイルを取り込めませんでした。");
      return;
    }
    setFilesBySource((current) => ({ ...current, [source.id]: null }));
    setMessage(`${source.sourceLabel} の売上ファイルを取り込みました。注文 ${body.importedOrderCount ?? 0} 件 / 行 ${body.rawRowCount ?? 0} 件`);
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
            <small>注文 {summary?.totals.orderCount ?? 0}件 / 稼働日 {summary?.totals.activeDayCount ?? 0}日</small>
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
                const imported = importedSourceMap.get(source.id) ?? null;
                const selectedFile = filesBySource[source.id] ?? null;
                const isUploading = uploadingSourceId === source.id;
                return (
                  <div className={`sales-source-upload-row${imported ? " is-uploaded" : ""}`} key={source.id}>
                    <div className="sales-source-upload-main">
                      <div className="sales-source-upload-heading">
                        <strong>{source.sourceLabel}</strong>
                        <span className={`status-pill ${imported ? "is-active" : source.importSupported ? "" : "is-muted"}`}>
                          {imported ? "取込済み" : source.importSupported ? "未取込" : "準備中"}
                        </span>
                      </div>
                      <small>
                        {imported
                          ? `${imported.fileName} / ${formatDateTime(imported.createdAt)} / ${imported.importedOrderCount}件`
                          : source.importSupported
                            ? "この月の売上ファイルを取り込んでください。"
                            : `${source.sourceLabel} の売上ファイル取込は次フェーズで対応します。`}
                      </small>
                    </div>
                    {source.importSupported && !imported ? (
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
                  <span>{item.importedOrderCount}件</span>
                </div>
              ))}
              {summary && summary.imports.length === 0 ? <div className="empty-state">この月の取込履歴はありません</div> : null}
            </div>
          </article>

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
        </section>
      </section>
    </main>
  );
}
