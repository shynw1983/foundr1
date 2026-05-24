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
  LogOut, UserCog,
  TrendingUp
} from "lucide-react";
import { UserBadge } from "./components/UserBadge";
import { MobileNavMenu } from "./components/MobileNavMenu";
import { OpsNavList } from "./components/OpsNavList";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  orders,
  productSupplierOptions as initialProductSupplierOptions,
  products as initialProducts,
  stores
} from "../../lib/mock-data";

type Product = typeof initialProducts[number];
type ProductSupplierGroup = typeof initialProductSupplierOptions[number];
type PurchaseOrder = typeof orders[number];
type PurchaseOrderItem = {
  id?: string;
  orderId: string;
  productName: string;
  requestedQuantity: number;
  actualQuantity?: number;
  actualPrice?: string;
  referencePrice?: number;
  unit: string;
  note?: string;
  priceExceptionNote?: string;
};
type PriceSignal = {
  productId: string;
  supplierId: string | null;
  product: string;
  supplier: string;
  latestPrice: number;
  baselinePrice: number;
  changeRate: number;
};
type StoreFeedback = {
  id: string;
  product: string;
  type: string;
  message: string;
  store: string;
  status: string;
};

const statusTone: Record<string, string> = {
  購入待ち: "tone-waiting",
  一部購入済み: "tone-warning",
  購入完了: "tone-done",
  配送待ち: "tone-confirm",
  配送中: "tone-route",
  一部納品済み: "tone-warning",
  確認待ち: "tone-confirm",
  完了: "tone-done"
};

function formatPurchaseOrderStatus(status: string) {
  if (status === "確認待ち") return "店舗確認待ち";

  return status;
}

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "ダッシュボード", href: "/ops#ダッシュボード", icon: ClipboardList },
  { label: "発注依頼", href: "/ops/orders", icon: PackageCheck },
  { label: "発注管理", href: "/ops/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/ops/history", icon: FileText },
  { label: "商品マスタ", href: "/ops/products", icon: Boxes },
  { label: "店舗・ブランド", href: "/ops/stores", icon: Store },
  { label: "スタッフ管理", href: "/ops/staff", icon: UserCog },
  { label: "発注先管理", href: "/ops/suppliers", icon: Truck },
  { label: "連絡・報告", href: "/ops#連絡・報告", icon: MessageSquareWarning },
  { label: "ログアウト", href: "/ops/logout", icon: LogOut }
];

