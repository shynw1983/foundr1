"use client";

import { Boxes, ClipboardList, FileText, MessageSquareWarning, PackageCheck, Search, Store, Truck, LogOut, UserCog } from "lucide-react";
import { UserBadge } from "../components/UserBadge";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  orders,
  productSupplierOptions as initialProductSupplierOptions,
  products as initialProducts,
  suppliers as initialSuppliers
} from "../../../lib/mock-data";

type Product = typeof initialProducts[number] & {
  id?: string;
  packageSpec?: string;
  productBrandName?: string;
};
type ProductSupplierGroup = typeof initialProductSupplierOptions[number];
type Supplier = typeof initialSuppliers[number];
type PurchaseOrder = typeof orders[number] & {
  expectedArrivalDate?: string;
  onlineOrderStatus?: "not_started" | "online_ordered";
};
type DashboardOrderItem = {
  id?: string;
  orderId: string;
  productId?: string;
  productName: string;
  requestedQuantity: number;
  actualQuantity?: number;
  unit: string;
  purchased?: boolean;
  supplier?: string;
  note?: string;
  priceExceptionNote?: string;
  deliveryStatus?: "pending" | "in_delivery" | "delivered" | "received";
  deliveryBatchId?: string;
};
type ProcurementTaskItem = {
  id: string;
  orderId: string;
  productId?: string;
  productName: string;
  requestedQuantity: number;
  actualQuantity: number;
  unit: string;
  supplier: string;
  purchased: boolean;
  note: string;
  priceExceptionNote: string;
  deliveryStatus: "pending" | "in_delivery" | "delivered" | "received";
  deliveryBatchId?: string;
};
type DeliveryState = {
  status: "not_started" | "online_ordered";
  expectedArrivalDate: string;
};
type DeliveryBatch = {
  id: string;
  orderId: string;
  batchNo?: number;
  itemIds: string[];
  status: "in_delivery" | "delivered" | "received";
  createdLabel: string;
  storeConfirmedLabel?: string;
};

const statusTone: Record<string, string> = {
  仕入れ待ち: "tone-waiting",
  仕入れ中: "tone-active",
  一部完了: "tone-warning",
  仕入れ完了: "tone-done",
  配送待ち: "tone-confirm",
  配送中: "tone-route",
  一部配達済み: "tone-warning",
  到着日入力待ち: "tone-warning",
  到着待ち: "tone-route",
  確認待ち: "tone-confirm",
  完了: "tone-done"
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "ダッシュボード", href: "/ops#ダッシュボード", icon: ClipboardList },
  { label: "発注管理", href: "/ops/orders", icon: PackageCheck },
  { label: "仕入れ管理", href: "/ops/procurement", icon: ClipboardList },
  { label: "仕入れ履歴", href: "/ops/history", icon: FileText },
  { label: "店舗・ブランド", href: "/ops/stores", icon: Store },
  { label: "スタッフ管理", href: "/ops/staff", icon: UserCog },
  { label: "仕入れ先管理", href: "/ops/suppliers", icon: Truck },
  { label: "連絡・報告", href: "/ops#連絡・報告", icon: MessageSquareWarning },
  { label: "商品マスタ", href: "/ops/products", icon: Boxes },
  { label: "ログアウト", href: "/ops/logout", icon: LogOut }
];

function getProductPhotoSrc(photoUrl?: string) {
  if (!photoUrl) return "";
  if (photoUrl.startsWith("/api/products/photo/view")) return photoUrl;

  try {
    const url = new URL(photoUrl);
    if (url.pathname.includes("/products/")) {
      return `/api/products/photo/view?pathname=${encodeURIComponent(url.pathname.slice(1))}`;
    }
  } catch {
    return photoUrl;
  }

  return photoUrl;
}

