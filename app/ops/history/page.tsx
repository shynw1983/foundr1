"use client";

import { Boxes, ClipboardList, FileText, Lightbulb, MessageSquareWarning, PackageCheck, Search, Store, Truck, LogOut, UserCog } from "lucide-react";
import { UserBadge } from "../components/UserBadge";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OpsNavList } from "../components/OpsNavList";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { orders, products as initialProducts } from "../../../lib/mock-data";

type Product = typeof initialProducts[number];
type PurchaseOrder = typeof orders[number];
type PurchaseOrderItem = {
  id?: string;
  orderId: string;
  productName: string;
  brandName?: string;
  requestedQuantity: number;
  actualQuantity?: number;
  unit: string;
  purchased?: boolean;
  unavailable?: boolean;
  supplier?: string;
  note?: string;
  priceExceptionNote?: string;
  deliveryStatus?: "pending" | "in_delivery" | "delivered" | "received";
};
type HistoryRow = {
  id: string;
  orderId: string;
  store: string;
  brand: string;
  deadline: string;
  productName: string;
  productBrand: string;
  supplier: string;
  requestedQuantity: number;
  actualQuantity: number;
  unit: string;
  status: string;
  note: string;
};
type HistoryReportRow = {
  id: string;
  store: string;
  productName: string;
  unit: string;
  totalActualQuantity: number;
  totalRequestedQuantity: number;
  orderCount: number;
  unavailableCount: number;
  latestDeadline: string;
};

const statusTone: Record<string, string> = {
  未購入: "tone-waiting",
  購入済み: "tone-confirm",
  購入不可: "tone-warning",
  配送中: "tone-route",
  納品済み: "tone-confirm",
  店舗確認済み: "tone-done"
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "ダッシュボード", href: "/ops#ダッシュボード", icon: ClipboardList },
  { label: "発注依頼", href: "/ops/orders", icon: PackageCheck },
  { label: "発注管理", href: "/ops/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/ops/history", icon: FileText },
  { label: "商品マスタ", href: "/ops/products", icon: Boxes },
  { label: "店舗・ブランド", href: "/ops/stores", icon: Store },
  { label: "スタッフ管理", href: "/ops/staff", icon: UserCog },
  { label: "発注先管理", href: "/ops/suppliers", icon: Truck },
  { label: "現場記録", href: "/ops/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/ops/product-comparisons", icon: Search },
  { label: "連絡・報告", href: "/ops/reports", icon: MessageSquareWarning },
  { label: "ログアウト", href: "/ops/logout", icon: LogOut }
];

function getItemStatus(item: PurchaseOrderItem) {
  if (item.unavailable) return "購入不可";
  if (item.deliveryStatus === "delivered") return "納品済み";
  if (item.deliveryStatus === "received") return "店舗確認済み";
  if (item.deliveryStatus === "in_delivery") return "配送中";
  if (item.purchased) return "購入済み";

  return "未購入";
}

function createHistoryRows(
  purchaseOrders: PurchaseOrder[],
  orderItems: PurchaseOrderItem[],
  products: Product[]
) {
  const orderMap = new Map(purchaseOrders.map((order) => [order.id, order]));
  const productMap = new Map(products.map((product) => [product.name, product]));

  return orderItems.map<HistoryRow>((item, index) => {
    const order = orderMap.get(item.orderId);
    const product = productMap.get(item.productName);

    return {
      id: item.id ?? `${item.orderId}-${index}`,
      orderId: item.orderId,
      store: order?.store ?? "未設定",
      brand: order?.brand ?? "共通",
      deadline: order?.deadline ?? "",
      productName: item.productName,
      productBrand: item.brandName ?? product?.brand ?? order?.brand ?? "共通",
      supplier: item.supplier || product?.mainSupplier || "未設定",
      requestedQuantity: item.requestedQuantity,
      actualQuantity: item.actualQuantity ?? item.requestedQuantity,
      unit: item.unit,
      status: getItemStatus(item),
      note: [item.note, item.priceExceptionNote].filter(Boolean).join(" / ")
    };
  });
}

