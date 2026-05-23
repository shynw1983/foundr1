"use client";

import { Boxes, ClipboardList, MessageSquareWarning, PackageCheck, Plus, Search } from "lucide-react";
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
  quantity: number;
  unit: string;
};

const statusTone: Record<string, string> = {
  仕入れ待ち: "tone-waiting",
  仕入れ中: "tone-active",
  一部完了: "tone-warning",
  配送中: "tone-route",
  確認待ち: "tone-confirm",
  完了: "tone-done"
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "ダッシュボード", href: "/ops#ダッシュボード", icon: ClipboardList },
  { label: "仕入れ依頼", href: "/ops/orders", icon: PackageCheck },
  { label: "仕入れ処理", href: "/ops/procurement", icon: ClipboardList },
  { label: "連絡・報告", href: "/ops#連絡・報告", icon: MessageSquareWarning },
  { label: "商品マスタ", href: "/ops/products", icon: Boxes }
];

export default function OrdersPage() {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [storesData, setStoresData] = useState(stores);
  const [brandsData, setBrandsData] = useState(brands);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(orders);
  const [dataSource, setDataSource] = useState<"mock" | "neon">("mock");
  const [orderItemDrafts, setOrderItemDrafts] = useState<OrderItemDraft[]>([
    {
      id: 1,
      category: initialProducts[0]?.category ?? "",
      productName: initialProducts[0]?.name ?? "",
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
      };

      if (data.stores) setStoresData(data.stores);
      if (data.brands) setBrandsData(data.brands);
      if (data.products) setProducts(data.products);
      if (data.orders) setPurchaseOrders(data.orders);
      setDataSource("neon");
    }

    void loadDashboardData();
  }, []);

  const productCategories = Array.from(new Set(products.map((product) => product.category)));

  function addOrderItemDraft() {
    const firstProduct = products[0];

    setOrderItemDrafts((items) => [
      ...items,
      {
        id: Date.now(),
        category: firstProduct?.category ?? "",
        productName: firstProduct?.name ?? "",
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
          <PanelTitle title="新規仕入れ依頼" subtitle="店舗、ブランド、締切、優先度、商品清单を指定して依頼を作成" />
          <form className="inline-create-form" action="/api/orders" method="post">
            <label>
              <span>送達店舗</span>
              <select name="store" defaultValue={storesData[0]?.name}>
                {storesData.map((store) => (
                  <option value={store.name} key={store.name}>{store.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>対象ブランド</span>
              <select name="brand" defaultValue={brandsData[0]?.name}>
                {brandsData.map((brand) => (
                  <option value={brand.name} key={brand.name}>{brand.name}</option>
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
                <strong>采购商品清单</strong>
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
            <PanelTitle title="仕入れ依頼キュー" subtitle="今日処理すべき依頼を優先度順に確認" />
            <div className="order-list">
              {purchaseOrders.map((order) => (
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
                    <PackageCheck size={18} />
                  </a>
                </article>
              ))}
            </div>
          </section>

          <aside className="side-stack">
            <section className="panel" id="連絡・報告">
              <PanelTitle title="要確認" subtitle="依頼前後の店舗連絡" />
              <div className="stack">
                {exceptions.map((item) => (
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
