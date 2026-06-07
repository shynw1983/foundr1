"use client";

import { MessageSquareText, ReceiptText, RotateCcw, ShoppingBag, X } from "lucide-react";
import { useMemo, useState } from "react";

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

function orderStatusLabel(order: MemberOrderHistory) {
  if (order.paymentStatus === "refunded" || order.status === "cancelled") return "キャンセル済み";
  if (order.paymentStatus === "partial_refunded" || order.paymentRefundStatus === "partial") return "一部返金済み";
  if (order.status === "refund_pending" || order.paymentRefundStatus === "pending") return "返金処理中";
  if (order.status === "completed") return "完了";
  if (order.status === "ready") return "受け取り可";
  if (order.status === "preparing") return "準備中";
  if (order.paymentStatus === "paid") return "支払い済み";
  if (order.paymentStatus === "pending") return "支払い待ち";
  return order.status || order.paymentStatus || "-";
}

function orderSourceLabel(value: string) {
  if (value === "store_pos") return "店舗購入";
  if (value === "maamaa_web") return "まぁ麻 Web予約";
  if (value === "nanacha_web") return "nanacha Web予約";
  return "Web予約";
}

function getPurchaseChannel(order: MemberOrderHistory) {
  return order.purchaseChannel === "store" || order.orderSource === "store_pos" ? "store" : "online";
}

