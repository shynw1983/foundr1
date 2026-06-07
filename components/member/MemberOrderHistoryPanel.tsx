"use client";

import { ReceiptText, ShoppingBag } from "lucide-react";

export type MemberOrderHistory = {
  id: string;
  pickupCode: string;
  orderSource: string;
  status: string;
  paymentStatus: string;
  paymentRefundStatus: string;
  amount: number;
  refundAmount: number;
  pickupDate: string;
  pickupTime: string;
  createdAt: string;
  brandName: string;
  storeName: string;
  items: string[];
  receiptPreviewUrl: string;
  receiptPdfUrl: string;
};

type MemberOrderHistoryPanelProps = {
  orders?: MemberOrderHistory[];
  compact?: boolean;
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
  if (order.paymentStatus === "refunded" || order.status === "cancelled") return "取消済み";
  if (order.paymentStatus === "partial_refunded" || order.paymentRefundStatus === "partial") return "一部返金済み";
  if (order.paymentStatus === "paid") return "支払い済み";
  if (order.paymentStatus === "pending") return "支払い待ち";
  return order.status || order.paymentStatus || "-";
}

function orderSourceLabel(value: string) {
  if (value === "maamaa_web") return "まぁ麻 Web予約";
  if (value === "nanacha_web") return "nanacha Web予約";
  return "Web予約";
}

export function MemberOrderHistoryPanel({ orders, compact = false }: MemberOrderHistoryPanelProps) {
  return (
    <article className={`member-portal-panel member-order-panel${compact ? " is-compact" : ""}`}>
      <div className="member-portal-panel-title">
        <ShoppingBag size={18} />
        <h3>購入履歴・領収書</h3>
      </div>
      <div className="member-order-list">
        {orders?.length ? orders.map((order) => (
          <div key={order.id} className="member-order-row">
            <div className="member-order-main">
              <div>
                <strong>{order.brandName || orderSourceLabel(order.orderSource)}</strong>
                <span>{order.storeName || orderSourceLabel(order.orderSource)} / {order.pickupCode}</span>
              </div>
              <div className="member-order-items">
                {(order.items.length ? order.items : ["明細なし"]).slice(0, 3).map((item) => <span key={`${order.id}-${item}`}>{item}</span>)}
              </div>
            </div>
            <div className="member-order-meta">
              <span>{formatPickupDate(order.pickupDate)} {order.pickupTime}</span>
              <b>{formatYen(order.amount)}</b>
              {order.refundAmount > 0 ? <small>返金 {formatYen(order.refundAmount)}</small> : null}
            </div>
            <div className="member-order-actions">
              <span className={order.paymentStatus === "refunded" || order.status === "cancelled" ? "is-cancelled" : ""}>{orderStatusLabel(order)}</span>
              {order.receiptPreviewUrl ? (
                <a href={order.receiptPreviewUrl} target="_blank" rel="noreferrer">
                  <ReceiptText size={15} />
                  領収書
                </a>
              ) : null}
            </div>
          </div>
        )) : <p>Web予約の購入履歴はまだありません。</p>}
      </div>
    </article>
  );
}
