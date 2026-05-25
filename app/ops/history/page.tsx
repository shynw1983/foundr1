"use client";

import { Boxes, ClipboardList, FileText, MessageSquareWarning, PackageCheck, Search, Store, Truck, LogOut, UserCog } from "lucide-react";
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

const statusTone: Record<string, string> = {
  未購入: "tone-waiting",
  購入済み: "tone-confirm",
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
  { label: "連絡・報告", href: "/ops/reports", icon: MessageSquareWarning },
  { label: "ログアウト", href: "/ops/logout", icon: LogOut }
];

function getItemStatus(item: PurchaseOrderItem) {
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
