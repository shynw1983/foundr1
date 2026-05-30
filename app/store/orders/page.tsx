"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

function shouldNotifyNewOrder(previousOrder: StoreOrder | undefined, nextOrder: StoreOrder) {
  return nextOrder.paymentStatus === "paid" &&
    nextOrder.status === "new" &&
    (!previousOrder || previousOrder.paymentStatus !== "paid" || previousOrder.status !== "new");
}

function splitLines(value = "") {
  return String(value).split(/\n+/).map((item) => item.trim()).filter(Boolean);
}

export default function StoreOrdersPage() {
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [newOrderIds, setNewOrderIds] = useState<string[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundReady, setSoundReady] = useState(false);
  const [error, setError] = useState("");
  const audioContextRef = useRef<AudioContext | null>(null);

  const ensureAudioReady = async () => {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass();
    }

    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }

    setSoundReady(true);
  };

  const playNewOrderSound = () => {
    if (!soundEnabled || !audioContextRef.current || audioContextRef.current.state !== "running") return;
    const context = audioContextRef.current;
    const playTone = (frequency: number, startAt: number, duration: number, volume = 0.42) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.02);
    };

    const now = context.currentTime;
    playTone(1046.5, now, 0.16, 0.38);
    playTone(1568, now + 0.18, 0.18, 0.46);
    playTone(1046.5, now + 0.48, 0.16, 0.38);
    playTone(1568, now + 0.66, 0.22, 0.48);
  };

  const refresh = async () => {
    setIsRefreshing(true);
    const response = await fetch("/api/store/orders", { cache: "no-store" });
    if (!response.ok) {
      setError("注文を読み込めませんでした。");
      setLoading(false);
      setIsRefreshing(false);
      return;
    }
    const body = await response.json();
    const nextOrders = body.orders ?? [];
    setOrders((current) => {
      const currentById = new Map(current.map((order) => [order.id, order]));
      const incomingIds = nextOrders
        .filter((order: StoreOrder) => shouldNotifyNewOrder(currentById.get(order.id), order))
        .map((order: StoreOrder) => order.id);

      if (incomingIds.length) {
        setNewOrderIds(incomingIds);
        setSelectedId((currentSelected) => currentSelected || incomingIds[0]);
        playNewOrderSound();
        window.setTimeout(() => setNewOrderIds([]), 10000);
      }

      return nextOrders;
    });
    setSelectedId((current) => current || nextOrders[0]?.id || "");
    setLastUpdatedAt(
      new Intl.DateTimeFormat("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }).format(new Date())
    );
    setLoading(false);
    setIsRefreshing(false);
    setError("");
  };

  useEffect(() => {
    refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const timer = window.setInterval(refresh, 8000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.clearInterval(timer);
    };
  }, []);

  const visibleOrders = useMemo(() => orders.filter((order) => {
    const matchesQuery = `${order.pickupCode} ${order.drink}`.toLowerCase().includes(query.toLowerCase());
    if (status === "all") return matchesQuery;
    const matchesStatus = status === "active"
      ? ["pending_payment", "new", "preparing", "ready"].includes(order.status)
      : order.status === status;
    return matchesQuery && matchesStatus;
  }), [orders, query, status]);
  const selectedOrder = visibleOrders.find((order) => order.id === selectedId) ?? visibleOrders[0];
  const counters = {
    new: orders.filter((order) => order.status === "new").length,
    preparing: orders.filter((order) => order.status === "preparing").length,
    ready: orders.filter((order) => order.status === "ready").length
  };

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
          <section className="store-order-stats" aria-label="注文数">
            <article>
              <span>新規</span>
              <strong>{counters.new}</strong>
            </article>
            <article>
              <span>制作中</span>
              <strong>{counters.preparing}</strong>
            </article>
            <article>
              <span>受け取り可</span>
              <strong>{counters.ready}</strong>
            </article>
          </section>
          <div className="store-orders-toolbar">
            <h2>Web予約注文</h2>
            <button type="button" className="secondary-button" onClick={refresh}>
              {isRefreshing ? "更新中..." : "更新"}
            </button>
          </div>
          <div className="store-orders-controls">
            <input
              aria-label="注文を検索"
              placeholder="受取番号・商品名"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="表示状態">
              <option value="active">対応中</option>
              <option value="pending_payment">決済待ち</option>
              <option value="new">新規</option>
              <option value="preparing">制作中</option>
              <option value="ready">受け取り可</option>
              <option value="completed">完了</option>
              <option value="all">すべて</option>
            </select>
          </div>
          <div className="store-orders-sound-row">
            <button
              type="button"
              className="secondary-button"
              onClick={async () => {
                const next = !soundEnabled;
                setSoundEnabled(next);
                if (next) await ensureAudioReady();
              }}
            >
              {soundEnabled ? "通知音 ON" : "通知音 OFF"}
            </button>
            <span>{soundEnabled && soundReady ? "新規注文を音で通知します" : "通知音を有効にできます"}</span>
          </div>
          <p className="store-orders-live-note">自動更新中{lastUpdatedAt ? ` · ${lastUpdatedAt}` : ""}</p>
          {loading ? <p className="muted-text">読み込み中...</p> : null}
          {error ? <p className="form-error">{error}</p> : null}
          <div className="store-order-cards">
            {visibleOrders.map((order) => (
              <button
                type="button"
                className={[
                  "store-order-card",
                  selectedOrder?.id === order.id ? "is-active" : "",
                  newOrderIds.includes(order.id) ? "is-new" : ""
                ].filter(Boolean).join(" ")}
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
