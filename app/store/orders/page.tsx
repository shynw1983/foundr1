"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { StoreNavTabs } from "../components/StoreNavTabs";
import { clearStoredStoreSelection, getStoredStoreSelection, setStoredStoreSelection } from "../components/store-selection";

type StoreOrder = {
  id: string;
  storeId: string;
  storeName: string;
  orderSource: string;
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
  customerName: string;
  customerPhone: string;
  customerNote: string;
  orderType: string;
  productionTasks: Array<{
    id: string;
    productionArea: string;
    productionAreaLabel: string;
    status: string;
    printStatus: string;
    itemSummary: string;
  }>;
  createdAt: string;
  squareReceiptUrl: string;
};

type StoreOrderAccess = {
  role: string;
  allStores: boolean;
  canViewSalesStats: boolean;
  canCancelOrders: boolean;
  canUseAllStoreView: boolean;
  stores: Array<{ id: string; name: string }>;
  storeIds: string[];
};

type StoreOrderStats = {
  days: number;
  summary: {
    paidOrders: number;
    completedOrders: number;
    cancelledOrders: number;
    activeOrders: number;
    grossSales: number;
    averageCompletionMinutes: number;
  };
  productRanking: Array<{ name: string; count: number; sales: number }>;
  storeBreakdown: Array<{ name: string; paidOrders: number; sales: number }>;
};

type StoreOperation = {
  minimumPickupMinutes?: number | null;
  reservationsEnabled: boolean;
  statusNote: string;
};

const statusLabels: Record<string, string> = {
  new: "新規",
  preparing: "制作中",
  ready: "受け取り可",
  completed: "完了",
  cancelled: "キャンセル",
  refund_pending: "返金処理中",
  pending_payment: "注文待ち",
  checkout_failed: "決済作成失敗",
  payment_failed: "決済失敗"
};

const paymentLabels: Record<string, string> = {
  pending: "未決済",
  paid: "決済済み",
  failed: "未決済",
  canceled: "未決済",
  refunded: "返金済み"
};

const sourceLabels: Record<string, string> = {
  store_pos: "POS",
  nanacha_web: "Web",
  maamaa_web: "Web"
};

const orderTypeLabels: Record<string, string> = {
  eat_in: "店内",
  takeout: "持ち帰り",
  delivery: "外送"
};

const nextActions: Record<string, Array<{ status: string; label: string }>> = {
  new: [{ status: "preparing", label: "制作開始" }],
  preparing: [{ status: "ready", label: "受け取り可" }],
  ready: [{ status: "completed", label: "受け渡し完了" }]
};

const pendingPaymentVisibleMinutes = 30;

function shouldNotifyNewOrder(previousOrder: StoreOrder | undefined, nextOrder: StoreOrder) {
  return nextOrder.paymentStatus === "paid" &&
    nextOrder.status === "new" &&
    (!previousOrder || previousOrder.paymentStatus !== "paid" || previousOrder.status !== "new");
}

function splitLines(value = "") {
  return String(value).split(/\n+/).map((item) => item.trim()).filter(Boolean);
}

function getPaymentPillClass(paymentStatus: string) {
  if (paymentStatus === "paid") return "status-pill is-payment-paid";
  if (paymentStatus === "refunded") return "status-pill is-muted";
  return "status-pill is-payment-unpaid";
}

function isPaidOrder(order?: StoreOrder | null) {
  return order?.paymentStatus === "paid";
}

function isPendingPaymentOrder(order: StoreOrder) {
  return order.status === "pending_payment" || order.paymentStatus !== "paid";
}

