"use client";

import { Boxes, ChevronDown, ClipboardList, FileText, Lightbulb, MessageSquareWarning, PackageCheck, Plus, Search, Store, Truck, LogOut, UserCog } from "lucide-react";
import { UserBadge } from "../components/UserBadge";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { ActionNotice, useActionNotice } from "../components/ActionNotice";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  orders,
  productSupplierOptions as initialProductSupplierOptions,
  products as initialProducts,
  suppliers as initialSuppliers
} from "../../../lib/mock-data";
import { normalizeDecimalInput } from "../../../lib/number-input";

type Product = typeof initialProducts[number] & {
  id?: string;
  subcategory?: string;
  packageSpec?: string;
  productBrandName?: string;
  productFamilyName?: string;
  variantName?: string;
  variantSortOrder?: number | string;
  mainSupplier?: string;
  backupSupplier?: string;
  usageType?: string;
};
type ProductSupplierGroup = Omit<typeof initialProductSupplierOptions[number], "options"> & {
  options: Array<typeof initialProductSupplierOptions[number]["options"][number] & { purchaseUrl?: string }>;
};
type Supplier = typeof initialSuppliers[number];
type PurchaseOrder = typeof orders[number] & {
  deadlineAt?: string | null;
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
  unavailable?: boolean;
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
  unavailable: boolean;
  note: string;
  priceExceptionNote: string;
  deliveryStatus: "pending" | "in_delivery" | "delivered" | "received";
  deliveryBatchId?: string;
};
type DeliveryState = {
  status: "not_started" | "online_ordered";
  expectedArrivalDate: string;
};
type SupplierFulfillment = DeliveryState & {
  id?: string;
  orderId: string;
  supplier: string;
  receiptPhotoUrl?: string;
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
type OnlineSupplierFulfillmentGroup = {
  supplier: string;
  totalCount: number;
  purchasedCount: number;
  unavailableCount: number;
  deliveredCount: number;
  receivedCount: number;
  state: DeliveryState;
};
type ProcurementStatusFilter = "未完了" | "購入待ち" | "一部購入済み" | "到着日入力待ち" | "到着待ち" | "配送待ち" | "配送中" | "一部納品済み" | "確認待ち" | "完了" | "すべて";
type ProductLookup = {
  byId: Map<string, Product>;
  byName: Map<string, Product>;
};
type AdditionalPurchaseDraft = {
  mode: "product" | "temporary";
  productId: string;
  temporaryProductName: string;
  temporaryProductUnit: string;
  quantity: number;
  note: string;
};

const additionalPurchaseDraftStorageKey = "foundr1-os:procurement-additional-purchase-drafts:v1";
const pendingProcurementTaskItemStorageKey = "foundr1-os:procurement-pending-task-items:v1";

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
const procurementStatusFilters: ProcurementStatusFilter[] = ["未完了", "購入待ち", "一部購入済み", "到着日入力待ち", "到着待ち", "配送待ち", "配送中", "一部納品済み", "確認待ち", "完了", "すべて"];
const actualQuantityOptions = Array.from({ length: 1000 }, (_, index) => index);
const purchaseQuantityOptions = Array.from({ length: 999 }, (_, index) => index + 1);
const procurementOrderRenderBatchSize = 20;
const temporaryProductUnitOptions = ["個", "袋", "本", "箱", "kg", "g", "L", "ml", "枚"];
const maxReceiptUploadBytes = 4 * 1024 * 1024;
const maxReceiptPdfUploadBytes = 50 * 1024 * 1024;
const receiptCompressionTargetBytes = 2 * 1024 * 1024;
const receiptCompressionEdges = [1800, 1400, 1100];
const receiptCompressionQualities = [0.82, 0.72, 0.62];

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

  const productByName = new Map(productList.map((product) => [product.name, product]));
  const itemsByOrderId = new Map<string, DashboardOrderItem[]>();
  purchaseOrderItems.forEach((item) => {
    const items = itemsByOrderId.get(item.orderId) ?? [];
    items.push(item);
    itemsByOrderId.set(item.orderId, items);
  });

  return purchaseOrders.flatMap((order, orderIndex) => {
    const orderItems = itemsByOrderId.get(order.id) ?? [];

    if (orderItems.length > 0) {
      return orderItems.map((item, itemIndex) => {
        const product = productByName.get(item.productName);

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
          unavailable: item.unavailable ?? false,
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
        unavailable: false,
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

function findProcurementProductFromLookup(item: ProcurementTaskItem, productLookup: ProductLookup) {
  return (item.productId ? productLookup.byId.get(item.productId) : undefined)
    ?? productLookup.byName.get(item.productName);
}

function getProductFamilyLabel(product: Product | undefined, fallbackName: string) {
  return String(product?.productFamilyName ?? "").trim() || fallbackName;
}

function getAlternativeVariantOptions(item: ProcurementTaskItem, products: Product[]) {
  const currentProduct = products.find((product) => product.id === item.productId)
    ?? products.find((product) => product.name === item.productName);
  const familyName = getProductFamilyLabel(currentProduct, item.productName);
  const normalizedFamilyName = familyName.trim().toLowerCase();

  return products
    .filter((product) => product.id)
    .filter((product) => getProductFamilyLabel(product, product.name).trim().toLowerCase() === normalizedFamilyName)
    .sort((left, right) => {
      const leftOrder = Number(left.variantSortOrder ?? 0);
      const rightOrder = Number(right.variantSortOrder ?? 0);
      return leftOrder - rightOrder || left.name.localeCompare(right.name, "ja", { numeric: true, sensitivity: "base" });
    });
}

function appendReplacementNote(note: string, fromName: string, toName: string) {
  const marker = "代替購入:";
  const cleanNote = note
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(marker))
    .join("\n")
    .trim();
  const replacementLine = `${marker} ${fromName} → ${toName}`;

  return [cleanNote, replacementLine].filter(Boolean).join("\n");
}

function compareProcurementItemsBySubcategory(a: ProcurementTaskItem, b: ProcurementTaskItem, productLookup: ProductLookup) {
  const productA = findProcurementProductFromLookup(a, productLookup);
  const productB = findProcurementProductFromLookup(b, productLookup);
  const subcategoryCompare = String(productA?.subcategory ?? "未分類").localeCompare(
    String(productB?.subcategory ?? "未分類"),
    "ja",
    { numeric: true, sensitivity: "base" }
  );

  if (subcategoryCompare !== 0) return subcategoryCompare;

  return a.productName.localeCompare(b.productName, "ja", { numeric: true, sensitivity: "base" });
}

function sortProcurementItemsBySubcategory(items: ProcurementTaskItem[], productLookup: ProductLookup) {
  return [...items].sort((a, b) => compareProcurementItemsBySubcategory(a, b, productLookup));
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

function getPurchaseUrlForItem(item: ProcurementTaskItem, supplierOptions: ProductSupplierGroup[]) {
  const supplier = normalizeSupplierName(item.supplier);
  if (!supplier) return "";

  return supplierOptions
    .find((group) => group.product === item.productName)
    ?.options.find((option) => normalizeSupplierName(option.supplier) === supplier)
    ?.purchaseUrl ?? "";
}

function getTemporarySupplierNote(note: string) {
  return note.split(/\r?\n/)
    .find((line) => line.startsWith("臨時購入先:"))
    ?.replace(/^臨時購入先:/, "")
    .trim() ?? "";
}

function isAdditionalPurchaseNote(note: string) {
  return note.startsWith("追加購入");
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

function groupTasksBySupplierFast(
  items: ProcurementTaskItem[],
  supplierByProductName: Map<string, string>
) {
  const groups = new Map<string, ProcurementTaskItem[]>();

  items.forEach((item) => {
    const supplier = item.supplier || supplierByProductName.get(item.productName) || "未設定";
    const groupItems = groups.get(supplier) ?? [];
    groupItems.push(item);
    groups.set(supplier, groupItems);
  });

  return Array.from(groups.entries()).map(([supplier, groupItems]) => ({ supplier, items: groupItems }));
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

function hasDeliveryOrderSupplierFast(items: ProcurementTaskItem[], supplierByName: Map<string, Supplier>) {
  return items.some((item) => isDeliveryOrderItem(item, supplierByName));
}

function isDeliveryOrderItem(item: ProcurementTaskItem, supplierByName: Map<string, Supplier>) {
  const supplier = supplierByName.get(item.supplier);
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
}

function getOrderStatus(
  order: PurchaseOrder,
  items: ProcurementTaskItem[],
  deliveryState: DeliveryState,
  supplierList: Supplier[]
) {
  if (items.length === 0) return order.status;

  const unavailableCount = items.filter((item) => item.unavailable).length;
  const purchasedCount = items.filter((item) => item.purchased).length;
  const deliveredCount = items.filter((item) => item.deliveryStatus === "delivered").length;
  const deliveryCount = items.filter((item) => item.deliveryStatus === "in_delivery").length;

  const receivedCount = items.filter((item) => item.deliveryStatus === "received").length;

  if (receivedCount + unavailableCount === items.length) return "完了";
  if (deliveredCount + receivedCount + unavailableCount === items.length) return "確認待ち";
  if (deliveryCount > 0) return "配送中";
  if (deliveredCount > 0) return "一部納品済み";
  if (purchasedCount + unavailableCount === 0) return "購入待ち";
  if (purchasedCount + unavailableCount < items.length) return "一部購入済み";
  if (hasDeliveryOrderSupplier(items, supplierList)) {
    if (deliveryState.status === "online_ordered" && deliveryState.expectedArrivalDate) return "到着待ち";
    return "到着日入力待ち";
  }
  if (deliveryState.status === "online_ordered" && deliveryState.expectedArrivalDate) return "到着待ち";

  return "配送待ち";
}

function getOrderStatusFast(
  order: PurchaseOrder,
  items: ProcurementTaskItem[],
  deliveryState: DeliveryState,
  supplierByName: Map<string, Supplier>
) {
  if (items.length === 0) return order.status;

  let unavailableCount = 0;
  let purchasedCount = 0;
  let deliveredCount = 0;
  let deliveryCount = 0;
  let receivedCount = 0;

  items.forEach((item) => {
    if (item.unavailable) unavailableCount += 1;
    if (item.purchased) purchasedCount += 1;
    if (item.deliveryStatus === "delivered") deliveredCount += 1;
    if (item.deliveryStatus === "in_delivery") deliveryCount += 1;
    if (item.deliveryStatus === "received") receivedCount += 1;
  });

  if (receivedCount + unavailableCount === items.length) return "完了";
  if (deliveredCount + receivedCount + unavailableCount === items.length) return "確認待ち";
  if (deliveryCount > 0) return "配送中";
  if (deliveredCount > 0) return "一部納品済み";
  if (purchasedCount + unavailableCount === 0) return "購入待ち";
  if (purchasedCount + unavailableCount < items.length) return "一部購入済み";
  if (hasDeliveryOrderSupplierFast(items, supplierByName)) {
    if (deliveryState.status === "online_ordered" && deliveryState.expectedArrivalDate) return "到着待ち";
    return "到着日入力待ち";
  }
  if (deliveryState.status === "online_ordered" && deliveryState.expectedArrivalDate) return "到着待ち";

  return "配送待ち";
}

function getSupplierDeliveryStateKey(orderId: string, supplier: string) {
  return `${orderId}::${supplier}`;
}

function getSupplierDeliveryState(
  deliveryStates: Record<string, DeliveryState>,
  orderId: string,
  supplier: string
) {
  return deliveryStates[getSupplierDeliveryStateKey(orderId, supplier)] ?? { status: "not_started", expectedArrivalDate: "" };
}

function getAggregateDeliveryStateForOrder(
  deliveryStates: Record<string, DeliveryState>,
  orderId: string,
  items: ProcurementTaskItem[],
  supplierByName: Map<string, Supplier>
) {
  const deliverySuppliers = Array.from(new Set(
    items
      .filter((item) => isDeliveryOrderItem(item, supplierByName))
      .map((item) => item.supplier)
      .filter(Boolean)
  ));

  if (deliverySuppliers.length === 0) return { status: "not_started" as const, expectedArrivalDate: "" };

  const supplierStates = deliverySuppliers.map((supplier) => getSupplierDeliveryState(deliveryStates, orderId, supplier));
  const allOrdered = supplierStates.every((state) => state.status === "online_ordered" && Boolean(state.expectedArrivalDate));

  return {
    status: allOrdered ? "online_ordered" as const : "not_started" as const,
    expectedArrivalDate: allOrdered ? supplierStates.map((state) => state.expectedArrivalDate).sort().at(-1) ?? "" : ""
  };
}

function getOrderDeadlineSortValue(order: PurchaseOrder) {
  if (order.deadlineAt) {
    const time = new Date(order.deadlineAt).getTime();
    if (Number.isFinite(time)) return time;
  }

  return Number.POSITIVE_INFINITY;
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

function isDeliveryLockedItem(item: Pick<ProcurementTaskItem, "deliveryStatus">) {
  return ["in_delivery", "delivered", "received"].includes(item.deliveryStatus);
}

async function saveProcurementTaskItem(item: ProcurementTaskItem) {
  const response = await fetch("/api/procurement/items", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      itemId: item.id,
      purchased: item.purchased,
      unavailable: item.unavailable,
      actualQuantity: item.actualQuantity,
      actualPrice: item.actualPrice,
      note: item.note,
      supplier: item.supplier,
      productId: item.productId ?? "",
      productName: item.productName,
      unit: item.unit,
      deliveryStatus: item.deliveryStatus
    })
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? "発注明細を保存できませんでした。");
  }
}

async function uploadProcurementReceipt(orderId: string, supplier: string, file: File) {
  const formData = new FormData();
  formData.set("orderId", orderId);
  formData.set("supplier", supplier);
  formData.set("receipt", file);

  const response = await fetch("/api/procurement/receipts", {
    method: "POST",
    body: formData
  });
  const body = await response.json().catch(() => ({})) as { receiptUrl?: string; error?: string };

  if (!response.ok || !body.receiptUrl) {
    throw new Error(body.error ?? "レシート写真を保存できませんでした。");
  }

  return body.receiptUrl;
}

function isPdfReceiptFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isReceiptUploadFile(file: File) {
  return file.type.startsWith("image/") || isPdfReceiptFile(file);
}

async function prepareReceiptUploadFile(file: File) {
  if (isPdfReceiptFile(file)) return file;
  return compressReceiptImage(file);
}

async function compressReceiptImage(file: File) {
  if (file.size <= receiptCompressionTargetBytes && file.type === "image/jpeg") return file;

  const image = await loadImageFromFile(file);
  let bestBlob: Blob | null = null;

  for (const maxEdge of receiptCompressionEdges) {
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) continue;

    context.drawImage(image, 0, 0, width, height);

    for (const quality of receiptCompressionQualities) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      if (!blob) continue;

      if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
      if (blob.size <= receiptCompressionTargetBytes) {
        return createCompressedReceiptFile(file, blob);
      }
    }
  }

  if (bestBlob && bestBlob.size < file.size) return createCompressedReceiptFile(file, bestBlob);

  return file;
}

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("レシート写真を読み込めませんでした。別の画像を選択してください。"));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

function createCompressedReceiptFile(originalFile: File, blob: Blob) {
  const baseName = originalFile.name.replace(/\.[^.]+$/, "") || "receipt";
  return new File([blob], `${baseName}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now()
  });
}

async function saveOrderDeliveryState(orderId: string, supplier: string, state: DeliveryState) {
  const response = await fetch("/api/procurement/orders", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderId,
      supplier,
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
  const [, startStatusTransition] = useTransition();
  const itemSaveChainsRef = useRef<Record<string, Promise<void>>>({});
  const procurementTaskItemsRef = useRef<ProcurementTaskItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productSupplierOptions, setProductSupplierOptions] = useState<ProductSupplierGroup[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [purchaseOrderItems, setPurchaseOrderItems] = useState<DashboardOrderItem[]>([]);
  const [dataSource, setDataSource] = useState<"loading" | "neon">("loading");
  const [activeExceptionItemId, setActiveExceptionItemId] = useState<string | null>(null);
  const [procurementTaskItems, setProcurementTaskItems] = useState<ProcurementTaskItem[]>([]);
  const [deliveryStates, setDeliveryStates] = useState<Record<string, DeliveryState>>({});
  const [supplierFulfillments, setSupplierFulfillments] = useState<SupplierFulfillment[]>([]);
  const [deliveryBatches, setDeliveryBatches] = useState<DeliveryBatch[]>([]);
  const [focusedOrderId, setFocusedOrderId] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProcurementStatusFilter>("未完了");
  const [visibleOrderLimit, setVisibleOrderLimit] = useState(procurementOrderRenderBatchSize);
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(() => new Set());
  const [additionalPurchaseDrafts, setAdditionalPurchaseDrafts] = useState<Record<string, AdditionalPurchaseDraft>>(() => readAdditionalPurchaseDrafts());
  const [submittingAdditionalPurchaseOrderId, setSubmittingAdditionalPurchaseOrderId] = useState("");
  const productLookup = useMemo<ProductLookup>(() => ({
    byId: new Map(products.flatMap((product) => product.id ? [[product.id, product] as const] : [])),
    byName: new Map(products.map((product) => [product.name, product]))
  }), [products]);
  const supplierByName = useMemo(() => new Map(suppliers.map((supplier) => [supplier.name, supplier])), [suppliers]);
  const supplierByProductName = useMemo(() => {
    const supplierMap = new Map<string, string>();

    products.forEach((product) => {
      if (product.mainSupplier) supplierMap.set(product.name, product.mainSupplier);
    });
    productSupplierOptions.forEach((group) => {
      if (supplierMap.has(group.product)) return;
      const mainOption = group.options.find((option) => option.role === "メイン");
      if (mainOption?.supplier) supplierMap.set(group.product, mainOption.supplier);
    });

    return supplierMap;
  }, [products, productSupplierOptions]);

  useEffect(() => {
    if (!purchaseOrders.length) return;
    const validOrderIds = new Set(purchaseOrders.map((order) => order.id));
    setAdditionalPurchaseDrafts((drafts) => filterRecordByKeys(drafts, validOrderIds));
  }, [purchaseOrders]);

  useEffect(() => {
    writeAdditionalPurchaseDrafts(additionalPurchaseDrafts);
  }, [additionalPurchaseDrafts]);
  const deliveryBatchesByOrderId = useMemo(() => {
    const batchMap = new Map<string, DeliveryBatch[]>();
    deliveryBatches.forEach((batch) => {
      const batches = batchMap.get(batch.orderId) ?? [];
      batches.push(batch);
      batchMap.set(batch.orderId, batches);
    });

    return batchMap;
  }, [deliveryBatches]);
  const supplierFulfillmentByKey = useMemo(() => {
    const fulfillmentMap = new Map<string, SupplierFulfillment>();
    supplierFulfillments.forEach((fulfillment) => {
      fulfillmentMap.set(getSupplierDeliveryStateKey(fulfillment.orderId, fulfillment.supplier), fulfillment);
    });

    return fulfillmentMap;
  }, [supplierFulfillments]);

  async function loadDashboardData() {
    const response = await fetch("/api/dashboard");
    if (!response.ok) return;

    const data = await response.json() as {
      products?: Product[];
      productSupplierOptions?: ProductSupplierGroup[];
      suppliers?: Supplier[];
      orders?: PurchaseOrder[];
      purchaseOrderItems?: DashboardOrderItem[];
      supplierFulfillments?: SupplierFulfillment[];
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
    if (data.supplierFulfillments) setSupplierFulfillments(data.supplierFulfillments);
    if (data.deliveryBatches) setDeliveryBatches(data.deliveryBatches);
    setDataSource("neon");
  }

  useEffect(() => {
    void loadDashboardData();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFocusedOrderId(params.get("order") ?? "");
  }, []);

  useEffect(() => {
    setProcurementTaskItems((items) => {
      const existingItems = new Map(items.map((item) => [item.id, item]));
      const pendingItems = readPendingProcurementTaskItems();

      const nextItems = createProcurementTaskItems(purchaseOrders, products, purchaseOrderItems).map(
        (item) => pendingItems[item.id]?.item ?? existingItems.get(item.id) ?? item
      );
      procurementTaskItemsRef.current = nextItems;
      return nextItems;
    });
  }, [purchaseOrders, products, purchaseOrderItems]);

  useEffect(() => {
    procurementTaskItemsRef.current = procurementTaskItems;
  }, [procurementTaskItems]);

  useEffect(() => {
    const syncPendingItems = () => {
      const pendingItems = readPendingProcurementTaskItems();
      const entries = Object.values(pendingItems);
      if (entries.length === 0) return;

      setProcurementTaskItems((items) => {
        const nextItems = items.map((item) => pendingItems[item.id]?.item ?? item);
        procurementTaskItemsRef.current = nextItems;
        return nextItems;
      });

      entries.forEach((entry) => {
        void queueProcurementTaskItemSave(entry.item, entry.updatedAt, { alreadyPending: true, silentFailure: true });
      });
    };

    const syncWhenVisible = () => {
      if (document.visibilityState === "visible") syncPendingItems();
    };

    syncPendingItems();
    window.addEventListener("online", syncPendingItems);
    document.addEventListener("visibilitychange", syncWhenVisible);

    return () => {
      window.removeEventListener("online", syncPendingItems);
      document.removeEventListener("visibilitychange", syncWhenVisible);
    };
  }, []);

  useEffect(() => {
    setDeliveryStates((states) => {
      const nextStates = { ...states };

      supplierFulfillments.forEach((fulfillment) => {
        nextStates[getSupplierDeliveryStateKey(fulfillment.orderId, fulfillment.supplier)] = {
          status: fulfillment.status,
          expectedArrivalDate: fulfillment.expectedArrivalDate
        };
      });

      return nextStates;
    });
  }, [supplierFulfillments]);

  useEffect(() => {
    setVisibleOrderLimit(procurementOrderRenderBatchSize);
  }, [statusFilter, query, focusedOrderId]);

  function toggleOrderExpanded(orderId: string) {
    setExpandedOrderIds((current) => {
      const next = new Set(current);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  }

  function queueProcurementTaskItemSave(
    item: ProcurementTaskItem,
    updatedAt = Date.now(),
    options: { alreadyPending?: boolean; silentFailure?: boolean } = {}
  ) {
    if (!options.alreadyPending) writePendingProcurementTaskItem(item, updatedAt);

    const previousSave = itemSaveChainsRef.current[item.id] ?? Promise.resolve();
    const nextSave = previousSave
      .catch(() => undefined)
      .then(() => saveProcurementTaskItem(item))
      .then(() => removePendingProcurementTaskItem(item.id, updatedAt))
      .catch(() => {
        if (!options.silentFailure) {
          window.alert("保存できませんでした。通信が戻ると自動で再保存します。");
        }
      })
      .finally(() => {
        if (itemSaveChainsRef.current[item.id] === nextSave) {
          delete itemSaveChainsRef.current[item.id];
        }
      });

    itemSaveChainsRef.current[item.id] = nextSave;
    return nextSave;
  }

  function updateProcurementTaskItem(id: string, next: Partial<ProcurementTaskItem>) {
    const currentItem = procurementTaskItemsRef.current.find((item) => item.id === id);
    if (!currentItem) return;
    const updatedItem: ProcurementTaskItem = { ...currentItem, ...next };

    void queueProcurementTaskItemSave(updatedItem);

    setProcurementTaskItems((items) => {
      const nextItems = items.map((item) => item.id === id ? updatedItem : item);
      procurementTaskItemsRef.current = nextItems;
      return nextItems;
    });
  }

  function uploadReceiptPhoto(orderId: string, supplier: string, file: File) {
    if (!isReceiptUploadFile(file)) {
      window.alert("画像またはPDFファイルを選択してください。");
      return;
    }

    void prepareReceiptUploadFile(file)
      .then((uploadFile) => {
        const maxBytes = isPdfReceiptFile(uploadFile) ? maxReceiptPdfUploadBytes : maxReceiptUploadBytes;
        if (uploadFile.size > maxBytes) {
          if (isPdfReceiptFile(uploadFile)) {
            throw new Error("レシートPDFは50MB以下にしてください。");
          }
          throw new Error("レシート写真を自動圧縮しても4MBを超えています。少し離れて全体を撮り直してください。");
        }

        return uploadProcurementReceipt(orderId, supplier, uploadFile);
      })
      .then((receiptUrl) => {
        setSupplierFulfillments((fulfillments) => {
          const existingIndex = fulfillments.findIndex(
            (fulfillment) => fulfillment.orderId === orderId && fulfillment.supplier === supplier
          );
          const nextFulfillment: SupplierFulfillment = {
            ...(existingIndex >= 0 ? fulfillments[existingIndex] : { orderId, supplier, status: "not_started", expectedArrivalDate: "" }),
            receiptPhotoUrl: receiptUrl
          };

          if (existingIndex < 0) return [...fulfillments, nextFulfillment];

          return fulfillments.map((fulfillment, index) => index === existingIndex ? nextFulfillment : fulfillment);
        });
        showNotice("レシートを保存しました。");
      })
      .catch((error: Error) => {
        window.alert(error.message);
      });
  }

  function updateDeliveryState(orderId: string, supplier: string, next: Partial<DeliveryState>, successMessage?: string) {
    let nextState: DeliveryState | null = null;
    const stateKey = getSupplierDeliveryStateKey(orderId, supplier);

    setDeliveryStates((states) => ({
      ...states,
      [stateKey]: (nextState = {
        ...getSupplierDeliveryState(states, orderId, supplier),
        ...next
      })
    }));

    queueMicrotask(() => {
      if (!nextState) return;

      void saveOrderDeliveryState(orderId, supplier, nextState)
        .then(() => {
          if (successMessage) showNotice(successMessage);
        })
        .catch((error: Error) => {
          window.alert(error.message);
        });
    });
  }

  function confirmOnlineOrder(orderId: string, supplier: string) {
    const currentState = getSupplierDeliveryState(deliveryStates, orderId, supplier);

    if (!currentState.expectedArrivalDate) {
      window.alert("到着予定日を入力してください。");
      return;
    }

    updateDeliveryState(orderId, supplier, { status: "online_ordered" }, `${supplier} を発注済みにしました。`);
  }

  function markOnlineOrderArrived(orderId: string, supplier: string) {
    const currentState = getSupplierDeliveryState(deliveryStates, orderId, supplier);

    if (currentState.status !== "online_ordered") {
      window.alert("先に発注済みにしてください。");
      return;
    }

    const targetItems = procurementTaskItems
      .filter((item) =>
        item.orderId === orderId &&
        item.purchased &&
        item.deliveryStatus !== "received" &&
        isDeliveryOrderItem(item, supplierByName) &&
        item.supplier === supplier
      )
      .map((item) => ({ ...item, deliveryStatus: "delivered" as const }));

    if (targetItems.length === 0) return;

    setProcurementTaskItems((items) => {
      const nextItems = items.map((item) => {
        const nextItem = targetItems.find((target) => target.id === item.id);
        return nextItem ?? item;
      });
      procurementTaskItemsRef.current = nextItems;
      return nextItems;
    });

    void Promise.all(targetItems.map((item) => queueProcurementTaskItemSave(item, Date.now(), { silentFailure: true })))
      .then(() => showNotice(`${supplier} を納品済みにしました。`))
      .catch(() => {
        window.alert("到着状態を保存できませんでした。通信が戻ると自動で再保存します。");
      });
  }

  function createDeliveryBatch(orderId: string) {
    const readyItems = procurementTaskItems.filter(
      (item) =>
        item.orderId === orderId &&
        item.purchased &&
        item.deliveryStatus === "pending" &&
        !isDeliveryOrderItem(item, supplierByName)
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
    setProcurementTaskItems((items) => {
      const nextItems = items.map((item) =>
        readyItems.some((readyItem) => readyItem.id === item.id)
          ? { ...item, deliveryStatus: "in_delivery" as const, deliveryBatchId: batchId }
          : item
      );
      procurementTaskItemsRef.current = nextItems;
      return nextItems;
    });

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
        setProcurementTaskItems((items) => {
          const nextItems = items.map((item) =>
            item.deliveryBatchId === batchId ? { ...item, deliveryBatchId: savedBatch.id } : item
          );
          procurementTaskItemsRef.current = nextItems;
          return nextItems;
        });
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
    setProcurementTaskItems((items) => {
      const nextItems = items.map((item) => (item.deliveryBatchId === batchId ? { ...item, deliveryStatus: status === "received" ? "received" as const : "delivered" as const } : item));
      procurementTaskItemsRef.current = nextItems;
      return nextItems;
    });

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

  function updateAdditionalPurchaseDraft(orderId: string, next: Partial<AdditionalPurchaseDraft>) {
    setAdditionalPurchaseDrafts((drafts) => {
      const current = drafts[orderId] ?? createDefaultAdditionalPurchaseDraft(products);

      return {
        ...drafts,
        [orderId]: {
          ...current,
          ...next
        }
      };
    });
  }

  async function createAdditionalPurchaseItem(orderId: string) {
    if (submittingAdditionalPurchaseOrderId) return;

    const draft = additionalPurchaseDrafts[orderId] ?? createDefaultAdditionalPurchaseDraft(products);
    const product = products.find((item) => item.id === draft.productId);
    const isTemporary = draft.mode === "temporary";
    const temporaryProductName = draft.temporaryProductName.trim();

    if (!isTemporary && !product?.id) {
      window.alert("追加購入する商品を選択してください。");
      return;
    }
    if (isTemporary && !temporaryProductName) {
      window.alert("テスト品・臨時品の商品名を入力してください。");
      return;
    }

    setSubmittingAdditionalPurchaseOrderId(orderId);

    try {
      const response = await fetch("/api/procurement/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          productId: isTemporary ? "" : product?.id,
          temporaryProductName: isTemporary ? temporaryProductName : "",
          temporaryProductUnit: isTemporary ? draft.temporaryProductUnit : "",
          requestedQuantity: draft.quantity,
          note: draft.note
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "追加購入を登録できませんでした。");
      }

      setAdditionalPurchaseDrafts((drafts) => ({
        ...drafts,
        [orderId]: createDefaultAdditionalPurchaseDraft(products)
      }));
      await loadDashboardData();
      showNotice("追加購入を登録しました。");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "追加購入を登録できませんでした。");
    } finally {
      setSubmittingAdditionalPurchaseOrderId("");
    }
  }

  const activeExceptionItem = procurementTaskItems.find((item) => item.id === activeExceptionItemId) ?? null;
  const normalizedQuery = query.trim().toLowerCase();
  const itemsByOrderId = useMemo(() => {
    const itemMap = new Map<string, ProcurementTaskItem[]>();
    procurementTaskItems.forEach((item) => {
      const items = itemMap.get(item.orderId) ?? [];
      items.push(item);
      itemMap.set(item.orderId, items);
    });

    return itemMap;
  }, [procurementTaskItems]);
  const purchaseOrdersWithStatus = useMemo(() => purchaseOrders.map((order) => {
    const items = itemsByOrderId.get(order.id) ?? [];
    const deliveryState = getAggregateDeliveryStateForOrder(deliveryStates, order.id, items, supplierByName);
    const liveStatus = getOrderStatusFast(order, items, deliveryState, supplierByName);

    return { order, items, deliveryState, liveStatus };
  }), [purchaseOrders, itemsByOrderId, deliveryStates, supplierByName]);
  const statusFilterCounts = useMemo(() => {
    const counts = procurementStatusFilters.reduce<Record<ProcurementStatusFilter, number>>((nextCounts, filter) => {
      nextCounts[filter] = 0;
      return nextCounts;
    }, {} as Record<ProcurementStatusFilter, number>);

    purchaseOrdersWithStatus.forEach(({ liveStatus }) => {
      counts["すべて"] += 1;
      if (liveStatus !== "完了") counts["未完了"] += 1;
      if (liveStatus in counts) counts[liveStatus as ProcurementStatusFilter] += 1;
    });

    return counts;
  }, [purchaseOrdersWithStatus]);
  const displayedPurchaseOrders = useMemo(() => purchaseOrdersWithStatus
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
    .sort((left, right) => getOrderDeadlineSortValue(left.order) - getOrderDeadlineSortValue(right.order)), [purchaseOrdersWithStatus, focusedOrderId, statusFilter, normalizedQuery]);
  const visiblePurchaseOrders = displayedPurchaseOrders.slice(0, visibleOrderLimit);
  const hasMorePurchaseOrders = visibleOrderLimit < displayedPurchaseOrders.length;

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
            <p className="eyebrow">現場の発注実行</p>
            <h2>購入管理</h2>
            <span className="source-indicator">{dataSource === "neon" ? "データ同期済み" : "読み込み中"}</span>
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
            <a className="primary-button" href="/os/orders">
              発注依頼を見る
            </a>
          </div>
        </header>

        <section className="panel procurement-panel">
          <PanelTitle
            title={focusedOrderId ? `${focusedOrderId} の購入管理` : "購入管理"}
            subtitle={focusedOrderId ? "選択した依頼だけを表示" : "発注先ごとに購入済み、数量差異、備考、価格異常を記録"}
          />
          {focusedOrderId ? (
            <div className="focused-order-bar">
              <span>依頼番号 {focusedOrderId}</span>
              <a className="text-button" href="/os/procurement">全体を見る</a>
            </div>
          ) : null}
          {!focusedOrderId ? (
            <div className="queue-filter-bar" aria-label="購入管理ステータスフィルター">
              {procurementStatusFilters.map((filter) => (
                <button
                  type="button"
                  className={statusFilter === filter ? "queue-filter is-active" : "queue-filter"}
                  onClick={() => startStatusTransition(() => {
                    setVisibleOrderLimit(procurementOrderRenderBatchSize);
                    setStatusFilter(filter);
                  })}
                  key={filter}
                >
                  <span>{filter}</span>
                  <strong>{statusFilterCounts[filter]}</strong>
                </button>
              ))}
            </div>
          ) : null}
          <div className="procurement-order-list">
            {visiblePurchaseOrders.map(({ order, items, deliveryState, liveStatus }) => {
              const supplierGroups = groupTasksBySupplierFast(items, supplierByProductName).map((group) => ({
                ...group,
                items: sortProcurementItemsBySubcategory(group.items, productLookup)
              }));
              const unavailableCount = items.filter((item) => item.unavailable).length;
              const completedCount = items.filter((item) => item.purchased).length;
              const handledCount = completedCount + unavailableCount;
              const deliveredCount = items.filter((item) => item.deliveryStatus === "delivered").length;
              const receivedCount = items.filter((item) => item.deliveryStatus === "received").length;
              const inDeliveryCount = items.filter((item) => item.deliveryStatus === "in_delivery").length;
              const onlineOrderItems = items.filter((item) => isDeliveryOrderItem(item, supplierByName));
              const storeDeliveryItems = items.filter((item) => !isDeliveryOrderItem(item, supplierByName));
              const readyToDeliverCount = storeDeliveryItems.filter((item) => item.purchased && !item.unavailable && item.deliveryStatus === "pending").length;
              const onlinePurchasedCount = onlineOrderItems.filter((item) => item.purchased).length;
              const onlineUnavailableCount = onlineOrderItems.filter((item) => item.unavailable).length;
              const onlineDeliveredCount = onlineOrderItems.filter((item) => item.deliveryStatus === "delivered").length;
              const onlineReceivedCount = onlineOrderItems.filter((item) => item.deliveryStatus === "received").length;
              const onlineSupplierGroups = groupTasksBySupplierFast(onlineOrderItems, supplierByProductName).map((group) => {
                const groupPurchasedCount = group.items.filter((item) => item.purchased).length;
                const groupUnavailableCount = group.items.filter((item) => item.unavailable).length;
                const groupDeliveredCount = group.items.filter((item) => item.deliveryStatus === "delivered").length;
                const groupReceivedCount = group.items.filter((item) => item.deliveryStatus === "received").length;

                return {
                  supplier: group.supplier,
                  totalCount: group.items.length,
                  purchasedCount: groupPurchasedCount,
                  unavailableCount: groupUnavailableCount,
                  deliveredCount: groupDeliveredCount,
                  receivedCount: groupReceivedCount,
                  state: getSupplierDeliveryState(deliveryStates, order.id, group.supplier)
                };
              });
              const orderDeliveryBatches = deliveryBatchesByOrderId.get(order.id) ?? [];
              const hasPurchasedItems = completedCount > 0;
              const hasOnlineOrderItems = onlineOrderItems.length > 0;
              const hasStoreDeliveryItems = storeDeliveryItems.length > 0;
              const estimatedAmount = calculateProcurementOrderEstimatedAmount(items, productLookup);
              const isExpanded = expandedOrderIds.has(order.id);

              return (
                <article className={isExpanded ? "procurement-order-card is-expanded" : "procurement-order-card is-collapsed"} key={order.id}>
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
                      <span>{handledCount} / {items.length} 処理済み</span>
                      {unavailableCount > 0 ? <span>購入不可 {unavailableCount} 件</span> : null}
                    </div>
                    <button
                      type="button"
                      className="procurement-order-toggle"
                      aria-expanded={isExpanded}
                      aria-controls={`procurement-order-body-${order.id}`}
                      onClick={() => toggleOrderExpanded(order.id)}
                    >
                      <ChevronDown size={16} aria-hidden="true" />
                      <span>{isExpanded ? "閉じる" : "開く"}</span>
                    </button>
                  </div>
                  <div className="procurement-order-compact-summary">
                    <span>発注先 {supplierGroups.length}</span>
                    <span>商品 {items.length}</span>
                    {inDeliveryCount > 0 ? <span>配送中 {inDeliveryCount}</span> : null}
                    {deliveredCount > 0 ? <span>納品済み {deliveredCount}</span> : null}
                    {receivedCount > 0 ? <span>店舗確認済み {receivedCount}</span> : null}
                    {readyToDeliverCount > 0 ? <span>配送待ち {readyToDeliverCount}</span> : null}
                    {hasOnlineOrderItems ? <span>オンライン/卸 {onlineOrderItems.length}</span> : null}
                  </div>
                  {isExpanded ? (
                    <div className="procurement-order-body" id={`procurement-order-body-${order.id}`}>
                      {liveStatus === "確認待ち" ? (
                        <div className="workflow-hint">
                          <span>購入側の作業は納品済みです。最終確認は店舗側で行います。</span>
                          <a href={`/os/orders#order-${order.id}`}>店舗確認へ</a>
                        </div>
                      ) : null}
                      <AdditionalPurchasePanel
                        orderId={order.id}
                        products={products}
                        draft={additionalPurchaseDrafts[order.id] ?? createDefaultAdditionalPurchaseDraft(products)}
                        isSubmitting={submittingAdditionalPurchaseOrderId === order.id}
                        onChange={(next) => updateAdditionalPurchaseDraft(order.id, next)}
                        onSubmit={() => void createAdditionalPurchaseItem(order.id)}
                      />
                      <OrderFulfillmentPanel
                        hasOnlineOrderItems={hasOnlineOrderItems}
                        hasStoreDeliveryItems={hasStoreDeliveryItems}
                        hasPurchasedItems={hasPurchasedItems}
                        purchasedCount={completedCount}
                        unavailableCount={unavailableCount}
                        onlinePurchasedCount={onlinePurchasedCount}
                        onlineUnavailableCount={onlineUnavailableCount}
                        onlineDeliveredCount={onlineDeliveredCount}
                        onlineReceivedCount={onlineReceivedCount}
                        onlineTotalCount={onlineOrderItems.length}
                        onlineSupplierGroups={onlineSupplierGroups}
                        deliveredCount={deliveredCount}
                        receivedCount={receivedCount}
                        inDeliveryCount={inDeliveryCount}
                        readyToDeliverCount={readyToDeliverCount}
                        totalCount={items.length}
                        state={deliveryState}
                        onChange={(supplier, next) => updateDeliveryState(order.id, supplier, next)}
                        onConfirmOnlineOrder={(supplier) => confirmOnlineOrder(order.id, supplier)}
                        onMarkOnlineArrived={(supplier) => markOnlineOrderArrived(order.id, supplier)}
                        batches={orderDeliveryBatches}
                        onCreateBatch={() => createDeliveryBatch(order.id)}
                        onMarkStatus={markDeliveryBatchStatus}
                      />
                      <div className="procurement-supplier-list">
                        {supplierGroups.map((group) => {
                          const supplierCompletedCount = group.items.filter((item) => item.purchased || item.unavailable).length;
                          const supplierReceipt = supplierFulfillmentByKey.get(getSupplierDeliveryStateKey(order.id, group.supplier))?.receiptPhotoUrl ?? "";
                          const canUploadReceipt = group.items.some((item) => item.purchased && !item.unavailable);
                          const needsReceiptUpload = canUploadReceipt && !supplierReceipt;

                          return (
                            <section className="procurement-supplier-group" key={`${order.id}-${group.supplier}`}>
                              <div className="supplier-group-heading">
                                <div>
                                  <span>発注先</span>
                                  <strong>{group.supplier}</strong>
                                </div>
                                <div className="supplier-group-meta">
                                  <small>{supplierCompletedCount} / {group.items.length} 処理済み</small>
                                  <div className="receipt-upload-control">
                                    {supplierReceipt ? (
                                      <a href={supplierReceipt} target="_blank" rel="noreferrer">
                                        レシートを見る
                                      </a>
                                    ) : needsReceiptUpload ? (
                                      <span className="receipt-missing-label">レシート未アップロード</span>
                                    ) : null}
                                    <label className={canUploadReceipt ? "receipt-upload-button" : "receipt-upload-button is-disabled"}>
                                      <input
                                        type="file"
                                        accept="image/*,application/pdf,.pdf"
                                        disabled={!canUploadReceipt}
                                        onChange={(event) => {
                                          const file = event.target.files?.[0];
                                          if (file) uploadReceiptPhoto(order.id, group.supplier, file);
                                          event.currentTarget.value = "";
                                        }}
                                      />
                                      <span>{supplierReceipt ? "レシートを差替" : "レシートをアップロード"}</span>
                                    </label>
                                  </div>
                                </div>
                              </div>
                              <div className="procurement-task-list">
                                {group.items.map((item) => {
                                  const quantityDiff = item.actualQuantity - item.requestedQuantity;
                                  const product = findProcurementProductFromLookup(item, productLookup);
                                  const photoSrc = getProductPhotoSrc(product?.photoUrl);
                                  const productSpec = product?.packageSpec || product?.specNote;
                                  const referencePrice = Number(product?.referencePrice ?? 0);
                                  const temporarySupplierNote = getTemporarySupplierNote(item.note);
                                  const purchaseUrl = getPurchaseUrlForItem(item, productSupplierOptions);
                                  const isAdditionalPurchase = isAdditionalPurchaseNote(item.note);
                                  const isDeliveryLocked = isDeliveryLockedItem(item);

                                  return (
                                    <div className={item.purchased || item.unavailable ? "procurement-task is-complete" : "procurement-task"} key={item.id}>
                                      <label className="task-check">
                                        <input
                                          type="checkbox"
                                          checked={item.purchased || item.unavailable}
                                          disabled={item.unavailable || isDeliveryLocked}
                                          onChange={(event) =>
                                            updateProcurementTaskItem(item.id, {
                                              purchased: event.target.checked,
                                              unavailable: false,
                                              deliveryStatus: event.target.checked ? item.deliveryStatus : "pending",
                                              deliveryBatchId: event.target.checked ? item.deliveryBatchId : undefined
                                            })
                                          }
                                        />
                                        <span>{item.unavailable ? "購入不可" : item.purchased ? "購入済み" : "未購入"}</span>
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
                                          {item.unavailable ? <span>購入不可</span> : null}
                                          {isAdditionalPurchase ? <span>追加購入</span> : null}
                                          {temporarySupplierNote ? <span>臨時購入先 {temporarySupplierNote}</span> : null}
                                        </div>
                                        {productSpec ? <small>{productSpec}</small> : null}
                                        <small>{isAdditionalPurchase ? "追加" : "依頼"} {item.requestedQuantity} {item.unit}</small>
                                        <small>
                                          参考価格 {referencePrice > 0 ? `${formatEstimatedAmount(referencePrice)} / ${item.unit}` : "未設定"}
                                        </small>
                                        {purchaseUrl ? (
                                          <a className="purchase-link-button" href={purchaseUrl} target="_blank" rel="noreferrer">
                                            購入ページ
                                          </a>
                                        ) : null}
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
                                        購入調整
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </section>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
            {displayedPurchaseOrders.length === 0 ? (
              <div className="empty-state">
                {focusedOrderId ? "対象の発注依頼が見つかりません" : "表示できる発注依頼はありません"}
              </div>
            ) : null}
            {hasMorePurchaseOrders ? (
              <div className="procurement-list-more">
                <span>{visiblePurchaseOrders.length} / {displayedPurchaseOrders.length} 件表示</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setVisibleOrderLimit((limit) => limit + procurementOrderRenderBatchSize)}
                >
                  さらに表示
                </button>
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
          products={products}
          choices={getSupplierChoicesForItem(activeExceptionItem, findProcurementProduct(activeExceptionItem, products), productSupplierOptions)}
          plannedSupplier={getProcurementSupplier(activeExceptionItem.productName, products, productSupplierOptions)}
          onChange={(next) => updateProcurementTaskItem(activeExceptionItem.id, next)}
          onClose={() => setActiveExceptionItemId(null)}
          onSaved={() => showNotice("購入調整を保存しました。")}
        />
      ) : null}
      <ActionNotice notice={notice} onClose={clearNotice} />
    </main>
  );
}

function AdditionalPurchasePanel({
  orderId,
  products,
  draft,
  isSubmitting,
  onChange,
  onSubmit
}: {
  orderId: string;
  products: Product[];
  draft: AdditionalPurchaseDraft;
  isSubmitting: boolean;
  onChange: (next: Partial<AdditionalPurchaseDraft>) => void;
  onSubmit: () => void;
}) {
  const productOptions = getAdditionalPurchaseProductOptions(products);
  const [isOpen, setIsOpen] = useState(false);
  const isTemporary = draft.mode === "temporary";
  const canSubmit = isSubmitting
    || (isTemporary ? draft.temporaryProductName.trim().length === 0 : productOptions.length === 0);

  return (
    <section className={isOpen ? "additional-purchase-panel is-open" : "additional-purchase-panel"}>
      <button
        type="button"
        className="additional-purchase-toggle"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>
          <strong>追加購入</strong>
          <small>必要な時だけ、依頼外のテスト品・臨時購入品を記録</small>
        </span>
        <b>{isOpen ? "閉じる" : "追加購入を開く"}</b>
      </button>
      {isOpen ? (
        <form
          className="additional-purchase-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="segmented-control additional-purchase-mode" aria-label="追加購入の種類">
            <button
              type="button"
              className={!isTemporary ? "is-active" : ""}
              onClick={() => onChange({ mode: "product" })}
            >
              既存商品
            </button>
            <button
              type="button"
              className={isTemporary ? "is-active" : ""}
              onClick={() => onChange({ mode: "temporary" })}
            >
              テスト品・臨時品
            </button>
          </div>
          {isTemporary ? (
            <>
              <label>
                <span>商品名</span>
                <input
                  value={draft.temporaryProductName}
                  placeholder="例: 試作スープ、限定トッピング候補"
                  onChange={(event) => onChange({ temporaryProductName: event.target.value })}
                />
              </label>
              <label>
                <span>単位</span>
                <select
                  value={draft.temporaryProductUnit}
                  onChange={(event) => onChange({ temporaryProductUnit: event.target.value })}
                >
                  {temporaryProductUnitOptions.map((unit) => (
                    <option value={unit} key={`${orderId}-temporary-unit-${unit}`}>{unit}</option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <label>
              <span>商品</span>
              <select
                value={draft.productId || getDefaultAdditionalPurchaseProductId(products)}
                onChange={(event) => onChange({ productId: event.target.value })}
              >
                {productOptions.map((product) => (
                  <option value={product.id ?? ""} key={product.id ?? product.name}>
                    {product.name} / {getProductUsageTypeLabel(product.usageType)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>数量</span>
            <select value={draft.quantity} onChange={(event) => onChange({ quantity: Number(event.target.value) })}>
              {purchaseQuantityOptions.map((quantity) => (
                <option value={quantity} key={`${orderId}-additional-${quantity}`}>{quantity}</option>
              ))}
            </select>
          </label>
          <label>
            <span>メモ</span>
            <input
              value={draft.note}
              placeholder="例: 新メニュー試作用、代替候補の検証"
              onChange={(event) => onChange({ note: event.target.value })}
            />
          </label>
          <button type="submit" className="secondary-button" disabled={canSubmit}>
            <Plus size={16} />
            {isSubmitting ? "登録中" : "追加"}
          </button>
          {!isTemporary && productOptions.length === 0 ? (
            <small>既存商品として追加するには、先に商品マスタに商品を登録してください。</small>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

function getAdditionalPurchaseProductOptions(products: Product[]) {
  return [...products]
    .filter((product) => product.id)
    .sort((left, right) => {
      const leftPriority = getAdditionalPurchaseProductPriority(left);
      const rightPriority = getAdditionalPurchaseProductPriority(right);

      return leftPriority - rightPriority || left.name.localeCompare(right.name, "ja", { numeric: true, sensitivity: "base" });
    });
}

function getDefaultAdditionalPurchaseProductId(products: Product[]) {
  return getAdditionalPurchaseProductOptions(products)[0]?.id ?? "";
}

function createDefaultAdditionalPurchaseDraft(products: Product[]): AdditionalPurchaseDraft {
  return {
    mode: "product",
    productId: getDefaultAdditionalPurchaseProductId(products),
    temporaryProductName: "",
    temporaryProductUnit: "個",
    quantity: 1,
    note: ""
  };
}

function getAdditionalPurchaseProductPriority(product: Product) {
  if (product.usageType === "test_product") return 0;
  if (product.usageType === "temporary_purchase") return 1;
  return 2;
}

function getProductUsageTypeLabel(value?: string) {
  if (value === "test_product") return "テスト品";
  if (value === "temporary_purchase") return "臨時購入品";
  if (value === "packaging") return "包材・消耗品";
  if (value === "durable_supply") return "備品・消耗工具";
  if (value === "equipment") return "設備";
  if (value === "other") return "その他";
  return "原材料";
}

function OrderFulfillmentPanel({
  hasOnlineOrderItems,
  hasStoreDeliveryItems,
  hasPurchasedItems,
  purchasedCount,
  unavailableCount,
  onlinePurchasedCount,
  onlineUnavailableCount,
  onlineDeliveredCount,
  onlineReceivedCount,
  onlineTotalCount,
  onlineSupplierGroups,
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
  hasOnlineOrderItems: boolean;
  hasStoreDeliveryItems: boolean;
  hasPurchasedItems: boolean;
  purchasedCount: number;
  unavailableCount: number;
  onlinePurchasedCount: number;
  onlineUnavailableCount: number;
  onlineDeliveredCount: number;
  onlineReceivedCount: number;
  onlineTotalCount: number;
  onlineSupplierGroups: OnlineSupplierFulfillmentGroup[];
  deliveredCount: number;
  receivedCount: number;
  inDeliveryCount: number;
  readyToDeliverCount: number;
  totalCount: number;
  state: DeliveryState;
  onChange: (supplier: string, next: Partial<DeliveryState>) => void;
  onConfirmOnlineOrder: (supplier: string) => void;
  onMarkOnlineArrived: (supplier: string) => void;
  batches: DeliveryBatch[];
  onCreateBatch: () => void;
  onMarkStatus: (batchId: string, status: "delivered" | "received") => void;
}) {
  const expectedArrivalLabel = formatExpectedArrivalDate(state.expectedArrivalDate);
  const isOnlineOrdered = state.status === "online_ordered" && Boolean(state.expectedArrivalDate);
  const handledTotalCount = purchasedCount + unavailableCount;
  const completedTotalCount = receivedCount + unavailableCount;
  const deliveredTotalCount = deliveredCount + receivedCount + unavailableCount;
  const onlineHandledCount = onlinePurchasedCount + onlineUnavailableCount;
  const onlineDeliveredTotalCount = onlineDeliveredCount + onlineReceivedCount + onlineUnavailableCount;
  const onlineArrived = hasOnlineOrderItems && onlineDeliveredTotalCount >= onlineTotalCount;
  const isMixedOrder = hasOnlineOrderItems && hasStoreDeliveryItems;

  return (
    <div className={hasPurchasedItems ? "fulfillment-panel is-ready" : "fulfillment-panel"}>
      <div>
        <span>{isMixedOrder ? "配送・到着フロー" : hasOnlineOrderItems ? "配送発注" : "配送フロー"}</span>
        <strong>
          {hasOnlineOrderItems && !hasStoreDeliveryItems
            ? completedTotalCount === totalCount
              ? "店舗確認済み"
              : deliveredTotalCount === totalCount
                ? "店舗確認待ち"
                : isOnlineOrdered && expectedArrivalLabel
                  ? `到着予定 ${expectedArrivalLabel}`
                  : state.expectedArrivalDate
                    ? "到着予定日を確認して発注済みにする"
                    : "発注先へ発注後に到着予定日を入力"
            : completedTotalCount === totalCount
              ? "店舗確認済み"
              : deliveredTotalCount === totalCount
                ? "店舗確認待ち"
              : inDeliveryCount > 0
                ? "配送中"
                : readyToDeliverCount > 0
                  ? "配送待ち"
                  : hasOnlineOrderItems
                    ? "到着予定日と配送をそれぞれ処理"
                    : "購入完了後に配送へ"}
        </strong>
        <div className="fulfillment-metrics">
          <span>処理 {handledTotalCount} / {totalCount}</span>
          {unavailableCount > 0 ? <span>購入不可 {unavailableCount}</span> : null}
          <span>配送中 {inDeliveryCount}</span>
          <span>納品済み {deliveredCount}</span>
          <span>店舗確認 {receivedCount}</span>
        </div>
      </div>
      {hasOnlineOrderItems ? (
        <div className="online-fulfillment-list">
          {onlineSupplierGroups.map((group) => {
            const groupHandledCount = group.purchasedCount + group.unavailableCount;
            const groupDeliveredTotalCount = group.deliveredCount + group.receivedCount + group.unavailableCount;
            const groupOrdered = group.state.status === "online_ordered" && Boolean(group.state.expectedArrivalDate);
            const groupArrived = groupDeliveredTotalCount >= group.totalCount;

            return (
              <div className="online-fulfillment-row" key={group.supplier}>
                <div className="online-fulfillment-info">
                  <span>配送発注先</span>
                  <strong>{group.supplier}</strong>
                  <small>{groupHandledCount} / {group.totalCount} 処理済み</small>
                </div>
                <div className="fulfillment-actions">
                  <label>
                    <span>到着予定日</span>
                    <input
                      type="date"
                      value={group.state.expectedArrivalDate}
                      disabled={groupHandledCount === 0}
                      onChange={(event) =>
                        onChange(group.supplier, {
                          expectedArrivalDate: event.target.value,
                          ...(event.target.value ? {} : { status: "not_started" as const })
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className={groupOrdered ? "fulfillment-mark-button is-complete" : "fulfillment-mark-button"}
                    disabled={groupHandledCount === 0 || !group.state.expectedArrivalDate || groupOrdered}
                    onClick={() => onConfirmOnlineOrder(group.supplier)}
                  >
                    {groupOrdered ? "発注済み" : "発注済みにする"}
                  </button>
                  <button
                    type="button"
                    className={groupArrived ? "fulfillment-mark-button is-complete" : "fulfillment-mark-button"}
                    disabled={!groupOrdered || groupArrived}
                    onClick={() => onMarkOnlineArrived(group.supplier)}
                  >
                    {groupArrived ? "納品済み" : "到着済みにする"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {hasStoreDeliveryItems ? (
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
      ) : null}
    </div>
  );
}

function ExceptionReportDialog({
  item,
  products,
  choices,
  plannedSupplier,
  onChange,
  onClose,
  onSaved
}: {
  item: ProcurementTaskItem;
  products: Product[];
  choices: SupplierChoice[];
  plannedSupplier: string;
  onChange: (next: Partial<ProcurementTaskItem>) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const quantityDiff = item.actualQuantity - item.requestedQuantity;
  const [temporarySupplier, setTemporarySupplier] = useState(getTemporarySupplierNote(item.note));
  const currentProduct = products.find((product) => product.id === item.productId)
    ?? products.find((product) => product.name === item.productName);
  const familyName = getProductFamilyLabel(currentProduct, item.productName);
  const variantOptions = getAlternativeVariantOptions(item, products);
  const selectedVariantId = item.productId ?? "";
  const [temporaryVariantName, setTemporaryVariantName] = useState("");
  const [temporaryVariantUnit, setTemporaryVariantUnit] = useState(item.unit || "個");
  const currentSupplier = item.supplier || plannedSupplier;
  const isDeliveryLocked = isDeliveryLockedItem(item);
  const normalizedTemporaryVariantName = temporaryVariantName.trim();

  function selectPurchasedVariant(productId: string) {
    const product = products.find((item) => item.id === productId);
    if (!product) return;

    onChange({
      productId: product.id,
      productName: product.name,
      unit: product.unit,
      supplier: product.mainSupplier || item.supplier,
      note: appendReplacementNote(item.note, item.productName, product.name)
    });
  }

  function useTemporaryVariant() {
    if (!normalizedTemporaryVariantName) return;
    const temporaryProductName = [familyName, normalizedTemporaryVariantName].filter(Boolean).join(" ");

    onChange({
      productId: undefined,
      productName: temporaryProductName,
      unit: temporaryVariantUnit || item.unit || "個",
      note: appendReplacementNote(item.note, item.productName, temporaryProductName)
    });
    setTemporaryVariantName("");
  }

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
            <h3 id="exception-report-title">購入調整</h3>
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
            <span>購入したバリエーション</span>
            <select
              value={selectedVariantId}
              disabled={isDeliveryLocked || variantOptions.length === 0}
              onChange={(event) => selectPurchasedVariant(event.target.value)}
            >
              {variantOptions.length === 0 ? <option value="">登録済み候補なし</option> : null}
              {variantOptions.map((product) => (
                <option value={product.id ?? ""} key={product.id ?? product.name}>
                  {product.name}{product.id === item.productId ? "（依頼）" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="temporary-variant-row">
            <label>
              <span>臨時バリエーション</span>
              <input
                value={temporaryVariantName}
                disabled={isDeliveryLocked}
                placeholder={`例: ${familyName} の別サイズ`}
                onChange={(event) => setTemporaryVariantName(event.target.value)}
              />
            </label>
            <label>
              <span>単位</span>
              <select
                value={temporaryVariantUnit}
                disabled={isDeliveryLocked}
                onChange={(event) => setTemporaryVariantUnit(event.target.value)}
              >
                {temporaryProductUnitOptions.map((unit) => (
                  <option value={unit} key={`temporary-variant-unit-${unit}`}>{unit}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary-button"
              disabled={isDeliveryLocked || !normalizedTemporaryVariantName}
              onClick={useTemporaryVariant}
            >
              臨時で適用
            </button>
          </div>
          <label className="exception-toggle">
            <input
              type="checkbox"
              checked={item.unavailable}
              disabled={isDeliveryLocked}
              onChange={(event) =>
                onChange({
                  unavailable: event.target.checked,
                  purchased: event.target.checked ? false : item.purchased,
                  deliveryStatus: event.target.checked ? "pending" : item.deliveryStatus,
                  deliveryBatchId: event.target.checked ? undefined : item.deliveryBatchId,
                  actualPrice: event.target.checked ? "" : item.actualPrice
                })
              }
            />
            <span>購入不可として処理</span>
          </label>
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
              onChange={(event) => onChange({ actualPrice: normalizeDecimalInput(event.target.value) })}
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

function calculateProcurementOrderEstimatedAmount(items: ProcurementTaskItem[], productLookup: ProductLookup) {
  return items.reduce((total, item) => {
    const product = findProcurementProductFromLookup(item, productLookup);
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

function readAdditionalPurchaseDrafts() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(additionalPurchaseDraftStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<AdditionalPurchaseDraft>>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([orderId, draft]) => {
      if (!draft || typeof draft !== "object") return [];
      return [[orderId, {
        mode: draft.mode === "temporary" ? "temporary" : "product",
        productId: String(draft.productId ?? ""),
        temporaryProductName: String(draft.temporaryProductName ?? ""),
        temporaryProductUnit: String(draft.temporaryProductUnit ?? "個") || "個",
        quantity: Math.min(99, Math.max(1, Number(draft.quantity) || 1)),
        note: String(draft.note ?? "")
      }]];
    })) as Record<string, AdditionalPurchaseDraft>;
  } catch {
    try {
      window.localStorage.removeItem(additionalPurchaseDraftStorageKey);
    } catch {
      // Ignore storage cleanup failures.
    }
    return {};
  }
}

function writeAdditionalPurchaseDrafts(drafts: Record<string, AdditionalPurchaseDraft>) {
  try {
    window.localStorage.setItem(additionalPurchaseDraftStorageKey, JSON.stringify(drafts));
  } catch {
    // Local storage is best-effort; procurement should keep working without it.
  }
}

type PendingProcurementTaskItemEntry = {
  item: ProcurementTaskItem;
  updatedAt: number;
};

function readPendingProcurementTaskItems() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(pendingProcurementTaskItemStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PendingProcurementTaskItemEntry>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(Object.entries(parsed).flatMap(([itemId, entry]) => {
      if (!entry || typeof entry !== "object" || !entry.item || typeof entry.item !== "object") return [];
      const item = entry.item as Partial<ProcurementTaskItem>;
      const normalizedItemId = String(item.id ?? itemId);
      if (!normalizedItemId) return [];

      return [[normalizedItemId, {
        item: {
          id: normalizedItemId,
          orderId: String(item.orderId ?? ""),
          productId: item.productId ? String(item.productId) : undefined,
          productName: String(item.productName ?? ""),
          requestedQuantity: Number(item.requestedQuantity ?? 0),
          actualQuantity: Number(item.actualQuantity ?? item.requestedQuantity ?? 0),
          actualPrice: String(item.actualPrice ?? ""),
          unit: String(item.unit ?? ""),
          supplier: String(item.supplier ?? ""),
          purchased: Boolean(item.purchased),
          unavailable: Boolean(item.unavailable),
          note: String(item.note ?? ""),
          priceExceptionNote: String(item.priceExceptionNote ?? ""),
          deliveryStatus: isProcurementDeliveryStatus(item.deliveryStatus) ? item.deliveryStatus : "pending",
          deliveryBatchId: item.deliveryBatchId ? String(item.deliveryBatchId) : undefined
        },
        updatedAt: Number(entry.updatedAt) || Date.now()
      }]];
    })) as Record<string, PendingProcurementTaskItemEntry>;
  } catch {
    try {
      window.localStorage.removeItem(pendingProcurementTaskItemStorageKey);
    } catch {
      // Ignore storage cleanup failures.
    }
    return {};
  }
}

function writePendingProcurementTaskItem(item: ProcurementTaskItem, updatedAt: number) {
  try {
    const pendingItems = readPendingProcurementTaskItems();
    pendingItems[item.id] = { item, updatedAt };
    window.localStorage.setItem(pendingProcurementTaskItemStorageKey, JSON.stringify(pendingItems));
  } catch {
    // Local storage is best-effort; the direct save request still runs.
  }
}

function removePendingProcurementTaskItem(itemId: string, updatedAt: number) {
  try {
    const pendingItems = readPendingProcurementTaskItems();
    if (!pendingItems[itemId] || pendingItems[itemId].updatedAt !== updatedAt) return;
    delete pendingItems[itemId];
    if (Object.keys(pendingItems).length === 0) {
      window.localStorage.removeItem(pendingProcurementTaskItemStorageKey);
      return;
    }
    window.localStorage.setItem(pendingProcurementTaskItemStorageKey, JSON.stringify(pendingItems));
  } catch {
    // Ignore cleanup failures; a later successful sync can clear the record.
  }
}

function isProcurementDeliveryStatus(value: unknown): value is ProcurementTaskItem["deliveryStatus"] {
  return value === "pending" || value === "in_delivery" || value === "delivered" || value === "received";
}

function filterRecordByKeys<T>(record: Record<string, T>, validKeys: Set<string>) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => validKeys.has(key))) as Record<string, T>;
}
