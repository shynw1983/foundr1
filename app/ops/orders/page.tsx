"use client";

import { Boxes, ClipboardList, FileText, MessageSquareWarning, PackageCheck, Plus, Search, Store, Truck, LogOut, UserCog } from "lucide-react";
import { UserBadge } from "../components/UserBadge";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OpsNavList } from "../components/OpsNavList";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";
import type { LucideIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import {
  orders,
  products as initialProducts,
  stores
} from "../../../lib/mock-data";

type Product = typeof initialProducts[number];
type ProductWithCategory = Product & {
  id?: string;
  subcategory?: string;
  productBrandName?: string;
  manufacturer?: string;
  packageSpec?: string;
};
type StoreItem = typeof stores[number];
type PurchaseOrder = typeof orders[number] & {
  note?: string;
  requesterStaffId?: string;
  requesterName?: string;
  buyerStaffId?: string;
  buyerName?: string;
};
type StaffOption = {
  id: string;
  name: string;
  role: string;
  storeNames: string[];
};
type OrderItemDraft = {
  id: number;
  productId: string;
  category: string;
  subcategory: string;
  productName: string;
  quantity: number;
  unit: string;
};
type QueueFilter = "未完了" | "今日対応" | "配送待ち" | "完了" | "すべて";
type PurchaseOrderItem = {
  id?: string;
  orderId: string;
  productId?: string;
  productName: string;
  brandName?: string;
  referencePrice?: number;
  requestedQuantity: number;
  actualQuantity?: number;
  actualPrice?: string;
  unit: string;
  unavailable?: boolean;
  note?: string;
  priceExceptionNote?: string;
  deliveryStatus?: "pending" | "in_delivery" | "delivered" | "received";
  deliveryBatchId?: string;
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
type StoreFeedback = {
  id: string;
  itemId?: string;
  kind?: "price" | "quantity" | "note";
  orderId: string;
  product: string;
  type: string;
  message: string;
  store: string;
  status: string;
};
type EditingOrder = {
  order: PurchaseOrder;
  store: string;
  deadline: string;
  priority: string;
  note: string;
  requesterStaffId: string;
  buyerStaffId: string;
  items: OrderItemDraft[];
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

function getDeliveryBatchLabel(batch: DeliveryBatch) {
  if (batch.batchNo) return `${batch.orderId}-DEL-${String(batch.batchNo).padStart(2, "0")}`;

  return batch.id;
}

function getCurrentDateTimeLabel() {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());
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
  { label: "連絡・報告", href: "/ops/reports", icon: MessageSquareWarning },
  { label: "ログアウト", href: "/ops/logout", icon: LogOut }
];

const queueFilters: QueueFilter[] = ["未完了", "今日対応", "配送待ち", "完了", "すべて"];
const quantityOptions = Array.from({ length: 999 }, (_, index) => index + 1);

function getProductPhotoSrc(photoUrl?: string) {
  if (!photoUrl) return "";
  if (photoUrl.startsWith("/api/products/photo/view")) return photoUrl;

  try {
    const url = new URL(photoUrl);
    if (url.hostname.endsWith(".private.blob.vercel-storage.com")) {
      return `/api/products/photo/view?pathname=${encodeURIComponent(url.pathname.slice(1))}`;
    }
  } catch {
    return photoUrl;
  }

  return photoUrl;
}

function getDefaultDeadlineValue() {
  const now = new Date();
  const deadline = new Date(now);
  deadline.setHours(now.getHours() + 2);

  if (deadline.getMinutes() > 0 || deadline.getSeconds() > 0 || deadline.getMilliseconds() > 0) {
    deadline.setHours(deadline.getHours() + 1);
  }

  deadline.setMinutes(0, 0, 0);

  if (deadline.getHours() < 12) {
    deadline.setHours(12, 0, 0, 0);
  }

  if (deadline.getDate() !== now.getDate()) {
    deadline.setHours(12, 0, 0, 0);
  }

  const year = deadline.getFullYear();
  const month = String(deadline.getMonth() + 1).padStart(2, "0");
  const day = String(deadline.getDate()).padStart(2, "0");
  const hour = String(deadline.getHours()).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:00`;
}

function labelToDeadlineValue(label: string) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowMonth = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const tomorrowDay = String(tomorrow.getDate()).padStart(2, "0");
  const timeMatch = label.match(/(\d{1,2}):(\d{2})/);
  const hour = timeMatch?.[1]?.padStart(2, "0") ?? "18";
  const minute = timeMatch?.[2] ?? "00";

  if (label.includes("本日")) return `${year}-${month}-${day}T${hour}:${minute}`;
  if (label.includes("明日")) return `${tomorrow.getFullYear()}-${tomorrowMonth}-${tomorrowDay}T${hour}:${minute}`;

  const dateMatch = label.match(/(\d{1,2})\/(\d{1,2})/);
  if (dateMatch) {
    return `${year}-${dateMatch[1].padStart(2, "0")}-${dateMatch[2].padStart(2, "0")}T${hour}:${minute}`;
  }

  return getDefaultDeadlineValue();
}

function isTodayOrder(order: PurchaseOrder) {
  return order.deadline.includes("本日");
}

function getProductBrands(product: ProductWithCategory) {
  return String(product.brand ?? "未設定")
    .split("/")
    .map((brand) => brand.trim())
    .filter(Boolean);
}

function getProductsForStore(products: ProductWithCategory[], storeList: StoreItem[], storeName: string) {
  const store = storeList.find((item) => item.name === storeName);
  const storeBrands = store?.brands ?? [];

  if (storeBrands.length !== 1) return products;

  const [storeBrand] = storeBrands;

  return products.filter((product) => {
    const productBrands = getProductBrands(product);
    return productBrands.includes("共通") || productBrands.includes(storeBrand);
  });
}

function createOrderItemDraftFromProduct(product: ProductWithCategory | undefined, id = Date.now()): OrderItemDraft {
  return {
    id,
    productId: product?.id ?? "",
    category: product?.category ?? "",
    subcategory: product?.subcategory ?? "未分類",
    productName: product?.name ?? "",
    quantity: 1,
    unit: product?.unit ?? "個"
  };
}

function getFirstProductInCategory(products: ProductWithCategory[], category: string) {
  return products.find((product) => product.category === category);
}

function getFirstProductInSubcategory(products: ProductWithCategory[], category: string, subcategory: string) {
  return products.find(
    (product) => product.category === category && (product.subcategory ?? "未分類") === subcategory
  );
}

function syncOrderItemWithProducts(item: OrderItemDraft, availableProducts: ProductWithCategory[]) {
  if (availableProducts.some((product) => product.id === item.productId || (!item.productId && product.name === item.productName))) return item;

  const firstSameCategory = getFirstProductInCategory(availableProducts, item.category);
  const nextProduct = firstSameCategory ?? availableProducts[0];

  return {
    ...item,
    productId: nextProduct?.id ?? "",
    category: nextProduct?.category ?? "",
    subcategory: nextProduct?.subcategory ?? "未分類",
    productName: nextProduct?.name ?? "",
    unit: nextProduct?.unit ?? "個"
  };
}

function createStoreFeedbackItems(
  purchaseOrders: PurchaseOrder[],
  purchaseOrderItems: PurchaseOrderItem[],
  fallbackItems: StoreFeedback[]
) {
  const orderMap = new Map(purchaseOrders.map((order) => [order.id, order]));
  const feedbackItems = purchaseOrderItems.flatMap<StoreFeedback>((item) => {
    if (item.unavailable) return [];

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
        itemId: item.id,
        kind: "price",
        orderId: item.orderId,
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
        itemId: item.id,
        kind: "quantity",
        orderId: item.orderId,
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
        itemId: item.id,
        kind: "note",
        orderId: item.orderId,
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

function parsePriceValue(value?: string) {
  const price = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(price) ? price : 0;
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2
  }).format(value);
}

export default function OrdersPage() {
  const { notice, showNotice, clearNotice } = useActionNotice();
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [storesData, setStoresData] = useState<typeof stores>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [purchaseOrderItems, setPurchaseOrderItems] = useState<PurchaseOrderItem[]>([]);
  const [deliveryBatches, setDeliveryBatches] = useState<DeliveryBatch[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [dataSource, setDataSource] = useState<"loading" | "neon">("loading");
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("未完了");
  const [query, setQuery] = useState("");
  const [editingOrder, setEditingOrder] = useState<EditingOrder | null>(null);
  const [draftStore, setDraftStore] = useState("");
  const [draftDeadline, setDraftDeadline] = useState(getDefaultDeadlineValue());
  const [draftPriority, setDraftPriority] = useState("中");
  const [draftNote, setDraftNote] = useState("");
  const [draftRequesterStaffId, setDraftRequesterStaffId] = useState("");
  const [draftBuyerStaffId, setDraftBuyerStaffId] = useState("");
  const [draftCategoryFilter, setDraftCategoryFilter] = useState("");
  const [draftSubcategoryFilter, setDraftSubcategoryFilter] = useState("");
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [orderItemDrafts, setOrderItemDrafts] = useState<OrderItemDraft[]>([]);

  async function loadDashboardData() {
    const response = await fetch("/api/dashboard");
    if (!response.ok) return;

    const data = await response.json() as {
      stores?: typeof stores;
      products?: ProductWithCategory[];
      orders?: PurchaseOrder[];
      purchaseOrderItems?: PurchaseOrderItem[];
      deliveryBatches?: DeliveryBatch[];
      staffOptions?: StaffOption[];
      currentUserId?: string;
    };

    if (data.stores) setStoresData(data.stores);
    if (data.products) {
      setProducts(data.products);
    }
    if (data.orders) setPurchaseOrders(data.orders);
    if (data.purchaseOrderItems) setPurchaseOrderItems(data.purchaseOrderItems);
    if (data.deliveryBatches) setDeliveryBatches(data.deliveryBatches);
    if (data.staffOptions) {
      setStaffOptions(data.staffOptions);
    }
    if (data.currentUserId) setCurrentUserId(data.currentUserId);
    setDataSource("neon");
  }

  useEffect(() => {
    void loadDashboardData();
  }, []);

  const orderableStores = storesData
    .map((store) => ({
      ...store,
      label: store.name.replace("納品", "")
    }));
  const storeFeedbackItems = createStoreFeedbackItems(purchaseOrders, purchaseOrderItems, []);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredPurchaseOrders = purchaseOrders.filter((order) => {
    if (normalizedQuery) {
      const orderItems = purchaseOrderItems.filter((item) => item.orderId === order.id);
      const targetText = [
        order.id,
        order.store,
        order.brand,
        order.deadline,
        order.priority,
        order.note ?? "",
        ...orderItems.flatMap((item) => [item.productName, item.brandName ?? "", item.note ?? "", item.priceExceptionNote ?? ""])
      ].join(" ").toLowerCase();

      if (!targetText.includes(normalizedQuery)) return false;
    }

    if (queueFilter === "未完了") return order.status !== "完了";
    if (queueFilter === "今日対応") return order.status !== "完了" && isTodayOrder(order);
    if (queueFilter === "配送待ち") return ["配送待ち", "配送中", "一部納品済み"].includes(order.status);
    if (queueFilter === "完了") return order.status === "完了";

    return true;
  });
  const selectedDraftStore = draftStore || orderableStores[0]?.name || "";
  const draftAssignableStaff = getAssignableStaffOptions(staffOptions, selectedDraftStore);
  const selectedDraftRequesterStaffId = getSelectedRequesterStaffId(draftRequesterStaffId, draftAssignableStaff, selectedDraftStore, currentUserId);
  const selectedDraftBuyerStaffId = getSelectedBuyerStaffId(draftBuyerStaffId, draftAssignableStaff, selectedDraftStore);
  const draftProducts = getProductsForStore(products, orderableStores, selectedDraftStore);
  const draftProductCategories = Array.from(new Set(draftProducts.map((product) => product.category)));
  const selectedDraftCategory = draftProductCategories.includes(draftCategoryFilter)
    ? draftCategoryFilter
    : draftProductCategories[0] ?? "";
  const draftProductSubcategories = Array.from(new Set(
    draftProducts
      .filter((product) => !selectedDraftCategory || product.category === selectedDraftCategory)
      .map((product) => product.subcategory ?? "未分類")
  ));
  const selectedDraftSubcategory = draftProductSubcategories.includes(draftSubcategoryFilter)
    ? draftSubcategoryFilter
    : draftProductSubcategories[0] ?? "";
  const visibleDraftProducts = draftProducts.filter((product) =>
    (!selectedDraftCategory || product.category === selectedDraftCategory) &&
    (!selectedDraftSubcategory || (product.subcategory ?? "未分類") === selectedDraftSubcategory)
  );
  const editingProducts = editingOrder
    ? getProductsForStore(products, orderableStores, editingOrder.store)
    : products;
  const editingProductCategories = Array.from(new Set(editingProducts.map((product) => product.category)));
  const editingProductSubcategories = Array.from(new Set(editingProducts.map((product) => product.subcategory ?? "未分類")));
  const editingAssignableStaff = editingOrder ? getAssignableStaffOptions(staffOptions, editingOrder.store) : [];
  const draftEstimatedAmount = calculateDraftEstimatedAmount(orderItemDrafts, products);
  const editingEstimatedAmount = editingOrder
    ? calculateDraftEstimatedAmount(editingOrder.items, products)
    : 0;

  useEffect(() => {
    setOrderItemDrafts((items) => items.map((item) => syncOrderItemWithProducts(item, draftProducts)));
  }, [selectedDraftStore, products]);

  useEffect(() => {
    setDraftCategoryFilter((current) => draftProductCategories.includes(current) ? current : draftProductCategories[0] ?? "");
  }, [selectedDraftStore, products]);

  useEffect(() => {
    setDraftSubcategoryFilter((current) => draftProductSubcategories.includes(current) ? current : draftProductSubcategories[0] ?? "");
  }, [selectedDraftCategory, selectedDraftStore, products]);

  useEffect(() => {
    setDraftRequesterStaffId((current) => getSelectedRequesterStaffId(current, draftAssignableStaff, selectedDraftStore, currentUserId));
    setDraftBuyerStaffId((current) => getSelectedBuyerStaffId(current, draftAssignableStaff, selectedDraftStore));
  }, [selectedDraftStore, currentUserId, staffOptions]);

  function getQueueFilterCount(filter: QueueFilter) {
    if (filter === "未完了") return purchaseOrders.filter((order) => order.status !== "完了").length;
    if (filter === "今日対応") return purchaseOrders.filter((order) => order.status !== "完了" && isTodayOrder(order)).length;
    if (filter === "配送待ち") {
      return purchaseOrders.filter((order) => ["配送待ち", "配送中", "一部納品済み"].includes(order.status)).length;
    }
    if (filter === "完了") return purchaseOrders.filter((order) => order.status === "完了").length;

    return purchaseOrders.length;
  }

  function addOrderItemDraft() {
    setOrderItemDrafts((items) => [
      ...items,
      createOrderItemDraftFromProduct(draftProducts[0])
    ]);
  }

  function addProductToDraft(product: ProductWithCategory) {
    setOrderItemDrafts((items) => {
      const existingItem = items.find((item) => item.productId === product.id);

      if (existingItem) {
        return items.map((item) =>
          item.id === existingItem.id
            ? { ...item, quantity: Math.min(999, item.quantity + 1) }
            : item
        );
      }

      return [
        ...items.filter((item) => item.productId || item.productName),
        createOrderItemDraftFromProduct(product)
      ];
    });
  }

  function updateOrderItemDraft(id: number, next: Partial<OrderItemDraft>) {
    setOrderItemDrafts((items) =>
      items.map((item) => {
        if (item.id !== id) return item;

        if (next.category && next.category !== item.category) {
          const firstProductInCategory = getFirstProductInCategory(draftProducts, next.category);

          return {
            ...item,
            productId: firstProductInCategory?.id ?? "",
            category: next.category,
            subcategory: firstProductInCategory?.subcategory ?? "未分類",
            productName: firstProductInCategory?.name ?? "",
            unit: firstProductInCategory?.unit ?? "個"
          };
        }

        if (next.subcategory && next.subcategory !== item.subcategory) {
          const firstProductInSubcategory = getFirstProductInSubcategory(draftProducts, item.category, next.subcategory);

          return {
            ...item,
            productId: firstProductInSubcategory?.id ?? "",
            subcategory: next.subcategory,
            productName: firstProductInSubcategory?.name ?? "",
            unit: firstProductInSubcategory?.unit ?? "個"
          };
        }

        if (next.productId && next.productId !== item.productId) {
          const selectedProduct = draftProducts.find((product) => product.id === next.productId);

          return {
            ...item,
            productId: next.productId,
            productName: selectedProduct?.name ?? "",
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

  function copyOrderToDraft(order: PurchaseOrder) {
    const availableProducts = getProductsForStore(products, orderableStores, order.store);
    const items = purchaseOrderItems
      .filter((item) => item.orderId === order.id)
      .map((item, index) => createDraftFromOrderItem(item, index));

    setDraftStore(order.store);
    setDraftDeadline(getDefaultDeadlineValue());
    setDraftPriority(order.priority || "中");
    setDraftNote(order.note ?? "");
    setDraftRequesterStaffId(order.requesterStaffId || currentUserId);
    setDraftBuyerStaffId(order.buyerStaffId || order.requesterStaffId || currentUserId);
    setOrderItemDrafts(items.length > 0 ? items : [
      createOrderItemDraftFromProduct(availableProducts[0])
    ]);

    showNotice("過去の依頼を新規依頼にコピーしました。", "info");
    document.getElementById("create-order-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submitNewOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmittingOrder) return;

    setIsSubmittingOrder(true);
    const form = event.currentTarget;

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        body: new FormData(form)
      });

      if (!response.ok) {
        window.alert("発注依頼を送信できませんでした。");
        return;
      }

      showNotice("発注依頼を送信しました。");
      setDraftDeadline(getDefaultDeadlineValue());
      setDraftPriority("中");
      setDraftNote("");
      setDraftRequesterStaffId("");
      setDraftBuyerStaffId("");
      setDraftCategoryFilter("");
      setDraftSubcategoryFilter("");
      setOrderItemDrafts([]);
      await loadDashboardData();
    } finally {
      setIsSubmittingOrder(false);
    }
  }

  async function markDeliveryBatchReceived(batch: DeliveryBatch) {
    const confirmedLabel = getCurrentDateTimeLabel();

    setDeliveryBatches((batches) =>
      batches.map((item) =>
        item.id === batch.id ? { ...item, status: "received", storeConfirmedLabel: confirmedLabel } : item
      )
    );
    setPurchaseOrderItems((items) =>
      items.map((item) =>
        item.id && batch.itemIds.includes(item.id) ? { ...item, deliveryStatus: "received" } : item
      )
    );

    try {
      const response = await fetch("/api/procurement/delivery-batches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: batch.id,
          status: "received"
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "店舗確認を保存できませんでした。");
      }

      showNotice("店舗確認済みにしました。");
      await loadDashboardData();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "店舗確認を保存できませんでした。");
      await loadDashboardData();
    }
  }

  async function markOrderItemsReceived(orderId: string, items: PurchaseOrderItem[]) {
    const targetItems = items.filter((item) => item.id && item.deliveryStatus === "delivered");

    if (targetItems.length === 0) return;

    setPurchaseOrderItems((currentItems) =>
      currentItems.map((item) =>
        item.orderId === orderId && item.id && targetItems.some((target) => target.id === item.id)
          ? { ...item, deliveryStatus: "received" }
          : item
      )
    );

    try {
      await Promise.all(targetItems.map((item) =>
        fetch("/api/procurement/items", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId: item.id,
            deliveryStatus: "received"
          })
        }).then(async (response) => {
          if (response.ok) return;
          const body = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? "店舗確認を保存できませんでした。");
        })
      ));

      showNotice("店舗確認済みにしました。");
      await loadDashboardData();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "店舗確認を保存できませんでした。");
      await loadDashboardData();
    }
  }

  async function confirmStoreFeedback(item: StoreFeedback) {
    if (!item.itemId || !item.kind || item.kind === "note") return;

    const orderItem = purchaseOrderItems.find((candidate) => candidate.id === item.itemId);
    if (!orderItem) return;

    const payload = item.kind === "quantity"
      ? { itemId: item.itemId, actualQuantity: orderItem.requestedQuantity }
      : { itemId: item.itemId, clearActualPrice: true };

    try {
      const response = await fetch("/api/procurement/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "確認状態を保存できませんでした。");
      }

      setPurchaseOrderItems((items) =>
        items.map((candidate) => {
          if (candidate.id !== item.itemId) return candidate;

          return item.kind === "quantity"
            ? { ...candidate, actualQuantity: candidate.requestedQuantity }
            : { ...candidate, actualPrice: "" };
        })
      );
      showNotice("確認済みにしました。");
      await loadDashboardData();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "確認状態を保存できませんでした。");
      await loadDashboardData();
    }
  }

  function createDraftFromOrderItem(item: PurchaseOrderItem, index: number): OrderItemDraft {
    const product = products.find((candidate) => candidate.id === item.productId) ??
      products.find((candidate) => candidate.name === item.productName);

    return {
      id: Date.now() + index,
      productId: product?.id ?? item.productId ?? "",
      category: product?.category ?? "",
      subcategory: product?.subcategory ?? "未分類",
      productName: item.productName,
      quantity: item.requestedQuantity,
      unit: item.unit
    };
  }

  function startEditingOrder(order: PurchaseOrder) {
    const items = purchaseOrderItems
      .filter((item) => item.orderId === order.id)
      .map((item, index) => createDraftFromOrderItem(item, index));

    setEditingOrder({
      order,
      store: order.store,
      deadline: labelToDeadlineValue(order.deadline),
      priority: order.priority,
      note: order.note ?? "",
      requesterStaffId: order.requesterStaffId || currentUserId,
      buyerStaffId: order.buyerStaffId || order.requesterStaffId || currentUserId,
      items: items.length > 0 ? items : [
        createOrderItemDraftFromProduct(getProductsForStore(products, orderableStores, order.store)[0])
      ]
    });
  }

  function updateEditingOrderItem(id: number, next: Partial<OrderItemDraft>) {
    setEditingOrder((current) => {
      if (!current) return current;

      return {
        ...current,
        items: current.items.map((item) => {
          if (item.id !== id) return item;

          if (next.category && next.category !== item.category) {
            const firstProductInCategory = getFirstProductInCategory(editingProducts, next.category);

            return {
              ...item,
              productId: firstProductInCategory?.id ?? "",
              category: next.category,
              subcategory: firstProductInCategory?.subcategory ?? "未分類",
              productName: firstProductInCategory?.name ?? "",
              unit: firstProductInCategory?.unit ?? "個"
            };
          }

          if (next.subcategory && next.subcategory !== item.subcategory) {
            const firstProductInSubcategory = getFirstProductInSubcategory(editingProducts, item.category, next.subcategory);

            return {
              ...item,
              productId: firstProductInSubcategory?.id ?? "",
              subcategory: next.subcategory,
              productName: firstProductInSubcategory?.name ?? "",
              unit: firstProductInSubcategory?.unit ?? "個"
            };
          }

          if (next.productId && next.productId !== item.productId) {
            const selectedProduct = editingProducts.find((product) => product.id === next.productId);

            return {
              ...item,
              productId: next.productId,
              productName: selectedProduct?.name ?? "",
              unit: selectedProduct?.unit ?? item.unit
            };
          }

          return {
            ...item,
            ...next
          };
        })
      };
    });
  }

  function addEditingOrderItem() {
    setEditingOrder((current) => current ? {
      ...current,
      items: [
        ...current.items,
        createOrderItemDraftFromProduct(getProductsForStore(products, orderableStores, current.store)[0])
      ]
    } : current);
  }

  function removeEditingOrderItem(id: number) {
    setEditingOrder((current) => current ? {
      ...current,
      items: current.items.filter((item) => item.id !== id)
    } : current);
  }

  async function saveEditingOrder() {
    if (!editingOrder) return;

    const formData = new FormData();
    formData.set("orderId", editingOrder.order.id);
    formData.set("store", editingOrder.store);
    formData.set("deadline", editingOrder.deadline);
    formData.set("priority", editingOrder.priority);
    formData.set("note", editingOrder.note);
    formData.set("requesterStaffId", editingOrder.requesterStaffId);
    formData.set("buyerStaffId", editingOrder.buyerStaffId);
    editingOrder.items.forEach((item) => {
      formData.append("productId", item.productId);
      formData.append("productName", item.productName);
      formData.append("requestedQuantity", String(item.quantity));
      formData.append("requestedUnit", item.unit);
    });

    const response = await fetch("/api/orders", {
      method: "PUT",
      body: formData
    });

    if (!response.ok) {
      const body = await response.json();
      window.alert(body.error ?? "発注依頼を保存できませんでした。");
      return;
    }

    await loadDashboardData();
    setEditingOrder(null);
    showNotice("発注依頼を更新しました。");
  }

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
            <p className="eyebrow">店舗からの発注依頼</p>
            <h2>発注依頼</h2>
            <span className="source-indicator">{dataSource === "neon" ? "Neon 接続済み" : "読み込み中"}</span>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input
                value={query}
                placeholder="商品・店舗・依頼番号を検索"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
        </header>

        <section className="panel create-order-panel" id="create-order-panel">
          <PanelTitle title="新規発注依頼" subtitle="納品先店舗と依頼商品リストを指定" />
          <form className="inline-create-form" onSubmit={submitNewOrder}>
            <label>
              <span>納品先店舗</span>
              <select
                name="store"
                value={selectedDraftStore}
                onChange={(event) => {
                  setDraftStore(event.target.value);
                  setDraftRequesterStaffId("");
                  setDraftBuyerStaffId("");
                }}
              >
                {orderableStores.map((store) => (
                  <option value={store.name} key={store.name}>{store.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>締切</span>
              <input name="deadline" type="datetime-local" value={draftDeadline} onChange={(event) => setDraftDeadline(event.target.value)} />
            </label>
            <label>
              <span>優先度</span>
              <select name="priority" value={draftPriority} onChange={(event) => setDraftPriority(event.target.value)}>
                <option value="高">高</option>
                <option value="中">中</option>
                <option value="低">低</option>
              </select>
            </label>
            <label>
              <span>依頼担当</span>
              <select name="requesterStaffId" value={selectedDraftRequesterStaffId} onChange={(event) => setDraftRequesterStaffId(event.target.value)}>
                {draftAssignableStaff.map((staff) => (
                  <option value={staff.id} key={staff.id}>{staff.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>購入担当</span>
              <select name="buyerStaffId" value={selectedDraftBuyerStaffId} onChange={(event) => setDraftBuyerStaffId(event.target.value)}>
                {draftAssignableStaff.map((staff) => (
                  <option value={staff.id} key={staff.id}>{staff.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>メモ</span>
              <textarea name="note" value={draftNote} onChange={(event) => setDraftNote(event.target.value)} placeholder="欠品時の代替、配送希望など" />
            </label>
            <div className="order-items-builder">
              <div className="builder-heading">
                <strong>依頼商品リスト</strong>
                <span>{orderItemDrafts.filter((item) => item.productId || item.productName).length} 件</span>
              </div>
              <div className="order-product-picker">
                <div className="product-category-strip" aria-label="依頼商品大分類">
                  {draftProductCategories.map((category) => (
                    <button
                      type="button"
                      className={selectedDraftCategory === category ? "filter-chip is-active" : "filter-chip"}
                      onClick={() => setDraftCategoryFilter(category)}
                      key={category}
                    >
                      {category}
                    </button>
                  ))}
                </div>
                <div className="product-category-strip" aria-label="依頼商品小分類">
                  {draftProductSubcategories.map((subcategory) => (
                    <button
                      type="button"
                      className={selectedDraftSubcategory === subcategory ? "filter-chip is-active" : "filter-chip"}
                      onClick={() => setDraftSubcategoryFilter(subcategory)}
                      key={subcategory}
                    >
                      {subcategory}
                    </button>
                  ))}
                </div>
                <div className="order-product-grid">
                  {visibleDraftProducts.map((product) => {
                    const selectedItem = orderItemDrafts.find((item) => item.productId === product.id);

                    return (
                      <button
                        type="button"
                        className={selectedItem ? "order-product-card is-selected" : "order-product-card"}
                        onClick={() => addProductToDraft(product)}
                        key={product.id ?? product.name}
                      >
                        <span className="order-product-photo">
                          {product.photoUrl ? (
                            <img src={getProductPhotoSrc(product.photoUrl)} alt={`${product.name} の写真`} />
                          ) : (
                            <span>写真</span>
                          )}
                        </span>
                        <span className="order-product-info">
                          <strong>{product.name}</strong>
                          <small>{product.packageSpec || product.productBrandName || product.mainSupplier || "詳細未設定"}</small>
                          <span>{product.unit} · {product.storageType || "保管未設定"} · ¥{product.referencePrice}</span>
                        </span>
                        {selectedItem ? <em>{selectedItem.quantity}</em> : null}
                      </button>
                    );
                  })}
                  {visibleDraftProducts.length === 0 ? (
                    <div className="empty-state">選択できる商品がありません</div>
                  ) : null}
                </div>
              </div>
              <div className="order-item-list">
                {orderItemDrafts.map((item) => (
                  <div className="order-item-row" key={item.id}>
                    <label className="selected-order-product">
                      <span>商品</span>
                      <strong>{item.productName || "商品未選択"}</strong>
                      <small>{item.category} / {item.subcategory}</small>
                      <input type="hidden" name="productId" value={item.productId} />
                      <input type="hidden" name="productName" value={item.productName} />
                    </label>
                    <label>
                      <span>数量</span>
                      <select
                        name="requestedQuantity"
                        value={item.quantity}
                        onChange={(event) => updateOrderItemDraft(item.id, { quantity: Number(event.target.value) })}
                      >
                        {quantityOptions.map((quantity) => (
                          <option value={quantity} key={quantity}>{quantity}</option>
                        ))}
                      </select>
                    </label>
                    <div className="unit-display">
                      <span>単位</span>
                      <strong>{item.unit}</strong>
                      <input type="hidden" name="requestedUnit" value={item.unit} />
                    </div>
                    <button
                      type="button"
                      className="text-button danger-button"
                      onClick={() => removeOrderItemDraft(item.id)}
                    >
                      削除
                    </button>
                  </div>
                ))}
                {orderItemDrafts.length === 0 ? (
                  <div className="empty-state">商品カードをクリックして追加してください</div>
                ) : null}
              </div>
              <EstimatedAmountBox amount={draftEstimatedAmount} />
            </div>
            <div className="inline-create-actions">
              <button type="submit" className="primary-button" disabled={isSubmittingOrder}>
                <Plus size={18} />
                {isSubmittingOrder ? "送信中..." : "依頼を送信"}
              </button>
            </div>
          </form>
        </section>

        <section className="workspace-grid">
          <section className="panel operation-panel" id="発注依頼">
            <PanelTitle title="依頼キュー" subtitle="未完了の依頼を中心に、状態別に確認" />
            <div className="queue-filter-bar" aria-label="発注依頼フィルター">
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
              {filteredPurchaseOrders.map((order) => {
                const estimatedAmount = calculateOrderEstimatedAmount(order.id, purchaseOrderItems, products);
                const storeConfirmationBatches = deliveryBatches.filter(
                  (batch) => batch.orderId === order.id && ["delivered", "received"].includes(batch.status)
                );
                const directStoreConfirmationItems = purchaseOrderItems.filter(
                  (item) =>
                    item.orderId === order.id &&
                    !item.deliveryBatchId &&
                    (item.deliveryStatus === "delivered" || item.deliveryStatus === "received")
                );
                const hasDirectStoreConfirmation = directStoreConfirmationItems.length > 0;
                const directStoreConfirmationDone = hasDirectStoreConfirmation &&
                  directStoreConfirmationItems.every((item) => item.deliveryStatus === "received");

                return (
                  <article className="order-row" id={`order-${order.id}`} key={order.id}>
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
                      <span className="muted-label">担当</span>
                      <strong>{formatOrderAssignees(order)}</strong>
                    </div>
                    <div>
                      <span className="muted-label">概算金額</span>
                      <strong>{formatEstimatedAmount(estimatedAmount)}</strong>
                    </div>
                    <div>
                      <span className="muted-label">優先度</span>
                      <strong>{order.priority}</strong>
                    </div>
                    <div className="row-actions">
                      <a
                        className="icon-button"
                        href={`/ops/procurement?order=${encodeURIComponent(order.id)}`}
                        aria-label={`${order.id} の発注管理`}
                      >
                        <PackageCheck size={18} />
                      </a>
                      <button type="button" className="text-button" onClick={() => startEditingOrder(order)}>
                        編集
                      </button>
                      <button type="button" className="text-button" onClick={() => copyOrderToDraft(order)}>
                        複製
                      </button>
                    </div>
                    {storeConfirmationBatches.length > 0 ? (
                      <div className="store-confirmation-panel">
                        <div className="store-confirmation-heading">
                          <strong>到着確認</strong>
                          <span>納品済みの配送を店舗側で確認</span>
                        </div>
                        <div className="delivery-batch-list">
                          {storeConfirmationBatches.map((batch) => (
                            <div className="delivery-batch-row store-confirmation-row" key={batch.id}>
                              <div className="delivery-batch-info">
                                <strong>{getDeliveryBatchLabel(batch)}</strong>
                                <span>
                                  {batch.createdLabel} · {batch.itemIds.length} 件 · {
                                    batch.status === "received"
                                      ? `店舗確認済み${batch.storeConfirmedLabel ? ` ${batch.storeConfirmedLabel}` : ""}`
                                      : "納品済み"
                                  }
                                </span>
                              </div>
                              <div className="delivery-batch-actions">
                                <button
                                  type="button"
                                  className="delivery-complete-button"
                                  disabled={batch.status !== "delivered"}
                                  onClick={() => markDeliveryBatchReceived(batch)}
                                >
                                  {batch.status === "received" ? "店舗確認済み" : "店舗確認済みにする"}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {hasDirectStoreConfirmation ? (
                      <div className="store-confirmation-panel">
                        <div className="store-confirmation-heading">
                          <strong>到着確認</strong>
                          <span>配送発注の到着を店舗側で確認</span>
                        </div>
                        <div className="delivery-batch-row store-confirmation-row">
                          <div className="delivery-batch-info">
                            <strong>{order.id}-NET</strong>
                            <span>
                              {directStoreConfirmationItems.length} 件 · {directStoreConfirmationDone ? "店舗確認済み" : "納品済み"}
                            </span>
                          </div>
                          <div className="delivery-batch-actions">
                            <button
                              type="button"
                              className="delivery-complete-button"
                              disabled={directStoreConfirmationDone}
                              onClick={() => markOrderItemsReceived(order.id, directStoreConfirmationItems)}
                            >
                              {directStoreConfirmationDone ? "店舗確認済み" : "店舗確認済みにする"}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
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
                    <div className="feedback-actions">
                      <small>
                        <a className="feedback-order-link" href={`#order-${item.orderId}`}>
                          依頼番号 {item.orderId}
                        </a>
                        <span> · {item.store} · {item.status}</span>
                      </small>
                      {item.status === "店舗確認待ち" ? (
                        <button
                          type="button"
                          className="feedback-confirm-button"
                          onClick={() => confirmStoreFeedback(item)}
                        >
                          確認済みにする
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
                {storeFeedbackItems.length === 0 ? (
                  <div className="empty-state">要確認の連絡はありません</div>
                ) : null}
              </div>
            </section>
          </aside>
        </section>
      </section>

      {editingOrder ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="order-edit-title">
          <section className="edit-modal order-edit-modal">
            <div className="modal-heading">
              <div>
                <h3 id="order-edit-title">発注依頼を編集</h3>
                <p>{editingOrder.order.id}</p>
              </div>
              <button type="button" className="text-button" onClick={() => setEditingOrder(null)}>
                閉じる
              </button>
            </div>

            <div className="edit-fields">
              <label>
                <span>納品先店舗</span>
                <select
                  value={editingOrder.store}
                  onChange={(event) => {
                    const nextStore = event.target.value;
                    const nextProducts = getProductsForStore(products, orderableStores, nextStore);
                    setEditingOrder((current) => current ? {
                      ...current,
                      store: nextStore,
                      items: current.items.map((item) => syncOrderItemWithProducts(item, nextProducts))
                    } : current);
                  }}
                >
                  {orderableStores.map((store) => (
                    <option value={store.name} key={store.name}>{store.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>締切</span>
                <input
                  type="datetime-local"
                  value={editingOrder.deadline}
                  onChange={(event) => setEditingOrder((current) => current ? { ...current, deadline: event.target.value } : current)}
                />
              </label>
              <label>
                <span>優先度</span>
                <select
                  value={editingOrder.priority}
                  onChange={(event) => setEditingOrder((current) => current ? { ...current, priority: event.target.value } : current)}
                >
                  <option value="高">高</option>
                  <option value="中">中</option>
                  <option value="低">低</option>
                </select>
              </label>
              <label>
                <span>依頼担当</span>
                <select
                  value={getSelectedStaffId(editingOrder.requesterStaffId, editingAssignableStaff)}
                  onChange={(event) => setEditingOrder((current) => current ? { ...current, requesterStaffId: event.target.value } : current)}
                >
                  {editingAssignableStaff.map((staff) => (
                    <option value={staff.id} key={staff.id}>{staff.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>購入担当</span>
                <select
                  value={getSelectedStaffId(editingOrder.buyerStaffId, editingAssignableStaff)}
                  onChange={(event) => setEditingOrder((current) => current ? { ...current, buyerStaffId: event.target.value } : current)}
                >
                  {editingAssignableStaff.map((staff) => (
                    <option value={staff.id} key={staff.id}>{staff.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>メモ</span>
                <textarea
                  value={editingOrder.note}
                  onChange={(event) => setEditingOrder((current) => current ? { ...current, note: event.target.value } : current)}
                  placeholder="欠品時の代替、配送希望など"
                />
              </label>
            </div>

            <div className="order-items-builder">
              <div className="builder-heading">
                <strong>依頼商品リスト</strong>
              </div>
              <div className="order-item-list">
                {editingOrder.items.map((item) => (
                  <div className="order-item-row" key={item.id}>
                    <label>
                      <span>大分類</span>
                      <select
                        value={item.category}
                        onChange={(event) => updateEditingOrderItem(item.id, { category: event.target.value })}
                      >
                        {editingProductCategories.map((category) => (
                          <option value={category} key={category}>{category}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>小分類</span>
                      <select
                        value={item.subcategory}
                        onChange={(event) => updateEditingOrderItem(item.id, { subcategory: event.target.value })}
                      >
                        {editingProductSubcategories
                          .filter((subcategory) =>
                            editingProducts.some((product) => product.category === item.category && (product.subcategory ?? "未分類") === subcategory)
                          )
                          .map((subcategory) => (
                            <option value={subcategory} key={subcategory}>{subcategory}</option>
                          ))}
                      </select>
                    </label>
                    <label>
                      <span>商品</span>
                      <select
                        value={item.productId}
                        onChange={(event) => updateEditingOrderItem(item.id, { productId: event.target.value })}
                      >
                        {editingProducts
                          .filter((product) => product.category === item.category && (product.subcategory ?? "未分類") === item.subcategory)
                          .map((product) => (
                            <option value={product.id ?? product.name} key={product.id ?? product.name}>{product.name}</option>
                          ))}
                      </select>
                    </label>
                    <label>
                      <span>数量</span>
                      <select
                        value={item.quantity}
                        onChange={(event) => updateEditingOrderItem(item.id, { quantity: Number(event.target.value) })}
                      >
                        {quantityOptions.map((quantity) => (
                          <option value={quantity} key={quantity}>{quantity}</option>
                        ))}
                      </select>
                    </label>
                    <div className="unit-display">
                      <span>単位</span>
                      <strong>{item.unit}</strong>
                    </div>
                    <button
                      type="button"
                      className="text-button danger-button"
                      onClick={() => removeEditingOrderItem(item.id)}
                      disabled={editingOrder.items.length === 1}
                    >
                      削除
                    </button>
                  </div>
                ))}
              </div>
              <div className="builder-actions">
                <button type="button" className="text-button" onClick={addEditingOrderItem}>
                  商品を追加
                </button>
              </div>
              <EstimatedAmountBox amount={editingEstimatedAmount} />
            </div>

            <div className="modal-actions">
              <button type="button" className="text-button" onClick={() => setEditingOrder(null)}>
                キャンセル
              </button>
              <button type="button" className="primary-button" onClick={saveEditingOrder}>
                保存
              </button>
            </div>
          </section>
        </div>
      ) : null}
      <ActionNotice notice={notice} onClose={clearNotice} />
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

function EstimatedAmountBox({ amount }: { amount: number }) {
  return (
    <div className="estimated-amount-box">
      <span>概算金額</span>
      <strong>{formatEstimatedAmount(amount)}</strong>
    </div>
  );
}

function calculateDraftEstimatedAmount(items: OrderItemDraft[], productList: ProductWithCategory[]) {
  return items.reduce((total, item) => {
    const product = findProductForEstimate(item.productId, item.productName, productList);
    return total + item.quantity * getReferencePrice(product);
  }, 0);
}

function calculateOrderEstimatedAmount(orderId: string, orderItems: PurchaseOrderItem[], productList: ProductWithCategory[]) {
  return orderItems
    .filter((item) => item.orderId === orderId)
    .reduce((total, item) => {
      const product = findProductForEstimate(item.productId, item.productName, productList);
      return total + item.requestedQuantity * getReferencePrice(product);
    }, 0);
}

function getAssignableStaffOptions(staffOptions: StaffOption[], storeName: string) {
  const storeLabel = storeName.replace("納品", "");
  return staffOptions
    .filter((staff) =>
      staff.storeNames.length === 0 ||
      staff.storeNames.includes(storeName) ||
      staff.storeNames.includes(storeLabel)
    )
    .sort((a, b) => getStaffStoreRelevance(a, storeName) - getStaffStoreRelevance(b, storeName));
}

function getStaffStoreRelevance(staff: StaffOption, storeName: string) {
  const rolePriority: Record<string, number> = {
    store_owner: 0,
    staff: 1,
    manager: 2,
    buyer: 3,
    owner: 4
  };
  const storeMatchPriority = isStaffAssignedToStore(staff, storeName) ? 0 : 10;

  return storeMatchPriority + (rolePriority[staff.role] ?? 5);
}

function isStaffAssignedToStore(staff: StaffOption, storeName: string) {
  const storeLabel = storeName.replace("納品", "");
  return staff.storeNames.includes(storeName) || staff.storeNames.includes(storeLabel);
}

function getSelectedRequesterStaffId(currentId: string, staffOptions: StaffOption[], storeName: string, currentUserId: string) {
  const currentStaff = staffOptions.find((staff) => staff.id === currentId);
  if (currentId && currentStaff) return currentStaff.id;

  const storeStaff = staffOptions.filter((staff) => staff.role !== "owner" && isStaffAssignedToStore(staff, storeName));
  if (storeStaff.length > 0) {
    const currentUserInStore = storeStaff.find((staff) => staff.id === currentUserId);
    return currentUserInStore?.id ?? storeStaff[0].id;
  }

  const currentFallback = staffOptions.find((staff) => staff.id === currentId && staff.role !== "owner");
  if (currentFallback) return currentFallback.id;

  const currentUserFallback = staffOptions.find((staff) => staff.id === currentUserId && staff.role !== "owner");
  if (currentUserFallback) return currentUserFallback.id;

  return staffOptions.find((staff) => staff.role !== "owner")?.id ?? staffOptions[0]?.id ?? "";
}

function getSelectedBuyerStaffId(currentId: string, staffOptions: StaffOption[], storeName: string) {
  const currentStaff = staffOptions.find((staff) => staff.id === currentId);
  if (currentStaff && (isStaffAssignedToStore(currentStaff, storeName) || currentStaff.role === "owner")) return currentStaff.id;

  return staffOptions.find((staff) => staff.role === "store_owner" && isStaffAssignedToStore(staff, storeName))?.id ??
    staffOptions.find((staff) => staff.role === "owner")?.id ??
    staffOptions[0]?.id ??
    "";
}

function getSelectedStaffId(currentId: string, staffOptions: StaffOption[]) {
  if (staffOptions.some((staff) => staff.id === currentId)) return currentId;
  return staffOptions[0]?.id ?? "";
}

function formatOrderAssignees(order: PurchaseOrder) {
  const requester = order.requesterName || "未設定";
  const buyer = order.buyerName || requester;
  if (requester === buyer) return requester;
  return `${requester} / ${buyer}`;
}

function findProductForEstimate(productId: string | undefined, productName: string, productList: ProductWithCategory[]) {
  return productList.find((product) => product.id === productId)
    ?? productList.find((product) => product.name === productName);
}

function getReferencePrice(product: ProductWithCategory | undefined) {
  const price = Number(product?.referencePrice ?? 0);
  return Number.isFinite(price) ? price : 0;
}

function formatEstimatedAmount(amount: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0
  }).format(Math.round(amount));
}
