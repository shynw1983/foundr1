"use client";

import { Boxes, ClipboardList, MessageSquareWarning, PackageCheck, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  exceptions,
  orders,
  productSupplierOptions as initialProductSupplierOptions,
  products as initialProducts
} from "../../../lib/mock-data";

type Product = typeof initialProducts[number];
type ProductSupplierGroup = typeof initialProductSupplierOptions[number];
type PurchaseOrder = typeof orders[number];
type DashboardOrderItem = {
  orderId: string;
  productName: string;
  requestedQuantity: number;
  actualQuantity?: number;
  unit: string;
  purchased?: boolean;
  supplier?: string;
  note?: string;
  priceExceptionNote?: string;
};
type ProcurementTaskItem = {
  id: string;
  orderId: string;
  productName: string;
  requestedQuantity: number;
  actualQuantity: number;
  unit: string;
  supplier: string;
  purchased: boolean;
  note: string;
  priceExceptionNote: string;
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "ダッシュボード", href: "/ops#ダッシュボード", icon: ClipboardList },
  { label: "仕入れ依頼", href: "/ops/orders", icon: PackageCheck },
  { label: "仕入れ処理", href: "/ops/procurement", icon: ClipboardList },
  { label: "連絡・報告", href: "/ops#連絡・報告", icon: MessageSquareWarning },
  { label: "商品マスタ", href: "/ops/products", icon: Boxes }
];

function createProcurementTaskItems(
  purchaseOrders: PurchaseOrder[],
  productList: Product[],
  purchaseOrderItems: DashboardOrderItem[]
) {
  if (productList.length === 0) return [];

  return purchaseOrders.flatMap((order, orderIndex) => {
    const orderItems = purchaseOrderItems.filter((item) => item.orderId === order.id);

    if (orderItems.length > 0) {
      return orderItems.map((item, itemIndex) => ({
        id: `${order.id}-${item.productName}-${itemIndex}`,
        orderId: order.id,
        productName: item.productName,
        requestedQuantity: item.requestedQuantity,
        actualQuantity: item.actualQuantity ?? item.requestedQuantity,
        unit: item.unit,
        supplier: item.supplier ?? "",
        purchased: item.purchased ?? false,
        note: item.note ?? "",
        priceExceptionNote: item.priceExceptionNote ?? ""
      }));
    }

    return Array.from({ length: Math.max(1, order.items) }, (_, itemIndex) => {
      const product = productList[(orderIndex + itemIndex) % productList.length];
      const quantity = itemIndex + 1;

      return {
        id: `${order.id}-${itemIndex}`,
        orderId: order.id,
        productName: product.name,
        requestedQuantity: quantity,
        actualQuantity: quantity,
        unit: product.unit,
        supplier: "",
        purchased: false,
        note: "",
        priceExceptionNote: ""
      };
    });
  });
}

function getProcurementSupplier(
  productName: string,
  productList: Product[],
  supplierOptions: ProductSupplierGroup[]
) {
  const product = productList.find((item) => item.name === productName);
  const mainOption = supplierOptions
    .find((group) => group.product === productName)
    ?.options.find((option) => option.role === "メイン");

  return product?.mainSupplier || mainOption?.supplier || "未設定";
}

function groupTasksBySupplier(
  items: ProcurementTaskItem[],
  productList: Product[],
  supplierOptions: ProductSupplierGroup[]
) {
  return items.reduce<Array<{ supplier: string; items: ProcurementTaskItem[] }>>((groups, item) => {
    const supplier = item.supplier || getProcurementSupplier(item.productName, productList, supplierOptions);
    const existingGroup = groups.find((group) => group.supplier === supplier);

    if (existingGroup) {
      existingGroup.items.push(item);
      return groups;
    }

    return [...groups, { supplier, items: [item] }];
  }, []);
}

