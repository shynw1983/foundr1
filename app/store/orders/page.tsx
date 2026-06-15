"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { defaultStoreModuleSettings, storeOrderAlertSoundOptions, type StoreModuleSettings, type StoreOrderAlertSound } from "../../../lib/module-setting-defaults";
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

function isFoundr1NativeShell() {
  if (typeof window === "undefined") return false;
  const nativeWindow = window as typeof window & {
    Foundr1NativeNotifications?: unknown;
    Foundr1Printer?: unknown;
  };
  return Boolean(nativeWindow.Foundr1NativeNotifications || nativeWindow.Foundr1Printer);
}

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
  minimumPickupResetAt?: string | null;
  defaultMinimumPickupMinutes?: number;
  brandDefaultPickupMinutes?: Array<{
    brandName: string;
    brandType: string;
    minimumPickupMinutes: number;
  }>;
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

type AlertTone = {
  at: number;
  frequency: number;
  duration: number;
  volume: number;
  type: OscillatorType;
};

const orderAlertTones: Record<StoreOrderAlertSound, AlertTone[]> = {
  foundr1_default: [
    { at: 0, frequency: 1046.5, duration: 0.14, volume: 0.34, type: "square" },
    { at: 0.18, frequency: 1568, duration: 0.16, volume: 0.42, type: "square" },
    { at: 0.48, frequency: 1046.5, duration: 0.14, volume: 0.34, type: "square" },
    { at: 0.66, frequency: 1568, duration: 0.2, volume: 0.44, type: "square" }
  ],
  kitchen_bell: [
    { at: 0, frequency: 1174.66, duration: 0.1, volume: 0.5, type: "triangle" },
    { at: 0.16, frequency: 1567.98, duration: 0.12, volume: 0.48, type: "triangle" },
    { at: 0.34, frequency: 1174.66, duration: 0.16, volume: 0.5, type: "triangle" }
  ],
  urgent_order: [
    { at: 0, frequency: 880, duration: 0.1, volume: 0.38, type: "square" },
    { at: 0.14, frequency: 1318.51, duration: 0.11, volume: 0.46, type: "square" },
    { at: 0.28, frequency: 1567.98, duration: 0.13, volume: 0.5, type: "square" },
    { at: 0.52, frequency: 659.25, duration: 0.18, volume: 0.38, type: "triangle" }
  ],
  soft_chime: [
    { at: 0, frequency: 659.25, duration: 0.22, volume: 0.26, type: "sine" },
    { at: 0.2, frequency: 880, duration: 0.26, volume: 0.3, type: "sine" },
    { at: 0.43, frequency: 1174.66, duration: 0.34, volume: 0.28, type: "sine" }
  ]
};

function shouldNotifyNewOrder(previousOrder: StoreOrder | undefined, nextOrder: StoreOrder) {
  return nextOrder.paymentStatus === "paid" &&
    nextOrder.status === "new" &&
    nextOrder.orderSource !== "store_pos" &&
    (!previousOrder || previousOrder.paymentStatus !== "paid" || previousOrder.status !== "new");
}

function splitLines(value = "") {
  return String(value).split(/\n+/).map((item) => item.trim()).filter(Boolean);
}

function joinOrderDetailParts(...values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean).join(" / ");
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
  return "制作待ち";
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
  const pickupDiff = getStoreOrderSortTime(a) - getStoreOrderSortTime(b);
  if (pickupDiff !== 0) return pickupDiff;
  const createdAtA = new Date(a.createdAt).getTime();
  const createdAtB = new Date(b.createdAt).getTime();
  return (Number.isFinite(createdAtA) ? createdAtA : 0) - (Number.isFinite(createdAtB) ? createdAtB : 0);
}

function getPickupDisplayParts(order: Pick<StoreOrder, "pickupDate" | "pickupTime">) {
  const date = new Date(`${order.pickupDate}T${order.pickupTime || "00:00"}`);
  const dateLabel = Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short" }).format(date)
    : order.pickupDate || "日付未設定";
  return {
    dateLabel,
    timeLabel: order.pickupTime || "時間未設定"
  };
}

