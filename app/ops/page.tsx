"use client";

import {
  AlertTriangle,
  Boxes,
  Clock3,
  ClipboardList,
  FileText,
  MessageSquareWarning,
  PackageCheck,
  Plus,
  Search,
  Store,
  Truck,
  TrendingUp
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  orders,
  priceSignals,
  productSupplierOptions as initialProductSupplierOptions,
  products as initialProducts,
  stores
} from "../../lib/mock-data";

type Product = typeof initialProducts[number];
type ProductSupplierGroup = typeof initialProductSupplierOptions[number];
type PurchaseOrder = typeof orders[number];

const statusTone: Record<string, string> = {
  仕入れ待ち: "tone-waiting",
  仕入れ中: "tone-active",
  一部完了: "tone-warning",
  配送待ち: "tone-confirm",
  配送中: "tone-route",
  一部配達済み: "tone-warning",
  確認待ち: "tone-confirm",
  完了: "tone-done"
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "ダッシュボード", href: "/ops#ダッシュボード", icon: ClipboardList },
  { label: "仕入れ依頼", href: "/ops/orders", icon: PackageCheck },
  { label: "仕入れ処理", href: "/ops/procurement", icon: ClipboardList },
  { label: "仕入れ一覧", href: "/ops/history", icon: FileText },
  { label: "店舗・ブランド", href: "/ops/stores", icon: Store },
  { label: "仕入れ先管理", href: "/ops/suppliers", icon: Truck },
  { label: "連絡・報告", href: "/ops#連絡・報告", icon: MessageSquareWarning },
  { label: "商品マスタ", href: "/ops/products", icon: Boxes }
];

