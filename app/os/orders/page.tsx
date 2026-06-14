"use client";

import { Boxes, CalendarDays, ClipboardList, FileText, Lightbulb, MessageSquareWarning, PackageCheck, Plus, Search, Store, Truck, LogOut, UserCog } from "lucide-react";
import { UserBadge } from "../components/UserBadge";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";
import { ModalHistoryScope } from "../components/useModalHistory";
import type { LucideIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import {
  orders,
  products as initialProducts,
  stores
} from "../../../lib/mock-data";
import { normalizeDecimalInput } from "../../../lib/number-input";

type Product = typeof initialProducts[number];
type ProductWithCategory = Product & {
  id?: string;
  subcategory?: string;
  productBrandName?: string;
  manufacturer?: string;
  variantName?: string;
};
type StoreItem = typeof stores[number] & {
  defaultProcurementStaffId?: string;
};
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
type ProcurementTimeSlot = "morning" | "afternoon" | "evening";
type ProcurementStaffUnavailableSlot = {
  employeeId: string;
  date: string;
  slot: ProcurementTimeSlot;
  note?: string;
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
  storeFeedbackConfirmed?: boolean;
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
  kind?: "price" | "quantity" | "note" | "unavailable";
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

type NewOrderDraftSession = {
  store: string;
  deadline: string;
  priority: string;
  note: string;
  requesterStaffId: string;
  buyerStaffId: string;
  categoryFilter: string;
  subcategoryFilter: string;
  items: OrderItemDraft[];
};

type PendingStoreConfirmationAction = {
  id: string;
  type: "batch_received" | "items_received" | "feedback_confirmed";
  updatedAt: number;
  batchId?: string;
  itemIds?: string[];
  feedback?: {
    itemId: string;
    kind: StoreFeedback["kind"];
    requestedQuantity?: number;
  };
};

const newOrderDraftStorageKey = "foundr1-os:new-order-draft";
const pendingStoreConfirmationStorageKey = "foundr1-os:pending-store-confirmations:v1";

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

function getStoreFeedbackConfirmLabel(kind?: StoreFeedback["kind"]) {
  if (kind === "price") return "確認して非表示";
  if (kind === "quantity") return "数量差異を確認";
  if (kind === "unavailable") return "購入不可を確認";
  if (kind === "note") return "連絡内容を確認";

  return "確認済みにする";
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
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "購入管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "商品マスタ", href: "/os/products", icon: Boxes },
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/os/product-comparisons", icon: Search },
  { label: "連絡・報告", href: "/os/reports", icon: MessageSquareWarning },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

const queueFilters: QueueFilter[] = ["未完了", "今日対応", "配送待ち", "完了", "すべて"];
const quantityOptions = Array.from({ length: 999 }, (_, index) => index + 1);
const procurementTimeSlots: Array<{ slot: ProcurementTimeSlot; label: string; time: string; description: string }> = [
  { slot: "morning", label: "午前", time: "10:00", description: "午前中" },
  { slot: "afternoon", label: "午後", time: "14:00", description: "昼から夕方前" },
  { slot: "evening", label: "夜", time: "18:00", description: "夕方以降" }
];

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

function getTodayDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function getDateKeyFromDateTime(value: string) {
  return value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? getTodayDateKey();
}

function setDateTimeSlot(value: string, slot: ProcurementTimeSlot) {
  const dateKey = getDateKeyFromDateTime(value);
  const slotConfig = procurementTimeSlots.find((item) => item.slot === slot) ?? procurementTimeSlots[0];

  return `${dateKey}T${slotConfig.time}`;
}

function getSlotFromDateTime(value: string): ProcurementTimeSlot {
  const hour = Number(value.match(/T(\d{2}):/)?.[1] ?? 0);
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";

  return "evening";
}

function formatDateKeyLabel(dateKey: string) {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateKey;

  return `${match[2]}/${match[3]}`;
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

function getUnavailableSlotsForStaffDate(
  availability: ProcurementStaffUnavailableSlot[],
  employeeId: string,
  date: string
) {
  return availability.filter((item) => item.employeeId === employeeId && item.date === date);
}

function getUnavailableSlotSet(
  availability: ProcurementStaffUnavailableSlot[],
  employeeId: string,
  date: string
) {
  return new Set(getUnavailableSlotsForStaffDate(availability, employeeId, date).map((item) => item.slot));
}

function isUnavailableDeadline(
  availability: ProcurementStaffUnavailableSlot[],
  employeeId: string,
  deadline: string
) {
  return getUnavailableSlotSet(availability, employeeId, getDateKeyFromDateTime(deadline)).has(getSlotFromDateTime(deadline));
}

function formatUnavailableNotice(
  availability: ProcurementStaffUnavailableSlot[],
  employeeId: string,
  deadline: string
) {
  const date = getDateKeyFromDateTime(deadline);
  const slot = getSlotFromDateTime(deadline);
  const entry = availability.find((item) => item.employeeId === employeeId && item.date === date && item.slot === slot);
  if (!entry) return "";

  const label = procurementTimeSlots.find((item) => item.slot === slot)?.label ?? "";
  return `${formatDateKeyLabel(date)} ${label} は購入担当の予定あり${entry.note ? `: ${entry.note}` : ""}`;
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
  if (availableProducts.length === 0) return item;
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

function readSavedNewOrderDraft(): NewOrderDraftSession | null {
  if (typeof window === "undefined") return null;

  try {
    const rawDraft = window.localStorage.getItem(newOrderDraftStorageKey);
    if (!rawDraft) return null;
    const parsed = JSON.parse(rawDraft) as Partial<NewOrderDraftSession>;
    const items = Array.isArray(parsed.items)
      ? parsed.items
          .map((item, index) => ({
            id: Number(item?.id) || Date.now() + index,
            productId: String(item?.productId ?? ""),
            category: String(item?.category ?? ""),
            subcategory: String(item?.subcategory ?? "未分類"),
            productName: String(item?.productName ?? ""),
            quantity: Math.min(999, Math.max(1, Number(item?.quantity) || 1)),
            unit: String(item?.unit ?? "個")
          }))
          .filter((item) => item.productId || item.productName)
      : [];

    if (
      !String(parsed.store ?? "") &&
      !String(parsed.note ?? "") &&
      items.length === 0
    ) {
      return null;
    }

    return {
      store: String(parsed.store ?? ""),
      deadline: String(parsed.deadline ?? "") || getDefaultDeadlineValue(),
      priority: String(parsed.priority ?? "中"),
      note: String(parsed.note ?? ""),
      requesterStaffId: String(parsed.requesterStaffId ?? ""),
      buyerStaffId: String(parsed.buyerStaffId ?? ""),
      categoryFilter: String(parsed.categoryFilter ?? ""),
      subcategoryFilter: String(parsed.subcategoryFilter ?? ""),
      items
    };
  } catch {
    return null;
  }
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
    const actualPrice = parsePriceValue(item.actualPrice);
    const referencePrice = Number(item.referencePrice ?? 0);

    if (item.unavailable && !item.storeFeedbackConfirmed) {
      items.push({
        id: `${baseId}-unavailable`,
        itemId: item.id,
        kind: "unavailable",
        orderId: item.orderId,
        product: item.productName,
        type: "購入不可",
        message: item.note ? `購入不可として処理されました。理由: ${item.note}` : "購入不可として処理されました。",
        store,
        status: "店舗確認待ち"
      });
    }

    if (item.unavailable) return items;

    if (actualPrice > 0 && referencePrice > 0 && actualPrice !== referencePrice && ["in_delivery", "delivered", "received"].includes(item.deliveryStatus ?? "")) {
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

    if (quantityDiff !== 0 && ["in_delivery", "delivered", "received"].includes(item.deliveryStatus ?? "")) {
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

    if (item.note && !item.storeFeedbackConfirmed && !item.unavailable && ["in_delivery", "delivered", "received"].includes(item.deliveryStatus ?? "")) {
      items.push({
        id: `${baseId}-note`,
        itemId: item.id,
        kind: "note",
        orderId: item.orderId,
        product: item.productName,
        type: "備考",
        message: item.note,
        store,
        status: "店舗確認待ち"
      });
    }

    return items;
  });

  return feedbackItems.length > 0 ? feedbackItems : fallbackItems;
}

function parsePriceValue(value?: string) {
  const price = Number(normalizeDecimalInput(String(value ?? "")));
  return Number.isFinite(price) ? price : 0;
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2
  }).format(value);
}

export default function OrdersPage() {
  const { notice, showNotice, clearNotice } = useActionNotice();
  const hasRestoredNewOrderDraft = useRef(false);
  const shouldSkipInitialDraftSave = useRef(true);
  const storeConfirmationSaveChainsRef = useRef<Record<string, Promise<void>>>({});
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [storesData, setStoresData] = useState<StoreItem[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [purchaseOrderItems, setPurchaseOrderItems] = useState<PurchaseOrderItem[]>([]);
  const [deliveryBatches, setDeliveryBatches] = useState<DeliveryBatch[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [procurementStaffAvailability, setProcurementStaffAvailability] = useState<ProcurementStaffUnavailableSlot[]>([]);
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
  const [calendarStaffId, setCalendarStaffId] = useState("");
  const [calendarDate, setCalendarDate] = useState(getTodayDateKey());
  const [calendarSlots, setCalendarSlots] = useState<ProcurementTimeSlot[]>([]);
  const [calendarNote, setCalendarNote] = useState("");
  const [isSavingCalendar, setIsSavingCalendar] = useState(false);

  async function loadDashboardData() {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    if (!response.ok) return;

    const data = await response.json() as {
      stores?: StoreItem[];
      products?: ProductWithCategory[];
      orders?: PurchaseOrder[];
      purchaseOrderItems?: PurchaseOrderItem[];
      deliveryBatches?: DeliveryBatch[];
      staffOptions?: StaffOption[];
      procurementStaffAvailability?: ProcurementStaffUnavailableSlot[];
      currentUserId?: string;
    };

    if (data.stores) setStoresData(data.stores);
    if (data.products) {
      setProducts(data.products);
    }
    if (data.orders) setPurchaseOrders(data.orders);
    const pendingStoreConfirmations = readPendingStoreConfirmationActions();
    if (data.purchaseOrderItems) setPurchaseOrderItems(applyPendingStoreConfirmationsToItems(data.purchaseOrderItems, pendingStoreConfirmations));
    if (data.deliveryBatches) setDeliveryBatches(applyPendingStoreConfirmationsToBatches(data.deliveryBatches, pendingStoreConfirmations));
    if (data.staffOptions) {
      setStaffOptions(data.staffOptions);
    }
    if (data.procurementStaffAvailability) setProcurementStaffAvailability(data.procurementStaffAvailability);
    if (data.currentUserId) setCurrentUserId(data.currentUserId);
    setDataSource("neon");
  }

  useEffect(() => {
    void loadDashboardData();
  }, []);

  useEffect(() => {
    const syncPendingStoreConfirmations = () => {
      const pendingActions = readPendingStoreConfirmationActions();
      if (pendingActions.length === 0) return;

      setPurchaseOrderItems((items) => applyPendingStoreConfirmationsToItems(items, pendingActions));
      setDeliveryBatches((batches) => applyPendingStoreConfirmationsToBatches(batches, pendingActions));

      pendingActions.forEach((action) => {
        void queueStoreConfirmationAction(action, { alreadyPending: true, silentFailure: true }).catch(() => undefined);
      });
    };

    const syncWhenVisible = () => {
      if (document.visibilityState === "visible") syncPendingStoreConfirmations();
    };

    syncPendingStoreConfirmations();
    window.addEventListener("online", syncPendingStoreConfirmations);
    document.addEventListener("visibilitychange", syncWhenVisible);

    return () => {
      window.removeEventListener("online", syncPendingStoreConfirmations);
      document.removeEventListener("visibilitychange", syncWhenVisible);
    };
  }, []);

  useEffect(() => {
    const savedDraft = readSavedNewOrderDraft();
    hasRestoredNewOrderDraft.current = true;

    if (!savedDraft) return;

    setDraftStore(savedDraft.store);
    setDraftDeadline(savedDraft.deadline);
    setDraftPriority(savedDraft.priority || "中");
    setDraftNote(savedDraft.note);
    setDraftRequesterStaffId(savedDraft.requesterStaffId);
    setDraftBuyerStaffId(savedDraft.buyerStaffId);
    setDraftCategoryFilter(savedDraft.categoryFilter);
    setDraftSubcategoryFilter(savedDraft.subcategoryFilter);
    setOrderItemDrafts(savedDraft.items);
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
  const draftAssignableStaff = getAssignableStaffOptions(staffOptions, selectedDraftStore, currentUserId);
  const selectedDraftStoreDefaultBuyerId = orderableStores.find((store) => store.name === selectedDraftStore)?.defaultProcurementStaffId ?? "";
  const selectedDraftRequesterStaffId = getSelectedRequesterStaffId(draftRequesterStaffId, draftAssignableStaff, selectedDraftStore, currentUserId);
  const selectedDraftBuyerStaffId = getSelectedBuyerStaffId(draftBuyerStaffId, draftAssignableStaff, selectedDraftStore, currentUserId, selectedDraftStoreDefaultBuyerId);
  const draftDeadlineDate = getDateKeyFromDateTime(draftDeadline);
  const draftUnavailableSlots = getUnavailableSlotSet(procurementStaffAvailability, selectedDraftBuyerStaffId, draftDeadlineDate);
  const draftUnavailableNotice = formatUnavailableNotice(procurementStaffAvailability, selectedDraftBuyerStaffId, draftDeadline);
  const selectedCalendarStaffId = getSelectedStaffId(calendarStaffId || selectedDraftBuyerStaffId, staffOptions);
  const calendarDayEntries = getUnavailableSlotsForStaffDate(procurementStaffAvailability, selectedCalendarStaffId, calendarDate);
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
  const editingAssignableStaff = editingOrder ? getAssignableStaffOptions(staffOptions, editingOrder.store, currentUserId) : [];
  const selectedEditingBuyerStaffId = editingOrder ? getSelectedStaffId(editingOrder.buyerStaffId, editingAssignableStaff) : "";
  const editingDeadlineDate = editingOrder ? getDateKeyFromDateTime(editingOrder.deadline) : getTodayDateKey();
  const editingUnavailableSlots = editingOrder
    ? getUnavailableSlotSet(procurementStaffAvailability, selectedEditingBuyerStaffId, editingDeadlineDate)
    : new Set<ProcurementTimeSlot>();
  const editingUnavailableNotice = editingOrder
    ? formatUnavailableNotice(procurementStaffAvailability, selectedEditingBuyerStaffId, editingOrder.deadline)
    : "";
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
    setDraftBuyerStaffId((current) => getSelectedBuyerStaffId(current, draftAssignableStaff, selectedDraftStore, currentUserId, selectedDraftStoreDefaultBuyerId));
  }, [selectedDraftStore, currentUserId, staffOptions, selectedDraftStoreDefaultBuyerId]);

  useEffect(() => {
    setCalendarStaffId((current) => current || selectedDraftBuyerStaffId);
  }, [selectedDraftBuyerStaffId]);

  useEffect(() => {
    if (!selectedCalendarStaffId || !calendarDate) return;
    const entries = getUnavailableSlotsForStaffDate(procurementStaffAvailability, selectedCalendarStaffId, calendarDate);
    setCalendarSlots(entries.map((entry) => entry.slot));
    setCalendarNote(entries.find((entry) => entry.note)?.note ?? "");
  }, [selectedCalendarStaffId, calendarDate, procurementStaffAvailability]);

  useEffect(() => {
    if (!hasRestoredNewOrderDraft.current || typeof window === "undefined") return;
    if (shouldSkipInitialDraftSave.current) {
      shouldSkipInitialDraftSave.current = false;
      return;
    }

    const draft: NewOrderDraftSession = {
      store: selectedDraftStore,
      deadline: draftDeadline,
      priority: draftPriority,
      note: draftNote,
      requesterStaffId: selectedDraftRequesterStaffId,
      buyerStaffId: selectedDraftBuyerStaffId,
      categoryFilter: selectedDraftCategory,
      subcategoryFilter: selectedDraftSubcategory,
      items: orderItemDrafts.filter((item) => item.productId || item.productName)
    };
    const hasDraftContent = draft.items.length > 0 || draft.note.trim().length > 0;

    if (!hasDraftContent) {
      window.localStorage.removeItem(newOrderDraftStorageKey);
      return;
    }

    window.localStorage.setItem(newOrderDraftStorageKey, JSON.stringify(draft));
  }, [
    selectedDraftStore,
    draftDeadline,
    draftPriority,
    draftNote,
    selectedDraftRequesterStaffId,
    selectedDraftBuyerStaffId,
    selectedDraftCategory,
    selectedDraftSubcategory,
    orderItemDrafts
  ]);

  function getQueueFilterCount(filter: QueueFilter) {
    if (filter === "未完了") return purchaseOrders.filter((order) => order.status !== "完了").length;
    if (filter === "今日対応") return purchaseOrders.filter((order) => order.status !== "完了" && isTodayOrder(order)).length;
    if (filter === "配送待ち") {
      return purchaseOrders.filter((order) => ["配送待ち", "配送中", "一部納品済み"].includes(order.status)).length;
    }
    if (filter === "完了") return purchaseOrders.filter((order) => order.status === "完了").length;

    return purchaseOrders.length;
  }

  function queueStoreConfirmationAction(
    action: PendingStoreConfirmationAction,
    options: { alreadyPending?: boolean; silentFailure?: boolean } = {}
  ) {
    if (!options.alreadyPending) writePendingStoreConfirmationAction(action);

    const previousSave = storeConfirmationSaveChainsRef.current[action.id];
    const saveRequest = previousSave
      ? previousSave.catch(() => undefined).then(() => performStoreConfirmationAction(action))
      : performStoreConfirmationAction(action);
    const nextSave = saveRequest
      .then(() => removePendingStoreConfirmationAction(action.id, action.updatedAt))
      .then(() => {
        void loadDashboardData();
      })
      .catch((error: Error) => {
        if (!options.silentFailure) {
          window.alert(error.message || "確認状態を保存できませんでした。通信が戻ると自動で再保存します。");
        }
        throw error;
      })
      .finally(() => {
        if (storeConfirmationSaveChainsRef.current[action.id] === nextSave) {
          delete storeConfirmationSaveChainsRef.current[action.id];
        }
      });

    storeConfirmationSaveChainsRef.current[action.id] = nextSave;
    return nextSave;
  }

  function toggleCalendarSlot(slot: ProcurementTimeSlot) {
    setCalendarSlots((current) =>
      current.includes(slot)
        ? current.filter((item) => item !== slot)
        : [...current, slot]
    );
  }

  async function saveProcurementCalendar() {
    if (!selectedCalendarStaffId || isSavingCalendar) return;

    setIsSavingCalendar(true);
    try {
      const response = await fetch("/api/procurement/availability", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: selectedCalendarStaffId,
          date: calendarDate,
          slots: calendarSlots,
          note: calendarNote
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        window.alert(body.error ?? "購入担当の予定を保存できませんでした。");
        return;
      }

      showNotice("購入担当の予定を保存しました。");
      await loadDashboardData();
    } finally {
      setIsSavingCalendar(false);
    }
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
    setDraftRequesterStaffId(currentUserId || order.requesterStaffId || "");
    setDraftBuyerStaffId("");
    setOrderItemDrafts(items.length > 0 ? items : [
      createOrderItemDraftFromProduct(availableProducts[0])
    ]);

    showNotice("過去の依頼を新規依頼にコピーしました。", "info");
    document.getElementById("create-order-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submitNewOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmittingOrder) return;

    if (isUnavailableDeadline(procurementStaffAvailability, selectedDraftBuyerStaffId, draftDeadline)) {
      window.alert(`${draftUnavailableNotice}。別の時間帯を選択してください。`);
      return;
    }

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
      window.localStorage.removeItem(newOrderDraftStorageKey);
      await loadDashboardData();
    } finally {
      setIsSubmittingOrder(false);
    }
  }

  async function markDeliveryBatchReceived(batch: DeliveryBatch) {
    const confirmedLabel = getCurrentDateTimeLabel();
    const action: PendingStoreConfirmationAction = {
      id: `batch:${batch.id}`,
      type: "batch_received",
      batchId: batch.id,
      itemIds: batch.itemIds,
      updatedAt: Date.now()
    };

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

    void queueStoreConfirmationAction(action)
      .then(() => showNotice("店舗確認済みにしました。"))
      .catch(() => undefined);
  }

  async function markOrderItemsReceived(orderId: string, items: PurchaseOrderItem[]) {
    const targetItems = items.filter((item) => item.id && item.deliveryStatus === "delivered");

    if (targetItems.length === 0) return;
    const itemIds = targetItems.flatMap((item) => item.id ? [item.id] : []);
    const action: PendingStoreConfirmationAction = {
      id: `items:${orderId}:${itemIds.sort().join(",")}`,
      type: "items_received",
      itemIds,
      updatedAt: Date.now()
    };

    setPurchaseOrderItems((currentItems) =>
      currentItems.map((item) =>
        item.orderId === orderId && item.id && targetItems.some((target) => target.id === item.id)
          ? { ...item, deliveryStatus: "received" }
          : item
      )
    );

    void queueStoreConfirmationAction(action)
      .then(() => showNotice("店舗確認済みにしました。"))
      .catch(() => undefined);
  }

  async function confirmStoreFeedback(item: StoreFeedback) {
    if (!item.itemId || !item.kind) return;

    const orderItem = purchaseOrderItems.find((candidate) => candidate.id === item.itemId);
    if (!orderItem && item.kind === "quantity") return;
    const action: PendingStoreConfirmationAction = {
      id: `feedback:${item.itemId}:${item.kind}`,
      type: "feedback_confirmed",
      feedback: {
        itemId: item.itemId,
        kind: item.kind,
        requestedQuantity: orderItem?.requestedQuantity
      },
      updatedAt: Date.now()
    };

    setPurchaseOrderItems((items) => applyPendingStoreConfirmationsToItems(items, [action]));
    void queueStoreConfirmationAction(action)
      .then(() => showNotice("確認済みにしました。"))
      .catch(() => undefined);
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

    if (isUnavailableDeadline(procurementStaffAvailability, selectedEditingBuyerStaffId, editingOrder.deadline)) {
      window.alert(`${editingUnavailableNotice}。別の時間帯を選択してください。`);
      return;
    }

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
        <a className="brand-block" href="/os" aria-label="OS ホームへ戻る">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>Foundr1 OS</h1>
          </div>
        </a>
        <MobileNavMenu navItems={navItems} />
        <div className="sidebar-user">
          <UserBadge />
        </div>
        <OsNavList navItems={navItems} />
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">店舗からの発注依頼</p>
            <h2>発注依頼</h2>
            <span className="source-indicator">{dataSource === "neon" ? "データ同期済み" : "読み込み中"}</span>
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
            <div className="deadline-slot-picker">
              <span>{formatDateKeyLabel(draftDeadlineDate)} の時間帯</span>
              <div>
                {procurementTimeSlots.map((slot) => {
                  const isUnavailable = draftUnavailableSlots.has(slot.slot);
                  const isSelected = getSlotFromDateTime(draftDeadline) === slot.slot;

                  return (
                    <button
                      type="button"
                      className={isSelected ? "slot-button is-active" : "slot-button"}
                      disabled={isUnavailable}
                      onClick={() => setDraftDeadline(setDateTimeSlot(draftDeadline, slot.slot))}
                      key={slot.slot}
                    >
                      <strong>{slot.label}</strong>
                      <small>{isUnavailable ? "予定あり" : slot.time}</small>
                    </button>
                  );
                })}
              </div>
              {draftUnavailableNotice ? <p>{draftUnavailableNotice}</p> : null}
            </div>
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
            <section className="procurement-calendar-panel" aria-label="購入担当カレンダー">
              <div className="procurement-calendar-heading">
                <CalendarDays size={18} />
                <div>
                  <strong>購入担当カレンダー</strong>
                  <span>事前に予定がある日を登録し、発注依頼の締切選択から避けます。</span>
                </div>
              </div>
              <label>
                <span>購入担当</span>
                <select value={selectedCalendarStaffId} onChange={(event) => setCalendarStaffId(event.target.value)}>
                  {staffOptions.map((staff) => (
                    <option value={staff.id} key={staff.id}>{staff.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>日付</span>
                <input type="date" value={calendarDate} onChange={(event) => setCalendarDate(event.target.value)} />
              </label>
              <div className="calendar-slot-toggle">
                <span>予定あり</span>
                <div>
                  {procurementTimeSlots.map((slot) => (
                    <button
                      type="button"
                      className={calendarSlots.includes(slot.slot) ? "slot-button is-active" : "slot-button"}
                      onClick={() => toggleCalendarSlot(slot.slot)}
                      key={slot.slot}
                    >
                      <strong>{slot.label}</strong>
                      <small>{slot.description}</small>
                    </button>
                  ))}
                </div>
              </div>
              <label>
                <span>メモ</span>
                <input value={calendarNote} onChange={(event) => setCalendarNote(event.target.value)} placeholder="例: 外出、商談、会議" />
              </label>
              <button type="button" className="secondary-button" disabled={!selectedCalendarStaffId || isSavingCalendar} onClick={() => void saveProcurementCalendar()}>
                {isSavingCalendar ? "保存中" : "予定を保存"}
              </button>
              {calendarDayEntries.length > 0 ? (
                <p>{calendarDayEntries.map((entry) => procurementTimeSlots.find((slot) => slot.slot === entry.slot)?.label).filter(Boolean).join("、")} は予定あり</p>
              ) : null}
            </section>
            <label>
              <span>メモ</span>
              <textarea name="note" value={draftNote} onChange={(event) => setDraftNote(event.target.value)} placeholder="欠品時の代替、配送希望など" />
            </label>
            <div className="order-items-builder">
              <div className="builder-heading">
                <strong>依頼商品リスト</strong>
                <span>{orderItemDrafts.filter((item) => item.productId || item.productName).length} 件</span>
                <a className="secondary-button" href="/os/products?from=orders&new=1">
                  <Plus size={16} />
                  商品マスタに追加
                </a>
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
                          <small>{product.variantName || product.productBrandName || product.mainSupplier || "詳細未設定"}</small>
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
                        href={`/os/procurement?order=${encodeURIComponent(order.id)}`}
                        aria-label={`${order.id} の購入管理`}
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
                          {getStoreFeedbackConfirmLabel(item.kind)}
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
        <ModalHistoryScope historyKey="orders-edit" onClose={() => setEditingOrder(null)}>
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
                    const nextAssignableStaff = getAssignableStaffOptions(staffOptions, nextStore, currentUserId);
                    const nextDefaultBuyerId = orderableStores.find((store) => store.name === nextStore)?.defaultProcurementStaffId ?? "";
                    setEditingOrder((current) => current ? {
                      ...current,
                      store: nextStore,
                      buyerStaffId: getSelectedBuyerStaffId("", nextAssignableStaff, nextStore, currentUserId, nextDefaultBuyerId),
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
              <div className="deadline-slot-picker">
                <span>{formatDateKeyLabel(editingDeadlineDate)} の時間帯</span>
                <div>
                  {procurementTimeSlots.map((slot) => {
                    const isUnavailable = editingUnavailableSlots.has(slot.slot);
                    const isSelected = getSlotFromDateTime(editingOrder.deadline) === slot.slot;

                    return (
                      <button
                        type="button"
                        className={isSelected ? "slot-button is-active" : "slot-button"}
                        disabled={isUnavailable}
                        onClick={() => setEditingOrder((current) => current ? { ...current, deadline: setDateTimeSlot(current.deadline, slot.slot) } : current)}
                        key={slot.slot}
                      >
                        <strong>{slot.label}</strong>
                        <small>{isUnavailable ? "予定あり" : slot.time}</small>
                      </button>
                    );
                  })}
                </div>
                {editingUnavailableNotice ? <p>{editingUnavailableNotice}</p> : null}
              </div>
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
        </ModalHistoryScope>
      ) : null}
      <ActionNotice notice={notice} onClose={clearNotice} />
    </main>
  );
}

async function performStoreConfirmationAction(action: PendingStoreConfirmationAction) {
  if (action.type === "batch_received") {
    if (!action.batchId) throw new Error("店舗確認対象が見つかりません。");
    const response = await fetch("/api/procurement/delivery-batches", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batchId: action.batchId,
        status: "received"
      })
    });
    if (response.ok) return;
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? "店舗確認を保存できませんでした。");
  }

  if (action.type === "items_received") {
    const itemIds = action.itemIds ?? [];
    if (itemIds.length === 0) throw new Error("店舗確認対象が見つかりません。");
    await Promise.all(itemIds.map((itemId) =>
      fetch("/api/procurement/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          deliveryStatus: "received"
        })
      }).then(async (response) => {
        if (response.ok) return;
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "店舗確認を保存できませんでした。");
      })
    ));
    return;
  }

  const feedback = action.feedback;
  if (!feedback?.itemId || !feedback.kind) throw new Error("確認対象が見つかりません。");
  const payload = feedback.kind === "quantity"
    ? { itemId: feedback.itemId, actualQuantity: feedback.requestedQuantity }
    : feedback.kind === "price"
      ? { itemId: feedback.itemId, clearActualPrice: true }
      : { itemId: feedback.itemId, confirmStoreFeedback: true };
  const response = await fetch("/api/procurement/items", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (response.ok) return;
  const body = await response.json().catch(() => ({})) as { error?: string };
  throw new Error(body.error ?? "確認状態を保存できませんでした。");
}

function readPendingStoreConfirmationActions() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(pendingStoreConfirmationStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((entry) => {
      const action = normalizePendingStoreConfirmationAction(entry);
      return action ? [action] : [];
    });
  } catch {
    try {
      window.localStorage.removeItem(pendingStoreConfirmationStorageKey);
    } catch {
      // Ignore storage cleanup failures.
    }
    return [];
  }
}

function writePendingStoreConfirmationAction(action: PendingStoreConfirmationAction) {
  if (typeof window === "undefined") return;
  try {
    const actions = readPendingStoreConfirmationActions();
    const nextActions = [
      ...actions.filter((item) => item.id !== action.id),
      action
    ];
    window.localStorage.setItem(pendingStoreConfirmationStorageKey, JSON.stringify(nextActions));
  } catch {
    // Best-effort; the live request still runs.
  }
}

function removePendingStoreConfirmationAction(actionId: string, updatedAt: number) {
  if (typeof window === "undefined") return;
  try {
    const actions = readPendingStoreConfirmationActions();
    const nextActions = actions.filter((action) => action.id !== actionId || action.updatedAt !== updatedAt);
    if (nextActions.length === 0) {
      window.localStorage.removeItem(pendingStoreConfirmationStorageKey);
      return;
    }
    window.localStorage.setItem(pendingStoreConfirmationStorageKey, JSON.stringify(nextActions));
  } catch {
    // Ignore cleanup failures; a later successful sync can clear the action.
  }
}

function normalizePendingStoreConfirmationAction(value: unknown): PendingStoreConfirmationAction | null {
  if (!value || typeof value !== "object") return null;
  const action = value as Partial<PendingStoreConfirmationAction>;
  const type = action.type;
  if (type !== "batch_received" && type !== "items_received" && type !== "feedback_confirmed") return null;
  const id = String(action.id ?? "").trim();
  if (!id) return null;

  if (type === "batch_received") {
    const batchId = String(action.batchId ?? "").trim();
    if (!batchId) return null;
    return {
      id,
      type,
      batchId,
      itemIds: Array.isArray(action.itemIds) ? action.itemIds.map(String).filter(Boolean) : [],
      updatedAt: Number(action.updatedAt) || Date.now()
    };
  }

  if (type === "items_received") {
    const itemIds = Array.isArray(action.itemIds) ? action.itemIds.map(String).filter(Boolean) : [];
    if (itemIds.length === 0) return null;
    return {
      id,
      type,
      itemIds,
      updatedAt: Number(action.updatedAt) || Date.now()
    };
  }

  const feedback = action.feedback;
  const itemId = String(feedback?.itemId ?? "").trim();
  const kind = feedback?.kind;
  if (!itemId || (kind !== "price" && kind !== "quantity" && kind !== "note" && kind !== "unavailable")) return null;
  return {
    id,
    type,
    feedback: {
      itemId,
      kind,
      requestedQuantity: Number(feedback?.requestedQuantity) || undefined
    },
    updatedAt: Number(action.updatedAt) || Date.now()
  };
}

function applyPendingStoreConfirmationsToItems(
  items: PurchaseOrderItem[],
  actions: PendingStoreConfirmationAction[]
) {
  if (actions.length === 0) return items;
  const receivedItemIds = new Set<string>();
  const feedbackActions = new Map<string, NonNullable<PendingStoreConfirmationAction["feedback"]>>();

  actions.forEach((action) => {
    if (action.type === "batch_received" || action.type === "items_received") {
      action.itemIds?.forEach((itemId) => receivedItemIds.add(itemId));
    }
    if (action.type === "feedback_confirmed" && action.feedback) {
      feedbackActions.set(`${action.feedback.itemId}:${action.feedback.kind}`, action.feedback);
    }
  });

  return items.map((item) => {
    if (!item.id) return item;
    let nextItem = receivedItemIds.has(item.id) ? { ...item, deliveryStatus: "received" as const } : item;

    for (const feedback of feedbackActions.values()) {
      if (feedback.itemId !== item.id) continue;
      nextItem = feedback.kind === "quantity"
        ? { ...nextItem, actualQuantity: nextItem.requestedQuantity }
        : feedback.kind === "price"
          ? { ...nextItem, actualPrice: "" }
          : { ...nextItem, storeFeedbackConfirmed: true };
    }

    return nextItem;
  });
}

function applyPendingStoreConfirmationsToBatches(
  batches: DeliveryBatch[],
  actions: PendingStoreConfirmationAction[]
) {
  if (actions.length === 0) return batches;
  const receivedBatchIds = new Set(actions.flatMap((action) => (
    action.type === "batch_received" && action.batchId ? [action.batchId] : []
  )));
  if (receivedBatchIds.size === 0) return batches;
  const confirmedLabel = getCurrentDateTimeLabel();

  return batches.map((batch) => (
    receivedBatchIds.has(batch.id)
      ? { ...batch, status: "received" as const, storeConfirmedLabel: batch.storeConfirmedLabel ?? confirmedLabel }
      : batch
  ));
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

function getAssignableStaffOptions(staffOptions: StaffOption[], storeName: string, currentUserId?: string) {
  const storeLabel = storeName.replace("納品", "");
  return staffOptions
    .filter((staff) =>
      staff.id === currentUserId ||
      staff.storeNames.length === 0 ||
      staff.storeNames.includes(storeName) ||
      staff.storeNames.includes(storeLabel)
    )
    .sort((a, b) => getStaffStoreRelevance(a, storeName, currentUserId) - getStaffStoreRelevance(b, storeName, currentUserId));
}

function getStaffStoreRelevance(staff: StaffOption, storeName: string, currentUserId?: string) {
  if (currentUserId && staff.id === currentUserId) return -100;

  const rolePriority: Record<string, number> = {
    store_owner: 0,
    store_manager: 1,
    staff: 2,
    manager: 3,
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

  const currentUser = staffOptions.find((staff) => staff.id === currentUserId);
  if (currentUser) return currentUser.id;

  const storeStaff = staffOptions.filter((staff) => staff.role !== "owner" && isStaffAssignedToStore(staff, storeName));
  if (storeStaff.length > 0) {
    return storeStaff[0].id;
  }

  const currentFallback = staffOptions.find((staff) => staff.id === currentId && staff.role !== "owner");
  if (currentFallback) return currentFallback.id;

  return staffOptions.find((staff) => staff.role !== "owner")?.id ?? staffOptions[0]?.id ?? "";
}

function getSelectedBuyerStaffId(currentId: string, staffOptions: StaffOption[], storeName: string, currentUserId?: string, defaultBuyerStaffId?: string) {
  const currentStaff = staffOptions.find((staff) => staff.id === currentId);
  if (currentStaff && (isStaffAssignedToStore(currentStaff, storeName) || currentStaff.role === "owner")) return currentStaff.id;

  const defaultBuyerStaff = staffOptions.find((staff) => staff.id === defaultBuyerStaffId);
  if (defaultBuyerStaff) return defaultBuyerStaff.id;

  return staffOptions.find((staff) => staff.role === "store_owner" && isStaffAssignedToStore(staff, storeName))?.id ??
    staffOptions.find((staff) => staff.role === "store_manager" && isStaffAssignedToStore(staff, storeName))?.id ??
    staffOptions.find((staff) => staff.role === "owner")?.id ??
    staffOptions.find((staff) => staff.id === currentUserId)?.id ??
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
