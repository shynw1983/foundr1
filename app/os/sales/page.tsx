"use client";

import {
  Boxes,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  FileText,
  Lightbulb,
  LogOut,
  MessageSquareWarning,
  PackageCheck,
  Search,
  Store,
  Truck,
  Upload,
  UserCog
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { UserBadge } from "../components/UserBadge";

type StoreOption = { id: string; name: string };
type SalesDay = { date: string; orderCount: number; sales: number };
type SalesHour = { hour: number; orderCount: number; sales: number };
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
  sourcePlatform: string;
  fileName: string;
  importedOrderCount: number;
  rawRowCount: number;
  createdAt: string;
};
type SalesSourceOption = {
  id: string;
  sourcePlatform: string;
  sourceLabel: string;
  sourceType: string;
  brandName: string;
  importSupported: boolean;
};
type SalesSummary = {
  month: string;
  stores: StoreOption[];
  selectedStoreId: string;
  totals: {
    orderCount: number;
    sales: number;
    estimatedFee: number;
    estimatedDeposit: number;
    deliveryShare: number;
    averageOrderValue: number;
    activeDayCount: number;
  };
  revenueGroups: RevenueGroup[];
  daily: SalesDay[];
  hourly: SalesHour[];
  busiestDays: SalesDay[];
  quietestDays: SalesDay[];
  peakHours: SalesHour[];
  imports: ImportBatch[];
};
type ImportState = {
  canImport: boolean;
  stores: StoreOption[];
  selectedStoreId: string;
  salesSources: SalesSourceOption[];
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "購入管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "売上分析", href: "/os/sales", icon: ChartColumn },
  { label: "商品マスタ", href: "/os/products", icon: Boxes },
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/os/product-comparisons", icon: Search },
  { label: "連絡・報告", href: "/os/reports", icon: MessageSquareWarning },
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

const salesMonthStorageKey = "foundr1:sales:selected-month";
const salesStoreStorageKey = "foundr1:sales:selected-store-id";
const salesSourceStorageKey = "foundr1:sales:selected-source-id";

function getStoredSalesMonth() {
  if (typeof window === "undefined") return getCurrentMonth();
  const stored = window.localStorage.getItem(salesMonthStorageKey);
  return stored && /^\d{4}-\d{2}$/.test(stored) ? stored : getCurrentMonth();
}

function getStoredSalesStoreId() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(salesStoreStorageKey) ?? "";
}

function getStoredSalesSourceId() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(salesSourceStorageKey) ?? "";
}

function storeSalesSelection(nextMonth: string, nextStoreId: string, nextSourceId = "") {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(salesMonthStorageKey, nextMonth);
  if (nextStoreId) window.localStorage.setItem(salesStoreStorageKey, nextStoreId);
  if (nextSourceId) window.localStorage.setItem(salesSourceStorageKey, nextSourceId);
}