function createHistoryReportRows(rows: HistoryRow[]) {
  const reportMap = new Map<string, HistoryReportRow>();

  rows.forEach((row) => {
    const key = [row.store, row.productName, row.unit].join("\u0000");
    const current = reportMap.get(key) ?? {
      id: key,
      store: row.store,
      productName: row.productName,
      unit: row.unit,
      totalActualQuantity: 0,
      totalRequestedQuantity: 0,
      orderCount: 0,
      unavailableCount: 0,
      latestDeadline: ""
    };

    current.totalActualQuantity += row.actualQuantity;
    current.totalRequestedQuantity += row.requestedQuantity;
    current.orderCount += 1;
    current.unavailableCount += row.status === "購入不可" ? 1 : 0;
    current.latestDeadline = row.deadline > current.latestDeadline ? row.deadline : current.latestDeadline;
    reportMap.set(key, current);
  });

  return Array.from(reportMap.values()).sort((a, b) =>
    (b.totalActualQuantity - a.totalActualQuantity) ||
    (b.orderCount - a.orderCount) ||
    a.store.localeCompare(b.store, "ja") ||
    a.productName.localeCompare(b.productName, "ja")
  );
}

function createStoreReportRows(rows: HistoryRow[]) {
  const reportMap = new Map<string, { store: string; itemCount: number; orderCount: number; productCount: number }>();
  const productSets = new Map<string, Set<string>>();

  rows.forEach((row) => {
    const current = reportMap.get(row.store) ?? { store: row.store, itemCount: 0, orderCount: 0, productCount: 0 };
    const products = productSets.get(row.store) ?? new Set<string>();
    current.itemCount += 1;
    products.add(row.productName);
    productSets.set(row.store, products);
    reportMap.set(row.store, current);
  });

  return Array.from(reportMap.values())
    .map((row) => {
      const orderIds = new Set(rows.filter((item) => item.store === row.store).map((item) => item.orderId));
      return { ...row, orderCount: orderIds.size, productCount: productSets.get(row.store)?.size ?? 0 };
    })
    .sort((a, b) => b.itemCount - a.itemCount || a.store.localeCompare(b.store, "ja"));
}

function formatQuantity(value: number) {
  return value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
}

