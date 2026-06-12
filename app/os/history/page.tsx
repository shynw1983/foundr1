"use client";

import { Boxes, ClipboardList, FileText, Lightbulb, MessageSquareWarning, PackageCheck, Search, Store, Truck, LogOut, UserCog } from "lucide-react";
import { UserBadge } from "../components/UserBadge";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { orders, products as initialProducts } from "../../../lib/mock-data";

type Product = typeof initialProducts[number];
type ProductWithSpec = Product & {
  id?: string;
  packageQuantity?: number | string;
  packageQuantityUnit?: string;
  mainSupplier?: string;
  variantName?: string;
};
type PurchaseOrder = typeof orders[number] & {
  deadlineAt?: string | null;
  createdAt?: string | null;
};
type PurchaseOrderItem = {
  id?: string;
  orderId: string;
  productId?: string;
  productName: string;
  brandName?: string;
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
};
type SupplierFulfillment = {
  id?: string;
  orderId: string;
  supplier: string;
  receiptPhotoUrl?: string;
  receiptUploadedLabel?: string;
  receiptConfirmedLabel?: string;
  receiptConfirmedBy?: string;
};
type HistoryRow = {
  id: string;
  orderId: string;
  productId: string;
  store: string;
  brand: string;
  deadline: string;
  deadlineMonth: string;
  deadlineDate: string;
  productName: string;
  productSpec: string;
  productBrand: string;
  supplier: string;
  requestedQuantity: number;
  actualQuantity: number;
  actualPrice: string;
  unit: string;
  deliveryStatus?: "pending" | "in_delivery" | "delivered" | "received";
  status: string;
  note: string;
};
type HistoryCorrectionDraft = {
  itemId: string;
  productId: string;
  productName: string;
  actualQuantity: string;
  actualPrice: string;
  unit: string;
  supplier: string;
  note: string;
};
type HistoryReportRow = {
  id: string;
  store: string;
  productName: string;
  productSpec: string;
  unit: string;
  totalActualQuantity: number;
  totalRequestedQuantity: number;
  orderIds: Set<string>;
  unavailableCount: number;
  latestDeadline: string;
};
type DisplayHistoryReportRow = Omit<HistoryReportRow, "orderIds"> & {
  orderCount: number;
  averageActualQuantity: number;
};
type ReceiptStatusFilter = "すべて" | "未アップロード" | "未確認" | "確認済み";
type ReceiptRow = {
  id: string;
  fulfillmentId?: string;
  orderId: string;
  store: string;
  brand: string;
  deadline: string;
  deadlineDate: string;
  supplier: string;
  itemCount: number;
  receiptPhotoUrl: string;
  receiptUploadedLabel: string;
  receiptConfirmedLabel: string;
  receiptConfirmedBy: string;
  status: Exclude<ReceiptStatusFilter, "すべて">;
};
type HistoryView = "orders" | "usage" | "items" | "receipts";
type HistoryOrderRow = {
  id: string;
  store: string;
  brand: string;
  deadline: string;
  deadlineMonth: string;
  deadlineDate: string;
  status: string;
  items: HistoryRow[];
  itemCount: number;
  productCount: number;
  purchasedCount: number;
  unavailableCount: number;
  receivedCount: number;
  supplierSummary: string;
};

const statusTone: Record<string, string> = {
  未設定: "tone-waiting",
  未購入: "tone-waiting",
  一部購入済み: "tone-route",
  購入済み: "tone-confirm",
  購入完了: "tone-confirm",
  購入不可: "tone-warning",
  配送中: "tone-route",
  納品済み: "tone-confirm",
  店舗確認済み: "tone-done"
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

function getCurrentMonthKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? String(new Date().getFullYear());
  const month = parts.find((part) => part.type === "month")?.value ?? String(new Date().getMonth() + 1).padStart(2, "0");

  return `${year}-${month}`;
}

function getCurrentDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? String(new Date().getFullYear());
  const month = parts.find((part) => part.type === "month")?.value ?? String(new Date().getMonth() + 1).padStart(2, "0");
  const day = parts.find((part) => part.type === "day")?.value ?? String(new Date().getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getCurrentMonthRange() {
  const monthKey = getCurrentMonthKey();
  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const endDate = new Date(year, monthIndex + 1, 0);

  return {
    start: `${monthKey}-01`,
    end: formatDateKey(endDate)
  };
}

function getMonthKeyFromDate(value?: string | Date | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;

  return year && month ? `${year}-${month}` : "";
}

function getDateKeyFromDate(value?: string | Date | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return year && month && day ? `${year}-${month}-${day}` : "";
}

function getOrderMonthKey(order?: PurchaseOrder) {
  if (!order) return getCurrentMonthKey();

  return getMonthKeyFromDate(order.deadlineAt) || getMonthKeyFromDate(order.createdAt) || getCurrentMonthKey();
}

function getOrderDateKey(order?: PurchaseOrder) {
  if (!order) return getCurrentDateKey();

  return getDateKeyFromDate(order.deadlineAt) || getDateKeyFromDate(order.createdAt) || getCurrentDateKey();
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  if (!year || !month) return monthKey;

  return `${year}年${Number(month)}月`;
}

function formatDateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-");
  if (!year || !month || !day) return dateKey;

  return `${year}/${month}/${day}`;
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addMonths(monthKey: string, amount: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 1 + amount, 1);

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getCalendarDays(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const firstDate = new Date(year, month - 1, 1);
  const firstDay = firstDate.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const blanks = Array.from({ length: firstDay }, () => "");
  const days = Array.from({ length: daysInMonth }, (_, index) =>
    `${monthKey}-${String(index + 1).padStart(2, "0")}`
  );

  return [...blanks, ...days];
}

function isDateInRange(dateKey: string, start: string, end: string) {
  if (!dateKey || !start) return false;
  if (!end) return dateKey === start;

  return dateKey >= start && dateKey <= end;
}

function getItemStatus(item: PurchaseOrderItem) {
  if (item.unavailable) return "購入不可";
  if (item.deliveryStatus === "delivered") return "納品済み";
  if (item.deliveryStatus === "received") return "店舗確認済み";
  if (item.deliveryStatus === "in_delivery") return "配送中";
  if (item.purchased) return "購入済み";

  return "未購入";
}

function formatPackageQuantity(product: ProductWithSpec) {
  const quantity = Number(product.packageQuantity ?? 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return "";

  return `${quantity.toLocaleString("ja-JP", { maximumFractionDigits: 3 })} ${product.packageQuantityUnit || product.unit || "個"}`;
}

function getProductDisplaySpec(product?: ProductWithSpec) {
  if (!product) return "";

  const packageQuantity = formatPackageQuantity(product);
  const variantName = String(product.variantName ?? "").trim();
  if (packageQuantity && variantName) return `${variantName} / ${packageQuantity}`;
  if (variantName) return variantName;

  return packageQuantity;
}

function createHistoryRows(
  purchaseOrders: PurchaseOrder[],
  orderItems: PurchaseOrderItem[],
  products: ProductWithSpec[]
) {
  const orderMap = new Map(purchaseOrders.map((order) => [order.id, order]));
  const productMap = new Map(products.map((product) => [product.name, product]));
  const productById = new Map(products.flatMap((product) => product.id ? [[String(product.id), product] as const] : []));

  return orderItems.map<HistoryRow>((item, index) => {
    const order = orderMap.get(item.orderId);
    const product = item.productId ? productById.get(item.productId) : productMap.get(item.productName);

    return {
      id: item.id ?? `${item.orderId}-${index}`,
      orderId: item.orderId,
      productId: item.productId ?? "",
      store: order?.store ?? "未設定",
      brand: order?.brand ?? "共通",
      deadline: order?.deadline ?? "",
      deadlineMonth: getOrderMonthKey(order),
      deadlineDate: getOrderDateKey(order),
      productName: item.productName,
      productSpec: getProductDisplaySpec(product),
      productBrand: item.brandName ?? product?.brand ?? order?.brand ?? "共通",
      supplier: item.supplier || product?.mainSupplier || "未設定",
      requestedQuantity: item.requestedQuantity,
      actualQuantity: item.actualQuantity ?? item.requestedQuantity,
      actualPrice: item.actualPrice ?? "",
      unit: item.unit,
      deliveryStatus: item.deliveryStatus,
      status: getItemStatus(item),
      note: [item.note, item.priceExceptionNote].filter(Boolean).join(" / ")
    };
  });
}

function createHistoryReportRows(rows: HistoryRow[]) {
  const reportMap = new Map<string, HistoryReportRow>();

  rows.forEach((row) => {
    const key = [row.store, row.productName, row.productSpec, row.unit].join("\u0000");
    const current = reportMap.get(key) ?? {
      id: key,
      store: row.store,
      productName: row.productName,
      productSpec: row.productSpec,
      unit: row.unit,
      totalActualQuantity: 0,
      totalRequestedQuantity: 0,
      orderIds: new Set<string>(),
      unavailableCount: 0,
      latestDeadline: ""
    };

    current.totalActualQuantity += row.actualQuantity;
    current.totalRequestedQuantity += row.requestedQuantity;
    current.orderIds.add(row.orderId);
    current.unavailableCount += row.status === "購入不可" ? 1 : 0;
    current.latestDeadline = row.deadline > current.latestDeadline ? row.deadline : current.latestDeadline;
    reportMap.set(key, current);
  });

  return Array.from(reportMap.values()).map<DisplayHistoryReportRow>((row) => {
    const orderCount = row.orderIds.size;

    return {
      ...row,
      orderCount,
      averageActualQuantity: orderCount > 0 ? row.totalActualQuantity / orderCount : 0
    };
  }).sort((a, b) =>
    (b.totalActualQuantity - a.totalActualQuantity) ||
    (b.orderCount - a.orderCount) ||
    a.store.localeCompare(b.store, "ja") ||
    a.productName.localeCompare(b.productName, "ja")
  );
}

function createStoreReportRows(rows: HistoryRow[]) {
  const reportMap = new Map<string, { store: string; itemCount: number; orderCount: number; productCount: number }>();
  const productSets = new Map<string, Set<string>>();

  rows.forEach((row) => {
    const current = reportMap.get(row.store) ?? { store: row.store, itemCount: 0, orderCount: 0, productCount: 0 };
    const products = productSets.get(row.store) ?? new Set<string>();
    current.itemCount += 1;
    products.add(row.productName);
    productSets.set(row.store, products);
    reportMap.set(row.store, current);
  });

  return Array.from(reportMap.values())
    .map((row) => {
      const orderIds = new Set(rows.filter((item) => item.store === row.store).map((item) => item.orderId));
      return { ...row, orderCount: orderIds.size, productCount: productSets.get(row.store)?.size ?? 0 };
    })
    .sort((a, b) => b.itemCount - a.itemCount || a.store.localeCompare(b.store, "ja"));
}

function getOrderStatus(items: HistoryRow[]) {
  if (items.length === 0) return "未設定";

  if (items.every((item) => item.status === "店舗確認済み")) return "店舗確認済み";
  if (items.every((item) => item.status === "納品済み" || item.status === "店舗確認済み")) return "納品済み";
  if (items.some((item) => item.status === "配送中")) return "配送中";

  const purchaseCompletedCount = items.filter((item) => item.status === "購入済み" || item.status === "購入不可").length;
  if (purchaseCompletedCount === items.length) return "購入完了";
  if (purchaseCompletedCount > 0) return "一部購入済み";

  return "未購入";
}

function createHistoryOrderRows(purchaseOrders: PurchaseOrder[], rows: HistoryRow[]) {
  const rowsByOrderId = new Map<string, HistoryRow[]>();
  rows.forEach((row) => {
    rowsByOrderId.set(row.orderId, [...(rowsByOrderId.get(row.orderId) ?? []), row]);
  });

  return purchaseOrders.map<HistoryOrderRow>((order) => {
    const items = rowsByOrderId.get(order.id) ?? [];
    const productCount = new Set(items.map((item) => item.productName)).size;
    const suppliers = Array.from(new Set(items.map((item) => item.supplier).filter((supplier) => supplier !== "未設定")));
    const purchasedCount = items.filter((item) =>
      item.status === "購入済み" ||
      item.status === "配送中" ||
      item.status === "納品済み" ||
      item.status === "店舗確認済み" ||
      item.status === "購入不可"
    ).length;

    return {
      id: order.id,
      store: order.store,
      brand: order.brand,
      deadline: order.deadline,
      deadlineMonth: getOrderMonthKey(order),
      deadlineDate: getOrderDateKey(order),
      status: getOrderStatus(items),
      items,
      itemCount: items.length,
      productCount,
      purchasedCount,
      unavailableCount: items.filter((item) => item.status === "購入不可").length,
      receivedCount: items.filter((item) => item.status === "店舗確認済み").length,
      supplierSummary: suppliers.length > 0 ? `${suppliers.slice(0, 2).join(" / ")}${suppliers.length > 2 ? " ほか" : ""}` : "未設定"
    };
  }).sort((a, b) =>
    (b.deadline || "").localeCompare(a.deadline || "", "ja") ||
    b.id.localeCompare(a.id, "ja")
  );
}

function createReceiptRows(purchaseOrders: PurchaseOrder[], rows: HistoryRow[], supplierFulfillments: SupplierFulfillment[]) {
  const orderMap = new Map(purchaseOrders.map((order) => [order.id, order]));
  const fulfillmentMap = new Map(supplierFulfillments.map((fulfillment) => [
    [fulfillment.orderId, fulfillment.supplier].join("\u0000"),
    fulfillment
  ]));
  const receiptMap = new Map<string, ReceiptRow>();

  rows.forEach((row) => {
    const supplier = row.supplier || "未設定";
    const key = [row.orderId, supplier].join("\u0000");
    const order = orderMap.get(row.orderId);
    const fulfillment = fulfillmentMap.get(key);
    const current = receiptMap.get(key) ?? {
      id: key,
      fulfillmentId: fulfillment?.id,
      orderId: row.orderId,
      store: row.store,
      brand: row.brand,
      deadline: order?.deadline ?? row.deadline,
      deadlineDate: getOrderDateKey(order),
      supplier,
      itemCount: 0,
      receiptPhotoUrl: fulfillment?.receiptPhotoUrl ?? "",
      receiptUploadedLabel: fulfillment?.receiptUploadedLabel ?? "",
      receiptConfirmedLabel: fulfillment?.receiptConfirmedLabel ?? "",
      receiptConfirmedBy: fulfillment?.receiptConfirmedBy ?? "",
      status: "未アップロード" as const
    };

    current.itemCount += 1;
    current.fulfillmentId = fulfillment?.id ?? current.fulfillmentId;
    current.receiptPhotoUrl = fulfillment?.receiptPhotoUrl ?? current.receiptPhotoUrl;
    current.receiptUploadedLabel = fulfillment?.receiptUploadedLabel ?? current.receiptUploadedLabel;
    current.receiptConfirmedLabel = fulfillment?.receiptConfirmedLabel ?? current.receiptConfirmedLabel;
    current.receiptConfirmedBy = fulfillment?.receiptConfirmedBy ?? current.receiptConfirmedBy;
    current.status = current.receiptPhotoUrl
      ? current.receiptConfirmedLabel ? "確認済み" : "未確認"
      : "未アップロード";
    receiptMap.set(key, current);
  });

  return Array.from(receiptMap.values()).sort((a, b) =>
    b.deadlineDate.localeCompare(a.deadlineDate, "ja") ||
    b.orderId.localeCompare(a.orderId, "ja") ||
    a.supplier.localeCompare(b.supplier, "ja")
  );
}

function formatQuantity(value: number) {
  return value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
}

function isPdfReceiptUrl(receiptPhotoUrl: string) {
  return getReceiptUrlExtension(receiptPhotoUrl) === "pdf";
}

function getReceiptDownloadName(row: Pick<ReceiptRow, "orderId" | "supplier" | "receiptPhotoUrl">) {
  return `receipt-${row.orderId}-${row.supplier}.${getReceiptUrlExtension(row.receiptPhotoUrl)}`.replace(/[^\w.-]+/g, "-");
}

function getReceiptUrlExtension(receiptPhotoUrl: string) {
  try {
    const url = new URL(receiptPhotoUrl, "https://foundr1.local");
    const pathname = url.searchParams.get("pathname") || url.pathname;
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    const extension = match ? match[1].toLowerCase() : "jpg";
    return ["jpg", "jpeg", "png", "webp", "heic", "pdf"].includes(extension) ? extension : "jpg";
  } catch {
    return "jpg";
  }
}

function HistoryMonthCalendar({
  monthKey,
  startDate,
  endDate,
  onSelect
}: {
  monthKey: string;
  startDate: string;
  endDate: string;
  onSelect: (dateKey: string) => void;
}) {
  const weekDays = ["日", "月", "火", "水", "木", "金", "土"];

  return (
    <section className="history-calendar-month">
      <h4>{formatMonthLabel(monthKey)}</h4>
      <div className="history-calendar-weekdays">
        {weekDays.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="history-calendar-days">
        {getCalendarDays(monthKey).map((dateKey, index) => {
          if (!dateKey) return <span aria-hidden="true" key={`blank-${monthKey}-${index}`} />;

          const day = Number(dateKey.slice(-2));
          const isStart = dateKey === startDate;
          const isEnd = dateKey === endDate;
          const isInRange = isDateInRange(dateKey, startDate, endDate);

          return (
            <button
              type="button"
              className={[
                isInRange ? "is-in-range" : "",
                isStart ? "is-start" : "",
                isEnd ? "is-end" : ""
              ].filter(Boolean).join(" ")}
              onClick={() => onSelect(dateKey)}
              key={dateKey}
            >
              {day}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function HistoryCorrectionDialog({
  row,
  products,
  onClose,
  onSave
}: {
  row: HistoryRow;
  products: ProductWithSpec[];
  onClose: () => void;
  onSave: (draft: HistoryCorrectionDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<HistoryCorrectionDraft>(() => ({
    itemId: row.id,
    productId: row.productId,
    productName: row.productName,
    actualQuantity: String(row.actualQuantity),
    actualPrice: row.actualPrice,
    unit: row.unit,
    supplier: row.supplier === "未設定" ? "" : row.supplier,
    note: row.note ? `${row.note} / 履歴修正` : "履歴修正"
  }));
  const [isSaving, setIsSaving] = useState(false);
  const productOptions = products
    .filter((product) => product.id)
    .sort((left, right) => {
      const leftCategory = String(left.category ?? "");
      const rightCategory = String(right.category ?? "");
      return leftCategory.localeCompare(rightCategory, "ja")
        || String(left.name).localeCompare(String(right.name), "ja");
    });
  const selectedProduct = productOptions.find((product) => String(product.id) === draft.productId);
  const actualQuantity = Number(draft.actualQuantity);
  const canSave = !isSaving && Number.isFinite(actualQuantity) && actualQuantity > 0 && (draft.productId || draft.productName.trim());

  function updateDraft(next: Partial<HistoryCorrectionDraft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  async function submitCorrection() {
    if (!canSave) return;
    setIsSaving(true);
    await onSave(draft);
    setIsSaving(false);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="edit-modal history-correction-modal" role="dialog" aria-modal="true" aria-labelledby="history-correction-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div>
            <p className="eyebrow">History Correction</p>
            <h3 id="history-correction-title">購入履歴修正</h3>
            <p>{row.orderId} · {row.store}</p>
          </div>
          <button type="button" className="text-button" onClick={onClose}>
            閉じる
          </button>
        </div>
        <div className="exception-summary">
          <strong>{row.productName}</strong>
          {row.productSpec ? <span>{row.productSpec}</span> : null}
          <span>現在 {formatQuantity(row.actualQuantity)} {row.unit}</span>
          <span>{row.status}</span>
        </div>
        <div className="edit-fields">
          <label>
            <span>購入した商品バリエーション</span>
            <select
              value={draft.productId}
              onChange={(event) => {
                const product = productOptions.find((item) => String(item.id) === event.target.value);
                updateDraft({
                  productId: event.target.value,
                  productName: product?.name ?? draft.productName,
                  unit: product?.unit ?? draft.unit,
                  supplier: product?.mainSupplier || draft.supplier
                });
              }}
            >
              {!row.productId ? <option value="">現在の臨時商品: {row.productName}</option> : null}
              {productOptions.map((product) => (
                <option value={String(product.id)} key={String(product.id)}>
                  {product.name}{getProductDisplaySpec(product) ? ` / ${getProductDisplaySpec(product)}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>商品名</span>
            <input
              value={selectedProduct?.name ?? draft.productName}
              disabled={Boolean(selectedProduct)}
              onChange={(event) => updateDraft({ productName: event.target.value })}
            />
          </label>
          <label>
            <span>実購入数量</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.actualQuantity}
              onChange={(event) => updateDraft({ actualQuantity: event.target.value })}
            />
          </label>
          <label>
            <span>単位</span>
            <input value={draft.unit} onChange={(event) => updateDraft({ unit: event.target.value })} />
          </label>
          <label>
            <span>実単価</span>
            <input
              inputMode="decimal"
              value={draft.actualPrice}
              placeholder="未設定"
              onChange={(event) => updateDraft({ actualPrice: event.target.value })}
            />
          </label>
          <label>
            <span>発注先</span>
            <input value={draft.supplier} onChange={(event) => updateDraft({ supplier: event.target.value })} />
          </label>
          <label className="full-span">
            <span>修正メモ</span>
            <textarea value={draft.note} onChange={(event) => updateDraft({ note: event.target.value })} />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="text-button" onClick={onClose}>
            キャンセル
          </button>
          <button type="button" className="primary-button" disabled={!canSave} onClick={() => void submitCorrection()}>
            {isSaving ? "保存中..." : "修正を保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProcurementHistoryPage() {
  const [products, setProducts] = useState<ProductWithSpec[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [purchaseOrderItems, setPurchaseOrderItems] = useState<PurchaseOrderItem[]>([]);
  const [supplierFulfillments, setSupplierFulfillments] = useState<SupplierFulfillment[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("すべて");
  const [receiptStatusFilter, setReceiptStatusFilter] = useState<ReceiptStatusFilter>("すべて");
  const [storeFilter, setStoreFilter] = useState("すべて");
  const [dateRange, setDateRange] = useState(getCurrentMonthRange);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(getCurrentMonthKey);
  const [historyView, setHistoryView] = useState<HistoryView>("orders");
  const [activeReceipt, setActiveReceipt] = useState<ReceiptRow | null>(null);
  const [activeCorrectionRow, setActiveCorrectionRow] = useState<HistoryRow | null>(null);
  const [currentRole, setCurrentRole] = useState("");
  const [dataSource, setDataSource] = useState<"loading" | "neon">("loading");

  async function loadHistoryData() {
    const [response, meResponse] = await Promise.all([
      fetch("/api/dashboard", { cache: "no-store" }),
      fetch("/api/auth/me", { cache: "no-store" })
    ]);
    if (meResponse.ok) {
      const body = await meResponse.json().catch(() => ({})) as { employee?: { role?: string } };
      setCurrentRole(body.employee?.role ?? "");
    }
    if (!response.ok) return;

    const data = await response.json() as {
      products?: ProductWithSpec[];
      orders?: PurchaseOrder[];
      purchaseOrderItems?: PurchaseOrderItem[];
      supplierFulfillments?: SupplierFulfillment[];
    };

    if (data.products) setProducts(data.products);
    if (data.orders) setPurchaseOrders(data.orders);
    if (data.purchaseOrderItems) setPurchaseOrderItems(data.purchaseOrderItems);
    if (data.supplierFulfillments) setSupplierFulfillments(data.supplierFulfillments);
    setDataSource("neon");
  }

  useEffect(() => {
    void loadHistoryData();
  }, []);

  const rows = useMemo(
    () => createHistoryRows(purchaseOrders, purchaseOrderItems, products),
    [purchaseOrders, purchaseOrderItems, products]
  );
  const orderRows = useMemo(() => createHistoryOrderRows(purchaseOrders, rows), [purchaseOrders, rows]);
  const receiptRows = useMemo(() => createReceiptRows(purchaseOrders, rows, supplierFulfillments), [purchaseOrders, rows, supplierFulfillments]);
  const orderStatusById = new Map(orderRows.map((row) => [row.id, row.status]));
  const stores = Array.from(new Set([...orderRows.map((row) => row.store), ...rows.map((row) => row.store)]));
  const statusOptions = ["未設定", "未購入", "一部購入済み", "購入済み", "購入完了", "購入不可", "配送中", "納品済み", "店舗確認済み"];
  const receiptStatusOptions: ReceiptStatusFilter[] = ["すべて", "未アップロード", "未確認", "確認済み"];
  const reportBaseRows = rows.filter((row) => {
    const targetText = [
      row.orderId,
      row.store,
      row.brand,
      row.productBrand,
      row.productName,
      row.productSpec,
      row.supplier,
      row.status,
      row.note
    ].join(" ");

    return (
      targetText.toLowerCase().includes(query.toLowerCase()) &&
      row.deadlineDate >= dateRange.start &&
      row.deadlineDate <= dateRange.end &&
      (statusFilter === "すべて" || row.status === statusFilter || orderStatusById.get(row.orderId) === statusFilter)
    );
  });
  const filteredRows = reportBaseRows.filter((row) => storeFilter === "すべて" || row.store === storeFilter);
  const filteredOrderRows = orderRows.filter((row) => {
    const targetText = [
      row.id,
      row.store,
      row.brand,
      row.deadline,
      row.status,
      row.supplierSummary,
      ...row.items.flatMap((item) => [item.productName, item.productSpec, item.productBrand, item.supplier, item.status, item.note])
    ].join(" ");

    return (
      targetText.toLowerCase().includes(query.toLowerCase()) &&
      row.deadlineDate >= dateRange.start &&
      row.deadlineDate <= dateRange.end &&
      (storeFilter === "すべて" || row.store === storeFilter) &&
      (statusFilter === "すべて" || row.status === statusFilter || row.items.some((item) => item.status === statusFilter))
    );
  });
  const reportRows = createHistoryReportRows(filteredRows).slice(0, 12);
  const storeReportRows = createStoreReportRows(reportBaseRows);
  const filteredReceiptRows = receiptRows.filter((row) => {
    const targetText = [row.orderId, row.store, row.brand, row.supplier, row.status].join(" ");

    return (
      targetText.toLowerCase().includes(query.toLowerCase()) &&
      row.deadlineDate >= dateRange.start &&
      row.deadlineDate <= dateRange.end &&
      (storeFilter === "すべて" || row.store === storeFilter) &&
      (receiptStatusFilter === "すべて" || row.status === receiptStatusFilter)
    );
  });
  const canDeleteHistory = currentRole === "owner";
  const canCorrectHistory = currentRole === "owner" || currentRole === "manager";
  const dateRangeLabel = `${formatDateLabel(dateRange.start)} - ${formatDateLabel(dateRange.end)}`;

  function selectDateRangeDay(dateKey: string) {
    setDateRange((currentRange) => {
      if (!currentRange.start || currentRange.end) return { start: dateKey, end: "" };
      if (dateKey < currentRange.start) return { start: dateKey, end: currentRange.start };

      return { start: currentRange.start, end: dateKey };
    });
  }

  function applyCurrentMonthRange() {
    const currentRange = getCurrentMonthRange();
    setDateRange(currentRange);
    setCalendarMonth(getCurrentMonthKey());
  }

  async function deleteHistoryOrder(orderId: string) {
    if (!window.confirm(`${orderId} の発注履歴を削除しますか？関連する明細・異常報告も削除されます。`)) return;

    const response = await fetch("/api/orders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      window.alert(body.error ?? "発注履歴を削除できませんでした。");
      return;
    }

    setPurchaseOrders((items) => items.filter((item) => item.id !== orderId));
    setPurchaseOrderItems((items) => items.filter((item) => item.orderId !== orderId));
  }

  async function deleteHistoryItem(itemId: string) {
    if (!window.confirm("この発注明細を削除しますか？関連する異常報告も削除されます。")) return;

    const response = await fetch("/api/procurement/items", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      window.alert(body.error ?? "発注明細を削除できませんでした。");
      return;
    }

    setPurchaseOrderItems((items) => items.filter((item) => item.id !== itemId));
  }

  async function confirmReceipt(row: ReceiptRow) {
    if (!row.fulfillmentId || !row.receiptPhotoUrl) return;

    const response = await fetch("/api/procurement/receipts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fulfillmentId: row.fulfillmentId })
    });

    const body = await response.json().catch(() => ({})) as {
      error?: string;
      receiptConfirmedBy?: string;
      receiptConfirmedLabel?: string;
    };

    if (!response.ok) {
      window.alert(body.error ?? "レシートを確認済みにできませんでした。");
      return;
    }

    setSupplierFulfillments((fulfillments) =>
      fulfillments.map((fulfillment) => fulfillment.id === row.fulfillmentId
          ? {
              ...fulfillment,
              receiptConfirmedBy: body.receiptConfirmedBy ?? "",
              receiptConfirmedLabel: body.receiptConfirmedLabel ?? ""
            }
        : fulfillment
      )
    );
    setActiveReceipt((current) => {
      if (!current || current.fulfillmentId !== row.fulfillmentId) return current;

      return {
        ...current,
        receiptConfirmedBy: body.receiptConfirmedBy ?? "",
        receiptConfirmedLabel: body.receiptConfirmedLabel ?? "",
        status: "確認済み"
      };
    });
  }

  async function saveHistoryCorrection(draft: HistoryCorrectionDraft) {
    const product = products.find((item) => item.id === draft.productId);
    const note = draft.note.trim();
    const response = await fetch("/api/procurement/items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId: draft.itemId,
        historyCorrection: true,
        purchased: true,
        productId: product?.id ?? "",
        productName: product?.name ?? draft.productName,
        unit: product?.unit ?? draft.unit,
        actualQuantity: Number(draft.actualQuantity),
        actualPrice: draft.actualPrice,
        supplier: draft.supplier,
        note
      })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      window.alert(body.error ?? "履歴修正を保存できませんでした。");
      return;
    }

    setActiveCorrectionRow(null);
    await loadHistoryData();
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
            <p className="eyebrow">依頼番号単位の発注履歴</p>
            <h2>発注履歴</h2>
            <span className="source-indicator">{dataSource === "neon" ? "データ同期済み" : "読み込み中"}</span>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input
                value={query}
                placeholder="依頼番号・店舗・商品・発注先を検索"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
        </header>

        <div className="history-view-tabs" aria-label="履歴表示切替">
          <button type="button" className={historyView === "orders" ? "is-active" : ""} onClick={() => setHistoryView("orders")}>
            発注履歴
          </button>
          <button type="button" className={historyView === "usage" ? "is-active" : ""} onClick={() => setHistoryView("usage")}>
            商品使用量
          </button>
          <button type="button" className={historyView === "items" ? "is-active" : ""} onClick={() => setHistoryView("items")}>
            明細一覧
          </button>
          <button type="button" className={historyView === "receipts" ? "is-active" : ""} onClick={() => setHistoryView("receipts")}>
            レシート確認
          </button>
        </div>

        <div className="history-filter-row">
          <div className="history-date-range-field">
            <span>対象期間</span>
            <button
              type="button"
              className="history-date-range-button"
              onClick={() => setIsDatePickerOpen((isOpen) => !isOpen)}
            >
              {dateRangeLabel}
            </button>
            {isDatePickerOpen ? (
              <div className="history-date-popover">
                <div className="history-date-popover-heading">
                  <button type="button" className="text-button" onClick={() => setCalendarMonth((month) => addMonths(month, -1))}>
                    前月
                  </button>
                  <strong>{formatMonthLabel(calendarMonth)} - {formatMonthLabel(addMonths(calendarMonth, 1))}</strong>
                  <button type="button" className="text-button" onClick={() => setCalendarMonth((month) => addMonths(month, 1))}>
                    次月
                  </button>
                </div>
                <div className="history-calendar-pair">
                  {[calendarMonth, addMonths(calendarMonth, 1)].map((month) => (
                    <HistoryMonthCalendar
                      key={month}
                      monthKey={month}
                      startDate={dateRange.start}
                      endDate={dateRange.end}
                      onSelect={selectDateRangeDay}
                    />
                  ))}
                </div>
                <div className="history-date-popover-actions">
                  <button type="button" className="text-button" onClick={applyCurrentMonthRange}>
                    今月
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!dateRange.start || !dateRange.end}
                    onClick={() => setIsDatePickerOpen(false)}
                  >
                    適用
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          <label>
            <span>店舗</span>
            <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}>
              <option value="すべて">すべて</option>
              {stores.map((store) => (
                <option value={store} key={store}>{store}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{historyView === "receipts" ? "レシート状態" : "状態"}</span>
            {historyView === "receipts" ? (
              <select value={receiptStatusFilter} onChange={(event) => setReceiptStatusFilter(event.target.value as ReceiptStatusFilter)}>
                {receiptStatusOptions.map((status) => (
                  <option value={status} key={status}>{status}</option>
                ))}
              </select>
            ) : (
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="すべて">すべて</option>
                {statusOptions.map((status) => (
                  <option value={status} key={status}>{status}</option>
                ))}
              </select>
            )}
          </label>
        </div>

        {historyView === "orders" ? (
          <section className="panel history-panel">
            <div className="panel-title product-master-title">
              <div>
                <h3>発注履歴</h3>
                <p>依頼番号ごとに過去の発注内容と進行結果を確認</p>
              </div>
              <span className="source-indicator">{filteredOrderRows.length} 件</span>
            </div>
            <div className="history-order-table">
              <div className="history-order-head">
                <span>依頼番号 / 店舗</span>
                <span>締切</span>
                <span>商品</span>
                <span>購入状況</span>
                <span>状態</span>
              </div>
              {filteredOrderRows.map((row) => (
                <article className="history-order-row" key={row.id}>
                  <div>
                    <strong>{row.id}</strong>
                    <p>{row.store} / {row.brand}</p>
                  </div>
                  <div>
                    <strong>{row.deadline || "締切未設定"}</strong>
                    <p>{row.supplierSummary}</p>
                  </div>
                  <div>
                    <strong>商品 {row.itemCount} 件</strong>
                    <p>{row.productCount} 種類</p>
                  </div>
                  <div>
                    <strong>{row.purchasedCount} / {row.itemCount} 件</strong>
                    <p>確認済み {row.receivedCount} 件{row.unavailableCount ? ` · 購入不可 ${row.unavailableCount} 件` : ""}</p>
                  </div>
                  <div className="history-owner-actions">
                    <span className={`status-pill ${statusTone[row.status]}`}>{row.status}</span>
                    {canDeleteHistory ? (
                      <button type="button" className="text-button danger-button" onClick={() => void deleteHistoryOrder(row.id)}>
                        削除
                      </button>
                    ) : null}
                  </div>
                  {row.items.length > 0 ? (
                    <details className="history-order-detail">
                      <summary>明細を見る</summary>
                      <div className="history-order-items">
                        {row.items.map((item) => (
                          <div className="history-order-item" key={item.id}>
                            <div>
                              <div className="history-product-name">
                                <strong>{item.productName}</strong>
                                {item.productSpec ? <span>{item.productSpec}</span> : null}
                              </div>
                              <p>{item.supplier} · 適用ブランド: {item.productBrand}</p>
                              {item.note ? <small>{item.note}</small> : null}
                            </div>
                            <strong>{item.actualQuantity} / {item.requestedQuantity} {item.unit}</strong>
                            <div className="history-owner-actions">
                              <span className={`status-pill ${statusTone[item.status]}`}>{item.status}</span>
                              {canCorrectHistory ? (
                                <button type="button" className="text-button" onClick={() => setActiveCorrectionRow(item)}>
                                  修正
                                </button>
                              ) : null}
                              {canDeleteHistory ? (
                                <button type="button" className="text-button danger-button" onClick={() => void deleteHistoryItem(item.id)}>
                                  削除
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </article>
              ))}
              {filteredOrderRows.length === 0 ? (
                <div className="empty-state">該当する発注履歴はありません</div>
              ) : null}
            </div>
          </section>
        ) : null}

        {historyView === "usage" ? (
          <section className="panel history-report-panel">
            <div className="panel-title product-master-title">
              <div>
                <h3>商品使用量レポート</h3>
                <p>現在の絞り込み条件で、店舗別の商品使用傾向を確認</p>
              </div>
              <span className="source-indicator">{reportRows.length} 件表示</span>
            </div>
            <div className="history-report-grid">
              <div className="history-report-card">
                <h4>店舗を選択</h4>
                <div className="history-report-list">
                  <button
                    type="button"
                    className={storeFilter === "すべて" ? "history-report-summary-row is-active" : "history-report-summary-row"}
                    onClick={() => setStoreFilter("すべて")}
                  >
                    <strong>すべて</strong>
                    <span>全店舗</span>
                    <span>{reportBaseRows.length} 明細</span>
                    <span>{storeReportRows.length} 店舗</span>
                  </button>
                  {storeReportRows.map((row) => (
                    <button
                      type="button"
                      className={storeFilter === row.store ? "history-report-summary-row is-active" : "history-report-summary-row"}
                      onClick={() => setStoreFilter(row.store)}
                      key={row.store}
                    >
                      <strong>{row.store}</strong>
                      <span>依頼 {row.orderCount} 件</span>
                      <span>明細 {row.itemCount} 件</span>
                      <span>商品 {row.productCount} 種</span>
                    </button>
                  ))}
                  {storeReportRows.length === 0 ? <div className="empty-state">集計できる履歴はありません</div> : null}
                </div>
              </div>
              <div className="history-report-card">
                <h4>{storeFilter === "すべて" ? "使用量ランキング" : `${storeFilter} の使用量ランキング`}</h4>
                <div className="history-report-list">
                  {reportRows.map((row, index) => (
                    <article className="history-report-ranking-row" key={row.id}>
                      <span className="rank-badge">{index + 1}</span>
                      <div>
                        <div className="history-product-name">
                          <strong>{row.productName}</strong>
                          {row.productSpec ? <span>{row.productSpec}</span> : null}
                        </div>
                        <p>{row.store} · 最終 {row.latestDeadline || "未設定"}</p>
                      </div>
                      <div className="history-report-quantity">
                        <strong>{formatQuantity(row.totalActualQuantity)} {row.unit}</strong>
                        <small>依頼合計 {formatQuantity(row.totalRequestedQuantity)} {row.unit} · 依頼回数 {row.orderCount} 回</small>
                        <small>平均 {formatQuantity(row.averageActualQuantity)} {row.unit} / 回{row.unavailableCount ? ` · 不可 ${row.unavailableCount} 回` : ""}</small>
                      </div>
                    </article>
                  ))}
                  {reportRows.length === 0 ? <div className="empty-state">集計できる履歴はありません</div> : null}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {historyView === "items" ? (
          <section className="panel history-panel">
            <div className="panel-title product-master-title">
              <div>
                <h3>明細一覧</h3>
                <p>配送は店舗単位、ブランドは商品の用途として確認</p>
              </div>
              <span className="source-indicator">{filteredRows.length} 件</span>
            </div>
            <div className="history-table">
              <div className="history-table-head">
                <span>店舗 / 依頼番号</span>
                <span>商品</span>
                <span>発注先</span>
                <span>数量</span>
                <span>状態</span>
              </div>
              {filteredRows.map((row) => (
                <article className="history-row" key={row.id}>
                  <div>
                    <strong>{row.store}</strong>
                    <p>{row.orderId} · {row.deadline || "締切未設定"}</p>
                  </div>
                  <div>
                    <div className="history-product-name">
                      <strong>{row.productName}</strong>
                      {row.productSpec ? <span>{row.productSpec}</span> : null}
                    </div>
                    <p>適用ブランド: {row.productBrand}</p>
                    {row.note ? <small>{row.note}</small> : null}
                  </div>
                  <span>{row.supplier}</span>
                  <strong>{row.actualQuantity} / {row.requestedQuantity} {row.unit}</strong>
                  <div className="history-owner-actions">
                    <span className={`status-pill ${statusTone[row.status]}`}>{row.status}</span>
                    {canCorrectHistory ? (
                      <button type="button" className="text-button" onClick={() => setActiveCorrectionRow(row)}>
                        修正
                      </button>
                    ) : null}
                    {canDeleteHistory ? (
                      <button type="button" className="text-button danger-button" onClick={() => void deleteHistoryItem(row.id)}>
                        削除
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
              {filteredRows.length === 0 ? (
                <div className="empty-state">該当する発注明細はありません</div>
              ) : null}
            </div>
          </section>
        ) : null}

        {historyView === "receipts" ? (
          <section className="panel history-panel">
            <div className="panel-title product-master-title">
              <div>
                <h3>レシート確認</h3>
                <p>発注先ごとのレシート提出状況を確認し、必要な画像をダウンロード</p>
              </div>
              <span className="source-indicator">{filteredReceiptRows.length} 件</span>
            </div>
            <div className="receipt-summary-strip">
              <span>未アップロード {filteredReceiptRows.filter((row) => row.status === "未アップロード").length} 件</span>
              <span>未確認 {filteredReceiptRows.filter((row) => row.status === "未確認").length} 件</span>
              <span>確認済み {filteredReceiptRows.filter((row) => row.status === "確認済み").length} 件</span>
            </div>
            <div className="history-receipt-table">
              <div className="history-receipt-head">
                <span>依頼番号 / 店舗</span>
                <span>発注先</span>
                <span>レシート</span>
                <span>確認状況</span>
                <span>操作</span>
              </div>
              {filteredReceiptRows.map((row) => (
                <article className="history-receipt-row" key={row.id}>
                  <div>
                    <strong>{row.orderId}</strong>
                    <p>{row.store} / {row.brand}</p>
                    <p>{row.deadline || "締切未設定"} · 商品 {row.itemCount} 件</p>
                  </div>
                  <div>
                    <strong>{row.supplier}</strong>
                    <p>{row.receiptUploadedLabel ? `アップロード ${row.receiptUploadedLabel}` : "未アップロード"}</p>
                  </div>
                  <div className="history-receipt-preview">
                    {row.receiptPhotoUrl ? (
                      <button type="button" onClick={() => setActiveReceipt(row)}>
                        レシートを見る
                      </button>
                    ) : (
                      <span>未アップロード</span>
                    )}
                  </div>
                  <div>
                    <span className={`status-pill ${row.status === "確認済み" ? "tone-done" : row.status === "未確認" ? "tone-warning" : "tone-waiting"}`}>
                      {row.status}
                    </span>
                    {row.receiptConfirmedLabel ? <p>{row.receiptConfirmedLabel} · {row.receiptConfirmedBy || "確認者未設定"}</p> : null}
                  </div>
                  <div className="history-owner-actions history-receipt-actions">
                    {row.receiptPhotoUrl ? (
                      <a className="text-button" href={row.receiptPhotoUrl} download={getReceiptDownloadName(row)}>
                        ダウンロード
                      </a>
                    ) : null}
                    {row.receiptPhotoUrl && row.status !== "確認済み" ? (
                      <button type="button" className="text-button" onClick={() => void confirmReceipt(row)}>
                        確認済みにする
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
              {filteredReceiptRows.length === 0 ? (
                <div className="empty-state">該当するレシート記録はありません</div>
              ) : null}
            </div>
          </section>
        ) : null}
        {activeReceipt ? (
          <div className="modal-backdrop" role="presentation" onMouseDown={() => setActiveReceipt(null)}>
            <div className="edit-modal receipt-preview-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-preview-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="modal-heading">
                <div>
                  <h3 id="receipt-preview-title">レシート確認</h3>
                  <p>{activeReceipt.orderId} · {activeReceipt.store} · {activeReceipt.supplier}</p>
                </div>
                <button type="button" className="text-button" onClick={() => setActiveReceipt(null)}>
                  閉じる
                </button>
              </div>
              <div className="receipt-preview-frame">
                {isPdfReceiptUrl(activeReceipt.receiptPhotoUrl) ? (
                  <iframe src={activeReceipt.receiptPhotoUrl} title={`${activeReceipt.orderId} ${activeReceipt.supplier} のレシートPDF`} />
                ) : (
                  <img src={activeReceipt.receiptPhotoUrl} alt={`${activeReceipt.orderId} ${activeReceipt.supplier} のレシート`} />
                )}
              </div>
              <div className="modal-actions">
                <a className="text-button" href={activeReceipt.receiptPhotoUrl} download={getReceiptDownloadName(activeReceipt)}>
                  ダウンロード
                </a>
                {activeReceipt.status !== "確認済み" ? (
                  <button type="button" className="primary-button" onClick={() => void confirmReceipt(activeReceipt)}>
                    確認済みにする
                  </button>
                ) : (
                  <span className="status-pill tone-done">確認済み</span>
                )}
              </div>
            </div>
          </div>
        ) : null}
        {activeCorrectionRow ? (
          <HistoryCorrectionDialog
            row={activeCorrectionRow}
            products={products}
            onClose={() => setActiveCorrectionRow(null)}
            onSave={saveHistoryCorrection}
          />
        ) : null}
      </section>
    </main>
  );
}
