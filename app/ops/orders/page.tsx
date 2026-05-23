"use client";

import { Boxes, ClipboardList, FileText, MessageSquareWarning, PackageCheck, Plus, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  brands,
  exceptions,
  orders,
  products as initialProducts,
  stores
} from "../../../lib/mock-data";

type Product = typeof initialProducts[number];
type PurchaseOrder = typeof orders[number];
type OrderItemDraft = {
  id: number;
  category: string;
  productName: string;
  brandName: string;
  quantity: number;
  unit: string;
};
type QueueFilter = "未完了" | "今日対応" | "配送待ち" | "完了" | "すべて";
type PurchaseOrderItem = {
  id?: string;
  orderId: string;
  productName: string;
  requestedQuantity: number;
  actualQuantity?: number;
  unit: string;
  note?: string;
  priceExceptionNote?: string;
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
  { label: "連絡・報告", href: "/ops#連絡・報告", icon: MessageSquareWarning },
  { label: "商品マスタ", href: "/ops/products", icon: Boxes }
];

const queueFilters: QueueFilter[] = ["未完了", "今日対応", "配送待ち", "完了", "すべて"];
const orderableStoreNames = ["清川店", "清水店"];
const usageBrandOptions = [
  { label: "共通", value: "共通" },
  { label: "nanacha", value: "奈奈茶" },
  { label: "まぁ麻", value: "熱辣食堂" }
];

function isTodayOrder(order: PurchaseOrder) {
  return order.deadline.includes("本日") || order.deadline.includes("2026-05-23") || order.deadline.includes("05/23");
}

