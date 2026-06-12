"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, ChartColumn, FileText, LineChart, PackageCheck, ShoppingCart } from "lucide-react";
import { AnalyticsShell } from "../components/AnalyticsShell";

type StoreOption = {
  id: string;
  name: string;
};

type PurchaseSummary = {
  totalAmount: number;
  totalQuantity: number;
  itemCount: number;
  productCount: number;
  orderCount: number;
};

type ProductPurchaseRow = {
  productId: string;
  productName: string;
  category: string;
  subcategory: string;
  supplier: string;
  quantity: number;
  unit: string;
  amount: number;
  orderCount: number;
  storeCount: number;
  averageUnitPrice: number;
};

type PurchaseBreakdownRow = {
  category?: string;
  supplier?: string;
  storeId?: string;
  storeName?: string;
  quantity: number;
  amount: number;
  itemCount: number;
};

type PurchaseAnalyticsResponse = {
  month: string;
  stores: StoreOption[];
  selectedStoreId: string;
  summary: PurchaseSummary;
  productRows: ProductPurchaseRow[];
  categoryRows: PurchaseBreakdownRow[];
  supplierRows: PurchaseBreakdownRow[];
  storeRows: PurchaseBreakdownRow[];
  error?: string;
};

const analyticsMonthStorageKey = "foundr1:analytics:selected-month";
const analyticsStoreStorageKey = "foundr1:analytics:selected-store-id";

const costLinks = [
  {
    title: "購入管理を見る",
    description: "発注先ごとの購入、納品、レシートの実績を原価分析のデータ元にします。",
    href: "/os/procurement",
    icon: ShoppingCart,
    status: "データ元"
  },
  {
    title: "発注履歴を見る",
    description: "過去の発注・購入・レシートから、月次の原価候補を確認します。",
    href: "/os/history",
    icon: FileText,
    status: "データ元"
  },
  {
    title: "商品マスタを見る",
    description: "商品単位、参考価格、発注先情報を原価の補助情報として使います。",
    href: "/os/products",
    icon: Boxes,
    status: "補助データ"
  },
  {
    title: "月次損益へ反映",
    description: "発注・購入側で確定した原価を月次損益へ接続します。",
    href: "/os/analytics/profit",
    icon: LineChart,
    status: "接続先"
  }
];

function getCurrentMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit"
  }).format(new Date());
}

function readInitialMonth() {
  if (typeof window === "undefined") return getCurrentMonth();
  const stored = window.localStorage.getItem(analyticsMonthStorageKey);
  return stored && /^\d{4}-\d{2}$/.test(stored) ? stored : getCurrentMonth();
}

function readInitialStoreId() {
  if (typeof window === "undefined") return "all";
  return window.localStorage.getItem(analyticsStoreStorageKey) ?? "all";
}

function storeAnalyticsSelection(month: string, storeId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(analyticsMonthStorageKey, month);
  window.localStorage.setItem(analyticsStoreStorageKey, storeId);
}

function formatMoney(amount: number) {
  return `¥${Math.round(amount).toLocaleString("ja-JP")}`;
}

function formatQuantity(quantity: number, unit = "") {
  const value = Number.isInteger(quantity) ? String(quantity) : quantity.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  return unit ? `${value} ${unit}` : value;
}

