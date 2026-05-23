"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  Clock3,
  ClipboardList,
  MessageSquareWarning,
  PackageCheck,
  Plus,
  Search,
  Store,
  Truck,
  UsersRound,
  WalletCards
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  accessProfiles,
  brands,
  exceptions,
  orders,
  priceSignals,
  productBrandUsages as initialProductBrandUsages,
  productSupplierOptions as initialProductSupplierOptions,
  products as initialProducts,
  stores,
  supplierLocations as initialSupplierLocations,
  suppliers as initialSuppliers
} from "../lib/mock-data";

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
type NewOrderDraft = {
  store: string;
  brand: string;
  deadline: string;
  priority: string;
  items: number;
  note: string;
};
type OrderItemDraft = {
  id: number;
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

const navItems: Array<[string, LucideIcon]> = [
  ["ダッシュボード", ClipboardList],
  ["仕入れ依頼", PackageCheck],
  ["連絡・報告", MessageSquareWarning],
  ["価格推移", WalletCards],
  ["マスタ管理", Boxes],
  ["店舗・権限", Store],
  ["権限", UsersRound]
];

export default function Home() {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [productBrandUsages, setProductBrandUsages] = useState<ProductBrandUsage[]>(initialProductBrandUsages);
  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers);
  const [supplierLocations, setSupplierLocations] = useState<SupplierLocation[]>(initialSupplierLocations);
  const [productSupplierOptions, setProductSupplierOptions] = useState<ProductSupplierGroup[]>(initialProductSupplierOptions);
  const [storesData, setStoresData] = useState(stores);
  const [brandsData, setBrandsData] = useState(brands);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(orders);
  const [newOrderDraft, setNewOrderDraft] = useState<NewOrderDraft | null>(null);
  const [orderItemDrafts, setOrderItemDrafts] = useState<OrderItemDraft[]>([
    {
      id: 1,
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
      };

      if (data.stores) setStoresData(data.stores);
      if (data.brands) setBrandsData(data.brands);
      if (data.products) setProducts(data.products);
      if (data.productBrandUsages) setProductBrandUsages(data.productBrandUsages);
      if (data.suppliers) setSuppliers(data.suppliers);
      if (data.supplierLocations) setSupplierLocations(data.supplierLocations);
      if (data.productSupplierOptions) setProductSupplierOptions(data.productSupplierOptions);
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

  const openOrders = purchaseOrders.filter((order) => order.status !== "完了");
  const urgentOrders = purchaseOrders.filter((order) => order.priority === "高").length;
  const activeExceptions = exceptions.filter((item) => item.status !== "解決済み").length;
  const risingPrices = priceSignals.filter((item) => item.changeRate > 8).length;
  const keyProducts = products.filter((product) => product.category === "食材").length;

  const masterModules = [
    {
      title: "商品マスタ",
      count: products.length,
      detail: "商品本体、カテゴリ、単位、参考価格",
      sample: products.slice(0, 3).map((product) => product.name).join(" / ")
    },
    {
      title: "ブランド別利用",
      count: productBrandUsages.length,
      detail: "共用品のブランド別用途と標準数量",
      sample: productBrandUsages.slice(0, 3).map((usage) => `${usage.product}:${usage.brand}`).join(" / ")
    },
    {
      title: "商品別仕入れ先",
      count: productSupplierOptions.length,
      detail: "メイン、予備、緊急チャネル",
      sample: productSupplierOptions.slice(0, 3).map((group) => group.product).join(" / ")
    },
    {
      title: "仕入れ先・拠点",
      count: suppliers.length + supplierLocations.length,
      detail: "ネットショップ、実店舗、チェーン分店",
      sample: suppliers.slice(0, 3).map((supplier) => supplier.name).join(" / ")
    }
  ];

  function saveEdit(target: EditTarget) {
    if (target.type === "product") {
      setProducts((items) => items.map((item, index) => (index === target.index ? target.value : item)));
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

  function saveNewOrder(draft: NewOrderDraft) {
    const nextOrder: PurchaseOrder = {
      id: `PO-${new Date().toISOString().slice(5, 10).replace("-", "")}-${String(purchaseOrders.length + 1).padStart(3, "0")}`,
      store: draft.store,
      brand: draft.brand,
      deadline: draft.deadline,
      items: draft.items,
      priority: draft.priority,
      status: "仕入れ待ち"
    };

    setPurchaseOrders((items) => [nextOrder, ...items]);
    setNewOrderDraft(null);
  }

  function addOrderItemDraft() {
    setOrderItemDrafts((items) => [
      ...items,
      {
        id: Date.now(),
        productName: products[0]?.name ?? "",
        quantity: 1,
        unit: products[0]?.unit ?? "個"
      }
    ]);
  }

  function updateOrderItemDraft(id: number, next: Partial<OrderItemDraft>) {
    setOrderItemDrafts((items) =>
      items.map((item) => {
        if (item.id !== id) return item;

        const selectedProduct = next.productName
          ? products.find((product) => product.name === next.productName)
          : undefined;

        return {
          ...item,
          ...next,
          unit: selectedProduct?.unit ?? next.unit ?? item.unit
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
          <MetricCard icon={<Boxes />} label="主要食材" value={keyProducts} note="価格確認の対象" />
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
                <button type="button" className="text-button" onClick={addOrderItemDraft}>
                  商品を追加
                </button>
              </div>
              <div className="order-item-list">
                {orderItemDrafts.map((item, index) => (
                  <div className="order-item-row" key={item.id}>
                    <label>
                      <span>商品 {index + 1}</span>
                      <select
                        name="productName"
                        value={item.productName}
                        onChange={(event) => updateOrderItemDraft(item.id, { productName: event.target.value })}
                      >
                        {products.map((product) => (
                          <option value={product.name} key={product.name}>
                            {product.category} / {product.name}
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
                    <label>
                      <span>単位</span>
                      <input
                        name="requestedUnit"
                        value={item.unit}
                        onChange={(event) => updateOrderItemDraft(item.id, { unit: event.target.value })}
                      />
                    </label>
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
                  <button className="icon-button" aria-label={`${order.id} の詳細`}>
                    <ArrowUpRight size={18} />
                  </button>
                </article>
              ))}
            </div>
          </section>

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

            <section className="panel" id="価格推移">
              <PanelTitle title="価格アラート" subtitle={`${risingPrices} 件の値上がり注意`} />
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

        <section className="management-grid" id="マスタ管理">
          <section className="panel management-panel">
            <PanelTitle title="マスタ管理" subtitle="件数が増えるデータは一覧画面で検索・編集する前提" />
            <div className="module-grid">
              {masterModules.map((module) => (
                <article className="module-card" key={module.title}>
                  <div>
                    <strong>{module.title}</strong>
                    <p>{module.detail}</p>
                  </div>
                  <span>{module.count} 件</span>
                  <small>{module.sample}</small>
                </article>
              ))}
            </div>
          </section>

          <section className="panel compact-editor" id="商品マスタ">
            <PanelTitle title="最近の編集" subtitle="代表データだけをホームに表示" />
            <div className="compact-list">
              {products.slice(0, 5).map((product, index) => (
                <article className="compact-row" key={product.name}>
                  <div>
                    <strong>{product.name}</strong>
                    <p>{product.category} · {product.brand}</p>
                  </div>
                  <span>¥{product.referencePrice}</span>
                  <button
                    className="text-button"
                    onClick={() => setEditTarget({ type: "product", index, value: product })}
                  >
                    編集
                  </button>
                </article>
              ))}
            </div>
          </section>
        </section>

        <section className="admin-grid" id="店舗・権限">
          <section className="panel">
            <PanelTitle title="店舗・ブランド" subtitle="3-5 店舗規模の担当範囲を確認" />
            <div className="store-grid">
              {storesData.map((store) => (
                <article className="store-card" key={store.name}>
                  <Store size={18} />
                  <strong>{store.name}</strong>
                  <p>{store.brands.join(" / ")}</p>
                  <small>{store.owner}</small>
                </article>
              ))}
            </div>
            <div className="brand-strip">
              {brandsData.map((brand) => (
                <span key={brand.name}>{brand.name} · {brand.type}</span>
              ))}
            </div>
          </section>

          <section className="panel" id="権限">
            <PanelTitle title="権限スコープ" subtitle="本部、店舗、ブランド別に表示範囲を分離" />
            <div className="access-grid compact-access-grid">
              {accessProfiles.map((profile) => (
                <article className="access-card" key={profile.name}>
                  <div className="access-heading">
                    <div>
                      <strong>{profile.name}</strong>
                      <p>{profile.person}</p>
                    </div>
                    <span>{profile.visibleOrderIds.length} 件</span>
                  </div>
                  <div className="access-scope">{profile.scope}</div>
                  <p>{profile.note}</p>
                </article>
              ))}
            </div>
          </section>
        </section>

        <details className="panel data-lab">
          <summary>詳細マスタ編集を開く</summary>
          <div className="data-lab-grid">
            <section id="ブランド別利用">
              <PanelTitle title="ブランド別利用設定" subtitle="同じ食材・備品をブランド別の用途と数量で管理" />
              <div className="usage-grid">
                {productBrandUsages.map((usage, index) => (
                  <article className="usage-card" key={`${usage.product}-${usage.brand}`}>
                    <div className="usage-heading">
                      <div>
                        <strong>{usage.product}</strong>
                        <p>{usage.usage}</p>
                      </div>
                      <span>{usage.brand}</span>
                    </div>
                    <div className="usage-meta">
                      <span>標準 {usage.defaultOrderQuantity}</span>
                      <span>優先度 {usage.priority}</span>
                    </div>
                    <p>{usage.specNote}</p>
                    <button
                      className="text-button"
                      onClick={() => setEditTarget({ type: "usage", index, value: usage })}
                    >
                      編集
                    </button>
                  </article>
                ))}
              </div>
            </section>

            <section id="商品別仕入れ先">
              <PanelTitle title="商品別仕入れ先" subtitle="メイン・予備・緊急チャネル" />
              <div className="sourcing-list">
                {productSupplierOptions.map((group, groupIndex) => (
                  <article className="sourcing-card" key={group.product}>
                    <div className="sourcing-title">
                      <strong>{group.product}</strong>
                      <span>{group.options.length} チャネル</span>
                    </div>
                    <div className="supplier-option-list">
                      {group.options.map((option, optionIndex) => (
                        <div className="supplier-option" key={`${group.product}-${option.supplier}`}>
                          <span className={`source-role source-role-${option.role}`}>{option.role}</span>
                          <div>
                            <strong>{option.supplier}</strong>
                            <p>{option.note}</p>
                          </div>
                          <div className="option-meta">
                            <span>¥{option.referencePrice}</span>
                            <small>{option.minOrder} · {option.leadTime}</small>
                          </div>
                          <button
                            className="text-button"
                            onClick={() => setEditTarget({ type: "source", groupIndex, optionIndex, value: option })}
                          >
                            編集
                          </button>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section id="仕入れ先">
              <PanelTitle title="仕入れ先" subtitle="仕入れ先本体" />
              <div className="supplier-list">
                {suppliers.map((supplier, index) => (
                  <article className="supplier-row" key={supplier.name}>
                    <Truck size={18} />
                    <div>
                      <strong>{supplier.name}</strong>
                      <p>{supplier.category} · {supplier.reliability}</p>
                    </div>
                    <span className="supplier-type">{supplier.channelType}</span>
                    <button
                      className="text-button"
                      onClick={() => setEditTarget({ type: "supplier", index, value: supplier })}
                    >
                      編集
                    </button>
                  </article>
                ))}
              </div>
            </section>

            <section id="仕入れ先拠点">
              <PanelTitle title="仕入れ先拠点" subtitle="ネットショップ、実店舗、チェーン分店" />
              <div className="location-grid">
                {supplierLocations.map((location, index) => (
                  <article className="location-card" key={`${location.supplier}-${location.locationName}`}>
                    <div className="location-heading">
                      <div>
                        <strong>{location.locationName}</strong>
                        <p>{location.supplier}</p>
                      </div>
                      <span>{location.type}</span>
                    </div>
                    <dl className="location-details">
                      <div>
                        <dt>エリア</dt>
                        <dd>{location.area}</dd>
                      </div>
                      <div>
                        <dt>営業時間</dt>
                        <dd>{location.hours}</dd>
                      </div>
                      <div>
                        <dt>購入方法</dt>
                        <dd>{location.purchaseMethod}</dd>
                      </div>
                    </dl>
                    <p>{location.note}</p>
                    <button
                      className="text-button"
                      onClick={() => setEditTarget({ type: "location", index, value: location })}
                    >
                      編集
                    </button>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </details>

        <section className="workflow-band">
          {["店舗申請", "仕入れ処理", "異常報告", "配送完了", "店舗確認"].map((step, index) => (
            <div className="workflow-step" key={step}>
              <CheckCircle2 size={18} />
              <span>{index + 1}. {step}</span>
            </div>
          ))}
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
      {newOrderDraft ? (
        <CreateOrderDialog
          draft={newOrderDraft}
          stores={storesData}
          brands={brandsData}
          onChange={setNewOrderDraft}
          onClose={() => setNewOrderDraft(null)}
          onSave={saveNewOrder}
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
            <h3 id="edit-title">{getEditTitle(target.type)}</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        <div className="edit-fields">
          {fields.map((field) => (
            <label key={field.key}>
              <span>{field.label}</span>
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

function CreateOrderDialog({
  draft,
  stores,
  brands,
  onChange,
  onClose,
  onSave
}: {
  draft: NewOrderDraft;
  stores: typeof import("../lib/mock-data").stores;
  brands: typeof import("../lib/mock-data").brands;
  onChange: (draft: NewOrderDraft) => void;
  onClose: () => void;
  onSave: (draft: NewOrderDraft) => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="create-order-title">
      <form
        className="edit-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Purchase Request</p>
            <h3 id="create-order-title">仕入れ依頼を作成</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        <div className="edit-fields">
          <label>
            <span>送達店舗</span>
            <select
              value={draft.store}
              onChange={(event) => onChange({ ...draft, store: event.target.value })}
            >
              {stores.map((store) => (
                <option value={store.name} key={store.name}>{store.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>対象ブランド</span>
            <select
              value={draft.brand}
              onChange={(event) => onChange({ ...draft, brand: event.target.value })}
            >
              {brands.map((brand) => (
                <option value={brand.name} key={brand.name}>{brand.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>締切</span>
            <input
              value={draft.deadline}
              onChange={(event) => onChange({ ...draft, deadline: event.target.value })}
            />
          </label>
          <label>
            <span>商品件数</span>
            <input
              type="number"
              min={1}
              value={draft.items}
              onChange={(event) => onChange({ ...draft, items: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>優先度</span>
            <select
              value={draft.priority}
              onChange={(event) => onChange({ ...draft, priority: event.target.value })}
            >
              <option value="高">高</option>
              <option value="中">中</option>
              <option value="低">低</option>
            </select>
          </label>
          <label>
            <span>メモ</span>
            <textarea
              value={draft.note}
              onChange={(event) => onChange({ ...draft, note: event.target.value })}
              placeholder="欠品時の代替、配送希望など"
            />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="primary-button">
            作成
          </button>
        </div>
      </form>
    </div>
  );
}

function getEditTitle(type: EditTarget["type"]) {
  const titles = {
    product: "商品マスタを編集",
    usage: "ブランド別利用を編集",
    supplier: "仕入れ先を編集",
    location: "仕入れ先拠点を編集",
    source: "商品別仕入れ先を編集"
  };

  return titles[type];
}

function getFields(target: EditTarget): Array<{ key: string; label: string; type?: "number" }> {
  if (target.type === "product") {
    return [
      { key: "name", label: "商品名" },
      { key: "category", label: "カテゴリ" },
      { key: "brand", label: "ブランド" },
      { key: "unit", label: "単位" },
      { key: "referencePrice", label: "参考価格", type: "number" }
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
