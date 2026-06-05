"use client";

import { BookOpen, ChefHat, Clock3, ClipboardList, Home, Menu, Monitor, ShoppingCart, Tags } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { UserBadge } from "../../os/components/UserBadge";
import { useCloseOnOutside } from "../../os/components/useCloseOnOutside";
import { defaultStoreModuleSettings, type StoreModuleSettings } from "../../../lib/module-setting-defaults";

type StoreOrderRealtimePayload = {
  order?: {
    id?: string;
    status?: string;
    paymentStatus?: string;
  };
};

type StoreOrdersResponse = {
  orders?: Array<{
    id: string;
    status: string;
    paymentStatus: string;
  }>;
};

const tabs = [
  { label: "ホーム", href: "/store", icon: Home },
  { label: "注文", href: "/store/orders", icon: ClipboardList },
  { label: "制作屏", href: "/store/kitchen", icon: ChefHat },
  { label: "取餐屏", href: "/store/pickup-display", icon: Monitor },
  { label: "販売状態", href: "/store/menu", icon: Tags },
  { label: "手順書", href: "/store/procedures", icon: BookOpen },
  { label: "タイムカード", href: "/store/timecard", icon: Clock3 },
  { label: "POS", href: "/store/pos", icon: ShoppingCart }
];

function formatStoreClock(date: Date) {
  const dateText = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).format(date);
  const timeText = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
  return { dateText, timeText };
}

function isNewPaidOrder(order: StoreOrderRealtimePayload["order"]) {
  return order?.paymentStatus === "paid" && order.status === "new" && Boolean(order.id);
}

function shouldAlertOrder(order: StoreOrderRealtimePayload["order"]) {
  return isNewPaidOrder(order);
}

function getAlertOrderKey(order: { id: string; status: string; paymentStatus: string }) {
  return `${order.id}:${order.status}:${order.paymentStatus}`;
}