function orderItemSummary(items: string[]) {
  const visibleItems = items.filter(Boolean);
  if (!visibleItems.length) return "明細は詳細で確認できます";
  if (visibleItems.length === 1) return visibleItems[0];
  return `${visibleItems[0]} ほか ${visibleItems.length - 1}件`;
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

function couponDisplayName(input: { couponName?: string; couponCode?: string; couponId?: string }) {
  const name = String(input.couponName || "").trim();
  const code = String(input.couponCode || "").trim();
  if (name && code) return `${name} / ${code}`;
  if (name) return name;
  if (code) return code;
  return input.couponId ? "クーポン適用" : "";
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
  const [activeTab, setActiveTab] = useState<"online" | "store">("online");
  const [selectedOrder, setSelectedOrder] = useState<MemberOrderHistory | null>(null);
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [cancelMessage, setCancelMessage] = useState("");
  const groupedOrders = useMemo(() => ({
    online: (orders ?? []).filter((order) => getPurchaseChannel(order) === "online"),
    store: (orders ?? []).filter((order) => getPurchaseChannel(order) === "store")
  }), [orders]);
  const visibleOrders = groupedOrders[activeTab];
  const emptyMessage = activeTab === "online" ? "Web予約の履歴はまだありません。" : "実店舗購入の履歴はまだありません。";

  async function requestCancel(order: MemberOrderHistory) {
    if (!order.canCancel || cancelSubmitting) return;
    const confirmed = window.confirm([
      "このWeb予約をキャンセルし、支払い済みの場合は返金を申請します。",
      "",
      `注文番号: ${order.pickupCode}`,
      `金額: ${formatYen(order.amount)}`,
      "",
      "よろしいですか？"
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
        setCancelMessage(body.error || "キャンセル申請を処理できませんでした。");
        return;
      }
      setCancelMessage("キャンセル・返金申請を受け付けました。");
      await onRefresh?.();
      setSelectedOrder(null);
    } catch {
      setCancelMessage("通信に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setCancelSubmitting(false);
    }
  }

  return (
    <article className={`member-portal-panel member-order-panel${compact ? " is-compact" : ""}`}>
      <div className="member-portal-panel-title">
        <ShoppingBag size={18} />
        <h3>購入履歴</h3>
      </div>
      <div className="member-order-tabs" role="tablist" aria-label="購入履歴の種別">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "online"}
          className={activeTab === "online" ? "is-active" : ""}
          onClick={() => setActiveTab("online")}
        >
          Web予約
          <span>{groupedOrders.online.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "store"}
          className={activeTab === "store" ? "is-active" : ""}
          onClick={() => setActiveTab("store")}
        >
          実店舗購入
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
                <strong>{order.brandName || orderSourceLabel(order.orderSource)}</strong>
                <span>{order.storeName || orderSourceLabel(order.orderSource)} / {orderSourceLabel(order.orderSource)} / {order.pickupCode}</span>
              </div>
              <p className="member-order-summary">{orderItemSummary(order.items)}</p>
            </div>
            <div className="member-order-meta">
              <span>{formatPickupDate(order.pickupDate)} {order.pickupTime}</span>
              <b>{formatYen(order.amount)}</b>
              {order.refundAmount > 0 ? <small>返金 {formatYen(order.refundAmount)}</small> : null}
            </div>
            <div className="member-order-actions">
              <span className={order.paymentStatus === "refunded" || order.status === "cancelled" ? "is-cancelled" : ""}>{orderStatusLabel(order)}</span>
              {getPurchaseChannel(order) === "online" && order.receiptPreviewUrl ? (
                <a href={order.receiptPreviewUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                  <ReceiptText size={15} />
                  領収書
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
                <span>{orderSourceLabel(selectedOrder.orderSource)} / {selectedOrder.pickupCode}</span>
                <h4 id="member-order-modal-title">{selectedOrder.brandName || orderSourceLabel(selectedOrder.orderSource)}</h4>
              </div>
              <button type="button" aria-label="閉じる" onClick={() => setSelectedOrder(null)}>
                <X size={18} />
              </button>
            </header>

            <div className="member-order-modal-status">
              <span className={selectedOrder.paymentStatus === "refunded" || selectedOrder.status === "cancelled" ? "is-cancelled" : ""}>
                {orderStatusLabel(selectedOrder)}
              </span>
              <strong>{formatYen(selectedOrder.amount)}</strong>
            </div>

            <dl className="member-order-modal-info">
              <div><dt>店舗</dt><dd>{selectedOrder.storeName || "-"}</dd></div>
              <div><dt>日時</dt><dd>{formatPickupDate(selectedOrder.pickupDate)} {selectedOrder.pickupTime}</dd></div>
              {selectedOrder.refundAmount > 0 ? <div><dt>返金</dt><dd>{formatYen(selectedOrder.refundAmount)}</dd></div> : null}
            </dl>

            <div className="member-order-modal-discount">
              <h5>クーポン・割引</h5>
              {Number(selectedOrder.couponDiscountAmount || 0) > 0 || selectedOrder.couponName || selectedOrder.couponCode ? (
                <dl>
                  {selectedOrder.subtotalAmount ? <div><dt>小計</dt><dd>{formatYen(selectedOrder.subtotalAmount)}</dd></div> : null}
                  <div>
                    <dt>使用クーポン</dt>
                    <dd>{couponDisplayName(selectedOrder) || "クーポン適用"}</dd>
                  </div>
                  <div className="is-discount">
                    <dt>クーポン値引き</dt>
                    <dd>-{formatYen(selectedOrder.couponDiscountAmount || 0)}</dd>
                  </div>
                </dl>
              ) : (
                <p>この注文ではクーポン・割引は使用されていません。</p>
              )}
            </div>

            <div className="member-order-modal-items">
              <h5>商品明細</h5>
              {(selectedOrder.itemDetails?.length ? selectedOrder.itemDetails : selectedOrder.items.map((item): MemberOrderHistoryItem => ({ name: item, quantity: 1 }))).map((item, index) => {
                const optionLabels = itemOptionLabels(item);
                const itemCouponName = couponDisplayName(item);
                const itemCouponDiscountAmount = Number(item.couponDiscountAmount || 0);
                return (
                  <div key={`${selectedOrder.id}-detail-${index}`} className="member-order-modal-item">
                    <div>
                      <strong>{item.name}</strong>
                      {optionLabels.length ? <p>{optionLabels.join(" / ")}</p> : null}
                      {itemCouponName || itemCouponDiscountAmount > 0 ? (
                        <p className="member-order-modal-item-coupon">
                          {itemCouponName || "クーポン適用"}
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
                  {cancelSubmitting ? "処理中..." : "キャンセル・返金申請"}
                </button>
              ) : null}
              {selectedOrder.orderSource === "maamaa_web" ? (
                <p>
                  {selectedOrder.canCancel
                    ? `受取予定の${selectedOrder.cancelWindowMinutes ?? 30}分前まで申請できます${formatCancelDeadline(selectedOrder.cancelDeadline) ? `（期限 ${formatCancelDeadline(selectedOrder.cancelDeadline)}）` : ""}。`
                    : "キャンセル受付時間を過ぎた、または調理開始後のため、この画面からは申請できません。"}
                </p>
              ) : null}
              {cancelMessage ? <p className="member-order-modal-message">{cancelMessage}</p> : null}
            </div>

            <div className="member-order-modal-reserved-actions" aria-label="今後追加予定の機能">
              <button type="button" disabled>
                <RotateCcw size={15} />
                もう一度注文
              </button>
              <button type="button" disabled>
                <MessageSquareText size={15} />
                評価・味のフィードバック
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </article>
  );
}