export default function OpsDashboard() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productSupplierOptions, setProductSupplierOptions] = useState<ProductSupplierGroup[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [purchaseOrderItems, setPurchaseOrderItems] = useState<PurchaseOrderItem[]>([]);
  const [priceSignals, setPriceSignals] = useState<PriceSignal[]>([]);
  const [storesData, setStoresData] = useState<typeof stores>([]);
  const [dataSource, setDataSource] = useState<"loading" | "neon">("loading");
  const [currentRole, setCurrentRole] = useState("");
  const [updatingBaseline, setUpdatingBaseline] = useState("");
  const [priceMessage, setPriceMessage] = useState("");

  useEffect(() => {
    async function loadDashboardData() {
      const [response, meResponse] = await Promise.all([
        fetch("/api/dashboard"),
        fetch("/api/auth/me")
      ]);
      if (!response.ok) return;

      const data = await response.json() as {
        stores?: typeof stores;
        products?: Product[];
        productSupplierOptions?: ProductSupplierGroup[];
        orders?: PurchaseOrder[];
        purchaseOrderItems?: PurchaseOrderItem[];
        priceSignals?: PriceSignal[];
      };

      if (data.stores) setStoresData(data.stores);
      if (data.products) setProducts(data.products);
      if (data.productSupplierOptions) setProductSupplierOptions(data.productSupplierOptions);
      if (data.orders) setPurchaseOrders(data.orders);
      if (data.purchaseOrderItems) setPurchaseOrderItems(data.purchaseOrderItems);
      if (data.priceSignals) setPriceSignals(data.priceSignals);
      if (meResponse.ok) {
        const me = await meResponse.json().catch(() => ({})) as { employee?: { role?: string } };
        setCurrentRole(me.employee?.role ?? "");
      }
      setDataSource("neon");
    }

    void loadDashboardData();
  }, []);

  const openOrders = purchaseOrders.filter((order) => order.status !== "完了");
  const urgentOrders = purchaseOrders.filter((order) => order.priority === "高").length;
  const storeFeedbackItems = createStoreFeedbackItems(purchaseOrders, purchaseOrderItems);
  const activeExceptions = storeFeedbackItems.length;
  const visiblePriceSignals = priceSignals.filter((item) => item.changeRate !== 0);
  const risingPrices = visiblePriceSignals.filter((item) => item.changeRate > 0);
  const canUpdateBaseline = ["owner", "manager", "buyer"].includes(currentRole);
  const supplierRouteCount = new Set(
    productSupplierOptions.flatMap((group) => group.options.filter((option) => option.role === "メイン").map((option) => option.supplier))
  ).size;

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
            <p className="eyebrow">複数店舗の日常発注オペレーション</p>
            <h2>発注ダッシュボード</h2>
            <span className="source-indicator">{dataSource === "neon" ? "Neon 接続済み" : "読み込み中"}</span>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input placeholder="商品・店舗・発注先を検索" />
            </label>
            <a className="primary-button" href="/ops/orders">
              <Plus size={18} />
              依頼を作成
            </a>
          </div>
        </header>

        <section className="metric-grid" id="ダッシュボード">
          <MetricCard icon={<ClipboardList />} label="進行中の依頼" value={openOrders.length} note="今日見るべき依頼" href="/ops/orders" />
          <MetricCard icon={<Clock3 />} label="高優先度" value={urgentOrders} note="先に処理したい依頼" href="/ops/orders" />
          <MetricCard icon={<AlertTriangle />} label="未対応の異常" value={activeExceptions} note="欠品・価格異常" href="/ops/procurement#連絡・報告" />
          <MetricCard icon={<Store />} label="巡回発注先" value={supplierRouteCount || storesData.length} note="主要発注ルート" href="/ops/suppliers" />
        </section>

        <section className="dashboard-report-grid">
          <section className="panel">
            <PanelTitle title="最近の発注依頼" subtitle="直近の依頼状況を確認" />
            <div className="order-list">
              {purchaseOrders.slice(0, 6).map((order) => (
                <article className="order-row" key={order.id}>
                  <div>
                    <div className="row-heading">
                      <strong>{order.id}</strong>
                      <span className={`status-pill ${statusTone[order.status]}`}>{formatPurchaseOrderStatus(order.status)}</span>
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
                  <a
                    className="icon-button"
                    href={`/ops/procurement?order=${encodeURIComponent(order.id)}`}
                    aria-label={`${order.id} の発注管理`}
                  >
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
                {storeFeedbackItems.slice(0, 4).map((item) => (
                  <article className="feedback-item" key={item.id}>
                    <div className="feedback-topline">
                      <strong>{item.product}</strong>
                      <span>{item.type}</span>
                    </div>
                    <p>{item.message}</p>
                    <small>{item.store} · {item.status}</small>
                  </article>
                ))}
                {storeFeedbackItems.length === 0 ? (
                  <div className="empty-state">要確認の連絡はありません</div>
                ) : null}
              </div>
            </section>

            <section className="panel">
              <PanelTitle title="価格トレンド" subtitle="主要食材と包材の変動" />
              <div className="trend-list">
                {visiblePriceSignals.map((signal) => (
                  <article className="trend-row" key={`${signal.productId}-${signal.supplierId ?? "none"}`}>
                    <div>
                      <strong>{signal.product}</strong>
                      <p>{signal.supplier}</p>
                    </div>
                    <div className="trend-price-block">
                      <strong>¥{formatPrice(signal.latestPrice)}</strong>
                      <span>
                        基準 ¥{formatPrice(signal.baselinePrice)} · <em className={signal.changeRate > 0 ? "rate-up" : "rate-down"}>
                          {signal.changeRate > 0 ? "+" : ""}{signal.changeRate}%
                        </em>
                      </span>
                      {canUpdateBaseline && signal.changeRate !== 0 ? (
                        <button
                          className="trend-baseline-button"
                          type="button"
                          disabled={updatingBaseline === `${signal.productId}-${signal.supplierId ?? "none"}`}
                          onClick={() => updateBaselinePrice(signal)}
                        >
                          基準価格を更新
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
                {visiblePriceSignals.length === 0 ? (
                  <div className="empty-state">比較できる価格記録はまだありません</div>
                ) : null}
                {priceMessage ? <div className="trend-message">{priceMessage}</div> : null}
              </div>
            </section>
          </aside>
        </section>

        <section className="panel">
          <PanelTitle title="商品・発注先の概況" subtitle="マスタは専用ページで管理" />
          <div className="module-grid">
            <a className="module-card" href="/ops/products">
              <div>
                <strong>商品マスタ</strong>
                <p>商品、単位、保管属性、メイン発注先</p>
              </div>
              <span>{products.length} 件</span>
              <small>{products.slice(0, 3).map((product) => product.name).join(" / ")}</small>
            </a>
            <a className="module-card" href="/ops/suppliers">
              <div>
                <strong>商品別発注先</strong>
                <p>メイン発注先、予備発注先、臨時購入先</p>
              </div>
              <span>{productSupplierOptions.length} 件</span>
              <small>{productSupplierOptions.slice(0, 3).map((group) => group.product).join(" / ")}</small>
            </a>
          </div>
        </section>
      </section>
    </main>
  );

  async function updateBaselinePrice(signal: PriceSignal) {
    const updateKey = `${signal.productId}-${signal.supplierId ?? "none"}`;
    setUpdatingBaseline(updateKey);
    setPriceMessage("");

    const response = await fetch("/api/price-records/baseline", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: signal.productId,
        supplierId: signal.supplierId,
        price: signal.latestPrice
      })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setPriceMessage(body.error ?? "基準価格を更新できませんでした。");
      setUpdatingBaseline("");
      return;
    }

    setPriceSignals((current) => current.filter((item) => item !== signal));
    setPriceMessage(`${signal.product} の基準価格を ¥${formatPrice(signal.latestPrice)} に更新しました。`);
    setUpdatingBaseline("");
  }
}

function createStoreFeedbackItems(
  purchaseOrders: PurchaseOrder[],
  purchaseOrderItems: PurchaseOrderItem[]
) {
  const orderMap = new Map(purchaseOrders.map((order) => [order.id, order]));

  return purchaseOrderItems.flatMap<StoreFeedback>((item) => {
    const actualQuantity = item.actualQuantity ?? item.requestedQuantity;
    const quantityDiff = actualQuantity - item.requestedQuantity;
    const order = orderMap.get(item.orderId);
    const store = order?.store ?? "店舗未設定";
    const baseId = item.id ?? `${item.orderId}-${item.productName}`;
    const items: StoreFeedback[] = [];
    const actualPrice = parsePriceValue(item.actualPrice);
    const referencePrice = Number(item.referencePrice ?? 0);

    if (actualPrice > 0 && referencePrice > 0 && actualPrice !== referencePrice) {
      const diffRate = Math.round(((actualPrice - referencePrice) / referencePrice) * 1000) / 10;
      items.push({
        id: `${baseId}-price`,
        product: item.productName,
        type: "価格異常",
        message: `実際 ¥${formatPrice(actualPrice)} / 基準 ¥${formatPrice(referencePrice)} (${diffRate > 0 ? "+" : ""}${diffRate}%)`,
        store,
        status: "店舗確認待ち"
      });
    }

    if (quantityDiff !== 0) {
      items.push({
        id: `${baseId}-quantity`,
        product: item.productName,
        type: "数量差異",
        message: `依頼 ${item.requestedQuantity} ${item.unit} / 実数 ${actualQuantity} ${item.unit}`,
        store,
        status: "店舗確認待ち"
      });
    }

    if (item.note) {
      items.push({
        id: `${baseId}-note`,
        product: item.productName,
        type: "備考",
        message: item.note,
        store,
        status: "共有済み"
      });
    }

    return items;
  });
}

function parsePriceValue(value?: string) {
  const price = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(price) ? price : 0;
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2
  }).format(value);
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
