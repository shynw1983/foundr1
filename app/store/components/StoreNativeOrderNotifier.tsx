"use client";

import { useEffect, useRef } from "react";
import { showNativeNotification } from "../../../lib/native-notifications";
import { getStoreOrderAlertPhase, isStoreOrderAlertAcknowledged } from "../../../lib/store-order-alert-timing";
import {
  createStoreFallbackPoller,
  rememberStoreBusinessHours,
  storeOrderAlertEventName
} from "../../../lib/store-polling-client";

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
    let channels: any[] = [];

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

    const checkOrdersByPolling = async () => {
      try {
        const response = await fetch("/api/store/orders/watch", { cache: "no-store" });
        if (!response.ok || !active) return;
        const body = await response.json() as StoreOrdersResponse;
        rememberStoreBusinessHours(body.stores);
        const alertableOrders = (body.orders ?? []).filter((order) => shouldNotifyOrder(order));
        const activeOrderKeys = new Set(alertableOrders.map(getOrderKey));
        if (!initializedRef.current) {
          knownOrderKeysRef.current = activeOrderKeys;
          initializedRef.current = true;
          return;
        }
        const incomingOrder = alertableOrders.find((order) => !knownOrderKeysRef.current.has(getOrderKey(order)));
        if (incomingOrder) announceOrder(incomingOrder);
        knownOrderKeysRef.current = activeOrderKeys;
      } catch (error) {
        // The Store app should stay usable even if notification polling fails.
        throw error;
      }
    };

    const poller = createStoreFallbackPoller(checkOrdersByPolling, { baseIntervalMs: 60_000 });
    const startPolling = () => poller.start({ immediate: true });
    const stopPolling = () => poller.stop();

    const handleOrderEvent = ({ order }: StoreOrderRealtimePayload) => {
      if (!shouldNotifyOrder(order) || !order?.id || !order.status || !order.paymentStatus) return;
      knownOrderKeysRef.current.add(getOrderKey(order));
      initializedRef.current = true;
      announceOrder(order);
    };

    startPolling();
    fetch("/api/store/realtime-config", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(async (config) => {
        if (!active || !config?.key || !config?.cluster || !config?.channels?.length) return;
        const { acquireSharedPusher } = await import("../../../lib/shared-pusher-client");
        if (!active) return;
        pusher = acquireSharedPusher({ key: config.key, cluster: config.cluster });
        pusher.connection.bind("unavailable", startPolling);
        pusher.connection.bind("failed", startPolling);
        pusher.connection.bind("disconnected", startPolling);
        channels = config.channels.map((channelName: string) => {
          const channel = pusher.subscribe(channelName);
          channel.bind("pusher:subscription_succeeded", stopPolling);
          channel.bind("pusher:subscription_error", startPolling);
          channel.bind("order.created", handleOrderEvent);
          channel.bind("order.updated", handleOrderEvent);
          return channel;
        });
      })
      .catch(startPolling);

    return () => {
      active = false;
      stopPolling();
      channels.forEach((channel) => {
        channel.unbind("order.created", handleOrderEvent);
        channel.unbind("order.updated", handleOrderEvent);
        pusher?.unsubscribe(channel.name);
      });
      pusher?.disconnect();
    };
  }, []);

  return null;
}
