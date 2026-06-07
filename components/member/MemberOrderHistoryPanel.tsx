"use client";

import { ReceiptText, ShoppingBag } from "lucide-react";
import { useMemo, useState } from "react";

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
  if (order.paymentStatus === "refunded" || order.status === "cancelled") return "キャンセル済み";
  if (order.paymentStatus === "partial_refunded" || order.paymentRefundStatus === "partial") return "一部返金済み";
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

export function MemberOrderHistoryPanel({ orders, compact = false }: MemberOrderHistoryPanelProps) {
  const [activeTab, setActiveTab] = useState<"online" | "store">("online");
  const groupedOrders = useMemo(() => ({
    online: (orders ?? []).filter((order) => getPurchaseChannel(order) === "online"),
    store: (orders ?? []).filter((order) => getPurchaseChannel(order) === "store")
  }), [orders]);
  const visibleOrders = groupedOrders[activeTab];
  const emptyMessage = activeTab === "online" ? "Web予約の履歴はまだありません。" : "実店舗購入の履歴はまだありません。";

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
          <div key={order.id} className="member-order-row">
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
                <a href={order.receiptPreviewUrl} target="_blank" rel="noreferrer">
                  <ReceiptText size={15} />
                  領収書
                </a>
              ) : null}
            </div>
          </div>
        )) : <p>{emptyMessage}</p>}
      </div>
    </article>
  );
}
