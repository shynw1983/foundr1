"use client";

import { useEffect, useRef } from "react";
import { showNativeNotification } from "../../../lib/native-notifications";

type StoreOrderRealtimePayload = {
  order?: {
    id?: string;
    pickupCode?: string;
    status?: string;
    paymentStatus?: string;
    drink?: string;
  };
};

type StoreOrdersResponse = {
  orders?: Array<{
    id: string;
    status: string;
    paymentStatus: string;
  }>;
};

function shouldNotifyOrder(order: StoreOrderRealtimePayload["order"]) {
  return order?.paymentStatus === "paid" && order.status === "new" && Boolean(order.id);
}

function getOrderKey(order: { id: string; status: string; paymentStatus: string }) {
  return `${order.id}:${order.status}:${order.paymentStatus}`;
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
  const lastNotifiedOrderIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    let pusher: any;
    let channels: any[] = [];
    let pollingTimer = 0;

    const notifyOrder = (order?: StoreOrderRealtimePayload["order"]) => {
      if (!active || isOrdersPage()) return;
      const id = String(order?.id ?? "").trim();
      if (id && lastNotifiedOrderIdsRef.current.has(id)) return;
      if (id) lastNotifiedOrderIdsRef.current.add(id);
      void showNativeNotification({
        title: "新しいWeb予約",
        body: buildNotificationBody(order),
        href: "/store/orders",
        tag: id ? `store-order:${id}` : `store-order:${Date.now()}`
      });
    };

    const checkOrdersByPolling = async () => {
      try {
        const response = await fetch("/api/store/orders?watch=1", { cache: "no-store" });
        if (!response.ok || !active) return;
        const body = await response.json() as StoreOrdersResponse;
        const activeOrderKeys = new Set(
          (body.orders ?? [])
            .filter((order) => shouldNotifyOrder(order))
            .map(getOrderKey)
        );
        if (!initializedRef.current) {
          knownOrderKeysRef.current = activeOrderKeys;
          initializedRef.current = true;
          return;
        }
        const hasIncomingOrder = Array.from(activeOrderKeys).some((orderKey) => !knownOrderKeysRef.current.has(orderKey));
        if (hasIncomingOrder) notifyOrder();
        knownOrderKeysRef.current = activeOrderKeys;
      } catch {
        // The Store app should stay usable even if notification polling fails.
      }
    };

    const startPolling = () => {
      if (pollingTimer) return;
      void checkOrdersByPolling();
      pollingTimer = window.setInterval(checkOrdersByPolling, 15000);
    };

    const handleOrderEvent = ({ order }: StoreOrderRealtimePayload) => {
      if (!shouldNotifyOrder(order) || !order?.id || !order.status || !order.paymentStatus) return;
      knownOrderKeysRef.current.add(getOrderKey({ id: order.id, status: order.status, paymentStatus: order.paymentStatus }));
      initializedRef.current = true;
      notifyOrder(order);
    };

    startPolling();
    fetch("/api/store/realtime-config", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(async (config) => {
        if (!active || !config?.key || !config?.cluster || !config?.channels?.length) return;
        const { default: Pusher } = await import("pusher-js");
        if (!active) return;
        pusher = new Pusher(config.key, {
          cluster: config.cluster,
          channelAuthorization: {
            endpoint: "/api/store/realtime-auth",
            transport: "ajax"
          }
        });
        pusher.connection.bind("unavailable", startPolling);
        pusher.connection.bind("failed", startPolling);
        pusher.connection.bind("disconnected", startPolling);
        channels = config.channels.map((channelName: string) => {
          const channel = pusher.subscribe(channelName);
          channel.bind("pusher:subscription_error", startPolling);
          channel.bind("order.created", handleOrderEvent);
          channel.bind("order.updated", handleOrderEvent);
          return channel;
        });
      })
      .catch(startPolling);

    return () => {
      active = false;
      if (pollingTimer) window.clearInterval(pollingTimer);
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

