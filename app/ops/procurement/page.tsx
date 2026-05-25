"use client";

import { Boxes, ClipboardList, FileText, MessageSquareWarning, PackageCheck, Search, Store, Truck, LogOut, UserCog } from "lucide-react";
import { UserBadge } from "../components/UserBadge";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OpsNavList } from "../components/OpsNavList";
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
  deadlineAt?: string | null;
  expectedArrivalDate?: string;
  onlineOrderStatus?: "not_started" | "online_ordered";
  requesterName?: string;
  buyerName?: string;
};
type DashboardOrderItem = {
  id?: string;
  orderId: string;
  productId?: string;
  productName: string;
  requestedQuantity: number;
  actualQuantity?: number;
  actualPrice?: string;
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
  actualPrice: string;
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
type SupplierChoice = {
  supplier: string;
  role: string;
};
type ProcurementStatusFilter = "未完了" | "購入待ち" | "一部購入済み" | "到着日入力待ち" | "到着待ち" | "配送待ち" | "配送中" | "一部納品済み" | "確認待ち" | "完了" | "すべて";

const statusTone: Record<string, string> = {
  購入待ち: "tone-waiting",
  一部購入済み: "tone-warning",
  購入完了: "tone-done",
  配送待ち: "tone-confirm",
  配送中: "tone-route",
  一部納品済み: "tone-warning",
  到着日入力待ち: "tone-warning",
  到着待ち: "tone-route",
  確認待ち: "tone-confirm",
  完了: "tone-done"
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
const procurementStatusFilters: ProcurementStatusFilter[] = ["未完了", "購入待ち", "一部購入済み", "到着日入力待ち", "到着待ち", "配送待ち", "配送中", "一部納品済み", "確認待ち", "完了", "すべて"];
const actualQuantityOptions = Array.from({ length: 1000 }, (_, index) => index);

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
          actualPrice: item.actualPrice ?? "",
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
        actualPrice: "",
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

function normalizeSupplierName(value?: string) {
  const supplier = String(value ?? "").trim();
  if (!supplier || supplier === "無" || supplier === "未設定") return "";

  return supplier;
}

function getSupplierChoicesForItem(
  item: ProcurementTaskItem,
  product: Product | undefined,
  supplierOptions: ProductSupplierGroup[]
): SupplierChoice[] {
  const choices = new Map<string, SupplierChoice>();
  const addChoice = (supplier: string | undefined, role: string) => {
    const normalizedSupplier = normalizeSupplierName(supplier);
    if (!normalizedSupplier || choices.has(normalizedSupplier)) return;
    choices.set(normalizedSupplier, { supplier: normalizedSupplier, role });
  };

  addChoice(product?.mainSupplier, "メイン発注先");
  addChoice(product?.backupSupplier, "予備発注先");
  supplierOptions
    .find((group) => group.product === item.productName)
    ?.options.forEach((option) => addChoice(option.supplier, option.role));
  addChoice(item.supplier, "現在");

  return Array.from(choices.values());
}

function getTemporarySupplierNote(note: string) {
  return note.split(/\r?\n/)
    .find((line) => line.startsWith("臨時購入先:"))
    ?.replace(/^臨時購入先:/, "")
    .trim() ?? "";
}

function setTemporarySupplierNote(note: string, temporarySupplier: string) {
  const nextNote = note
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("臨時購入先:"))
    .join("\n")
    .trim();
  const normalizedSupplier = temporarySupplier.trim();

  return [nextNote, normalizedSupplier ? `臨時購入先: ${normalizedSupplier}` : ""].filter(Boolean).join("\n");
}

function formatSupplierRole(role: string) {
  if (role === "メイン") return "メイン発注先";
  if (role === "予備") return "予備発注先";

  return role;
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

function hasDeliveryOrderSupplier(items: ProcurementTaskItem[], supplierList: Supplier[]) {
  return items.some((item) => {
    const supplier = supplierList.find((supplierItem) => supplierItem.name === item.supplier);
    const supplierName = item.supplier.toLowerCase();

    return (
      supplier?.channelType === "ネットショップ" ||
      supplier?.channelType === "卸売" ||
      supplierName.includes("online") ||
      supplierName.includes("ネット") ||
      supplierName.includes("オンライン") ||
      supplierName.includes("卸") ||
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
  if (deliveredCount > 0) return "一部納品済み";
  if (purchasedCount === 0) return "購入待ち";
  if (purchasedCount < items.length) return "一部購入済み";
  if (hasDeliveryOrderSupplier(items, supplierList)) {
    if (deliveryState.status === "online_ordered" && deliveryState.expectedArrivalDate) return "到着待ち";
    return "到着日入力待ち";
  }
  if (deliveryState.status === "online_ordered" && deliveryState.expectedArrivalDate) return "到着待ち";

  return "配送待ち";
}

function getDeliveryStateForOrder(deliveryStates: Record<string, DeliveryState>, orderId: string) {
  return deliveryStates[orderId] ?? { status: "not_started", expectedArrivalDate: "" };
}

function getOrderDeadlineSortValue(order: PurchaseOrder) {
  if (order.deadlineAt) {
    const time = new Date(order.deadlineAt).getTime();
    if (Number.isFinite(time)) return time;
  }

  return Number.POSITIVE_INFINITY;
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
      actualPrice: item.actualPrice,
      note: item.note,
      supplier: item.supplier,
      deliveryStatus: item.deliveryStatus
    })
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? "発注明細を保存できませんでした。");
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
  const [statusFilter, setStatusFilter] = useState<ProcurementStatusFilter>("未完了");

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

  function updateDeliveryState(orderId: string, next: Partial<DeliveryState>, successMessage?: string) {
    let nextState: DeliveryState | null = null;

    setDeliveryStates((states) => ({
      ...states,
      [orderId]: (nextState = { ...getDeliveryStateForOrder(states, orderId), ...next })
    }));

    queueMicrotask(() => {
      if (!nextState) return;

      void saveOrderDeliveryState(orderId, nextState)
        .then(() => {
          if (successMessage) showNotice(successMessage);
        })
        .catch((error: Error) => {
          window.alert(error.message);
        });
    });
  }

  function confirmOnlineOrder(orderId: string) {
    const currentState = getDeliveryStateForOrder(deliveryStates, orderId);

    if (!currentState.expectedArrivalDate) {
      window.alert("到着予定日を入力してください。");
      return;
    }

    updateDeliveryState(orderId, { status: "online_ordered" }, "配送発注を発注済みにしました。");
  }

  function markOnlineOrderArrived(orderId: string) {
    const currentState = getDeliveryStateForOrder(deliveryStates, orderId);

    if (currentState.status !== "online_ordered") {
      window.alert("先に発注済みにしてください。");
      return;
    }

    const targetItems = procurementTaskItems
      .filter((item) => item.orderId === orderId && item.purchased && item.deliveryStatus !== "received")
      .map((item) => ({ ...item, deliveryStatus: "delivered" as const }));

    if (targetItems.length === 0) return;

    setProcurementTaskItems((items) =>
      items.map((item) => {
        const nextItem = targetItems.find((target) => target.id === item.id);
        return nextItem ?? item;
      })
    );

    void Promise.all(targetItems.map((item) => saveProcurementTaskItem(item)))
      .then(() => showNotice("配送発注を納品済みにしました。"))
      .catch(() => {
        window.alert("到着状態を保存できませんでした。画面を再読み込みして最新状態を確認してください。");
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
    showNotice(status === "received" ? "店舗確認済みにしました。" : "納品済みにしました。");
  }

  const activeExceptionItem = procurementTaskItems.find((item) => item.id === activeExceptionItemId) ?? null;
  const normalizedQuery = query.trim().toLowerCase();
  const purchaseOrdersWithStatus = purchaseOrders.map((order) => {
    const items = procurementTaskItems.filter((item) => item.orderId === order.id);
    const deliveryState = getDeliveryStateForOrder(deliveryStates, order.id);
    const liveStatus = getOrderStatus(order, items, deliveryState, suppliers);

    return {
      order,
      items,
      deliveryState,
      liveStatus
    };
  });
  const statusFilterCounts = procurementStatusFilters.reduce<Record<ProcurementStatusFilter, number>>((counts, filter) => {
    counts[filter] = purchaseOrdersWithStatus.filter(({ liveStatus }) => {
      if (filter === "すべて") return true;
      if (filter === "未完了") return liveStatus !== "完了";

      return liveStatus === filter;
    }).length;

    return counts;
  }, {} as Record<ProcurementStatusFilter, number>);
  const displayedPurchaseOrders = purchaseOrdersWithStatus
    .filter(({ order }) => !focusedOrderId || order.id === focusedOrderId)
    .filter(({ liveStatus }) => {
      if (focusedOrderId) return true;
      if (statusFilter === "すべて") return true;
      if (statusFilter === "未完了") return liveStatus !== "完了";

      return liveStatus === statusFilter;
    })
    .filter(({ order, items }) => {
      if (!normalizedQuery) return true;

      return [
        order.id,
        order.store,
        order.brand,
        order.priority,
        ...items.flatMap((item) => [item.productName, item.supplier, item.note, item.priceExceptionNote, item.actualPrice])
      ].join(" ").toLowerCase().includes(normalizedQuery);
    })
    .sort((left, right) => getOrderDeadlineSortValue(left.order) - getOrderDeadlineSortValue(right.order));

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
            <p className="eyebrow">現場の発注実行</p>
            <h2>発注管理</h2>
            <span className="source-indicator">{dataSource === "neon" ? "Neon 接続済み" : "読み込み中"}</span>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input
                value={query}
                placeholder="依頼番号・商品・発注先を検索"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <a className="primary-button" href="/ops/orders">
              発注依頼を見る
            </a>
          </div>
        </header>

        <section className="panel procurement-panel">
          <PanelTitle
            title={focusedOrderId ? `${focusedOrderId} の発注管理` : "発注管理"}
            subtitle={focusedOrderId ? "選択した依頼だけを表示" : "発注先ごとに購入済み、数量差異、備考、価格異常を記録"}
          />
          {focusedOrderId ? (
            <div className="focused-order-bar">
              <span>依頼番号 {focusedOrderId}</span>
              <a className="text-button" href="/ops/procurement">全体を見る</a>
            </div>
          ) : null}
          {!focusedOrderId ? (
            <div className="queue-filter-bar" aria-label="発注管理ステータスフィルター">
              {procurementStatusFilters.map((filter) => (
                <button
                  type="button"
                  className={statusFilter === filter ? "queue-filter is-active" : "queue-filter"}
                  onClick={() => setStatusFilter(filter)}
                  key={filter}
                >
                  <span>{filter}</span>
                  <strong>{statusFilterCounts[filter]}</strong>
                </button>
              ))}
            </div>
          ) : null}
          <div className="procurement-order-list">
            {displayedPurchaseOrders.map(({ order, items, deliveryState, liveStatus }) => {
              const supplierGroups = groupTasksBySupplier(items, products, productSupplierOptions);
              const completedCount = items.filter((item) => item.purchased).length;
              const deliveredCount = items.filter((item) => item.deliveryStatus === "delivered").length;
              const receivedCount = items.filter((item) => item.deliveryStatus === "received").length;
              const inDeliveryCount = items.filter((item) => item.deliveryStatus === "in_delivery").length;
              const readyToDeliverCount = items.filter((item) => item.purchased && item.deliveryStatus === "pending").length;
              const orderDeliveryBatches = deliveryBatches.filter((batch) => batch.orderId === order.id);
              const hasPurchasedItems = completedCount > 0;
              const isOnlineOrder = hasDeliveryOrderSupplier(items, suppliers);
              const estimatedAmount = calculateProcurementOrderEstimatedAmount(items, products);

              return (
                <article className="procurement-order-card" key={order.id}>
                  <div className="procurement-order-heading">
                    <div>
                      <div className="row-heading">
                        <strong>{order.id}</strong>
                      <span className={`status-pill ${statusTone[liveStatus]}`}>{liveStatus === "確認待ち" ? "店舗確認待ち" : liveStatus}</span>
                      </div>
                      <p>{order.store} / {order.brand}{order.buyerName ? ` · 購入担当 ${order.buyerName}` : ""}</p>
                    </div>
                    <div className="procurement-order-summary">
                      <span>概算 {formatEstimatedAmount(estimatedAmount)}</span>
                      <span>{completedCount} / {items.length} 購入済み</span>
                    </div>
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
                    onConfirmOnlineOrder={() => confirmOnlineOrder(order.id)}
                    onMarkOnlineArrived={() => markOnlineOrderArrived(order.id)}
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
                              <span>発注先</span>
                              <strong>{group.supplier}</strong>
                            </div>
                            <small>{supplierCompletedCount} / {group.items.length} 購入済み</small>
                          </div>
                          <div className="procurement-task-list">
                            {group.items.map((item) => {
                              const quantityDiff = item.actualQuantity - item.requestedQuantity;
                              const product = findProcurementProduct(item, products);
                              const photoSrc = getProductPhotoSrc(product?.photoUrl);
                              const productSpec = product?.packageSpec || product?.specNote;
                              const referencePrice = Number(product?.referencePrice ?? 0);
                              const temporarySupplierNote = getTemporarySupplierNote(item.note);

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
                                      {item.deliveryStatus === "delivered" ? <span>納品済み</span> : null}
                                      {item.deliveryStatus === "received" ? <span>店舗確認済み</span> : null}
                                      {temporarySupplierNote ? <span>臨時購入先 {temporarySupplierNote}</span> : null}
                                    </div>
                                    {productSpec ? <small>{productSpec}</small> : null}
                                    <small>依頼 {item.requestedQuantity} {item.unit}</small>
                                    <small>
                                      参考価格 {referencePrice > 0 ? `${formatEstimatedAmount(referencePrice)} / ${item.unit}` : "未設定"}
                                    </small>
                                  </div>
                                  <label className="task-actual">
                                    <span>実数</span>
                                    <select
                                      value={item.actualQuantity}
                                      onChange={(event) =>
                                        updateProcurementTaskItem(item.id, { actualQuantity: Number(event.target.value) })
                                      }
                                    >
                                      {actualQuantityOptions.map((quantity) => (
                                        <option value={quantity} key={quantity}>{quantity}</option>
                                      ))}
                                    </select>
                                  </label>
                                  <div className={quantityDiff === 0 ? "quantity-diff" : "quantity-diff has-diff"}>
                                    {quantityDiff === 0 ? "差異なし" : `${quantityDiff > 0 ? "+" : ""}${quantityDiff} ${item.unit}`}
                                  </div>
                                  <button
                                    type="button"
                                    className={item.note || item.actualPrice ? "exception-button has-report" : "exception-button"}
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
            {displayedPurchaseOrders.length === 0 ? (
              <div className="empty-state">
                {focusedOrderId ? "対象の発注依頼が見つかりません" : "表示できる発注依頼はありません"}
              </div>
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
          choices={getSupplierChoicesForItem(activeExceptionItem, findProcurementProduct(activeExceptionItem, products), productSupplierOptions)}
          plannedSupplier={getProcurementSupplier(activeExceptionItem.productName, products, productSupplierOptions)}
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
  onConfirmOnlineOrder,
  onMarkOnlineArrived,
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
  onConfirmOnlineOrder: () => void;
  onMarkOnlineArrived: () => void;
  batches: DeliveryBatch[];
  onCreateBatch: () => void;
  onMarkStatus: (batchId: string, status: "delivered" | "received") => void;
}) {
  const expectedArrivalLabel = formatExpectedArrivalDate(state.expectedArrivalDate);
  const isOnlineOrdered = state.status === "online_ordered" && Boolean(state.expectedArrivalDate);
  const onlineArrived = isOnlineOrder && deliveredCount + receivedCount >= totalCount;

  return (
    <div className={hasPurchasedItems ? "fulfillment-panel is-ready" : "fulfillment-panel"}>
      <div>
        <span>{isOnlineOrder ? "配送発注" : "配送フロー"}</span>
        <strong>
          {isOnlineOrder
            ? receivedCount === totalCount
              ? "店舗確認済み"
              : deliveredCount === totalCount
                ? "店舗確認待ち"
                : isOnlineOrdered && expectedArrivalLabel
                  ? `到着予定 ${expectedArrivalLabel}`
                  : state.expectedArrivalDate
                    ? "到着予定日を確認して発注済みにする"
                    : "発注先へ発注後に到着予定日を入力"
            : receivedCount === totalCount
              ? "店舗確認済み"
              : deliveredCount === totalCount
                ? "店舗確認待ち"
              : inDeliveryCount > 0
                ? "配送中"
                : readyToDeliverCount > 0
                  ? "配送待ち"
                  : "購入完了後に配送へ"}
        </strong>
        <div className="fulfillment-metrics">
          <span>購入 {purchasedCount} / {totalCount}</span>
          <span>配送中 {inDeliveryCount}</span>
          <span>納品済み {deliveredCount}</span>
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
                onChange({
                  expectedArrivalDate: event.target.value,
                  ...(event.target.value ? {} : { status: "not_started" as const })
                })
              }
            />
          </label>
          <button
            type="button"
            className={isOnlineOrdered ? "secondary-button is-complete" : "secondary-button"}
            disabled={!hasPurchasedItems || !state.expectedArrivalDate || isOnlineOrdered}
            onClick={onConfirmOnlineOrder}
          >
            {isOnlineOrdered ? "発注済み" : "発注済みにする"}
          </button>
          <button
            type="button"
            className={onlineArrived ? "secondary-button is-complete" : "secondary-button"}
            disabled={!isOnlineOrdered || onlineArrived}
            onClick={onMarkOnlineArrived}
          >
            {onlineArrived ? "納品済み" : "到着済みにする"}
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
                  <div className="delivery-batch-info">
                    <strong>{getDeliveryBatchLabel(batch)}</strong>
                    <span>
                      {batch.createdLabel} · {batch.itemIds.length} 件 · {
                        batch.status === "received"
                          ? `店舗確認済み${batch.storeConfirmedLabel ? ` ${batch.storeConfirmedLabel}` : ""}`
                          : batch.status === "delivered"
                            ? "納品済み"
                            : "配送中"
                      }
                    </span>
                  </div>
                  <div className="delivery-batch-actions">
                    <button
                      type="button"
                      className="delivery-complete-button"
                      disabled={batch.status !== "in_delivery"}
                      onClick={() => onMarkStatus(batch.id, "delivered")}
                    >
                      {batch.status === "in_delivery" ? "納品済みにする" : "納品済み"}
                    </button>
                  </div>
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
  choices,
  plannedSupplier,
  onChange,
  onClose,
  onSaved
}: {
  item: ProcurementTaskItem;
  choices: SupplierChoice[];
  plannedSupplier: string;
  onChange: (next: Partial<ProcurementTaskItem>) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const quantityDiff = item.actualQuantity - item.requestedQuantity;
  const [temporarySupplier, setTemporarySupplier] = useState(getTemporarySupplierNote(item.note));
  const currentSupplier = item.supplier || plannedSupplier;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="exception-report-title">
      <form
        className="edit-modal exception-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onChange({ note: setTemporarySupplierNote(item.note, temporarySupplier) });
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
          <span>実際の購入先 {currentSupplier}</span>
          <span className={quantityDiff === 0 ? "quantity-diff" : "quantity-diff has-diff"}>
            {quantityDiff === 0 ? "差異なし" : `${quantityDiff > 0 ? "+" : ""}${quantityDiff} ${item.unit}`}
          </span>
        </div>
        <div className="edit-fields">
          <label>
            <span>購入先変更</span>
            <div className="supplier-choice-list">
              {choices.map((choice) => (
                <button
                  type="button"
                  className={choice.supplier === currentSupplier ? "supplier-choice is-selected" : "supplier-choice"}
                  onClick={() => {
                    onChange({
                      supplier: choice.supplier,
                      note: setTemporarySupplierNote(item.note, "")
                    });
                    setTemporarySupplier("");
                  }}
                  key={`${choice.role}-${choice.supplier}`}
                >
                  <span>{formatSupplierRole(choice.role)}</span>
                  <strong>{choice.supplier}</strong>
                </button>
              ))}
              {choices.length === 0 ? <div className="empty-state">選択できる発注先がありません</div> : null}
            </div>
          </label>
          <label>
            <span>臨時購入先</span>
            <input
              type="text"
              value={temporarySupplier}
              placeholder="例: 近隣スーパー、商店街の青果店"
              onChange={(event) => setTemporarySupplier(event.target.value)}
            />
          </label>
          <label>
            <span>備考</span>
            <textarea
              value={item.note}
              placeholder="代替品、欠品、配送メモなど"
              onChange={(event) => onChange({ note: event.target.value })}
            />
          </label>
          <label>
            <span>実際購入価格</span>
            <input
              type="text"
              inputMode="decimal"
              value={item.actualPrice}
              placeholder="例: 271 / ¥271"
              onChange={(event) => onChange({ actualPrice: event.target.value })}
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

function calculateProcurementOrderEstimatedAmount(items: ProcurementTaskItem[], productList: Product[]) {
  return items.reduce((total, item) => {
    const product = findProcurementProduct(item, productList);
    const price = Number(product?.referencePrice ?? 0);
    return total + item.requestedQuantity * (Number.isFinite(price) ? price : 0);
  }, 0);
}

function formatEstimatedAmount(amount: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0
  }).format(Math.round(amount));
}