function getShare(value: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.round((value / total) * 1000) / 10}%`;
}

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase();
}

function getChartWidth(value: number, maxValue: number) {
  if (maxValue <= 0) return "0%";
  return `${Math.max(4, Math.round((value / maxValue) * 100))}%`;
}

export default function CostAnalyticsPage() {
  const [month, setMonth] = useState(readInitialMonth);
  const [selectedStoreId, setSelectedStoreId] = useState(readInitialStoreId);
  const [data, setData] = useState<PurchaseAnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("すべて");
  const [supplierFilter, setSupplierFilter] = useState("すべて");
  const [query, setQuery] = useState("");

  async function loadPurchaseAnalytics(nextMonth = month, nextStoreId = selectedStoreId) {
    setIsLoading(true);
    setError("");
    const params = new URLSearchParams({ month: nextMonth, storeId: nextStoreId || "all" });
    const response = await fetch(`/api/analytics/purchases?${params.toString()}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as PurchaseAnalyticsResponse;

    if (!response.ok) {
      setError(body.error ?? "購入量を読み込めませんでした。");
      setIsLoading(false);
      return;
    }

    setData(body);
    setMonth(body.month);
    setSelectedStoreId(body.selectedStoreId);
    storeAnalyticsSelection(body.month, body.selectedStoreId);
    setIsLoading(false);
  }

  useEffect(() => {
    void loadPurchaseAnalytics();
  }, []);

  const productRows = data?.productRows ?? [];
  const categoryOptions = useMemo(() => ["すべて", ...Array.from(new Set(productRows.map((row) => row.category))).sort()], [productRows]);
  const supplierOptions = useMemo(() => ["すべて", ...Array.from(new Set(productRows.map((row) => row.supplier))).sort()], [productRows]);
  const normalizedQuery = normalizeSearchText(query);
  const filteredProductRows = productRows.filter((row) => {
    const targetText = [
      row.productName,
      row.category,
      row.subcategory,
      row.supplier,
      row.unit
    ].join(" ").toLowerCase();

    return (
      (categoryFilter === "すべて" || row.category === categoryFilter) &&
      (supplierFilter === "すべて" || row.supplier === supplierFilter) &&
      (!normalizedQuery || targetText.includes(normalizedQuery))
    );
  });
  const selectedStoreName = selectedStoreId === "all"
    ? "全店舗"
    : data?.stores.find((store) => store.id === selectedStoreId)?.name ?? "店舗";
  const summary = data?.summary ?? { totalAmount: 0, totalQuantity: 0, itemCount: 0, productCount: 0, orderCount: 0 };
  const maxProductAmount = Math.max(...filteredProductRows.slice(0, 8).map((row) => row.amount), 1);
  const topProducts = filteredProductRows.slice(0, 8);
  const topCategories = (data?.categoryRows ?? []).slice(0, 5);
  const topSuppliers = (data?.supplierRows ?? []).slice(0, 5);
  const maxCategoryAmount = Math.max(...topCategories.map((row) => row.amount), 1);
  const maxSupplierAmount = Math.max(...topSuppliers.map((row) => row.amount), 1);

  return (
    <AnalyticsShell
      eyebrow="Cost Analytics"
      title="原価・経費分析"
      sourceLabel={isLoading ? "読み込み中" : `${selectedStoreName} / ${month}`}
      workspaceClassName="analytics-workspace cost-analytics-workspace"
    >
      <section className="panel analytics-overview-panel">
        <div className="panel-title">
          <PackageCheck size={18} />
          <div>
            <h3>月間購入量</h3>
            <p>購入管理で確定した実購入数量を月次で集計します。金額は実単価がある明細だけ反映します。</p>
          </div>
        </div>
        <div className="analytics-control-row">
          <label>
            <span>対象月</span>
            <input
              type="month"
              value={month}
              onChange={(event) => {
                const nextMonth = event.target.value || getCurrentMonth();
                setMonth(nextMonth);
                storeAnalyticsSelection(nextMonth, selectedStoreId);
                void loadPurchaseAnalytics(nextMonth, selectedStoreId);
              }}
            />
          </label>
          <label>
            <span>店舗</span>
            <select
              value={selectedStoreId}
              onChange={(event) => {
                const nextStoreId = event.target.value;
                setSelectedStoreId(nextStoreId);
                storeAnalyticsSelection(month, nextStoreId);
                void loadPurchaseAnalytics(month, nextStoreId);
              }}
            >
              <option value="all">全店舗</option>
              {(data?.stores ?? []).map((store) => (
                <option value={store.id} key={store.id}>{store.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>カテゴリ</span>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              {categoryOptions.map((category) => (
                <option value={category} key={category}>{category}</option>
              ))}
            </select>
          </label>
          <label>
            <span>発注先</span>
            <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}>
              {supplierOptions.map((supplier) => (
                <option value={supplier} key={supplier}>{supplier}</option>
              ))}
            </select>
          </label>
          <label className="cost-search-field">
            <span>検索</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="商品名・単位" />
          </label>
        </div>
        {error ? <p className="empty-state-text">{error}</p> : null}
      </section>

      <section className="metric-grid analytics-metric-grid">
        <article className="metric-card">
          <span>購入金額</span>
          <strong>{formatMoney(summary.totalAmount)}</strong>
          <p>実単価がある明細の概算原価</p>
        </article>
        <article className="metric-card">
          <span>商品数</span>
          <strong>{summary.productCount.toLocaleString("ja-JP")}</strong>
          <p>{summary.itemCount.toLocaleString("ja-JP")} 明細 / {summary.orderCount.toLocaleString("ja-JP")} 発注</p>
        </article>
        <article className="metric-card">
          <span>合計数量</span>
          <strong>{formatQuantity(summary.totalQuantity)}</strong>
          <p>単位混在のため参考合計</p>
        </article>
        <article className="metric-card">
          <span>表示中</span>
          <strong>{filteredProductRows.length.toLocaleString("ja-JP")}</strong>
          <p>商品別購入量</p>
        </article>
      </section>

      <section className="analytics-chart-grid cost-analytics-chart-grid">
        <article className="panel">
          <div className="panel-title">
            <ChartColumn size={18} />
            <div>
              <h3>商品別ランキング</h3>
              <p>表示条件内で購入金額が大きい商品を上から表示します。</p>
            </div>
          </div>
          <div className="analytics-bar-list">
            {topProducts.map((row) => (
              <div className="analytics-bar-row" key={`${row.productId}-${row.productName}-${row.unit}`}>
                <div className="analytics-bar-heading">
                  <strong>{row.productName}</strong>
                  <span>{formatQuantity(row.quantity, row.unit)} / {row.category}</span>
                  <b>{formatMoney(row.amount)}</b>
                </div>
                <div className="analytics-bar-track">
                  <i className="is-sales" style={{ width: getChartWidth(row.amount, maxProductAmount) }} />
                </div>
              </div>
            ))}
            {!topProducts.length && !isLoading ? <div className="empty-state">集計できる購入量はありません</div> : null}
          </div>
        </article>

        <article className="panel">
          <div className="panel-title">
            <Boxes size={18} />
            <div>
              <h3>カテゴリ / 発注先</h3>
              <p>原価の偏りをカテゴリと発注先で確認します。</p>
            </div>
          </div>
          <div className="cost-breakdown-list">
            {topCategories.map((row) => (
              <div className="cost-breakdown-row" key={`category-${row.category}`}>
                <div>
                  <strong>{row.category}</strong>
                  <span>{row.itemCount} 明細 / {getShare(row.amount, summary.totalAmount)}</span>
                </div>
                <b>{formatMoney(row.amount)}</b>
                <i style={{ width: getChartWidth(row.amount, maxCategoryAmount) }} />
              </div>
            ))}
            {topSuppliers.map((row) => (
              <div className="cost-breakdown-row" key={`supplier-${row.supplier}`}>
                <div>
                  <strong>{row.supplier}</strong>
                  <span>{row.itemCount} 明細 / {getShare(row.amount, summary.totalAmount)}</span>
                </div>
                <b>{formatMoney(row.amount)}</b>
                <i className="is-supplier" style={{ width: getChartWidth(row.amount, maxSupplierAmount) }} />
              </div>
            ))}
            {!topCategories.length && !topSuppliers.length && !isLoading ? <div className="empty-state">集計できる分類はありません</div> : null}
          </div>
        </article>
      </section>

      <section className="panel cost-purchase-table-panel">
        <div className="panel-title">
          <ShoppingCart size={18} />
          <div>
            <h3>商品別月間購入量</h3>
            <p>数量、平均単価、購入金額、発注回数を商品単位で確認します。</p>
          </div>
        </div>
        <div className="cost-purchase-table-wrap">
          <table className="cost-purchase-table">
            <thead>
              <tr>
                <th>商品</th>
                <th>カテゴリ</th>
                <th>発注先</th>
                <th>数量</th>
                <th>平均単価</th>
                <th>購入金額</th>
                <th>発注</th>
              </tr>
            </thead>
            <tbody>
              {filteredProductRows.map((row) => (
                <tr key={`${row.productId}-${row.productName}-${row.unit}`}>
                  <td>
                    <strong>{row.productName}</strong>
                    <span>{row.subcategory}</span>
                  </td>
                  <td>{row.category}</td>
                  <td>{row.supplier}</td>
                  <td>{formatQuantity(row.quantity, row.unit)}</td>
                  <td>{row.averageUnitPrice ? formatMoney(row.averageUnitPrice) : "-"}</td>
                  <td>{row.amount ? formatMoney(row.amount) : "-"}</td>
                  <td>{row.orderCount} 件{selectedStoreId === "all" ? ` / ${row.storeCount} 店舗` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filteredProductRows.length && !isLoading ? <div className="empty-state">条件に一致する購入量はありません</div> : null}
        </div>
      </section>

      <section className="os-module-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Source of Truth</p>
            <h2>確認するデータ元</h2>
          </div>
        </div>
        <div className="os-module-grid">
          {costLinks.map((item) => {
            const Icon = item.icon;
            return (
              <a className="os-module-card" href={item.href} key={item.title}>
                <div className="os-module-icon">
                  <Icon size={24} />
                </div>
                <div>
                  <div className="os-module-heading">
                    <h3>{item.title}</h3>
                    <span className="status-pill is-active">{item.status}</span>
                  </div>
                  <p>{item.description}</p>
                </div>
              </a>
            );
          })}
        </div>
      </section>
    </AnalyticsShell>
  );
}