function createStoreFeedbackItems(
  purchaseOrders: PurchaseOrder[],
  purchaseOrderItems: PurchaseOrderItem[],
  fallbackItems: StoreFeedback[]
) {
  const orderMap = new Map(purchaseOrders.map((order) => [order.id, order]));
  const feedbackItems = purchaseOrderItems.flatMap<StoreFeedback>((item) => {
    const actualQuantity = item.actualQuantity ?? item.requestedQuantity;
    const quantityDiff = actualQuantity - item.requestedQuantity;
    const order = orderMap.get(item.orderId);
    const store = order?.store ?? "店舗未設定";
    const baseId = item.id ?? `${item.orderId}-${item.productName}`;
    const items: StoreFeedback[] = [];

    if (item.priceExceptionNote) {
      items.push({
        id: `${baseId}-price`,
        product: item.productName,
        type: "価格異常",
        message: item.priceExceptionNote,
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

  return feedbackItems.length > 0 ? feedbackItems : fallbackItems;
}

export default function OrdersPage() {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [storesData, setStoresData] = useState(stores);
  const [brandsData, setBrandsData] = useState(brands);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(orders);
  const [purchaseOrderItems, setPurchaseOrderItems] = useState<PurchaseOrderItem[]>([]);
  const [dataSource, setDataSource] = useState<"mock" | "neon">("mock");
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("未完了");
  const [orderItemDrafts, setOrderItemDrafts] = useState<OrderItemDraft[]>([
    {
      id: 1,
      category: initialProducts[0]?.category ?? "",
      productName: initialProducts[0]?.name ?? "",
      brandName: usageBrandOptions[0].value,
      quantity: 1,
      unit: initialProducts[0]?.unit ?? "個"
    }
  ]);

  useEffect(() => {
    async function loadDashboardData() {
      const response = await fetch("/api/dashboard");
      if (!response.ok) return;

      const data = await response.json() as {
        stores?: typeof stores;
        brands?: typeof brands;
        products?: Product[];
        orders?: PurchaseOrder[];
        purchaseOrderItems?: PurchaseOrderItem[];
      };

      if (data.stores) setStoresData(data.stores);
      if (data.brands) setBrandsData(data.brands);
      if (data.products) setProducts(data.products);
      if (data.orders) setPurchaseOrders(data.orders);
      if (data.purchaseOrderItems) setPurchaseOrderItems(data.purchaseOrderItems);
      setDataSource("neon");
    }

    void loadDashboardData();
  }, []);

  const productCategories = Array.from(new Set(products.map((product) => product.category)));
  const orderableStores = storesData
    .filter((store) => orderableStoreNames.includes(store.name.replace("納品", "")))
    .map((store) => ({
      ...store,
      label: store.name.replace("納品", "")
    }));
  const storeFeedbackItems = createStoreFeedbackItems(purchaseOrders, purchaseOrderItems, exceptions);
  const filteredPurchaseOrders = purchaseOrders.filter((order) => {
    if (queueFilter === "未完了") return order.status !== "完了";
    if (queueFilter === "今日対応") return order.status !== "完了" && isTodayOrder(order);
    if (queueFilter === "配送待ち") return ["配送待ち", "配送中", "一部配達済み"].includes(order.status);
    if (queueFilter === "完了") return order.status === "完了";

    return true;
  });

  function getQueueFilterCount(filter: QueueFilter) {
    if (filter === "未完了") return purchaseOrders.filter((order) => order.status !== "完了").length;
    if (filter === "今日対応") return purchaseOrders.filter((order) => order.status !== "完了" && isTodayOrder(order)).length;
    if (filter === "配送待ち") {
      return purchaseOrders.filter((order) => ["配送待ち", "配送中", "一部配達済み"].includes(order.status)).length;
    }
    if (filter === "完了") return purchaseOrders.filter((order) => order.status === "完了").length;

    return purchaseOrders.length;
  }

  function addOrderItemDraft() {
    const firstProduct = products[0];

    setOrderItemDrafts((items) => [
      ...items,
      {
        id: Date.now(),
        category: firstProduct?.category ?? "",
        productName: firstProduct?.name ?? "",
        brandName: usageBrandOptions[0].value,
        quantity: 1,
        unit: firstProduct?.unit ?? "個"
      }
    ]);
  }

  function updateOrderItemDraft(id: number, next: Partial<OrderItemDraft>) {
    setOrderItemDrafts((items) =>
      items.map((item) => {
        if (item.id !== id) return item;

        if (next.category && next.category !== item.category) {
          const firstProductInCategory = products.find((product) => product.category === next.category);

          return {
            ...item,
            category: next.category,
            productName: firstProductInCategory?.name ?? "",
            unit: firstProductInCategory?.unit ?? "個"
          };
        }

        if (next.productName && next.productName !== item.productName) {
          const selectedProduct = products.find((product) => product.name === next.productName);

          return {
            ...item,
            productName: next.productName,
            unit: selectedProduct?.unit ?? item.unit
          };
        }

        return {
          ...item,
          ...next
        };
      })
    );
  }

  function removeOrderItemDraft(id: number) {
    setOrderItemDrafts((items) => items.filter((item) => item.id !== id));
  }

  function deletePurchaseOrder(orderId: string) {
    if (!window.confirm(`${orderId} を削除しますか？`)) return;

    setPurchaseOrders((items) => items.filter((item) => item.id !== orderId));
    setPurchaseOrderItems((items) => items.filter((item) => item.orderId !== orderId));

    void fetch("/api/orders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId })
    }).catch(() => {
      // Keep the UI responsive; a refresh will restore server state if deletion failed.
    });
  }

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
            <p className="eyebrow">店舗からの仕入れ依頼</p>
            <h2>仕入れ依頼</h2>
            <span className="source-indicator">{dataSource === "neon" ? "Neon 接続済み" : "ローカル表示"}</span>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input placeholder="商品・店舗・依頼番号を検索" />
            </label>
            <a className="primary-button" href="#create-order-panel">
              <Plus size={18} />
              仕入れ依頼を作成
            </a>
          </div>
        </header>

        <section className="panel create-order-panel" id="create-order-panel">
          <PanelTitle title="新規仕入れ依頼" subtitle="配達先店舗を中心に、商品ごとの用途ブランドと仕入れ商品リストを指定" />
          <form className="inline-create-form" action="/api/orders" method="post">
            <label>
              <span>配達先店舗</span>
              <select name="store" defaultValue={orderableStores[0]?.name}>
                {orderableStores.map((store) => (
                  <option value={store.name} key={store.name}>{store.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>締切</span>
              <input name="deadline" defaultValue="本日 18:00" />
            </label>
            <label>
              <span>優先度</span>
              <select name="priority" defaultValue="中">
                <option value="高">高</option>
                <option value="中">中</option>
                <option value="低">低</option>
              </select>
            </label>
            <label>
              <span>メモ</span>
              <textarea name="note" placeholder="欠品時の代替、配送希望など" />
            </label>
            <div className="order-items-builder">
              <div className="builder-heading">
                <strong>仕入れ商品リスト</strong>
              </div>
              <div className="order-item-list">
                {orderItemDrafts.map((item, index) => (
                  <div className="order-item-row" key={item.id}>
                    <label>
                      <span>分類 {index + 1}</span>
                      <select
                        value={item.category}
                        onChange={(event) => updateOrderItemDraft(item.id, { category: event.target.value })}
                      >
                        {productCategories.map((category) => (
                          <option value={category} key={category}>{category}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>商品</span>
                      <select
                        name="productName"
                        value={item.productName}
                        onChange={(event) => updateOrderItemDraft(item.id, { productName: event.target.value })}
                      >
                        {products.filter((product) => product.category === item.category).map((product) => (
                          <option value={product.name} key={product.name}>{product.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>用途ブランド</span>
                      <select
                        name="itemBrand"
                        value={item.brandName}
                        onChange={(event) => updateOrderItemDraft(item.id, { brandName: event.target.value })}
                      >
                        {usageBrandOptions.map((brand) => (
                          <option value={brand.value} key={brand.value}>{brand.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>数量</span>
                      <input
                        name="requestedQuantity"
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(event) => updateOrderItemDraft(item.id, { quantity: Number(event.target.value) })}
                      />
                    </label>
                    <div className="unit-display">
                      <span>単位</span>
                      <strong>{item.unit}</strong>
                      <input type="hidden" name="requestedUnit" value={item.unit} />
                    </div>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => removeOrderItemDraft(item.id)}
                      disabled={orderItemDrafts.length === 1}
                    >
                      削除
                    </button>
                  </div>
                ))}
              </div>
              <div className="builder-actions">
                <button type="button" className="text-button" onClick={addOrderItemDraft}>
                  商品を追加
                </button>
              </div>
            </div>
            <div className="inline-create-actions">
              <button type="submit" className="primary-button">
                <Plus size={18} />
                依頼を追加
              </button>
            </div>
          </form>
        </section>

        <section className="workspace-grid">
          <section className="panel operation-panel" id="仕入れ依頼">
            <PanelTitle title="仕入れ依頼キュー" subtitle="未完了の依頼を中心に、状態別に確認" />
            <div className="queue-filter-bar" aria-label="仕入れ依頼フィルター">
              {queueFilters.map((filter) => (
                <button
                  type="button"
                  className={queueFilter === filter ? "queue-filter is-active" : "queue-filter"}
                  onClick={() => setQueueFilter(filter)}
                  key={filter}
                >
                  <span>{filter}</span>
                  <strong>{getQueueFilterCount(filter)}</strong>
                </button>
              ))}
            </div>
            <div className="order-list">
              {filteredPurchaseOrders.map((order) => (
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
                  <div className="row-actions">
                    <a className="icon-button" href="/ops/procurement" aria-label={`${order.id} の仕入れ処理`}>
                      <PackageCheck size={18} />
                    </a>
                    <button type="button" className="text-button danger-button" onClick={() => deletePurchaseOrder(order.id)}>
                      削除
                    </button>
                  </div>
                </article>
              ))}
              {filteredPurchaseOrders.length === 0 ? (
                <div className="empty-state">該当する依頼はありません</div>
              ) : null}
            </div>
          </section>

          <aside className="side-stack">
            <section className="panel" id="連絡・報告">
              <PanelTitle title="要確認" subtitle="依頼前後の店舗連絡" />
              <div className="stack">
                {storeFeedbackItems.map((item) => (
                  <article className="feedback-item" key={item.id}>
                    <div className="feedback-topline">
                      <strong>{item.product}</strong>
                      <span>{item.type}</span>
                    </div>
                    <p>{item.message}</p>
                    <small>{item.store} · {item.status}</small>
                  </article>
                ))}
              </div>
            </section>
          </aside>
        </section>
      </section>
    </main>
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