export function StoreNavTabs({ active }: { active: "home" | "orders" | "kitchen" | "pickup-display" | "menu" | "procedures" | "timecard" | "pos" }) {
  const activeHref = active === "home" ? "/store" : `/store/${active}`;
  const [now, setNow] = useState<Date | null>(null);
  const [settings, setSettings] = useState<StoreModuleSettings>(defaultStoreModuleSettings);
  const [employeeRole, setEmployeeRole] = useState("");
  const [isTimecardEmployee, setIsTimecardEmployee] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [hasPendingOrderAlert, setHasPendingOrderAlert] = useState(false);
  const knownActiveOrderKeysRef = useRef<Set<string>>(new Set());
  const hasInitializedOrderWatchRef = useRef(false);
  const storeMenuRef = useRef<HTMLDetailsElement | null>(null);
  const clock = now ? formatStoreClock(now) : { dateText: "--/--", timeText: "--:--:--" };
  const shouldFlashOrdersTab = active !== "orders" && hasPendingOrderAlert;
  const visibleTabs = isMobileViewport && employeeRole === "staff" && isTimecardEmployee
    ? tabs.filter((tab) => tab.href === "/store/procedures" || tab.href === "/store/timecard")
    : tabs;

  const clearOrderAlert = () => {
    setHasPendingOrderAlert(false);
    window.sessionStorage.removeItem("store:pending-order-alert");
  };

  const markOrderAlert = () => {
    if (active === "orders") return;
    setHasPendingOrderAlert(true);
    window.sessionStorage.setItem("store:pending-order-alert", "1");
  };

  useCloseOnOutside(storeMenuRef, () => {
    if (storeMenuRef.current) storeMenuRef.current.open = false;
  });

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const updateViewport = () => setIsMobileViewport(query.matches);
    updateViewport();
    query.addEventListener("change", updateViewport);
    return () => query.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function loadCurrentEmployee() {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as { employee?: { role?: string; isTimecardEmployee?: boolean } | null };
      if (isMounted) {
        setEmployeeRole(String(body.employee?.role ?? ""));
        setIsTimecardEmployee(body.employee?.isTimecardEmployee === true);
      }
    }
    void loadCurrentEmployee();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (active === "orders") {
      clearOrderAlert();
      return;
    }
    setHasPendingOrderAlert(window.sessionStorage.getItem("store:pending-order-alert") === "1");
  }, [active]);

  useEffect(() => {
    let isMounted = true;
    async function loadSettings() {
      const response = await fetch("/api/settings?module=store", { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as { settings?: StoreModuleSettings };
      if (isMounted && body.settings) setSettings(body.settings);
    }
    void loadSettings();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (active === "orders") return;

    hasInitializedOrderWatchRef.current = false;
    let pusher: any;
    let channels: any[] = [];
    let activeListener = true;
    let pollingTimer = 0;

    const checkOrdersByPolling = async () => {
      try {
        const response = await fetch("/api/store/orders?watch=1", { cache: "no-store" });
        if (!response.ok || !activeListener) return;
        const body = await response.json() as StoreOrdersResponse;
        const activeOrderIds = new Set(
          (body.orders ?? [])
            .filter(shouldAlertOrder)
            .map(getAlertOrderKey)
        );
        if (!hasInitializedOrderWatchRef.current) {
          knownActiveOrderKeysRef.current = activeOrderIds;
          hasInitializedOrderWatchRef.current = true;
          return;
        }
        const hasIncomingOrder = Array.from(activeOrderIds).some((orderId) => !knownActiveOrderKeysRef.current.has(orderId));
        if (hasIncomingOrder) markOrderAlert();
        knownActiveOrderKeysRef.current = activeOrderIds;
      } catch {
        // Keep the navigation usable even if the fallback poll fails.
      }
    };

    const startPolling = () => {
      if (pollingTimer) return;
      void checkOrdersByPolling();
      pollingTimer = window.setInterval(checkOrdersByPolling, 15000);
    };

    const handleOrderCreated = ({ order }: StoreOrderRealtimePayload) => {
      if (!shouldAlertOrder(order) || !order?.id || !order.status || !order.paymentStatus) return;
      knownActiveOrderKeysRef.current.add(getAlertOrderKey({ id: order.id, status: order.status, paymentStatus: order.paymentStatus }));
      hasInitializedOrderWatchRef.current = true;
      markOrderAlert();
    };

    startPolling();
    fetch("/api/store/realtime-config", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(async (config) => {
        if (!activeListener) return;
        if (!config?.key || !config?.cluster || !config?.channels?.length) {
          return;
        }
        const { default: Pusher } = await import("pusher-js");
        if (!activeListener) return;
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
          channel.bind("order.created", handleOrderCreated);
          channel.bind("order.updated", handleOrderCreated);
          return channel;
        });
      })
      .catch(startPolling);

    return () => {
      activeListener = false;
      if (pollingTimer) window.clearInterval(pollingTimer);
      channels.forEach((channel) => {
        channel.unbind("order.created", handleOrderCreated);
        channel.unbind("order.updated", handleOrderCreated);
        pusher?.unsubscribe(channel.name);
      });
      pusher?.disconnect();
    };
  }, [active]);

  return (
    <div className="store-nav-cluster">
      {settings.header.showClock ? (
        <div className="store-live-clock" aria-label="現在時刻">
          <Clock3 size={17} />
          <span>{clock.dateText}</span>
          <strong>{clock.timeText}</strong>
        </div>
      ) : null}
      <div className={`store-user-tools is-user-${settings.header.userDisplay}`}>
        <UserBadge showNotifications={settings.header.showNotifications} showLanguagePicker={settings.header.showLanguagePicker} />
      </div>
      <nav className="store-nav-tabs" aria-label="店舗ワークベンチ">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isOrdersTab = tab.href === "/store/orders";
          const className = [
            tab.href === activeHref ? "is-active" : "",
            isOrdersTab && shouldFlashOrdersTab ? "has-order-alert" : ""
          ].filter(Boolean).join(" ");
          return (
            <a className={className} href={tab.href} key={tab.href} onClick={isOrdersTab ? clearOrderAlert : undefined}>
              <Icon size={17} />
              {tab.label}
              {isOrdersTab && shouldFlashOrdersTab ? <span className="store-order-alert-dot" aria-label="新規注文あり" /> : null}
            </a>
          );
        })}
      </nav>
      <details className="mobile-nav-menu store-nav-menu" ref={storeMenuRef}>
        <summary aria-label="メニュー">
          <span className="hamburger-button" aria-hidden="true">
            <Menu size={18} />
          </span>
          <span className="mobile-nav-menu-label">メニュー</span>
        </summary>
        <nav className="mobile-nav-list store-nav-list" aria-label="店舗ワークベンチメニュー">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isOrdersTab = tab.href === "/store/orders";
            const className = [
              tab.href === activeHref ? "is-active" : "",
              isOrdersTab && shouldFlashOrdersTab ? "has-order-alert" : ""
            ].filter(Boolean).join(" ");
            return (
              <a className={className} href={tab.href} key={tab.href} onClick={isOrdersTab ? clearOrderAlert : undefined}>
                <Icon size={17} />
                <span>{tab.label}</span>
                {isOrdersTab && shouldFlashOrdersTab ? <span className="store-order-alert-dot" aria-label="新規注文あり" /> : null}
              </a>
            );
          })}
        </nav>
      </details>
    </div>
  );
}
