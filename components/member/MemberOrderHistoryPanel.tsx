"use client";

import { MessageSquareText, ReceiptText, RotateCcw, ShoppingBag, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useMemberLanguage } from "./MemberLanguageProvider";
import { memberText } from "./memberTranslations";

export type MemberOrderHistoryItem = {
  name: string;
  quantity: number;
  sizeLabel?: string;
  temperature?: string;
  sweetness?: string;
  ice?: string;
  optionLabel?: string;
  toppingLabels?: string[];
  measuredQuantity?: number | null;
  measuredUnit?: string;
  amount?: number;
  couponDiscountAmount?: number;
  couponId?: string;
  couponCode?: string;
  couponName?: string;
};

export type MemberOrderHistory = {
  id: string;
  pickupCode: string;
  orderSource: string;
  purchaseChannel?: "online" | "store";
  status: string;
  paymentStatus: string;
  paymentRefundStatus: string;
  amount: number;
  refundAmount: number;
  subtotalAmount?: number;
  couponDiscountAmount?: number;
  couponId?: string;
  couponCode?: string;
  couponName?: string;
  pickupDate: string;
  pickupTime: string;
  createdAt: string;
  brandName: string;
  storeName: string;
  items: string[];
  itemDetails?: MemberOrderHistoryItem[];
  canCancel?: boolean;
  cancelDeadline?: string;
  cancelWindowMinutes?: number;
  receiptPreviewUrl: string;
  receiptPdfUrl: string;
};

type MemberOrderHistoryPanelProps = {
  orders?: MemberOrderHistory[];
  compact?: boolean;
  onRefresh?: () => Promise<void> | void;
};

function formatYen(value: number) {
  return `¥${Math.round(value || 0).toLocaleString("ja-JP")}`;
}

function formatPickupDate(value: string) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", { month: "2-digit", day: "2-digit", weekday: "short" }).format(date);
}

function orderStatusLabel(order: MemberOrderHistory, text: typeof memberText[keyof typeof memberText]) {
  if (order.paymentStatus === "refunded" || order.status === "cancelled") return text.statusCancelled;
  if (order.paymentStatus === "partial_refunded" || order.paymentRefundStatus === "partial") return text.statusPartialRefunded;
  if (order.status === "refund_pending" || order.paymentRefundStatus === "pending") return text.statusRefundPending;
  if (order.status === "completed") return text.statusCompleted;
  if (order.status === "ready") return text.statusReady;
  if (order.status === "preparing") return text.statusPreparing;
  if (order.paymentStatus === "paid") return text.statusPaid;
  if (order.paymentStatus === "pending") return text.statusPending;
  return order.status || order.paymentStatus || "-";
}

function orderSourceLabel(value: string, text: typeof memberText[keyof typeof memberText]) {
  if (value === "store_pos") return text.sourceStorePos;
  if (value === "maamaa_web") return text.sourceMaamaaWeb;
  if (value === "nanacha_web") return text.sourceNanachaWeb;
  return text.sourceWeb;
}

function getPurchaseChannel(order: MemberOrderHistory) {
  return order.purchaseChannel === "store" || order.orderSource === "store_pos" ? "store" : "online";
}

function orderItemSummary(items: string[], text: typeof memberText[keyof typeof memberText]) {
  const visibleItems = items.filter(Boolean);
  if (!visibleItems.length) return text.detailsFallback;
  if (visibleItems.length === 1) return visibleItems[0];
  return `${visibleItems[0]} ${text.otherItems(visibleItems.length - 1)}`;
}

function itemOptionLabels(item: MemberOrderHistoryItem) {
  const measuredQuantity = Number(item.measuredQuantity);
  const measuredLabel = Number.isFinite(measuredQuantity) && measuredQuantity > 0
    ? `${measuredQuantity.toLocaleString("ja-JP")} ${item.measuredUnit || ""}`.trim()
    : "";
  return [
    measuredLabel,
    item.sizeLabel,
    item.temperature,
    item.sweetness,
    item.ice,
    item.optionLabel,
    ...(Array.isArray(item.toppingLabels) ? item.toppingLabels : [])
  ].map((label) => String(label || "").trim()).filter(Boolean);
}

function couponDisplayName(input: { couponName?: string; couponCode?: string; couponId?: string }, text: typeof memberText[keyof typeof memberText]) {
  const name = String(input.couponName || "").trim();
  const code = String(input.couponCode || "").trim();
  if (name && code) return `${name} / ${code}`;
  if (name) return name;
  if (code) return code;
  return input.couponId ? text.couponApplied : "";
}