function isRecentPendingPaymentOrder(order: StoreOrder) {
  if (!isPendingPaymentOrder(order)) return false;
  const createdAt = new Date(order.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return false;
  return Date.now() - createdAt < pendingPaymentVisibleMinutes * 60 * 1000;
}

function getProductionTaskLabel(status: string) {
  if (status === "ready") return "完成";
  if (status === "preparing") return "制作中";
  return "待ち";
}

const storeOrderStatusPriority: Record<string, number> = {
  new: 0,
  preparing: 1,
  ready: 2,
  pending_payment: 3,
  completed: 4,
  cancelled: 5
};

function getStoreOrderSortTime(order: StoreOrder) {
  const pickupTime = new Date(`${order.pickupDate}T${order.pickupTime || "00:00"}`).getTime();
  if (Number.isFinite(pickupTime)) return pickupTime;
  const createdAt = new Date(order.createdAt).getTime();
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function sortStoreOrders(a: StoreOrder, b: StoreOrder) {
  const priorityDiff = (storeOrderStatusPriority[a.status] ?? 9) - (storeOrderStatusPriority[b.status] ?? 9);
  if (priorityDiff !== 0) return priorityDiff;
  return getStoreOrderSortTime(b) - getStoreOrderSortTime(a);
}

export default function StoreOrdersPage() {
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [access, setAccess] = useState<StoreOrderAccess | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState(() => getStoredStoreSelection());
  const [stats, setStats] = useState<StoreOrderStats | null>(null);
  const [statsDays, setStatsDays] = useState(1);
  const [operation, setOperation] = useState<StoreOperation | null>(null);
  const [minimumPickupDraft, setMinimumPickupDraft] = useState("");
  const [operationSaving, setOperationSaving] = useState(false);
  const [operationMessage, setOperationMessage] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [realtimeStatus, setRealtimeStatus] = useState("connecting");
  const [newOrderIds, setNewOrderIds] = useState<string[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundReady, setSoundReady] = useState(false);
  const [error, setError] = useState("");
  const audioContextRef = useRef<AudioContext | null>(null);
  const selectedStoreIdRef = useRef("");

  useEffect(() => {
    selectedStoreIdRef.current = selectedStoreId;
  }, [selectedStoreId]);

  const selectStore = (storeId: string) => {
    selectedStoreIdRef.current = storeId;
    setSelectedStoreId(storeId);
    setStoredStoreSelection(storeId);
    setSelectedId("");
    setOrders([]);
  };

  const loadOperation = async (storeId = selectedStoreId) => {
    if (!storeId) {
      setOperation(null);
      setMinimumPickupDraft("");
      return;
    }
    const params = new URLSearchParams({ storeId });
    const response = await fetch(`/api/store/operations?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json();
    const nextOperation = body.operation as StoreOperation | null;
    setOperation(nextOperation);
    setMinimumPickupDraft(
      nextOperation?.minimumPickupMinutes === null || nextOperation?.minimumPickupMinutes === undefined
        ? ""
        : String(nextOperation.minimumPickupMinutes),
    );
  };

  const saveOperationSettings = async (patch: Partial<StoreOperation> = {}, successMessage = "受付設定を保存しました。") => {
    if (!selectedStoreId || !operation) return;
    const nextOperation = { ...operation, ...patch };
    const rawMinutes = minimumPickupDraft.trim();
    const minutes = rawMinutes === "" ? null : Math.max(0, Math.min(240, Math.round(Number(rawMinutes) || 0)));
    setOperationSaving(true);
    setOperationMessage("");
    try {
      const response = await fetch("/api/store/operations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStoreId,
          reservationsEnabled: nextOperation.reservationsEnabled,
          statusNote: nextOperation.statusNote,
          minimumPickupMinutes: minutes
        })
      });
      if (!response.ok) throw new Error("save failed");
      await loadOperation(selectedStoreId);
      setOperationMessage(successMessage);
    } catch {
      setOperationMessage("受付設定を保存できませんでした。");
    } finally {
      setOperationSaving(false);
    }
  };

  const saveMinimumPickupMinutes = async () => {
    const rawMinutes = minimumPickupDraft.trim();
    await saveOperationSettings(
      {},
      rawMinutes === "" ? "最短準備時間をブランド初期値に戻しました。" : "最短準備時間を保存しました。",
    );
  };

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
    const params = new URLSearchParams();
    const requestedStoreId = selectedStoreIdRef.current;
    if (requestedStoreId) params.set("storeId", requestedStoreId);
    const response = await fetch(`/api/store/orders${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" });
    if (!response.ok) {
      if (response.status === 403 && requestedStoreId) {
        selectedStoreIdRef.current = "";
        setSelectedStoreId("");
        clearStoredStoreSelection();
        setIsRefreshing(false);
        void refresh();
        return;
      }
      setError("注文を読み込めませんでした。");
      setLoading(false);
      setIsRefreshing(false);
      return;
    }
    const body = await response.json();
    const nextAccess = body.access as StoreOrderAccess | undefined;
    const responseStoreId = String(body.selectedStoreId || requestedStoreId || nextAccess?.stores[0]?.id || "");
    const currentStoreId = selectedStoreIdRef.current;
    if (currentStoreId && responseStoreId && currentStoreId !== responseStoreId) {
      setIsRefreshing(false);
      return;
    }
    if (nextAccess) {
      setAccess(nextAccess);
      if (!selectedStoreIdRef.current && responseStoreId) {
        selectedStoreIdRef.current = responseStoreId;
        setSelectedStoreId(responseStoreId);
        setStoredStoreSelection(responseStoreId);
      }
    }
    if (responseStoreId && responseStoreId !== "__forbidden__") setStoredStoreSelection(responseStoreId);
    if (nextAccess?.canViewSalesStats) {
      const statsParams = new URLSearchParams({ days: String(statsDays) });
      const statsStoreId = selectedStoreIdRef.current || responseStoreId;
      if (statsStoreId) statsParams.set("storeId", statsStoreId);
      const statsResponse = await fetch(`/api/store/order-stats?${statsParams.toString()}`, { cache: "no-store" });
      if (statsResponse.ok) setStats(await statsResponse.json());
    } else {
      setStats(null);
    }
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
    const timer = window.setInterval(refresh, realtimeStatus === "connected" ? 60000 : 8000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.clearInterval(timer);
    };
  }, [realtimeStatus, statsDays, selectedStoreId]);

  useEffect(() => {
    void loadOperation(selectedStoreId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStoreId]);

  useEffect(() => {
    if (!operationMessage) return;
    const timer = window.setTimeout(() => setOperationMessage(""), 3000);
    return () => window.clearTimeout(timer);
  }, [operationMessage]);

  useEffect(() => {
    let pusher: any;
    let channels: any[] = [];
    let active = true;
    if (!selectedStoreId) {
      setRealtimeStatus("polling");
      return () => {
        active = false;
      };
    }
    const upsertOrder = ({ order }: { order: StoreOrder }) => {
      setOrders((current) => {
        if (selectedStoreId && order.storeId !== selectedStoreId) return current;
        const previousOrder = current.find((item) => item.id === order.id);
        const exists = Boolean(previousOrder);
        const next = exists
          ? current.map((item) => (item.id === order.id ? order : item))
          : [order, ...current];

        if (shouldNotifyNewOrder(previousOrder, order)) {
          setNewOrderIds([order.id]);
          setSelectedId(order.id);
          playNewOrderSound();
          window.setTimeout(() => setNewOrderIds([]), 10000);
        }

        return next;
      });
      setLastUpdatedAt(
        new Intl.DateTimeFormat("ja-JP", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        }).format(new Date())
      );
    };

    setRealtimeStatus("connecting");
    fetch(`/api/store/realtime-config?storeId=${encodeURIComponent(selectedStoreId)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(async (config) => {
        if (!active) return;
        if (!config?.key || !config?.cluster || !config?.channels?.length) {
          setRealtimeStatus("polling");
          return;
        }
        const { default: Pusher } = await import("pusher-js");
        if (!active) return;
        pusher = new Pusher(config.key, {
          cluster: config.cluster,
          channelAuthorization: {
            endpoint: "/api/store/realtime-auth",
            transport: "ajax"
          }
        });
        pusher.connection.bind("unavailable", () => {
          if (active) setRealtimeStatus("polling");
        });
        pusher.connection.bind("failed", () => {
          if (active) setRealtimeStatus("polling");
        });
        pusher.connection.bind("disconnected", () => {
          if (active) setRealtimeStatus("polling");
        });
        channels = config.channels.map((channelName: string) => {
          const channel = pusher.subscribe(channelName);
          channel.bind("pusher:subscription_succeeded", () => {
            if (active) setRealtimeStatus("connected");
          });
          channel.bind("pusher:subscription_error", () => {
            if (active) setRealtimeStatus("polling");
          });
          channel.bind("order.created", upsertOrder);
          channel.bind("order.updated", upsertOrder);
          return channel;
        });
      })
      .catch(() => {
        if (active) setRealtimeStatus("polling");
      });

    return () => {
      active = false;
      channels.forEach((channel) => {
        channel.unbind("order.created", upsertOrder);
        channel.unbind("order.updated", upsertOrder);
        pusher?.unsubscribe(channel.name);
      });
      pusher?.disconnect();
    };
  }, [soundEnabled, selectedStoreId]);

  const visibleOrders = useMemo(() => orders
    .filter((order) => {
      const matchesQuery = `${order.pickupCode} ${order.drink} ${order.customerName} ${order.customerPhone}`.toLowerCase().includes(query.toLowerCase());
      if (!matchesQuery) return false;
      if (status === "all") return true;
      if (status === "pending_payment") return isPendingPaymentOrder(order);
      if (status === "active") {
        if (order.status === "pending_payment") return isRecentPendingPaymentOrder(order);
        return ["new", "preparing", "ready"].includes(order.status);
      }
      return order.status === status;
    })
    .sort(sortStoreOrders), [orders, query, status]);
  const selectedOrder = visibleOrders.find((order) => order.id === selectedId && isPaidOrder(order)) ?? visibleOrders.find(isPaidOrder);
  const counters = {
    new: orders.filter((order) => order.status === "new").length,
    preparing: orders.filter((order) => order.status === "preparing").length,
    ready: orders.filter((order) => order.status === "ready").length
  };

  const summary = stats?.summary;

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
          <div className="store-stats-heading">
            <h2>{access?.stores.find((store) => store.id === selectedStoreId)?.name ?? "店舗"}</h2>
            {access && access.stores.length > 1 ? (
              <select value={selectedStoreId} onChange={(event) => selectStore(event.target.value)} aria-label="店舗">
                {access.stores.map((store) => (
                  <option value={store.id} key={store.id}>{store.name}</option>
                ))}
              </select>
            ) : null}
          </div>
          {access?.canViewSalesStats ? (
            <>
              <div className="store-stats-heading">
                <h2>実績</h2>
                <select value={statsDays} onChange={(event) => setStatsDays(Number(event.target.value))} aria-label="集計期間">
                  <option value={1}>今日</option>
                  <option value={7}>7日</option>
                  <option value={31}>31日</option>
                </select>
              </div>
              <section className="store-order-performance" aria-label="注文実績">
                <article>
                  <span>売上</span>
                  <strong>¥{Number(summary?.grossSales ?? 0).toLocaleString("ja-JP")}</strong>
                </article>
                <article>
                  <span>支払済み</span>
                  <strong>{summary?.paidOrders ?? 0}</strong>
                </article>
                <article>
                  <span>完了</span>
                  <strong>{summary?.completedOrders ?? 0}</strong>
                </article>
                <article>
                  <span>平均完了</span>
                  <strong>{summary?.averageCompletionMinutes ? `${summary.averageCompletionMinutes}分` : "—"}</strong>
                </article>
              </section>
              {stats?.productRanking?.length ? (
                <section className="store-product-ranking" aria-label="商品ランキング">
                  <h3>商品ランキング</h3>
                  {stats.productRanking.slice(0, 4).map((item) => (
                    <div key={item.name}>
                      <span>{item.name}</span>
                      <strong>{item.count}件</strong>
                    </div>
                  ))}
                </section>
              ) : null}
            </>
          ) : null}
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
          {access?.stores.length ? (
            <section className="store-pickup-setting" aria-label="最短受け取り準備時間">
              <div>
                <span>受付設定</span>
                <small>受付状態と最短準備時間</small>
              </div>
              {operation ? (
                <>
                  <div className="store-reception-buttons" aria-label="受付状態">
                    <button
                      className={operation.reservationsEnabled ? "store-reception-button is-on" : "store-reception-button"}
                      type="button"
                      disabled={operationSaving}
                      onClick={() => void saveOperationSettings({ reservationsEnabled: true, statusNote: "" }, "通常受付にしました。")}
                    >
                      通常受付
                    </button>
                    <button
                      className={!operation.reservationsEnabled && operation.statusNote !== "本日休業" ? "store-reception-button is-off" : "store-reception-button"}
                      type="button"
                      disabled={operationSaving}
                      onClick={() => void saveOperationSettings({ reservationsEnabled: false, statusNote: "一時休止" }, "一時休止にしました。")}
                    >
                      一時休止
                    </button>
                    <button
                      className={!operation.reservationsEnabled && operation.statusNote === "本日休業" ? "store-reception-button is-off" : "store-reception-button"}
                      type="button"
                      disabled={operationSaving}
                      onClick={() => void saveOperationSettings({ reservationsEnabled: false, statusNote: "本日休業" }, "本日休業にしました。")}
                    >
                      本日休業
                    </button>
                  </div>
                  <label>
                    <input
                      inputMode="numeric"
                      min={0}
                      max={240}
                      type="number"
                      value={minimumPickupDraft}
                      onChange={(event) => setMinimumPickupDraft(event.target.value)}
                      placeholder="初期値"
                    />
                    分後
                  </label>
                  <button className="secondary-button" type="button" disabled={operationSaving} onClick={() => void saveMinimumPickupMinutes()}>
                    {operationSaving ? "保存中..." : "保存"}
                  </button>
                </>
              ) : (
                <p>店舗設定を読み込み中です。</p>
              )}
              {operationMessage ? <p>{operationMessage}</p> : null}
            </section>
          ) : null}
          <div className="store-orders-toolbar">
            <h2>注文ワーク台</h2>
            <button type="button" className="secondary-button" onClick={refresh}>
              {isRefreshing ? "更新中..." : "更新"}
            </button>
          </div>
          <div className="store-orders-controls">
            <input
              aria-label="注文を検索"
              placeholder="番号・商品・お客様"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="表示状態">
              <option value="active">対応中</option>
              <option value="pending_payment">未決済</option>
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
          <p className="store-orders-live-note">
            {realtimeStatus === "connected" ? "リアルタイム接続中" : "自動更新中"}
            {lastUpdatedAt ? ` · ${lastUpdatedAt}` : ""}
          </p>
          {loading ? <p className="muted-text">読み込み中...</p> : null}
          {error ? <p className="form-error">{error}</p> : null}
          <div className="store-order-cards">
            {visibleOrders.map((order) => (
              <button
                type="button"
                className={[
                  "store-order-card",
                  !isPaidOrder(order) ? "is-payment-pending" : "",
                  selectedOrder?.id === order.id ? "is-active" : "",
                  newOrderIds.includes(order.id) ? "is-new" : ""
                ].filter(Boolean).join(" ")}
                key={order.id}
                onClick={() => {
                  if (isPaidOrder(order)) setSelectedId(order.id);
                }}
              >
                {!isPaidOrder(order) ? (
                  <span className="store-order-payment-badge">
                    決済待ち
                    <small>30分後に対応中から非表示</small>
                  </span>
                ) : null}
                <span className="store-order-code">{order.pickupCode}</span>
                <strong>{splitLines(order.drink).join(" / ")}</strong>
                <span className="store-order-customer">
                  {(sourceLabels[order.orderSource] ?? order.orderSource) || "注文"} / {(orderTypeLabels[order.orderType] ?? order.orderType) || "受け取り"}
                </span>
                <span className="store-order-customer">
                  {order.customerName || "名前未入力"}{order.customerPhone ? ` / ${order.customerPhone}` : ""}
                </span>
                {order.productionTasks?.length ? (
                  <span className="store-order-task-summary">
                    {order.productionTasks.map((task) => `${task.productionAreaLabel}:${getProductionTaskLabel(task.status)}`).join(" / ")}
                  </span>
                ) : null}
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
                  <p>{selectedOrder.pickupDate} {selectedOrder.pickupTime} / {(sourceLabels[selectedOrder.orderSource] ?? selectedOrder.orderSource) || "注文"} / {(orderTypeLabels[selectedOrder.orderType] ?? selectedOrder.orderType) || "受け取り"}</p>
                </div>
                <div className="store-order-status-stack">
                  <span className="status-pill is-active">{statusLabels[selectedOrder.status] ?? selectedOrder.status}</span>
                  <span className={getPaymentPillClass(selectedOrder.paymentStatus)}>
                    {paymentLabels[selectedOrder.paymentStatus] ?? (selectedOrder.paymentStatus === "paid" ? "決済済み" : "未決済")}
                  </span>
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

              <div className="store-order-customer-panel">
                <div>
                  <span>お客様</span>
                  <strong>{selectedOrder.customerName || "名前未入力"}</strong>
                </div>
                <div>
                  <span>電話番号</span>
                  {selectedOrder.customerPhone ? <a href={`tel:${selectedOrder.customerPhone}`}>{selectedOrder.customerPhone}</a> : <strong>未入力</strong>}
                </div>
                {selectedOrder.customerNote ? (
                  <div className="is-wide">
                    <span>メモ</span>
                    <p>{selectedOrder.customerNote}</p>
                  </div>
                ) : null}
              </div>

              <div className="store-order-total">
                <span>合計</span>
                <strong>¥{Number(selectedOrder.amount).toLocaleString("ja-JP")}</strong>
              </div>

              {selectedOrder.productionTasks?.length ? (
                <div className="store-order-production-panel">
                  <span>制作タスク</span>
                  {selectedOrder.productionTasks.map((task) => (
                    <div key={task.id}>
                      <strong>{task.productionAreaLabel}</strong>
                      <small>{getProductionTaskLabel(task.status)}</small>
                      <p>{task.itemSummary}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="store-order-actions">
                {(nextActions[selectedOrder.status] ?? []).map((action) => (
                  <button type="button" className="primary-button" key={action.status} onClick={() => updateStatus(selectedOrder.id, action.status)}>
                    {action.label}
                  </button>
                ))}
                {access?.canCancelOrders && selectedOrder.status !== "completed" && selectedOrder.status !== "cancelled" ? (
                  <button type="button" className="secondary-button" onClick={() => updateStatus(selectedOrder.id, "cancelled")}>キャンセル</button>
                ) : null}
              </div>
            </>
          ) : (
            <p className="muted-text">決済済みの注文を選択してください。未決済の注文は左側リストで確認できます。</p>
          )}
        </section>
      </section>
    </main>
  );
}
