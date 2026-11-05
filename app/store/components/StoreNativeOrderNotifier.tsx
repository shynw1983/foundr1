"use client";

import { useEffect, useRef } from "react";
import { showNativeNotification } from "../../../lib/native-notifications";
import { getStoreOrderAlertPhase, isStoreOrderAlertAcknowledged } from "../../../lib/store-order-alert-timing";
import {
  createStoreRefreshCoordinator,
  rememberStoreBusinessHours,
  storeOrderAlertEventName
} from "../../../lib/store-polling-client";

import { bindStoreRealtimeChannels } from "../../../lib/store-realtime-refresh";
import { createReadError } from "../../../components/useReadRequest";

type StoreOrderRealtimePayload = {
  order?: {
    id?: string;
    pickupCode?: string;
    status?: string;
    paymentStatus?: string;
    orderSource?: string;
    pickupTiming?: string;
    pickupDate?: string;
    pickupTime?: string;
    paidAt?: string;
    alertPhase?: string;
    initialAlertAcknowledgedAt?: string;
    reminderAlertAcknowledgedAt?: string;
    drink?: string;
  };
};

type StoreOrdersResponse = {
  orders?: Array<{
    id: string;
    status: string;
    paymentStatus: string;
    orderSource?: string;
    pickupTiming?: string;
    pickupDate?: string;
    pickupTime?: string;
    paidAt?: string;
    alertPhase?: string;
    initialAlertAcknowledgedAt?: string;
    reminderAlertAcknowledgedAt?: string;
  }>;
  stores?: Array<{ id: string; businessHours?: unknown }>;
};

function shouldNotifyOrder(order: StoreOrderRealtimePayload["order"]) {
  return order?.paymentStatus === "paid" &&
    order.status === "new" &&
    order.orderSource !== "store_pos" &&
    Boolean(order.id) &&
    getStoreOrderAlertPhase(order) !== "scheduled_waiting" &&
    !isStoreOrderAlertAcknowledged(order);
}

function getOrderKey(order: NonNullable<StoreOrderRealtimePayload["order"]>) {
  return `${order.id}:${order.status}:${order.paymentStatus}:${getStoreOrderAlertPhase(order)}`;
}

function isOrdersPage() {
  return typeof window !== "undefined" && window.location.pathname.startsWith("/store/orders");
}

function buildNotificationBody(order?: StoreOrderRealtimePayload["order"]) {
  const pickupCode = String(order?.pickupCode ?? "").trim();
  const itemName = String(order?.drink ?? "").trim();
  if (pickupCode && itemName) return `受付番号 ${pickupCode} / ${itemName}`;
  if (pickupCode) return `受付番号 ${pickupCode}`;
  if (itemName) return itemName;
  return "新しい注文が入りました。注文画面を確認してください。";
}

export function StoreNativeOrderNotifier() {
  const knownOrderKeysRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const lastNotifiedOrderKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    let pusher: any;
    let unbindRealtime: (() => void) | undefined;
    const configController = new AbortController();

    const notifyOrder = (order?: StoreOrderRealtimePayload["order"]) => {
      if (!active || isOrdersPage()) return;
      const id = String(order?.id ?? "").trim();
      const phase = getStoreOrderAlertPhase(order ?? {});
      const notificationKey = id ? `${id}:${phase}` : "";
      if (notificationKey && lastNotifiedOrderKeysRef.current.has(notificationKey)) return;
      if (notificationKey) lastNotifiedOrderKeysRef.current.add(notificationKey);
      void showNativeNotification({
        title: phase === "scheduled_reminder" ? "予約時間が近づいています" : "新しいWeb予約",
        body: buildNotificationBody(order),
        href: "/store/orders",
        tag: id ? `store-order:${id}:${phase}` : `store-order:${Date.now()}`
      });
    };

    const announceOrder = (order?: StoreOrderRealtimePayload["order"]) => {
      if (!active || !order?.id) return;
      window.dispatchEvent(new CustomEvent(storeOrderAlertEventName, { detail: { order } }));
      notifyOrder(order);
    };

    const checkOrdersByPolling = async (signal: AbortSignal) => {
      try {
        const response = await fetch("/api/store/orders/watch", { cache: "no-store", signal });
        if (!response.ok) throw createReadError(response);
        if (!active || signal.aborted) return;
        const body = await response.json() as StoreOrdersResponse;
        if (!active || signal.aborted) return;
        rememberStoreBusinessHours(body.stores);
        const alertableOrders = (body.orders ?? []).filter((order) => shouldNotifyOrder(order));
        const activeOrderKeys = new Set(alertableOrders.map(getOrderKey));
        if (!initializedRef.current) {
          knownOrderKeysRef.current = activeOrderKeys;
          initializedRef.current = true;
          return;
        }
        const incomingOrders = alertableOrders.filter(order => !knownOrderKeysRef.current.has(getOrderKey(order)));
        incomingOrders.forEach(announceOrder);
        knownOrderKeysRef.current = activeOrderKeys;
      } catch (error) {
        // The Store app should stay usable even if notification polling fails.
        throw error;
      }
    };

    const deny = () => {
      active = false; configController.abort();
      knownOrderKeysRef.current.clear(); lastNotifiedOrderKeysRef.current.clear();
      initializedRef.current = false; unbindRealtime?.(); pusher?.disconnect();
      coordinator.stop();
    };
    const coordinator = createStoreRefreshCoordinator(checkOrdersByPolling, {
      healthyIntervalMs: 60_000, fallbackIntervalMs: 30_000,
      onUnauthorized: deny
    });

    const handleOrderEvent = ({ order }: StoreOrderRealtimePayload) => {
      if (!shouldNotifyOrder(order) || !order?.id || !order.status || !order.paymentStatus) return;
      knownOrderKeysRef.current.add(getOrderKey(order));
      initializedRef.current = true;
      announceOrder(order);
    };

    coordinator.start({ immediate: true });
    fetch("/api/store/realtime-config", { cache: "no-store", signal: configController.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then(async (config) => {
        if (!active || !config?.key || !config?.cluster || !config?.channels?.length) return;
        const { acquireSharedPusher } = await import("../../../lib/shared-pusher-client");
        if (!active) return;
        pusher = acquireSharedPusher({ key: config.key, cluster: config.cluster });
        unbindRealtime = bindStoreRealtimeChannels(pusher, {
          onUnauthorized: deny,
          channels: config.channels, events: ["order.created", "order.updated"],
          onEvent: (event: StoreOrderRealtimePayload) => {
            handleOrderEvent(event);
            void coordinator.refresh();
          },
          onHealthChange: healthy => {
            if (!active) return;
            coordinator.setRealtimeHealthy(healthy);
            if (healthy) void coordinator.refresh({ force: true });
          }
        });
      })
      .catch(() => undefined);

    return () => {
      active = false;
      configController.abort();
      coordinator.stop();
      unbindRealtime?.();
      pusher?.disconnect();
    };
  }, []);

  return null;
}
