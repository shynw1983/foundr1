"use client";

import { Boxes, ClipboardList, FileText, MessageSquareWarning, PackageCheck, Search, Store } from "lucide-react";
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
  supplier?: string;
  note?: string;
  priceExceptionNote?: string;
  deliveryStatus?: "pending" | "in_delivery" | "delivered";
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

const statusTone: Record<string, string> = {
  未購入: "tone-waiting",
  購入済み: "tone-confirm",
  配送中: "tone-route",
  配達済み: "tone-done"
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "ダッシュボード", href: "/ops#ダッシュボード", icon: ClipboardList },
  { label: "仕入れ依頼", href: "/ops/orders", icon: PackageCheck },
  { label: "仕入れ処理", href: "/ops/procurement", icon: ClipboardList },
  { label: "仕入れ一覧", href: "/ops/history", icon: FileText },
  { label: "店舗・ブランド", href: "/ops/stores", icon: Store },
  { label: "連絡・報告", href: "/ops#連絡・報告", icon: MessageSquareWarning },
  { label: "商品マスタ", href: "/ops/products", icon: Boxes }
];

function getItemStatus(item: PurchaseOrderItem) {
  if (item.deliveryStatus === "delivered") return "配達済み";
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

export default function ProcurementHistoryPage() {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(orders);
  const [purchaseOrderItems, setPurchaseOrderItems] = useState<PurchaseOrderItem[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("すべて");
  const [storeFilter, setStoreFilter] = useState("すべて");
  const [dataSource, setDataSource] = useState<"mock" | "neon">("mock");

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
            <p className="eyebrow">店舗単位の仕入れ明細</p>
            <h2>仕入れ一覧</h2>
            <span className="source-indicator">{dataSource === "neon" ? "Neon 接続済み" : "ローカル表示"}</span>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input
                value={query}
                placeholder="店舗・商品・仕入れ先を検索"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
        </header>

        <section className="panel history-panel">
          <div className="panel-title product-master-title">
            <div>
              <h3>全仕入れ明細</h3>
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
                <option value="配送中">配送中</option>
                <option value="配達済み">配達済み</option>
              </select>
            </label>
          </div>
          <div className="history-table">
            <div className="history-table-head">
              <span>店舗 / 注文</span>
              <span>商品</span>
              <span>仕入れ先</span>
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
                  <p>用途ブランド: {row.productBrand}</p>
                  {row.note ? <small>{row.note}</small> : null}
                </div>
                <span>{row.supplier}</span>
                <strong>{row.actualQuantity} / {row.requestedQuantity} {row.unit}</strong>
                <span className={`status-pill ${statusTone[row.status]}`}>{row.status}</span>
              </article>
            ))}
            {filteredRows.length === 0 ? (
              <div className="empty-state">該当する仕入れ明細はありません</div>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}