function formatCancelDeadline(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function MemberOrderHistoryPanel({ orders, compact = false, onRefresh }: MemberOrderHistoryPanelProps) {
  const { language } = useMemberLanguage();
  const text = memberText[language];
  const [activeTab, setActiveTab] = useState<"online" | "store">("online");
  const [selectedOrder, setSelectedOrder] = useState<MemberOrderHistory | null>(null);
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [cancelMessage, setCancelMessage] = useState("");
  const groupedOrders = useMemo(() => ({
    online: (orders ?? []).filter((order) => getPurchaseChannel(order) === "online"),
    store: (orders ?? []).filter((order) => getPurchaseChannel(order) === "store")
  }), [orders]);
  const visibleOrders = groupedOrders[activeTab];
  const emptyMessage = activeTab === "online" ? text.noWebOrders : text.noStoreOrders;

  async function requestCancel(order: MemberOrderHistory) {
    if (!order.canCancel || cancelSubmitting) return;
    const confirmed = window.confirm([
      text.cancelConfirm(order.pickupCode, formatYen(order.amount))
    ].join("\n"));
    if (!confirmed) return;
    setCancelSubmitting(true);
    setCancelMessage("");
    try {
      const response = await fetch("/api/public/members/orders/cancel", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, pickupCode: order.pickupCode })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setCancelMessage(body.error || text.cancelRequestFailed);
        return;
      }
      setCancelMessage(text.cancelRequestAccepted);
      await onRefresh?.();
      setSelectedOrder(null);
    } catch {
      setCancelMessage(text.networkError);
    } finally {
      setCancelSubmitting(false);
    }
  }

  return (
    <article className={`member-portal-panel member-order-panel${compact ? " is-compact" : ""}`}>
      <div className="member-portal-panel-title">
        <ShoppingBag size={18} />
        <h3>{text.purchaseHistory}</h3>
      </div>
      <div className="member-order-tabs" role="tablist" aria-label={text.orderTypeTabs}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "online"}
          className={activeTab === "online" ? "is-active" : ""}
          onClick={() => setActiveTab("online")}
        >
          {text.webReservation}
          <span>{groupedOrders.online.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "store"}
          className={activeTab === "store" ? "is-active" : ""}
          onClick={() => setActiveTab("store")}
        >
          {text.storePurchase}
          <span>{groupedOrders.store.length}</span>
        </button>
      </div>
      <div className="member-order-list">
        {visibleOrders.length ? visibleOrders.map((order) => (
          <div
            key={order.id}
            className="member-order-row"
            role="button"
            tabIndex={0}
            onClick={() => setSelectedOrder(order)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelectedOrder(order);
              }
            }}
          >
            <div className="member-order-main">
              <div>
                <strong>{order.brandName || orderSourceLabel(order.orderSource, text)}</strong>
                <span>{order.storeName || orderSourceLabel(order.orderSource, text)} / {orderSourceLabel(order.orderSource, text)} / {order.pickupCode}</span>
              </div>
              <p className="member-order-summary">{orderItemSummary(order.items, text)}</p>
            </div>
            <div className="member-order-meta">
              <span>{formatPickupDate(order.pickupDate)} {order.pickupTime}</span>
              <b>{formatYen(order.amount)}</b>
              {order.refundAmount > 0 ? <small>返金 {formatYen(order.refundAmount)}</small> : null}
            </div>
            <div className="member-order-actions">
              <span className={order.paymentStatus === "refunded" || order.status === "cancelled" ? "is-cancelled" : ""}>{orderStatusLabel(order, text)}</span>
              {getPurchaseChannel(order) === "online" && order.receiptPreviewUrl ? (
                <a href={order.receiptPreviewUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                  <ReceiptText size={15} />
                  {text.receipt}
                </a>
              ) : null}
            </div>
          </div>
        )) : <p>{emptyMessage}</p>}
      </div>
      {selectedOrder ? (
        <div className="member-order-modal-backdrop" role="presentation" onClick={() => setSelectedOrder(null)}>
          <section
            className="member-order-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="member-order-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="member-order-modal-header">
              <div>
                <span>{orderSourceLabel(selectedOrder.orderSource, text)} / {selectedOrder.pickupCode}</span>
                <h4 id="member-order-modal-title">{selectedOrder.brandName || orderSourceLabel(selectedOrder.orderSource, text)}</h4>
              </div>
              <button type="button" aria-label={text.close} onClick={() => setSelectedOrder(null)}>
                <X size={18} />
              </button>
            </header>

            <div className="member-order-modal-status">
              <span className={selectedOrder.paymentStatus === "refunded" || selectedOrder.status === "cancelled" ? "is-cancelled" : ""}>
                {orderStatusLabel(selectedOrder, text)}
              </span>
              <strong>{formatYen(selectedOrder.amount)}</strong>
            </div>

            <dl className="member-order-modal-info">
              <div><dt>{text.store}</dt><dd>{selectedOrder.storeName || "-"}</dd></div>
              <div><dt>{text.dateTime}</dt><dd>{formatPickupDate(selectedOrder.pickupDate)} {selectedOrder.pickupTime}</dd></div>
              {selectedOrder.refundAmount > 0 ? <div><dt>{text.refund}</dt><dd>{formatYen(selectedOrder.refundAmount)}</dd></div> : null}
            </dl>

            <div className="member-order-modal-discount">
              <h5>{text.couponDiscount}</h5>
              {Number(selectedOrder.couponDiscountAmount || 0) > 0 || selectedOrder.couponName || selectedOrder.couponCode ? (
                <dl>
                  {selectedOrder.subtotalAmount ? <div><dt>{text.subtotal}</dt><dd>{formatYen(selectedOrder.subtotalAmount)}</dd></div> : null}
                  <div>
                    <dt>{text.usedCoupon}</dt>
                    <dd>{couponDisplayName(selectedOrder, text) || text.couponApplied}</dd>
                  </div>
                  <div className="is-discount">
                    <dt>{text.couponDiscountAmount}</dt>
                    <dd>-{formatYen(selectedOrder.couponDiscountAmount || 0)}</dd>
                  </div>
                </dl>
              ) : (
                <p>{text.noCouponDiscount}</p>
              )}
            </div>

            <div className="member-order-modal-items">
              <h5>{text.itemDetails}</h5>
              {(selectedOrder.itemDetails?.length ? selectedOrder.itemDetails : selectedOrder.items.map((item): MemberOrderHistoryItem => ({ name: item, quantity: 1 }))).map((item, index) => {
                const optionLabels = itemOptionLabels(item);
                const itemCouponName = couponDisplayName(item, text);
                const itemCouponDiscountAmount = Number(item.couponDiscountAmount || 0);
                return (
                  <div key={`${selectedOrder.id}-detail-${index}`} className="member-order-modal-item">
                    <div>
                      <strong>{item.name}</strong>
                      {optionLabels.length ? <p>{optionLabels.join(" / ")}</p> : null}
                      {itemCouponName || itemCouponDiscountAmount > 0 ? (
                        <p className="member-order-modal-item-coupon">
                          {itemCouponName || text.couponApplied}
                          {itemCouponDiscountAmount > 0 ? ` / -${formatYen(itemCouponDiscountAmount)}` : ""}
                        </p>
                      ) : null}
                    </div>
                    <span>x {item.quantity}</span>
                  </div>
                );
              })}
            </div>

            <div className="member-order-modal-primary-actions">
              {selectedOrder.orderSource === "maamaa_web" ? (
                <button type="button" disabled={!selectedOrder.canCancel || cancelSubmitting} onClick={() => void requestCancel(selectedOrder)}>
                  {cancelSubmitting ? text.processing : text.cancelRefundRequest}
                </button>
              ) : null}
              {selectedOrder.orderSource === "maamaa_web" ? (
                <p>
                  {selectedOrder.canCancel
                    ? text.cancelDeadlineAvailable(selectedOrder.cancelWindowMinutes ?? 30, formatCancelDeadline(selectedOrder.cancelDeadline))
                    : text.cancelUnavailable}
                </p>
              ) : null}
              {cancelMessage ? <p className="member-order-modal-message">{cancelMessage}</p> : null}
            </div>

            <div className="member-order-modal-reserved-actions" aria-label={text.orderAgain}>
              <button type="button" disabled>
                <RotateCcw size={15} />
                {text.orderAgain}
              </button>
              <button type="button" disabled>
                <MessageSquareText size={15} />
                {text.tasteFeedback}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </article>
  );
}