export default function ProcurementHistoryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [purchaseOrderItems, setPurchaseOrderItems] = useState<PurchaseOrderItem[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("すべて");
  const [storeFilter, setStoreFilter] = useState("すべて");
  const [dataSource, setDataSource] = useState<"loading" | "neon">("loading");

  useEffect(() => {
    async function loadHistoryData() {
      const response = await fetch("/api/dashboard");
      if (!response.ok) return;

      const data = await response.json() as {
        products?: Product[];
        orders?: PurchaseOrder[];
        purchaseOrderItems?: PurchaseOrderItem[];
      };

      if (data.products) setProducts(data.products);
      if (data.orders) setPurchaseOrders(data.orders);
      if (data.purchaseOrderItems) setPurchaseOrderItems(data.purchaseOrderItems);
      setDataSource("neon");
    }

    void loadHistoryData();
  }, []);

  const rows = useMemo(
    () => createHistoryRows(purchaseOrders, purchaseOrderItems, products),
    [purchaseOrders, purchaseOrderItems, products]
  );
  const stores = Array.from(new Set(rows.map((row) => row.store)));
  const filteredRows = rows.filter((row) => {
    const targetText = [
      row.orderId,
      row.store,
      row.brand,
      row.productBrand,
      row.productName,
      row.supplier,
      row.status,
      row.note
    ].join(" ");

    return (
      targetText.toLowerCase().includes(query.toLowerCase()) &&
      (statusFilter === "すべて" || row.status === statusFilter) &&
      (storeFilter === "すべて" || row.store === storeFilter)
    );
  });
  const reportRows = createHistoryReportRows(filteredRows).slice(0, 12);
  const storeReportRows = createStoreReportRows(filteredRows);

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="管理画面ナビゲーション">
        <a className="brand-block" href="/ops" aria-label="ダッシュボードへ戻る">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 Ops</p>
            <h1>発注管理</h1>
          </div>
        </a>
        <MobileNavMenu navItems={navItems} />
        <div className="sidebar-user">
          <UserBadge />
        </div>
        <OpsNavList navItems={navItems} />
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">店舗単位の発注明細</p>
            <h2>発注履歴</h2>
            <span className="source-indicator">{dataSource === "neon" ? "Neon 接続済み" : "読み込み中"}</span>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input
                value={query}
                placeholder="店舗・商品・発注先を検索"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
        </header>

        <section className="panel history-report-panel">
          <div className="panel-title product-master-title">
            <div>
              <h3>集計レポート</h3>
              <p>現在の絞り込み条件で、店舗別の商品使用傾向を確認</p>
            </div>
            <span className="source-indicator">{reportRows.length} 件表示</span>
          </div>
          <div className="history-report-grid">
            <div className="history-report-card">
              <h4>店舗別サマリー</h4>
              <div className="history-report-list">
                {storeReportRows.map((row) => (
                  <article className="history-report-summary-row" key={row.store}>
                    <strong>{row.store}</strong>
                    <span>依頼 {row.orderCount} 件</span>
                    <span>明細 {row.itemCount} 件</span>
                    <span>商品 {row.productCount} 種</span>
                  </article>
                ))}
                {storeReportRows.length === 0 ? <div className="empty-state">集計できる履歴はありません</div> : null}
              </div>
            </div>
            <div className="history-report-card">
              <h4>使用量ランキング</h4>
              <div className="history-report-list">
                {reportRows.map((row, index) => (
                  <article className="history-report-ranking-row" key={row.id}>
                    <span className="rank-badge">{index + 1}</span>
                    <div>
                      <strong>{row.productName}</strong>
                      <p>{row.store} · 最終 {row.latestDeadline || "未設定"}</p>
                    </div>
                    <div className="history-report-quantity">
                      <strong>{formatQuantity(row.totalActualQuantity)} {row.unit}</strong>
                      <small>依頼 {formatQuantity(row.totalRequestedQuantity)} {row.unit} / {row.orderCount} 回{row.unavailableCount ? ` / 不可 ${row.unavailableCount} 回` : ""}</small>
                    </div>
                  </article>
                ))}
                {reportRows.length === 0 ? <div className="empty-state">集計できる履歴はありません</div> : null}
              </div>
            </div>
          </div>
        </section>

        <section className="panel history-panel">
          <div className="panel-title product-master-title">
            <div>
              <h3>全発注明細</h3>
              <p>配送は店舗単位、ブランドは商品の用途として確認</p>
            </div>
            <span className="source-indicator">{filteredRows.length} 件</span>
          </div>
          <div className="history-filter-row">
            <label>
              <span>店舗</span>
              <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}>
                <option value="すべて">すべて</option>
                {stores.map((store) => (
                  <option value={store} key={store}>{store}</option>
                ))}
              </select>
            </label>
            <label>
              <span>状態</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="すべて">すべて</option>
                <option value="未購入">未購入</option>
                <option value="購入済み">購入済み</option>
                <option value="購入不可">購入不可</option>
                <option value="配送中">配送中</option>
                <option value="納品済み">納品済み</option>
                <option value="店舗確認済み">店舗確認済み</option>
              </select>
            </label>
          </div>
          <div className="history-table">
            <div className="history-table-head">
              <span>店舗 / 依頼番号</span>
              <span>商品</span>
              <span>発注先</span>
              <span>数量</span>
              <span>状態</span>
            </div>
            {filteredRows.map((row) => (
              <article className="history-row" key={row.id}>
                <div>
                  <strong>{row.store}</strong>
                  <p>{row.orderId} · {row.deadline || "締切未設定"}</p>
                </div>
                <div>
                  <strong>{row.productName}</strong>
                  <p>適用ブランド: {row.productBrand}</p>
                  {row.note ? <small>{row.note}</small> : null}
                </div>
                <span>{row.supplier}</span>
                <strong>{row.actualQuantity} / {row.requestedQuantity} {row.unit}</strong>
                <span className={`status-pill ${statusTone[row.status]}`}>{row.status}</span>
              </article>
            ))}
            {filteredRows.length === 0 ? (
              <div className="empty-state">該当する発注明細はありません</div>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}