export default function OpsDashboard() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productSupplierOptions, setProductSupplierOptions] = useState<ProductSupplierGroup[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [storesData, setStoresData] = useState<typeof stores>([]);
  const [dataSource, setDataSource] = useState<"loading" | "neon">("loading");

  useEffect(() => {
    async function loadDashboardData() {
      const response = await fetch("/api/dashboard");
      if (!response.ok) return;

      const data = await response.json() as {
        stores?: typeof stores;
        products?: Product[];
        productSupplierOptions?: ProductSupplierGroup[];
        orders?: PurchaseOrder[];
      };

      if (data.stores) setStoresData(data.stores);
      if (data.products) setProducts(data.products);
      if (data.productSupplierOptions) setProductSupplierOptions(data.productSupplierOptions);
      if (data.orders) setPurchaseOrders(data.orders);
      setDataSource("neon");
    }

    void loadDashboardData();
  }, []);

  const openOrders = purchaseOrders.filter((order) => order.status !== "完了");
  const urgentOrders = purchaseOrders.filter((order) => order.priority === "高").length;
  const activeExceptions = 0;
  const risingPrices = priceSignals.filter((item) => item.changeRate > 0);
  const supplierRouteCount = new Set(
    productSupplierOptions.flatMap((group) => group.options.filter((option) => option.role === "メイン").map((option) => option.supplier))
  ).size;

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="管理画面ナビゲーション">
        <div className="brand-block">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 Ops</p>
            <h1>仕入れ管理</h1>
          </div>
        </div>
        <details className="mobile-nav-menu">
          <summary>メニュー</summary>
          <div className="mobile-nav-list">
            {navItems.map(({ label, href }) => (
              <a href={href} key={label}>{label}</a>
            ))}
          </div>
        </details>
        <nav className="nav-list">
          {navItems.map(({ label, href, icon: Icon }) => (
            <a href={href} className="nav-item" key={label}>
              <Icon size={18} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">複数店舗の日常仕入れオペレーション</p>
            <h2>仕入れダッシュボード</h2>
            <span className="source-indicator">{dataSource === "neon" ? "Neon 接続済み" : "読み込み中"}</span>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input placeholder="商品・店舗・仕入れ先を検索" />
            </label>
            <a className="primary-button" href="/ops/orders">
              <Plus size={18} />
              仕入れ依頼を作成
            </a>
          </div>
        </header>

        <section className="metric-grid" id="ダッシュボード">
          <MetricCard icon={<ClipboardList />} label="進行中の依頼" value={openOrders.length} note="今日見るべき依頼" href="/ops/orders" />
          <MetricCard icon={<Clock3 />} label="高優先度" value={urgentOrders} note="先に処理したい依頼" href="/ops/orders" />
          <MetricCard icon={<AlertTriangle />} label="未対応の異常" value={activeExceptions} note="欠品・価格異常" href="/ops/procurement#連絡・報告" />
          <MetricCard icon={<Store />} label="巡回仕入れ先" value={supplierRouteCount || storesData.length} note="主要購入ルート" href="/ops/suppliers" />
        </section>

        <section className="dashboard-report-grid">
          <section className="panel">
            <PanelTitle title="最近の仕入れ依頼" subtitle="直近の依頼状況を確認" />
            <div className="order-list">
              {purchaseOrders.slice(0, 6).map((order) => (
                <article className="order-row" key={order.id}>
                  <div>
                    <div className="row-heading">
                      <strong>{order.id}</strong>
                      <span className={`status-pill ${statusTone[order.status]}`}>{order.status}</span>
                    </div>
                    <p>{order.store} / {order.brand}</p>
                  </div>
                  <div>
                    <span className="muted-label">締切</span>
                    <strong>{order.deadline}</strong>
                  </div>
                  <div>
                    <span className="muted-label">商品</span>
                    <strong>{order.items} 件</strong>
                  </div>
                  <div>
                    <span className="muted-label">優先度</span>
                    <strong>{order.priority}</strong>
                  </div>
                  <a className="icon-button" href="/ops/procurement" aria-label={`${order.id} の仕入れ処理`}>
                    <TrendingUp size={18} />
                  </a>
                </article>
              ))}
            </div>
          </section>

          <aside className="side-stack">
            <section className="panel" id="連絡・報告">
              <PanelTitle title="要確認" subtitle="店舗へ返答が必要な連絡" />
              <div className="stack">
                <div className="empty-state">要確認の連絡はありません</div>
              </div>
            </section>

            <section className="panel">
              <PanelTitle title="価格トレンド" subtitle="主要食材と包材の変動" />
              <div className="trend-list">
                {priceSignals.map((signal) => (
                  <article className="trend-row" key={signal.product}>
                    <div>
                      <strong>{signal.product}</strong>
                      <p>{signal.supplier}</p>
                    </div>
                    <div className={signal.changeRate > 0 ? "rate-up" : "rate-down"}>
                      {signal.changeRate > 0 ? "+" : ""}{signal.changeRate}%
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </aside>
        </section>

        <section className="panel">
          <PanelTitle title="商品・仕入れ先の概況" subtitle="マスタは専用ページで管理" />
          <div className="module-grid">
            <a className="module-card" href="/ops/products">
              <div>
                <strong>商品マスタ</strong>
                <p>商品、単位、保管属性、主要仕入れ先</p>
              </div>
              <span>{products.length} 件</span>
              <small>{products.slice(0, 3).map((product) => product.name).join(" / ")}</small>
            </a>
            <a className="module-card" href="/ops/suppliers">
              <div>
                <strong>商品別仕入れ先</strong>
                <p>メイン、予備、緊急チャネル</p>
              </div>
              <span>{productSupplierOptions.length} 件</span>
              <small>{productSupplierOptions.slice(0, 3).map((group) => group.product).join(" / ")}</small>
            </a>
          </div>
        </section>
      </section>
    </main>
  );
}

function MetricCard({
  icon,
  label,
  value,
  note,
  href
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  note: string;
  href: string;
}) {
  return (
    <a className="metric-card" href={href}>
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <p>{note}</p>
      </div>
    </a>
  );
}

function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="panel-title">
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}