function createProcurementTaskItems(
  purchaseOrders: PurchaseOrder[],
  productList: Product[],
  purchaseOrderItems: DashboardOrderItem[]
): ProcurementTaskItem[] {
  if (productList.length === 0) return [];

  return purchaseOrders.flatMap((order, orderIndex) => {
    const orderItems = purchaseOrderItems.filter((item) => item.orderId === order.id);

    if (orderItems.length > 0) {
      return orderItems.map((item, itemIndex) => {
        const product = productList.find((candidate) => candidate.name === item.productName);

        return {
          id: item.id ?? `${order.id}-${item.productName}-${itemIndex}`,
          orderId: order.id,
          productId: item.productId,
          productName: item.productName,
          requestedQuantity: item.requestedQuantity,
          actualQuantity: item.actualQuantity ?? item.requestedQuantity,
          unit: item.unit,
          supplier: item.supplier || product?.mainSupplier || "",
          purchased: item.purchased ?? false,
          note: item.note ?? "",
          priceExceptionNote: item.priceExceptionNote ?? "",
          deliveryStatus: item.deliveryStatus ?? "pending",
          deliveryBatchId: item.deliveryBatchId
        };
      });
    }

    if (purchaseOrderItems.length > 0) return [];

    return Array.from({ length: Math.max(1, order.items) }, (_, itemIndex) => {
      const product = productList[(orderIndex + itemIndex) % productList.length];
      const quantity = itemIndex + 1;

      return {
        id: `${order.id}-${itemIndex}`,
        orderId: order.id,
        productId: undefined,
        productName: product.name,
        requestedQuantity: quantity,
        actualQuantity: quantity,
        unit: product.unit,
        supplier: "",
        purchased: false,
        note: "",
        priceExceptionNote: "",
        deliveryStatus: "pending",
        deliveryBatchId: undefined
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

function findProcurementProduct(item: ProcurementTaskItem, productList: Product[]) {
  return productList.find((product) => product.id === item.productId)
    ?? productList.find((product) => product.name === item.productName);
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

function hasOnlineSupplier(items: ProcurementTaskItem[], supplierList: Supplier[]) {
  return items.some((item) => {
    const supplier = supplierList.find((supplierItem) => supplierItem.name === item.supplier);
    const supplierName = item.supplier.toLowerCase();

    return (
      supplier?.channelType === "ネットショップ" ||
      supplierName.includes("online") ||
      supplierName.includes("ネット") ||
      supplierName.includes("オンライン") ||
      supplierName.includes("amazon") ||
      supplierName.includes("楽天")
    );
  });
}

function getOrderStatus(
  order: PurchaseOrder,
  items: ProcurementTaskItem[],
  deliveryState: DeliveryState,
  supplierList: Supplier[]
) {
  if (items.length === 0) return order.status;

  const purchasedCount = items.filter((item) => item.purchased).length;
  const deliveredCount = items.filter((item) => item.deliveryStatus === "delivered").length;
  const deliveryCount = items.filter((item) => item.deliveryStatus === "in_delivery").length;

  const receivedCount = items.filter((item) => item.deliveryStatus === "received").length;

  if (receivedCount === items.length) return "完了";
  if (deliveredCount === items.length) return "確認待ち";
  if (deliveryCount > 0) return "配送中";
  if (deliveredCount > 0) return "一部配達済み";
  if (purchasedCount === 0) return "仕入れ待ち";
  if (purchasedCount < items.length) return "一部完了";
  if (hasOnlineSupplier(items, supplierList)) {
    if (deliveryState.status === "online_ordered" && deliveryState.expectedArrivalDate) return "到着待ち";
    return "到着日入力待ち";
  }
  if (deliveryState.status === "online_ordered" && deliveryState.expectedArrivalDate) return "到着待ち";

  return "配送待ち";
}

function getDeliveryStateForOrder(deliveryStates: Record<string, DeliveryState>, orderId: string) {
  return deliveryStates[orderId] ?? { status: "not_started", expectedArrivalDate: "" };
}

function createInitialDeliveryStates(purchaseOrders: PurchaseOrder[]) {
  return purchaseOrders.reduce<Record<string, DeliveryState>>((states, order) => {
    states[order.id] = { status: "not_started", expectedArrivalDate: "" };

    return states;
  }, {});
}

function formatExpectedArrivalDate(date: string) {
  return date ? date.replaceAll("-", "/") : "";
}

function createDeliveryBatchId(orderId: string, batchCount: number) {
  return `${orderId}-DEL-${String(batchCount + 1).padStart(2, "0")}`;
}

function getDeliveryBatchLabel(batch: DeliveryBatch) {
  if (batch.batchNo) return `${batch.orderId}-DEL-${String(batch.batchNo).padStart(2, "0")}`;

  return batch.id;
}

async function saveProcurementTaskItem(item: ProcurementTaskItem) {
  const response = await fetch("/api/procurement/items", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      itemId: item.id,
      purchased: item.purchased,
      actualQuantity: item.actualQuantity,
      note: item.note,
      priceExceptionNote: item.priceExceptionNote,
      supplier: item.supplier
    })
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? "仕入れ明細を保存できませんでした。");
  }
}

async function saveOrderDeliveryState(orderId: string, state: DeliveryState) {
  const response = await fetch("/api/procurement/orders", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderId,
      expectedArrivalDate: state.expectedArrivalDate,
      onlineOrderStatus: state.status
    })
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? "到着予定日を保存できませんでした。");
  }
}

export default function ProcurementPage() {
  const { notice, showNotice, clearNotice } = useActionNotice();
  const [products, setProducts] = useState<Product[]>([]);
  const [productSupplierOptions, setProductSupplierOptions] = useState<ProductSupplierGroup[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [purchaseOrderItems, setPurchaseOrderItems] = useState<DashboardOrderItem[]>([]);
  const [dataSource, setDataSource] = useState<"loading" | "neon">("loading");
  const [activeExceptionItemId, setActiveExceptionItemId] = useState<string | null>(null);
  const [procurementTaskItems, setProcurementTaskItems] = useState<ProcurementTaskItem[]>([]);
  const [deliveryStates, setDeliveryStates] = useState<Record<string, DeliveryState>>({});
  const [deliveryBatches, setDeliveryBatches] = useState<DeliveryBatch[]>([]);
  const [focusedOrderId, setFocusedOrderId] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    async function loadDashboardData() {
      const response = await fetch("/api/dashboard");
      if (!response.ok) return;

      const data = await response.json() as {
        products?: Product[];
        productSupplierOptions?: ProductSupplierGroup[];
        suppliers?: Supplier[];
        orders?: PurchaseOrder[];
        purchaseOrderItems?: DashboardOrderItem[];
        deliveryBatches?: DeliveryBatch[];
      };

      if (data.products) setProducts(data.products);
      if (data.productSupplierOptions) setProductSupplierOptions(data.productSupplierOptions);
      if (data.suppliers) setSuppliers(data.suppliers);
      if (data.orders && data.purchaseOrderItems) {
        const orderIdsWithItems = new Set(data.purchaseOrderItems.map((item) => item.orderId));
        setPurchaseOrders(data.orders.filter((order) => orderIdsWithItems.has(order.id)));
      } else if (data.orders) {
        setPurchaseOrders(data.orders);
      }
      if (data.purchaseOrderItems) setPurchaseOrderItems(data.purchaseOrderItems);
      if (data.deliveryBatches) setDeliveryBatches(data.deliveryBatches);
      setDataSource("neon");
    }

    void loadDashboardData();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFocusedOrderId(params.get("order") ?? "");
  }, []);

  useEffect(() => {
    setProcurementTaskItems((items) => {
      const existingItems = new Map(items.map((item) => [item.id, item]));

      return createProcurementTaskItems(purchaseOrders, products, purchaseOrderItems).map(
        (item) => existingItems.get(item.id) ?? item
      );
    });
  }, [purchaseOrders, products, purchaseOrderItems]);

  useEffect(() => {
    setDeliveryStates((states) => {
      const nextStates = { ...states };

      purchaseOrders.forEach((order) => {
        nextStates[order.id] = nextStates[order.id] ?? {
          status: order.onlineOrderStatus ?? "not_started",
          expectedArrivalDate: order.expectedArrivalDate ?? ""
        };
      });

      return nextStates;
    });
  }, [purchaseOrders]);

  function updateProcurementTaskItem(id: string, next: Partial<ProcurementTaskItem>) {
    let updatedItem: ProcurementTaskItem | null = null;

    setProcurementTaskItems((items) =>
      items.map((item) => {
        if (item.id !== id) return item;

        updatedItem = { ...item, ...next };
        return updatedItem;
      })
    );

    queueMicrotask(() => {
      if (updatedItem) {
        void saveProcurementTaskItem(updatedItem).catch(() => {
          window.alert("保存できませんでした。画面を再読み込みして最新状態を確認してください。");
        });
      }
    });
  }

  function updateDeliveryState(orderId: string, next: Partial<DeliveryState>) {
    let nextState: DeliveryState | null = null;

    setDeliveryStates((states) => ({
      ...states,
      [orderId]: (nextState = { ...getDeliveryStateForOrder(states, orderId), ...next })
    }));

    queueMicrotask(() => {
      if (!nextState) return;

      void saveOrderDeliveryState(orderId, nextState).catch((error: Error) => {
        window.alert(error.message);
      });
    });
  }

  function createDeliveryBatch(orderId: string) {
    const readyItems = procurementTaskItems.filter(
      (item) => item.orderId === orderId && item.purchased && item.deliveryStatus === "pending"
    );

    if (readyItems.length === 0) return;

    const batchId = createDeliveryBatchId(orderId, deliveryBatches.filter((batch) => batch.orderId === orderId).length);
    const batchNo = deliveryBatches.filter((batch) => batch.orderId === orderId).length + 1;
    const createdLabel = new Intl.DateTimeFormat("ja-JP", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date());

    setDeliveryBatches((batches) => [
      ...batches,
      {
        id: batchId,
        orderId,
        batchNo,
        itemIds: readyItems.map((item) => item.id),
        status: "in_delivery",
        createdLabel
      }
    ]);
    setProcurementTaskItems((items) =>
      items.map((item) =>
        readyItems.some((readyItem) => readyItem.id === item.id)
          ? { ...item, deliveryStatus: "in_delivery", deliveryBatchId: batchId }
          : item
      )
    );

    void fetch("/api/procurement/delivery-batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        itemIds: readyItems.map((item) => item.id)
      })
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((savedBatch: DeliveryBatch | null) => {
        if (!savedBatch) return;

        setDeliveryBatches((batches) =>
          batches.map((batch) =>
            batch.id === batchId
              ? {
                  ...savedBatch,
                  itemIds: readyItems.map((item) => item.id)
                }
              : batch
          )
        );
        setProcurementTaskItems((items) =>
          items.map((item) =>
            item.deliveryBatchId === batchId ? { ...item, deliveryBatchId: savedBatch.id } : item
          )
        );
      })
      .catch(() => {
        window.alert("配送状態を保存できませんでした。画面を再読み込みして最新状態を確認してください。");
      });
    showNotice("購入済み分を配送中にしました。");
  }

  function markDeliveryBatchStatus(batchId: string, status: "delivered" | "received") {
    setDeliveryBatches((batches) =>
      batches.map((batch) => (batch.id === batchId ? { ...batch, status } : batch))
    );
    setProcurementTaskItems((items) =>
      items.map((item) => (item.deliveryBatchId === batchId ? { ...item, deliveryStatus: status === "received" ? "received" : "delivered" } : item))
    );

    void fetch("/api/procurement/delivery-batches", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batchId,
        status
      })
    }).catch(() => {
      window.alert("配送状態を保存できませんでした。画面を再読み込みして最新状態を確認してください。");
    });
    showNotice(status === "received" ? "店舗確認済みにしました。" : "配送を完了にしました。");
  }

  const activeExceptionItem = procurementTaskItems.find((item) => item.id === activeExceptionItemId) ?? null;
  const normalizedQuery = query.trim().toLowerCase();
  const displayedPurchaseOrders = (focusedOrderId
    ? purchaseOrders.filter((order) => order.id === focusedOrderId)
    : purchaseOrders).filter((order) => {
      if (!normalizedQuery) return true;

      const orderItems = procurementTaskItems.filter((item) => item.orderId === order.id);
      return [
        order.id,
        order.store,
        order.brand,
        order.priority,
        ...orderItems.flatMap((item) => [item.productName, item.supplier, item.note, item.priceExceptionNote])
      ].join(" ").toLowerCase().includes(normalizedQuery);
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
        <MobileNavMenu navItems={navItems} />
        <div className="sidebar-user">
          <UserBadge />
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
            <h2>仕入れ管理</h2>
            <span className="source-indicator">{dataSource === "neon" ? "Neon 接続済み" : "読み込み中"}</span>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input
                value={query}
                placeholder="注文番号・商品・仕入れ先を検索"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <a className="primary-button" href="/ops/orders">
              発注管理を見る
            </a>
          </div>
        </header>

        <section className="panel procurement-panel">
          <PanelTitle
            title={focusedOrderId ? `${focusedOrderId} の仕入れ管理` : "仕入れ管理"}
            subtitle={focusedOrderId ? "選択した依頼だけを表示" : "仕入れ先ごとに購入済み、数量差異、備考、価格異常を記録"}
          />
          {focusedOrderId ? (
            <div className="focused-order-bar">
              <span>注文番号 {focusedOrderId}</span>
              <a className="text-button" href="/ops/procurement">全体を見る</a>
            </div>
          ) : null}
          <div className="procurement-order-list">
            {displayedPurchaseOrders.map((order) => {
              const items = procurementTaskItems.filter((item) => item.orderId === order.id);
              const supplierGroups = groupTasksBySupplier(items, products, productSupplierOptions);
              const completedCount = items.filter((item) => item.purchased).length;
              const deliveredCount = items.filter((item) => item.deliveryStatus === "delivered").length;
              const receivedCount = items.filter((item) => item.deliveryStatus === "received").length;
              const inDeliveryCount = items.filter((item) => item.deliveryStatus === "in_delivery").length;
              const readyToDeliverCount = items.filter((item) => item.purchased && item.deliveryStatus === "pending").length;
              const deliveryState = getDeliveryStateForOrder(deliveryStates, order.id);
              const orderDeliveryBatches = deliveryBatches.filter((batch) => batch.orderId === order.id);
              const liveStatus = getOrderStatus(order, items, deliveryState, suppliers);
              const hasPurchasedItems = completedCount > 0;
              const isOnlineOrder = hasOnlineSupplier(items, suppliers);

              return (
                <article className="procurement-order-card" key={order.id}>
                  <div className="procurement-order-heading">
                    <div>
                      <div className="row-heading">
                        <strong>{order.id}</strong>
                        <span className={`status-pill ${statusTone[liveStatus]}`}>{liveStatus}</span>
                      </div>
                      <p>{order.store} / {order.brand}</p>
                    </div>
                    <span>{completedCount} / {items.length} 完了</span>
                  </div>
                  <OrderFulfillmentPanel
                    isOnlineOrder={isOnlineOrder}
                    hasPurchasedItems={hasPurchasedItems}
                    purchasedCount={completedCount}
                    deliveredCount={deliveredCount}
                    receivedCount={receivedCount}
                    inDeliveryCount={inDeliveryCount}
                    readyToDeliverCount={readyToDeliverCount}
                    totalCount={items.length}
                    state={deliveryState}
                    onChange={(next) => updateDeliveryState(order.id, next)}
                    batches={orderDeliveryBatches}
                    onCreateBatch={() => createDeliveryBatch(order.id)}
                    onMarkStatus={markDeliveryBatchStatus}
                  />
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
                              const product = findProcurementProduct(item, products);
                              const photoSrc = getProductPhotoSrc(product?.photoUrl);
                              const productSpec = product?.packageSpec || product?.specNote;

                              return (
                                <div className={item.purchased ? "procurement-task is-complete" : "procurement-task"} key={item.id}>
                                  <label className="task-check">
                                    <input
                                      type="checkbox"
                                      checked={item.purchased}
                                      onChange={(event) =>
                                        updateProcurementTaskItem(item.id, {
                                          purchased: event.target.checked,
                                          deliveryStatus: event.target.checked ? item.deliveryStatus : "pending",
                                          deliveryBatchId: event.target.checked ? item.deliveryBatchId : undefined
                                        })
                                      }
                                    />
                                    <span>{item.purchased ? "購入済み" : "未購入"}</span>
                                  </label>
                                  <span className="task-product-photo">
                                    {photoSrc ? (
                                      <img src={photoSrc} alt={`${item.productName} の写真`} />
                                    ) : (
                                      <span>写真</span>
                                    )}
                                  </span>
                                  <div className="task-product">
                                    <div className="task-product-line">
                                      <strong>{item.productName}</strong>
                                      {item.deliveryStatus === "in_delivery" ? <span>配送中</span> : null}
                                      {item.deliveryStatus === "delivered" ? <span>配達済み</span> : null}
                                      {item.deliveryStatus === "received" ? <span>店舗確認済み</span> : null}
                                    </div>
                                    {productSpec ? <small>{productSpec}</small> : null}
                                    <small>依頼 {item.requestedQuantity} {item.unit}</small>
                                  </div>
                                  <label>
                                    <span>仕入れ先</span>
                                    <select
                                      value={item.supplier || getProcurementSupplier(item.productName, products, productSupplierOptions)}
                                      onChange={(event) => updateProcurementTaskItem(item.id, { supplier: event.target.value })}
                                    >
                                      {suppliers.map((supplier) => (
                                        <option value={supplier.name} key={supplier.name}>{supplier.name}</option>
                                      ))}
                                    </select>
                                  </label>
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
            {focusedOrderId && displayedPurchaseOrders.length === 0 ? (
              <div className="empty-state">対象の仕入れ依頼が見つかりません</div>
            ) : null}
          </div>
        </section>

        <section className="panel" id="連絡・報告">
          <PanelTitle title="現場連絡" subtitle="欠品や代替品の連絡を確認" />
          <div className="stack">
            <div className="empty-state">現場連絡はありません</div>
          </div>
        </section>
      </section>
      {activeExceptionItem ? (
        <ExceptionReportDialog
          item={activeExceptionItem}
          onChange={(next) => updateProcurementTaskItem(activeExceptionItem.id, next)}
          onClose={() => setActiveExceptionItemId(null)}
          onSaved={() => showNotice("異常報告を保存しました。")}
        />
      ) : null}
      <ActionNotice notice={notice} onClose={clearNotice} />
    </main>
  );
}

function OrderFulfillmentPanel({
  isOnlineOrder,
  hasPurchasedItems,
  purchasedCount,
  deliveredCount,
  receivedCount,
  inDeliveryCount,
  readyToDeliverCount,
  totalCount,
  state,
  onChange,
  batches,
  onCreateBatch,
  onMarkStatus
}: {
  isOnlineOrder: boolean;
  hasPurchasedItems: boolean;
  purchasedCount: number;
  deliveredCount: number;
  receivedCount: number;
  inDeliveryCount: number;
  readyToDeliverCount: number;
  totalCount: number;
  state: DeliveryState;
  onChange: (next: Partial<DeliveryState>) => void;
  batches: DeliveryBatch[];
  onCreateBatch: () => void;
  onMarkStatus: (batchId: string, status: "delivered" | "received") => void;
}) {
  const expectedArrivalLabel = formatExpectedArrivalDate(state.expectedArrivalDate);

  return (
    <div className={hasPurchasedItems ? "fulfillment-panel is-ready" : "fulfillment-panel"}>
      <div>
        <span>{isOnlineOrder ? "ネット注文" : "納品フロー"}</span>
        <strong>
          {isOnlineOrder
            ? expectedArrivalLabel
              ? `到着予定 ${expectedArrivalLabel}`
              : "発注後に到着予定日を入力"
            : receivedCount === totalCount
              ? "店舗確認済み"
              : deliveredCount === totalCount
                ? "店舗確認待ち"
              : inDeliveryCount > 0
                ? "配送中"
                : readyToDeliverCount > 0
                  ? "配送待ち"
                  : "仕入れ完了後に配送へ"}
        </strong>
        <div className="fulfillment-metrics">
          <span>購入 {purchasedCount} / {totalCount}</span>
          <span>配送中 {inDeliveryCount}</span>
          <span>配達済み {deliveredCount}</span>
          <span>店舗確認 {receivedCount}</span>
        </div>
      </div>
      {isOnlineOrder ? (
        <div className="fulfillment-actions">
          <label>
            <span>到着予定日</span>
            <input
              type="date"
              value={state.expectedArrivalDate}
              disabled={!hasPurchasedItems}
              onChange={(event) =>
                onChange({ expectedArrivalDate: event.target.value, status: event.target.value ? "online_ordered" : "not_started" })
              }
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={!hasPurchasedItems || !state.expectedArrivalDate}
            onClick={() => onChange({ status: "online_ordered" })}
          >
            発注済み
          </button>
        </div>
      ) : (
        <div className="fulfillment-delivery-area">
          <div className="fulfillment-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={readyToDeliverCount === 0}
              onClick={onCreateBatch}
            >
              購入済み分を配送
            </button>
          </div>
          {batches.length > 0 ? (
            <div className="delivery-batch-list">
              {batches.map((batch) => (
                <div className="delivery-batch-row" key={batch.id}>
                  <div>
                    <strong>{getDeliveryBatchLabel(batch)}</strong>
                    <span>
                      {batch.createdLabel} · {batch.itemIds.length} 件 · {
                        batch.status === "received"
                          ? `店舗確認済み${batch.storeConfirmedLabel ? ` ${batch.storeConfirmedLabel}` : ""}`
                          : batch.status === "delivered"
                            ? "配達済み"
                            : "配送中"
                      }
                    </span>
                  </div>
                  <button
                    type="button"
                    className="delivery-complete-button"
                    disabled={batch.status !== "in_delivery"}
                    onClick={() => onMarkStatus(batch.id, "delivered")}
                  >
                    {batch.status === "in_delivery" ? "配達完了にする" : "配達済み"}
                  </button>
                  <button
                    type="button"
                    className="delivery-complete-button"
                    disabled={batch.status !== "delivered"}
                    onClick={() => onMarkStatus(batch.id, "received")}
                  >
                    {batch.status === "received" ? "店舗確認済み" : "店舗確認済みにする"}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ExceptionReportDialog({
  item,
  onChange,
  onClose,
  onSaved
}: {
  item: ProcurementTaskItem;
  onChange: (next: Partial<ProcurementTaskItem>) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const quantityDiff = item.actualQuantity - item.requestedQuantity;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="exception-report-title">
      <form
        className="edit-modal exception-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSaved();
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
