"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  Clock3,
  ClipboardList,
  MessageSquareWarning,
  PackageCheck,
  Plus,
  Search,
  Store
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  brands,
  exceptions,
  orders,
  productBrandUsages as initialProductBrandUsages,
  productSupplierOptions as initialProductSupplierOptions,
  products as initialProducts,
  stores,
  supplierLocations as initialSupplierLocations,
  suppliers as initialSuppliers
} from "../../lib/mock-data";

type Product = typeof initialProducts[number];
type Supplier = typeof initialSuppliers[number];
type SupplierLocation = typeof initialSupplierLocations[number];
type ProductSupplierGroup = typeof initialProductSupplierOptions[number];
type ProductSupplierOption = ProductSupplierGroup["options"][number];
type ProductBrandUsage = typeof initialProductBrandUsages[number];
type PurchaseOrder = typeof orders[number];
type EditTarget =
  | { type: "product"; index: number; value: Product }
  | { type: "usage"; index: number; value: ProductBrandUsage }
  | { type: "supplier"; index: number; value: Supplier }
  | { type: "location"; index: number; value: SupplierLocation }
  | { type: "source"; groupIndex: number; optionIndex: number; value: ProductSupplierOption };
type OrderItemDraft = {
  id: number;
  category: string;
  productName: string;
  quantity: number;
  unit: string;
};
type ProcurementTaskItem = {
  id: string;
  orderId: string;
  productName: string;
  requestedQuantity: number;
  actualQuantity: number;
  unit: string;
  purchased: boolean;
  note: string;
  priceExceptionNote: string;
};
type DashboardOrderItem = {
  orderId: string;
  productName: string;
  requestedQuantity: number;
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

const navItems: Array<[string, LucideIcon]> = [
  ["ダッシュボード", ClipboardList],
  ["仕入れ依頼", PackageCheck],
  ["仕入れ処理", ClipboardList],
  ["連絡・報告", MessageSquareWarning]
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
        actualQuantity: item.requestedQuantity,
        unit: item.unit,
        purchased: false,
        note: "",
        priceExceptionNote: ""
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
        purchased: false,
        note: "",
        priceExceptionNote: ""
      };
    });
  });
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [productBrandUsages, setProductBrandUsages] = useState<ProductBrandUsage[]>(initialProductBrandUsages);
  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers);
  const [supplierLocations, setSupplierLocations] = useState<SupplierLocation[]>(initialSupplierLocations);
  const [productSupplierOptions, setProductSupplierOptions] = useState<ProductSupplierGroup[]>(initialProductSupplierOptions);
  const [storesData, setStoresData] = useState(stores);
  const [brandsData, setBrandsData] = useState(brands);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(orders);
  const [purchaseOrderItems, setPurchaseOrderItems] = useState<DashboardOrderItem[]>([]);
  const [procurementTaskItems, setProcurementTaskItems] = useState<ProcurementTaskItem[]>(() =>
    createProcurementTaskItems(orders, initialProducts, [])
  );
  const [orderItemDrafts, setOrderItemDrafts] = useState<OrderItemDraft[]>([
    {
      id: 1,
      category: initialProducts[0]?.category ?? "",
      productName: initialProducts[0]?.name ?? "",
      quantity: 1,
      unit: initialProducts[0]?.unit ?? "個"
    }
  ]);
  const [dataSource, setDataSource] = useState<"mock" | "neon">("mock");
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  useEffect(() => {
    async function loadDashboardData() {
      const response = await fetch("/api/dashboard");
      if (!response.ok) return;

      const data = await response.json() as {
        stores?: typeof stores;
        brands?: typeof brands;
        products?: Product[];
        productBrandUsages?: ProductBrandUsage[];
        suppliers?: Supplier[];
        supplierLocations?: SupplierLocation[];
        productSupplierOptions?: ProductSupplierGroup[];
        purchaseOrderItems?: DashboardOrderItem[];
      };

      if (data.stores) setStoresData(data.stores);
      if (data.brands) setBrandsData(data.brands);
      if (data.products) setProducts(data.products);
      if (data.productBrandUsages) setProductBrandUsages(data.productBrandUsages);
      if (data.suppliers) setSuppliers(data.suppliers);
      if (data.supplierLocations) setSupplierLocations(data.supplierLocations);
      if (data.productSupplierOptions) setProductSupplierOptions(data.productSupplierOptions);
      if (data.purchaseOrderItems) setPurchaseOrderItems(data.purchaseOrderItems);
      setDataSource("neon");
    }

    void loadDashboardData();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      "foundr1-procurement-data",
      JSON.stringify({ products, productBrandUsages, suppliers, supplierLocations, productSupplierOptions })
    );
  }, [products, productBrandUsages, suppliers, supplierLocations, productSupplierOptions]);

  useEffect(() => {
    setProcurementTaskItems((items) => {
      const existingItems = new Map(items.map((item) => [item.id, item]));

      return createProcurementTaskItems(purchaseOrders, products, purchaseOrderItems).map(
        (item) => existingItems.get(item.id) ?? item
      );
    });
  }, [purchaseOrders, products, purchaseOrderItems]);

  const openOrders = purchaseOrders.filter((order) => order.status !== "完了");
  const urgentOrders = purchaseOrders.filter((order) => order.priority === "高").length;
  const activeExceptions = exceptions.filter((item) => item.status !== "解決済み").length;
  const productCategories = Array.from(new Set(products.map((product) => product.category)));

  function saveEdit(target: EditTarget) {
    if (target.type === "product") {
      setProducts((items) =>
        target.index >= items.length
          ? [...items, target.value]
          : items.map((item, index) => (index === target.index ? target.value : item))
      );
    }

    if (target.type === "supplier") {
      setSuppliers((items) => items.map((item, index) => (index === target.index ? target.value : item)));
    }

    if (target.type === "usage") {
      setProductBrandUsages((items) => items.map((item, index) => (index === target.index ? target.value : item)));
    }

    if (target.type === "location") {
      setSupplierLocations((items) => items.map((item, index) => (index === target.index ? target.value : item)));
    }

    if (target.type === "source") {
      setProductSupplierOptions((groups) =>
        groups.map((group, groupIndex) =>
          groupIndex === target.groupIndex
            ? {
                ...group,
                options: group.options.map((option, optionIndex) =>
                  optionIndex === target.optionIndex ? target.value : option
                )
              }
            : group
        )
      );
    }

    setEditTarget(null);
  }

  function openNewProductEditor() {
    setEditTarget({
      type: "product",
      index: products.length,
      value: {
        name: "",
        category: productCategories[0] ?? "食材",
        brand: brandsData[0]?.name ?? "共通",
        unit: "個",
        referencePrice: 0,
        mainSupplier: suppliers[0]?.name ?? "",
        backupSupplier: "",
        specNote: "",
        photoUrl: "",
        storageType: "常温"
      }
    });
  }

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

  function updateProcurementTaskItem(id: string, next: Partial<ProcurementTaskItem>) {
    setProcurementTaskItems((items) =>
      items.map((item) => {
        if (item.id !== id) return item;

        return {
          ...item,
          ...next
        };
      })
    );
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
          {navItems.map(([label, Icon]) => (
            <a href={`#${label}`} className="nav-item" key={label}>
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
            <h2>仕入れワークスペース</h2>
            <span className="source-indicator">{dataSource === "neon" ? "Neon 接続済み" : "ローカル表示"}</span>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input placeholder="商品・店舗・仕入れ先を検索" />
            </label>
            <a className="primary-button" href="#create-order-panel">
              <Plus size={18} />
              仕入れ依頼を作成
            </a>
          </div>
        </header>

        <section className="metric-grid" id="ダッシュボード">
          <MetricCard icon={<ClipboardList />} label="進行中の依頼" value={openOrders.length} note="3 店舗をカバー" />
          <MetricCard icon={<Clock3 />} label="高優先度" value={urgentOrders} note="先に処理したい依頼" />
          <MetricCard icon={<AlertTriangle />} label="未対応の異常" value={activeExceptions} note="欠品・価格異常" />
          <MetricCard icon={<Store />} label="対象店舗" value={storesData.length} note="依頼を送れる店舗" />
        </section>

        <section className="panel create-order-panel" id="create-order-panel">
          <PanelTitle title="新規仕入れ依頼" subtitle="店舗、ブランド、締切、優先度を指定して依頼を作成" />
          <form
            className="inline-create-form"
            action="/api/orders"
            method="post"
          >
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
                          <option value={category} key={category}>
                            {category}
                          </option>
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
                          <option value={product.name} key={product.name}>
                            {product.name}
                          </option>
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
          <div className="ops-main-stack">
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
                    <button className="icon-button" aria-label={`${order.id} の詳細`}>
                      <ArrowUpRight size={18} />
                    </button>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel procurement-panel" id="仕入れ処理">
              <PanelTitle title="仕入れ処理" subtitle="購入済み、数量差異、備考、価格異常を現場で記録" />
              <div className="procurement-order-list">
                {purchaseOrders.map((order) => {
                  const items = procurementTaskItems.filter((item) => item.orderId === order.id);
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
                      <div className="procurement-task-list">
                        {items.map((item) => {
                          const quantityDiff = item.actualQuantity - item.requestedQuantity;

                          return (
                            <div className={item.purchased ? "procurement-task is-complete" : "procurement-task"} key={item.id}>
                              <label className="task-check">
                                <input
                                  type="checkbox"
                                  checked={item.purchased}
                                  onChange={(event) => updateProcurementTaskItem(item.id, { purchased: event.target.checked })}
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
                              <label>
                                <span>備考</span>
                                <input
                                  value={item.note}
                                  placeholder="代替品、欠品、配送メモ"
                                  onChange={(event) => updateProcurementTaskItem(item.id, { note: event.target.value })}
                                />
                              </label>
                              <label>
                                <span>価格異常メモ</span>
                                <input
                                  value={item.priceExceptionNote}
                                  placeholder="通常より高い、特売終了など"
                                  onChange={(event) =>
                                    updateProcurementTaskItem(item.id, { priceExceptionNote: event.target.value })
                                  }
                                />
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>

          <aside className="side-stack">
            <section className="panel" id="連絡・報告">
              <PanelTitle title="要確認" subtitle="店舗へ返答が必要な連絡" />
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

      {editTarget ? (
        <EditDialog
          target={editTarget}
          onChange={setEditTarget}
          onClose={() => setEditTarget(null)}
          onSave={saveEdit}
        />
      ) : null}
    </main>
  );
}

function MetricCard({
  icon,
  label,
  value,
  note
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  note: string;
}) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <p>{note}</p>
      </div>
    </article>
  );
}

function EditDialog({
  target,
  onChange,
  onClose,
  onSave
}: {
  target: EditTarget;
  onChange: (target: EditTarget) => void;
  onClose: () => void;
  onSave: (target: EditTarget) => void;
}) {
  const fields = getFields(target);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="edit-title">
      <form
        className="edit-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(target);
        }}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Data Edit</p>
            <h3 id="edit-title">{getEditTitle(target)}</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        <div className="edit-fields">
          {fields.map((field) => (
            <label key={field.key}>
              <span>{field.label}</span>
              {field.options ? (
                <select
                  value={String((target.value as Record<string, string | number>)[field.key] ?? "")}
                  onChange={(event) => {
                    onChange({
                      ...target,
                      value: {
                        ...target.value,
                        [field.key]: event.target.value
                      }
                    } as EditTarget);
                  }}
                >
                  {field.options.map((option) => (
                    <option value={option} key={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={String((target.value as Record<string, string | number>)[field.key] ?? "")}
                  type={field.type ?? "text"}
                  onChange={(event) => {
                    const nextValue =
                      field.type === "number" ? Number(event.target.value) : event.target.value;
                    onChange({
                      ...target,
                      value: {
                        ...target.value,
                        [field.key]: nextValue
                      }
                    } as EditTarget);
                  }}
                />
              )}
            </label>
          ))}
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

function getEditTitle(target: EditTarget) {
  const titles = {
    product: "商品マスタを編集",
    usage: "ブランド別利用を編集",
    supplier: "仕入れ先を編集",
    location: "仕入れ先拠点を編集",
    source: "商品別仕入れ先を編集"
  };

  if (target.type === "product" && !target.value.name) {
    return "商品マスタを追加";
  }

  return titles[target.type];
}

function getFields(target: EditTarget): Array<{ key: string; label: string; type?: "number"; options?: string[] }> {
  if (target.type === "product") {
    const product = target.value;
    const categoryOptions = uniqueOptions(["食材", "包材", "消耗品", "清掃備品", "設備消耗品", product.category]);
    const brandOptions = uniqueOptions(["奈奈茶", "熱辣食堂", "奈奈茶 / 熱辣食堂", product.brand]);
    const unitOptions = uniqueOptions(["個", "袋", "箱", "本", "枚", "kg", "g", "L", "ml", "セット", product.unit]);
    const supplierOptions = uniqueOptions(["", ...["城北食材卸", "東和包材", "南区調味料店", "近隣業務スーパー", "オンライン包材 A"], product.mainSupplier, product.backupSupplier]);
    const storageOptions = uniqueOptions(["常温", "冷蔵", "冷凍", product.storageType]);

    return [
      { key: "name", label: "商品名" },
      { key: "category", label: "カテゴリ", options: categoryOptions },
      { key: "brand", label: "ブランド", options: brandOptions },
      { key: "unit", label: "単位", options: unitOptions },
      { key: "referencePrice", label: "参考価格", type: "number" },
      { key: "mainSupplier", label: "主要仕入れ先", options: supplierOptions },
      { key: "backupSupplier", label: "予備仕入れ先", options: supplierOptions },
      { key: "storageType", label: "保管属性", options: storageOptions },
      { key: "specNote", label: "規格メモ" },
      { key: "photoUrl", label: "写真URL" }
    ];
  }

  if (target.type === "supplier") {
    return [
      { key: "name", label: "仕入れ先名" },
      { key: "category", label: "カテゴリ" },
      { key: "reliability", label: "安定性" },
      { key: "channelType", label: "種別" }
    ];
  }

  if (target.type === "usage") {
    return [
      { key: "product", label: "商品名" },
      { key: "brand", label: "ブランド" },
      { key: "usage", label: "用途" },
      { key: "defaultOrderQuantity", label: "標準数量" },
      { key: "specNote", label: "規格メモ" },
      { key: "priority", label: "優先度" }
    ];
  }

  if (target.type === "location") {
    return [
      { key: "supplier", label: "仕入れ先" },
      { key: "locationName", label: "拠点名" },
      { key: "type", label: "種別" },
      { key: "area", label: "エリア" },
      { key: "hours", label: "営業時間" },
      { key: "purchaseMethod", label: "購入方法" },
      { key: "note", label: "備考" }
    ];
  }

  return [
    { key: "supplier", label: "仕入れ先" },
    { key: "role", label: "役割" },
    { key: "referencePrice", label: "参考価格", type: "number" },
    { key: "minOrder", label: "最小発注" },
    { key: "leadTime", label: "リードタイム" },
    { key: "note", label: "備考" }
  ];
}

function uniqueOptions(options: string[]) {
  return Array.from(new Set(options.filter(Boolean)));
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
