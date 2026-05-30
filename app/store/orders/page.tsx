"use client";

import { useEffect, useMemo, useState } from "react";
import { StoreNavTabs } from "../components/StoreNavTabs";

type StoreOrder = {
  id: string;
  storeName: string;
  pickupCode: string;
  status: string;
  paymentStatus: string;
  pickupDate: string;
  pickupTime: string;
  amount: number;
  currency: string;
  drink: string;
  size: string;
  temperature: string;
  sweetness: string;
  ice: string;
  option: string;
  toppings: string;
  createdAt: string;
  squareReceiptUrl: string;
};

const statusLabels: Record<string, string> = {
  new: "新規",
  preparing: "制作中",
  ready: "受け取り可",
  completed: "完了",
  cancelled: "キャンセル",
  pending_payment: "決済待ち",
  checkout_failed: "決済作成失敗",
  payment_failed: "決済失敗"
};

const paymentLabels: Record<string, string> = {
  pending: "未決済",
  paid: "支払済み",
  failed: "失敗",
  canceled: "キャンセル"
};

const nextActions: Record<string, Array<{ status: string; label: string }>> = {
  new: [{ status: "preparing", label: "制作開始" }],
  preparing: [{ status: "ready", label: "受け取り可" }],
  ready: [{ status: "completed", label: "受け渡し完了" }]
};

function splitLines(value = "") {
  return String(value).split(/\n+/).map((item) => item.trim()).filter(Boolean);
}

export default function StoreOrdersPage() {
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [status, setStatus] = useState("active");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = async () => {
    const response = await fetch("/api/store/orders", { cache: "no-store" });
    if (!response.ok) {
      setError("注文を読み込めませんでした。");
      setLoading(false);
      return;
    }
    const body = await response.json();
    const nextOrders = body.orders ?? [];
    setOrders(nextOrders);
    setSelectedId((current) => current || nextOrders[0]?.id || "");
    setLoading(false);
    setError("");
  };

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 8000);
    return () => window.clearInterval(timer);
  }, []);

  const visibleOrders = useMemo(() => orders.filter((order) => {
    if (status === "all") return true;
    if (status === "active") return !["completed", "cancelled", "payment_failed", "checkout_failed"].includes(order.status);
    return order.status === status;
  }), [orders, status]);
  const selectedOrder = visibleOrders.find((order) => order.id === selectedId) ?? visibleOrders[0];

  const updateStatus = async (orderId: string, nextStatus: string) => {
    const response = await fetch("/api/store/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, status: nextStatus })
    });
    if (response.ok) await refresh();
  };

  return (
    <main className="store-workbench-shell">
      <header className="store-workbench-topbar">
        <a className="brand-block" href="/store" aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 Store</p>
            <h1>注文管理</h1>
          </div>
        </a>
        <StoreNavTabs active="orders" />
      </header>

      <section className="store-orders-layout">
        <aside className="panel store-orders-list">
          <div className="store-orders-toolbar">
            <h2>Web予約注文</h2>
            <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="表示状態">
              <option value="active">対応中</option>
              <option value="new">新規</option>
              <option value="preparing">制作中</option>
              <option value="ready">受け取り可</option>
              <option value="completed">完了</option>
              <option value="all">すべて</option>
            </select>
          </div>
          {loading ? <p className="muted-text">読み込み中...</p> : null}
          {error ? <p className="form-error">{error}</p> : null}
          <div className="store-order-cards">
            {visibleOrders.map((order) => (
              <button
                type="button"
                className={selectedOrder?.id === order.id ? "store-order-card is-active" : "store-order-card"}
                key={order.id}
                onClick={() => setSelectedId(order.id)}
              >
                <span className="store-order-code">{order.pickupCode}</span>
                <strong>{splitLines(order.drink).join(" / ")}</strong>
                <small>{order.pickupDate} {order.pickupTime} / {statusLabels[order.status] ?? order.status}</small>
              </button>
            ))}
            {!visibleOrders.length && !loading ? <p className="muted-text">表示する注文はありません。</p> : null}
          </div>
        </aside>

        <section className="panel store-order-detail">
          {selectedOrder ? (
            <>
              <div className="store-order-detail-head">
                <div>
                  <p className="eyebrow">{selectedOrder.storeName}</p>
                  <h2>{selectedOrder.pickupCode}</h2>
                  <p>{selectedOrder.pickupDate} {selectedOrder.pickupTime}</p>
                </div>
                <div className="store-order-status-stack">
                  <span className="status-pill is-active">{statusLabels[selectedOrder.status] ?? selectedOrder.status}</span>
                  <span className="status-pill">{paymentLabels[selectedOrder.paymentStatus] ?? selectedOrder.paymentStatus}</span>
                </div>
              </div>

              <div className="store-order-lines">
                {splitLines(selectedOrder.size).length > 1 ? (
                  splitLines(selectedOrder.size).map((line) => <p key={line}>{line}</p>)
                ) : (
                  <>
                    <h3>{selectedOrder.drink}</h3>
                    <p>{selectedOrder.size} / {selectedOrder.temperature} / {selectedOrder.sweetness} / {selectedOrder.ice}</p>
                    <p>{selectedOrder.option} / {selectedOrder.toppings}</p>
                  </>
                )}
              </div>

              <div className="store-order-total">
                <span>合計</span>
                <strong>¥{Number(selectedOrder.amount).toLocaleString("ja-JP")}</strong>
              </div>

              <div className="store-order-actions">
                {(nextActions[selectedOrder.status] ?? []).map((action) => (
                  <button type="button" className="primary-button" key={action.status} onClick={() => updateStatus(selectedOrder.id, action.status)}>
                    {action.label}
                  </button>
                ))}
                {selectedOrder.status !== "completed" && selectedOrder.status !== "cancelled" ? (
                  <button type="button" className="secondary-button" onClick={() => updateStatus(selectedOrder.id, "cancelled")}>キャンセル</button>
                ) : null}
              </div>
            </>
          ) : (
            <p className="muted-text">注文を選択してください。</p>
          )}
        </section>
      </section>
    </main>
  );
}