export default function ProcurementPage() {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [productSupplierOptions, setProductSupplierOptions] = useState<ProductSupplierGroup[]>(initialProductSupplierOptions);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(orders);
  const [purchaseOrderItems, setPurchaseOrderItems] = useState<DashboardOrderItem[]>([]);
  const [dataSource, setDataSource] = useState<"mock" | "neon">("mock");
  const [activeExceptionItemId, setActiveExceptionItemId] = useState<string | null>(null);
  const [procurementTaskItems, setProcurementTaskItems] = useState<ProcurementTaskItem[]>(() =>
    createProcurementTaskItems(orders, initialProducts, [])
  );

  useEffect(() => {
    async function loadDashboardData() {
      const response = await fetch("/api/dashboard");
      if (!response.ok) return;

      const data = await response.json() as {
        products?: Product[];
        productSupplierOptions?: ProductSupplierGroup[];
        orders?: PurchaseOrder[];
        purchaseOrderItems?: DashboardOrderItem[];
      };

      if (data.products) setProducts(data.products);
      if (data.productSupplierOptions) setProductSupplierOptions(data.productSupplierOptions);
      if (data.orders) setPurchaseOrders(data.orders);
      if (data.purchaseOrderItems) setPurchaseOrderItems(data.purchaseOrderItems);
      setDataSource("neon");
    }

    void loadDashboardData();
  }, []);

  useEffect(() => {
    setProcurementTaskItems((items) => {
      const existingItems = new Map(items.map((item) => [item.id, item]));

      return createProcurementTaskItems(purchaseOrders, products, purchaseOrderItems).map(
        (item) => existingItems.get(item.id) ?? item
      );
    });
  }, [purchaseOrders, products, purchaseOrderItems]);

  function updateProcurementTaskItem(id: string, next: Partial<ProcurementTaskItem>) {
    setProcurementTaskItems((items) => items.map((item) => (item.id === id ? { ...item, ...next } : item)));
  }

  const activeExceptionItem = procurementTaskItems.find((item) => item.id === activeExceptionItemId) ?? null;

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
            <p className="eyebrow">現場の仕入れ実行</p>
            <h2>仕入れ処理</h2>
            <span className="source-indicator">{dataSource === "neon" ? "Neon 接続済み" : "ローカル表示"}</span>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input placeholder="注文番号・商品・仕入れ先を検索" />
            </label>
            <a className="primary-button" href="/ops/orders">
              仕入れ依頼を見る
            </a>
          </div>
        </header>

        <section className="panel procurement-panel">
          <PanelTitle title="仕入れ処理" subtitle="仕入れ先ごとに購入済み、数量差異、備考、価格異常を記録" />
          <div className="procurement-order-list">
            {purchaseOrders.map((order) => {
              const items = procurementTaskItems.filter((item) => item.orderId === order.id);
              const supplierGroups = groupTasksBySupplier(items, products, productSupplierOptions);
              const completedCount = items.filter((item) => item.purchased).length;

              return (
                <article className="procurement-order-card" key={order.id}>
                  <div className="procurement-order-heading">
                    <div>
                      <strong>{order.id}</strong>
                      <p>{order.store} / {order.brand}</p>
                    </div>
                    <span>{completedCount} / {items.length} 完了</span>
                  </div>
                  <div className="procurement-supplier-list">
                    {supplierGroups.map((group) => {
                      const supplierCompletedCount = group.items.filter((item) => item.purchased).length;

                      return (
                        <section className="procurement-supplier-group" key={`${order.id}-${group.supplier}`}>
                          <div className="supplier-group-heading">
                            <div>
                              <span>仕入れ先</span>
                              <strong>{group.supplier}</strong>
                            </div>
                            <small>{supplierCompletedCount} / {group.items.length} 完了</small>
                          </div>
                          <div className="procurement-task-list">
                            {group.items.map((item) => {
                              const quantityDiff = item.actualQuantity - item.requestedQuantity;

                              return (
                                <div className={item.purchased ? "procurement-task is-complete" : "procurement-task"} key={item.id}>
                                  <label className="task-check">
                                    <input
                                      type="checkbox"
                                      checked={item.purchased}
                                      onChange={(event) =>
                                        updateProcurementTaskItem(item.id, { purchased: event.target.checked })
                                      }
                                    />
                                    <span>{item.purchased ? "購入済み" : "未購入"}</span>
                                  </label>
                                  <div className="task-product">
                                    <strong>{item.productName}</strong>
                                    <small>依頼 {item.requestedQuantity} {item.unit}</small>
                                  </div>
                                  <label>
                                    <span>実数</span>
                                    <input
                                      type="number"
                                      min={0}
                                      value={item.actualQuantity}
                                      onChange={(event) =>
                                        updateProcurementTaskItem(item.id, { actualQuantity: Number(event.target.value) })
                                      }
                                    />
                                  </label>
                                  <div className={quantityDiff === 0 ? "quantity-diff" : "quantity-diff has-diff"}>
                                    {quantityDiff === 0 ? "差異なし" : `${quantityDiff > 0 ? "+" : ""}${quantityDiff} ${item.unit}`}
                                  </div>
                                  <button
                                    type="button"
                                    className={item.note || item.priceExceptionNote ? "exception-button has-report" : "exception-button"}
                                    onClick={() => setActiveExceptionItemId(item.id)}
                                  >
                                    異常報告
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="panel" id="連絡・報告">
          <PanelTitle title="現場連絡" subtitle="欠品や代替品の連絡を確認" />
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
      </section>
      {activeExceptionItem ? (
        <ExceptionReportDialog
          item={activeExceptionItem}
          onChange={(next) => updateProcurementTaskItem(activeExceptionItem.id, next)}
          onClose={() => setActiveExceptionItemId(null)}
        />
      ) : null}
    </main>
  );
}

function ExceptionReportDialog({
  item,
  onChange,
  onClose
}: {
  item: ProcurementTaskItem;
  onChange: (next: Partial<ProcurementTaskItem>) => void;
  onClose: () => void;
}) {
  const quantityDiff = item.actualQuantity - item.requestedQuantity;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="exception-report-title">
      <form
        className="edit-modal exception-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Exception Report</p>
            <h3 id="exception-report-title">異常報告</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        <div className="exception-summary">
          <strong>{item.productName}</strong>
          <span>依頼 {item.requestedQuantity} {item.unit}</span>
          <span>実数 {item.actualQuantity} {item.unit}</span>
          <span className={quantityDiff === 0 ? "quantity-diff" : "quantity-diff has-diff"}>
            {quantityDiff === 0 ? "差異なし" : `${quantityDiff > 0 ? "+" : ""}${quantityDiff} ${item.unit}`}
          </span>
        </div>
        <div className="edit-fields">
          <label>
            <span>備考</span>
            <textarea
              value={item.note}
              placeholder="代替品、欠品、配送メモなど"
              onChange={(event) => onChange({ note: event.target.value })}
            />
          </label>
          <label>
            <span>価格異常メモ</span>
            <textarea
              value={item.priceExceptionNote}
              placeholder="通常より高い、特売終了、価格確認が必要など"
              onChange={(event) => onChange({ priceExceptionNote: event.target.value })}
            />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="primary-button">
            保存
          </button>
        </div>
      </form>
    </div>
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