function PickupTimeChip({ order, detail = false }: { order: Pick<StoreOrder, "pickupDate" | "pickupTime">; detail?: boolean }) {
  const pickup = getPickupDisplayParts(order);
  return (
    <span className={detail ? "store-order-pickup-chip is-detail" : "store-order-pickup-chip"} aria-label={`受取予定 ${pickup.dateLabel} ${pickup.timeLabel}`}>
      <span>受取予定</span>
      <strong>{pickup.timeLabel}</strong>
      <small>{pickup.dateLabel}</small>
    </span>
  );
}

export default function StoreOrdersPage() {
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [access, setAccess] = useState<StoreOrderAccess | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState(() => getStoredStoreSelection());
  const [stats, setStats] = useState<StoreOrderStats | null>(null);
  const [storeSettings, setStoreSettings] = useState<StoreModuleSettings>(defaultStoreModuleSettings);
  const [statsDays, setStatsDays] = useState(1);
  const [operation, setOperation] = useState<StoreOperation | null>(null);
  const [minimumPickupOffsetDraft, setMinimumPickupOffsetDraft] = useState(0);
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
  const [cancelNotice, setCancelNotice] = useState("");
  const audioContextRef = useRef<AudioContext | null>(null);
  const ordersRef = useRef<StoreOrder[]>([]);
  const repeatAlertTimersRef = useRef<number[]>([]);
  const selectedStoreIdRef = useRef("");
  const lastResumeRefreshAtRef = useRef(0);

  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  useEffect(() => {
    selectedStoreIdRef.current = selectedStoreId;
  }, [selectedStoreId]);

  useEffect(() => {
    let isMounted = true;
    fetch("/api/settings?module=store", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { settings?: StoreModuleSettings } | null) => {
        if (isMounted && body?.settings) setStoreSettings(body.settings);
      })
      .catch(() => {
        // Store orders should keep working even if module settings cannot be loaded.
      });
    return () => {
      isMounted = false;
      repeatAlertTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      repeatAlertTimersRef.current = [];
    };
  }, []);

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
      setMinimumPickupOffsetDraft(0);
      return;
    }
    const params = new URLSearchParams({ storeId });
    const response = await fetch(`/api/store/operations?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json();
    const nextOperation = body.operation as StoreOperation | null;
    setOperation(nextOperation);
    const defaultMinutes = nextOperation?.defaultMinimumPickupMinutes ?? 15;
    const currentMinutes = nextOperation?.minimumPickupMinutes ?? defaultMinutes;
    setMinimumPickupOffsetDraft(currentMinutes - defaultMinutes);
  };

  const saveOperationSettings = async (
    patch: Partial<StoreOperation> = {},
    successMessage = "受付設定を保存しました。",
    minimumPickupResetPolicy = "manual",
  ) => {
    if (!selectedStoreId || !operation) return;
    const nextOperation = { ...operation, ...patch };
    const defaultMinutes = nextOperation.defaultMinimumPickupMinutes ?? 15;
    const minutes = Math.max(0, Math.min(240, defaultMinutes + minimumPickupOffsetDraft));
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
          minimumPickupMinutes: minutes === defaultMinutes ? null : minutes,
          minimumPickupResetPolicy
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

  const changeMinimumPickupOffset = (delta: number) => {
    if (!operation) return;
    const defaultMinutes = operation.defaultMinimumPickupMinutes ?? 15;
    const minOffset = -defaultMinutes;
    const maxOffset = 240 - defaultMinutes;
    setMinimumPickupOffsetDraft((current) => Math.max(minOffset, Math.min(maxOffset, current + delta)));
  };

  const resetMinimumPickupDraft = () => {
    setMinimumPickupOffsetDraft(0);
  };

  const saveMinimumPickupMinutes = async (resetPolicy = "manual") => {
    await saveOperationSettings(
      {},
      minimumPickupOffsetDraft === 0 ? "最短準備時間をブランド初期値に戻しました。" : "最短準備時間を保存しました。",
      resetPolicy,
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

  useEffect(() => {
    if (!isFoundr1NativeShell()) return;
    setSoundEnabled(true);
    void ensureAudioReady().catch(() => {
      setSoundReady(false);
    });
    // Native shells are configured to allow foreground order sounds without a manual browser gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const playNewOrderSound = (sound: StoreOrderAlertSound = storeSettings.orderAlerts.sound) => {
    if (!soundEnabled || !audioContextRef.current || audioContextRef.current.state !== "running") return;
    const context = audioContextRef.current;
    const playTone = ({ frequency, at, duration, volume, type }: AlertTone) => {
      const startAt = context.currentTime + at;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.02);
    };

    for (const tone of orderAlertTones[sound] ?? orderAlertTones.kitchen_bell) {
      playTone(tone);
    }
  };

  const scheduleRepeatAlert = (orderIds: string[]) => {
    if (!storeSettings.orderAlerts.repeatUntilHandled || !orderIds.length) return;
    for (const delay of [30000, 60000]) {
      const timer = window.setTimeout(() => {
        const stillUnhandled = ordersRef.current.some((order) => (
          orderIds.includes(order.id) &&
          order.paymentStatus === "paid" &&
          order.status === "new" &&
          order.orderSource !== "store_pos"
        ));
        if (stillUnhandled) {
          playNewOrderSound(delay >= 60000 ? "urgent_order" : storeSettings.orderAlerts.sound);
        }
      }, delay);
      repeatAlertTimersRef.current.push(timer);
    }
  };

  const refresh = async () => {
    setIsRefreshing(true);
    const params = new URLSearchParams();
    const requestedStoreId = selectedStoreIdRef.current;
    if (requestedStoreId) params.set("storeId", requestedStoreId);
    params.set("ts", String(Date.now()));
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
      statsParams.set("ts", String(Date.now()));
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
        scheduleRepeatAlert(incomingIds);
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
    lastResumeRefreshAtRef.current = Date.now();
    refresh();
    const refreshFromResume = () => {
      const now = Date.now();
      if (now - lastResumeRefreshAtRef.current < 5000) return;
      lastResumeRefreshAtRef.current = now;
      void refresh();
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshFromResume();
    };
    window.addEventListener("focus", refreshFromResume);
    window.addEventListener("pageshow", refreshFromResume);
    window.addEventListener("pointerdown", refreshFromResume);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const timer = window.setInterval(refresh, realtimeStatus === "connected" ? 60000 : 8000);
    return () => {
      window.removeEventListener("focus", refreshFromResume);
      window.removeEventListener("pageshow", refreshFromResume);
      window.removeEventListener("pointerdown", refreshFromResume);
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
          scheduleRepeatAlert([order.id]);
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
  }, [soundEnabled, selectedStoreId, storeSettings.orderAlerts.repeatUntilHandled, storeSettings.orderAlerts.sound]);

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
  const selectedOrder = visibleOrders.find((order) => order.id === selectedId) ?? visibleOrders.find(isPaidOrder);
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
    if (response.ok) {
      await refresh();
      return true;
    }
    return false;
  };

  const cancelOrder = async (order: StoreOrder) => {
    if (order.paymentStatus === "paid") {
      const confirmed = window.confirm([
        "この注文は決済済みです。",
        "",
        "ここでキャンセルしても、決済サービス側の返金は自動実行されません。",
        "KOMOJU / Square などの決済管理画面で返金処理を確認してください。",
        "",
        "会員ポイントは返金または正式な返金連動後に取り消されます。",
        "",
        "注文をキャンセルしますか？"
      ].join("\n"));
      if (!confirmed) return;
    }
    const ok = await updateStatus(order.id, "cancelled");
    if (ok && order.paymentStatus === "paid") {
      setCancelNotice(`${order.pickupCode} をキャンセルしました。決済済み注文のため、決済サービス側で返金処理を確認してください。`);
    }
  };

  return (
    <main className="store-workbench-shell">
      <header className="store-workbench-topbar">
        <a className="brand-block" href="/store" aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 STORE</p>
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
                  <div className="store-pickup-stepper">
                    <span>
                      初期値 {operation.defaultMinimumPickupMinutes ?? 15}分
                      {operation.brandDefaultPickupMinutes && operation.brandDefaultPickupMinutes.length > 1
                        ? ` / ${operation.brandDefaultPickupMinutes.map((brand) => `${brand.brandName} ${brand.minimumPickupMinutes}分`).join("・")}`
                        : ""}
                    </span>
                    <div className="store-pickup-stepper-controls">
                      <button type="button" disabled={operationSaving} onClick={() => changeMinimumPickupOffset(-5)} aria-label="最短準備時間を5分短くする">
                        -5
                      </button>
                      <strong>
                        {minimumPickupOffsetDraft === 0 ? "初期値" : `初期値 ${minimumPickupOffsetDraft > 0 ? "+" : ""}${minimumPickupOffsetDraft}分`}
                      </strong>
                      <button type="button" disabled={operationSaving} onClick={() => changeMinimumPickupOffset(5)} aria-label="最短準備時間を5分長くする">
                        +5
                      </button>
                    </div>
                    <small>現在 {(operation.defaultMinimumPickupMinutes ?? 15) + minimumPickupOffsetDraft}分後から受付</small>
                    {operation.minimumPickupResetAt ? <small>営業日終了で初期値に戻ります</small> : null}
                  </div>
                  <button className="secondary-button" type="button" disabled={operationSaving || minimumPickupOffsetDraft === 0} onClick={resetMinimumPickupDraft}>
                    初期値に戻す
                  </button>
                  <button className="secondary-button" type="button" disabled={operationSaving} onClick={() => void saveMinimumPickupMinutes("business_day_end")}>
                    営業日終了で戻す
                  </button>
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
            <button
              type="button"
              className="secondary-button"
              disabled={!soundEnabled}
              onClick={async () => {
                await ensureAudioReady();
                playNewOrderSound();
              }}
            >
              試聴
            </button>
            <span>
              {soundEnabled && soundReady ? `${storeOrderAlertSoundOptions.find((option) => option.value === storeSettings.orderAlerts.sound)?.label ?? "通知音"} で通知します` : "通知音を有効にできます"}
              {storeSettings.orderAlerts.repeatUntilHandled ? " / 未対応は再通知" : ""}
            </span>
          </div>
          <p className="store-orders-live-note">
            {realtimeStatus === "connected" ? "リアルタイム接続中" : "自動更新中"}
            {lastUpdatedAt ? ` · ${lastUpdatedAt}` : ""}
          </p>
          {loading ? <p className="muted-text">読み込み中...</p> : null}
          {error ? <p className="form-error">{error}</p> : null}
          {cancelNotice ? <p className="store-order-payment-note">{cancelNotice}</p> : null}
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
                onClick={() => setSelectedId(order.id)}
              >
                <PickupTimeChip order={order} />
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
                <small>{statusLabels[order.status] ?? order.status}</small>
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
                  <p>{(sourceLabels[selectedOrder.orderSource] ?? selectedOrder.orderSource) || "注文"} / {(orderTypeLabels[selectedOrder.orderType] ?? selectedOrder.orderType) || "受け取り"}</p>
                </div>
                <div className="store-order-status-stack">
                  <PickupTimeChip order={selectedOrder} detail />
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
                    {joinOrderDetailParts(selectedOrder.size, selectedOrder.temperature, selectedOrder.sweetness, selectedOrder.ice) ? (
                      <p>{joinOrderDetailParts(selectedOrder.size, selectedOrder.temperature, selectedOrder.sweetness, selectedOrder.ice)}</p>
                    ) : null}
                    {joinOrderDetailParts(selectedOrder.option, selectedOrder.toppings) ? (
                      <p>{joinOrderDetailParts(selectedOrder.option, selectedOrder.toppings)}</p>
                    ) : null}
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

              {!isPaidOrder(selectedOrder) ? (
                <p className="store-order-payment-note">決済完了前の注文です。内容確認のみ可能で、制作タスクには反映しません。</p>
              ) : null}

              {isPaidOrder(selectedOrder) && selectedOrder.productionTasks?.length ? (
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

              {isPaidOrder(selectedOrder) ? (
                <div className="store-order-actions">
                  {(nextActions[selectedOrder.status] ?? []).map((action) => (
                    <button type="button" className="primary-button" key={action.status} onClick={() => updateStatus(selectedOrder.id, action.status)}>
                      {action.label}
                    </button>
                  ))}
                  {access?.canCancelOrders && selectedOrder.status !== "completed" && selectedOrder.status !== "cancelled" ? (
                    <button type="button" className="secondary-button" onClick={() => void cancelOrder(selectedOrder)}>キャンセル</button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <p className="muted-text">左側の注文を選択してください。</p>
          )}
        </section>
      </section>
    </main>
  );
}