export default function SalesPage() {
  const [month, setMonth] = useState(getStoredSalesMonth);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [importState, setImportState] = useState<ImportState>({ canImport: false, stores: [], selectedStoreId: "", salesSources: [] });
  const [selectedSalesSourceId, setSelectedSalesSourceId] = useState(getStoredSalesSourceId);
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState("");

  async function loadSales(nextMonth = month, nextStoreId = selectedStoreId) {
    setIsLoading(true);
    const params = new URLSearchParams({ month: nextMonth });
    if (nextStoreId) params.set("storeId", nextStoreId);
    const importParams = new URLSearchParams();
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
      setSelectedStoreId(body.selectedStoreId);
      resolvedMonth = body.month;
      resolvedStoreId = body.selectedStoreId;
    }
    if (importsResponse.ok) {
      const body = await importsResponse.json() as ImportState;
      const salesSources = body.salesSources ?? [];
      const storedSourceId = getStoredSalesSourceId();
      const nextSourceId = salesSources.some((source) => source.id === selectedSalesSourceId)
        ? selectedSalesSourceId
        : salesSources.some((source) => source.id === storedSourceId)
          ? storedSourceId
          : salesSources[0]?.id ?? "";
      setImportState({
        canImport: body.canImport,
        stores: body.stores ?? [],
        selectedStoreId: body.selectedStoreId ?? resolvedStoreId,
        salesSources
      });
      setSelectedSalesSourceId(nextSourceId);
      storeSalesSelection(resolvedMonth, resolvedStoreId || body.selectedStoreId || "", nextSourceId);
    } else {
      storeSalesSelection(resolvedMonth, resolvedStoreId);
    }
    setIsLoading(false);
  }

  useEffect(() => {
    void loadSales(getStoredSalesMonth(), getStoredSalesStoreId());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxDailyOrders = useMemo(() => Math.max(1, ...(summary?.daily.map((day) => day.orderCount) ?? [1])), [summary]);
  const selectedStoreName = summary?.stores.find((store) => store.id === selectedStoreId)?.name ?? "";
  const selectedSalesSource = importState.salesSources.find((source) => source.id === selectedSalesSourceId) ?? null;

  async function uploadSalesFile() {
    if (!file || !selectedStoreId || !selectedSalesSourceId) return;
    setIsUploading(true);
    setMessage("");
    const formData = new FormData();
    formData.set("storeId", selectedStoreId);
    formData.set("month", month);
    formData.set("salesSourceId", selectedSalesSourceId);
    formData.set("file", file);
    const response = await fetch("/api/sales/imports", {
      method: "POST",
      body: formData
    });
    const body = await response.json().catch(() => ({})) as { error?: string; importedOrderCount?: number; rawRowCount?: number };
    setIsUploading(false);
    if (!response.ok) {
      setMessage(body.error ?? "売上ファイルを取り込めませんでした。");
      return;
    }
    setFile(null);
    setMessage(`${selectedSalesSource?.sourceLabel ?? "売上"} の売上ファイルを取り込みました。注文 ${body.importedOrderCount ?? 0} 件 / 行 ${body.rawRowCount ?? 0} 件`);
    await loadSales(month, selectedStoreId);
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
            <span className="source-indicator">{isLoading ? "読み込み中" : `${selectedStoreName || "店舗"} / ${month}`}</span>
          </div>
          <div className="timecard-toolbar">
            <input type="month" value={month} onChange={(event) => {
              setMonth(event.target.value);
              storeSalesSelection(event.target.value, selectedStoreId, selectedSalesSourceId);
              void loadSales(event.target.value, selectedStoreId);
            }} />
            <select value={selectedStoreId} onChange={(event) => {
              setSelectedStoreId(event.target.value);
              setSelectedSalesSourceId("");
              storeSalesSelection(month, event.target.value, "");
              void loadSales(month, event.target.value);
            }}>
              {(summary?.stores.length ? summary.stores : importState.stores).map((store) => (
                <option value={store.id} key={store.id}>{store.name}</option>
              ))}
            </select>
          </div>
        </header>

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

        <section className="sales-grid">
          <article className="panel sales-revenue-panel">
            <div className="panel-title">
              <ChartColumn size={18} />
              <div>
                <h3>売上口径</h3>
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
            <label className="sales-source-select">
              <span>売上源</span>
              <select
                value={selectedSalesSourceId}
                disabled={!importState.canImport || isUploading || importState.salesSources.length === 0}
                onChange={(event) => {
                  setSelectedSalesSourceId(event.target.value);
                  storeSalesSelection(month, selectedStoreId, event.target.value);
                }}
              >
                {importState.salesSources.map((source) => (
                  <option value={source.id} key={source.id}>
                    {source.sourceLabel}{source.importSupported ? "" : "（準備中）"}
                  </option>
                ))}
              </select>
            </label>
            <div className="sales-upload-row">
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                disabled={!importState.canImport || isUploading || !selectedSalesSource?.importSupported}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <button className="primary-button" type="button" disabled={!file || !selectedStoreId || !selectedSalesSource?.importSupported || !importState.canImport || isUploading} onClick={() => void uploadSalesFile()}>
                {isUploading ? "取込中" : "取込"}
              </button>
            </div>
            {message ? <p className="sales-import-message">{message}</p> : null}
            {!importState.canImport ? <p className="sales-import-message">売上データの取込は owner / manager が操作できます。</p> : null}
            {importState.canImport && importState.salesSources.length === 0 ? <p className="sales-import-message">この店舗の売上源が未設定です。店舗・ブランド設定で売上源を追加してください。</p> : null}
            {selectedSalesSource && !selectedSalesSource.importSupported ? <p className="sales-import-message">{selectedSalesSource.sourceLabel} の売上ファイル取込は次フェーズで対応します。</p> : null}
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
                <h3>日別の忙しさ</h3>
                <p>注文数を基準に月内の波を確認します。</p>
              </div>
            </div>
            <div className="sales-day-bars">
              {(summary?.daily ?? []).map((day) => (
                <div className="sales-day-bar" key={day.date}>
                  <span>{day.date.slice(8)}</span>
                  <div><i style={{ width: `${Math.max(4, (day.orderCount / maxDailyOrders) * 100)}%` }} /></div>
                  <strong>{day.orderCount}</strong>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="sales-grid">
          <article className="panel">
            <h3>忙しい日</h3>
            <div className="sales-rank-list">
              {(summary?.busiestDays ?? []).map((day) => (
                <div className="sales-rank-row" key={day.date}>
                  <span>{formatDate(day.date)}</span>
                  <strong>{day.orderCount}件</strong>
                  <small>{formatMoney(day.sales)}</small>
                </div>
              ))}
            </div>
          </article>
          <article className="panel">
            <h3>空きやすい日</h3>
            <div className="sales-rank-list">
              {(summary?.quietestDays ?? []).map((day) => (
                <div className="sales-rank-row" key={day.date}>
                  <span>{formatDate(day.date)}</span>
                  <strong>{day.orderCount}件</strong>
                  <small>{formatMoney(day.sales)}</small>
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
