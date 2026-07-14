"use client";

import { BookOpen, ChefHat, ChevronDown, Clock3, ClipboardList, Home, Menu, MessageSquareWarning, Monitor, PackageCheck, Settings, ShoppingCart, Store, Tags, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { UserBadge } from "../../os/components/UserBadge";
import { useCloseOnOutside } from "../../os/components/useCloseOnOutside";
import { defaultStoreModuleSettings, type StoreModuleSettings } from "../../../lib/module-setting-defaults";
import { getStoredStoreSelection, setStoredStoreSelection } from "./store-selection";
import { getStoreOrderAlertPhase, isStoreOrderAlertAcknowledged } from "../../../lib/store-order-alert-timing";

type StoreOrderRealtimePayload = {
  order?: {
    id?: string;
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
};

type StoreContextResponse = {
  access?: {
    role: string;
    canUseAllStoreView: boolean;
    stores: Array<{ id: string; name: string }>;
  };
  selectedStoreId?: string;
};

const tabs = [
  { label: "ホーム", href: "/store", icon: Home },
  { label: "客席", href: "/store/seats", icon: Users },
  { label: "注文", href: "/store/orders", icon: ClipboardList },
  { label: "販売状態", href: "/store/menu", icon: Tags },
  { label: "POS", href: "/store/pos", icon: ShoppingCart },
  { label: "納品確認", href: "/store/receiving", icon: PackageCheck },
  { label: "タイムカード", href: "/store/timecard", icon: Clock3 },
  { label: "手順書", href: "/store/procedures", icon: BookOpen },
  { label: "問題報告", href: "/store/feedback", icon: MessageSquareWarning },
  { label: "OS", href: "/os", icon: Settings }
];

const displayTabs = [
  { label: "キッチン", href: "/store/display/kitchen", icon: ChefHat },
  { label: "受取表示", href: "/store/display/pickup", icon: Monitor },
  { label: "POS客席表示", href: "/store/pos/customer-display", icon: Monitor }
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
  return order?.paymentStatus === "paid" &&
    order.status === "new" &&
    order.orderSource !== "store_pos" &&
    Boolean(order.id);
}

function shouldAlertOrder(order: StoreOrderRealtimePayload["order"]) {
  return isNewPaidOrder(order) &&
    getStoreOrderAlertPhase(order ?? {}) !== "scheduled_waiting" &&
    !isStoreOrderAlertAcknowledged(order ?? {});
}

function getAlertOrderKey(order: NonNullable<StoreOrderRealtimePayload["order"]>) {
  return `${order.id}:${order.status}:${order.paymentStatus}:${getStoreOrderAlertPhase(order)}`;
}

export function StoreNavTabs({ active }: { active: "home" | "seats" | "orders" | "kitchen" | "pickup-display" | "menu" | "procedures" | "timecard" | "pos" | "receiving" | "feedback" }) {
  const activeHref = active === "home"
    ? "/store"
    : active === "kitchen"
      ? "/store/display/kitchen"
      : active === "pickup-display"
        ? "/store/display/pickup"
        : active === "feedback"
          ? "/store/feedback"
          : `/store/${active}`;
  const [now, setNow] = useState<Date | null>(null);
  const [settings, setSettings] = useState<StoreModuleSettings>(defaultStoreModuleSettings);
  const [employeeRole, setEmployeeRole] = useState<string | null>(null);
  const [storeContext, setStoreContext] = useState<StoreContextResponse | null>(null);
  const [hasPendingOrderAlert, setHasPendingOrderAlert] = useState(false);
  const [displayMenuOpen, setDisplayMenuOpen] = useState(false);
  const [mobileDisplayMenuOpen, setMobileDisplayMenuOpen] = useState(false);
  const knownActiveOrderKeysRef = useRef<Set<string>>(new Set());
  const hasInitializedOrderWatchRef = useRef(false);
  const storeMenuRef = useRef<HTMLDetailsElement | null>(null);
  const displayMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileDisplayMenuRef = useRef<HTMLDivElement | null>(null);
  const clock = now ? formatStoreClock(now) : { dateText: "--/--", timeText: "--:--:--" };
  const shouldFlashOrdersTab = active !== "orders" && hasPendingOrderAlert;
  const visibleTabs = employeeRole === null || employeeRole === "store_terminal"
    ? tabs.filter((tab) => tab.href !== "/os")
    : tabs;
  const visibleDisplayTabs = displayTabs;
  const isDisplayActive = visibleDisplayTabs.some((tab) => tab.href === activeHref);
  const storeOptions = storeContext?.access?.stores ?? [];
  const selectedStoreId = storeContext?.selectedStoreId ?? "";
  const selectedStoreName = storeOptions.find((store) => store.id === selectedStoreId)?.name ?? "";
  const canSwitchStore = Boolean(
    storeOptions.length > 1 &&
    storeContext?.access &&
    (storeContext.access.canUseAllStoreView || !["staff", "store_terminal"].includes(storeContext.access.role))
  );

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
  useCloseOnOutside(displayMenuRef, () => {
    setDisplayMenuOpen(false);
  }, displayMenuOpen);
  useCloseOnOutside(mobileDisplayMenuRef, () => {
    setMobileDisplayMenuOpen(false);
  }, mobileDisplayMenuOpen);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function loadStoreContext() {
      const storedStoreId = getStoredStoreSelection();
      const params = storedStoreId ? `?storeId=${encodeURIComponent(storedStoreId)}` : "";
      const response = await fetch(`/api/store/context${params}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as StoreContextResponse;
      if (!isMounted) return;
      setStoreContext(body);
      if (body.selectedStoreId) setStoredStoreSelection(body.selectedStoreId);
    }
    void loadStoreContext();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function loadCurrentEmployee() {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as { employee?: { role?: string; isTimecardEmployee?: boolean } | null };
      if (isMounted) {
        setEmployeeRole(String(body.employee?.role ?? ""));
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
      knownActiveOrderKeysRef.current.add(getAlertOrderKey(order));
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

  function handleStoreSwitch(storeId: string) {
    if (!storeId || storeId === selectedStoreId) return;
    setStoredStoreSelection(storeId);
    window.location.reload();
  }

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
        <div className="store-display-nav-menu" data-open={displayMenuOpen ? "true" : "false"} ref={displayMenuRef}>
          <button
            className={isDisplayActive ? "is-active" : ""}
            type="button"
            aria-expanded={displayMenuOpen}
            onClick={() => setDisplayMenuOpen((open) => !open)}
          >
            <Monitor size={17} />
            表示画面
            <ChevronDown size={15} />
          </button>
          {displayMenuOpen ? <div className="store-display-nav-list">
            {visibleDisplayTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <a className={tab.href === activeHref ? "is-active" : ""} href={tab.href} key={tab.href} onClick={() => setDisplayMenuOpen(false)}>
                  <Icon size={16} />
                  {tab.label}
                </a>
              );
            })}
          </div> : null}
        </div>
        {canSwitchStore ? (
          <label className="store-nav-store-switch" title={selectedStoreName ? `現在: ${selectedStoreName}` : "店舗切替"}>
            <Store size={17} />
            <span>店舗切替</span>
            <select value={selectedStoreId} onChange={(event) => handleStoreSwitch(event.target.value)} aria-label="店舗切替">
              {storeOptions.map((store) => (
                <option value={store.id} key={store.id}>{store.name}</option>
              ))}
            </select>
          </label>
        ) : null}
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
          <div className="store-display-nav-menu is-mobile" data-open={mobileDisplayMenuOpen ? "true" : "false"} ref={mobileDisplayMenuRef}>
            <button
              className={isDisplayActive ? "is-active" : ""}
              type="button"
              aria-expanded={mobileDisplayMenuOpen}
              onClick={() => setMobileDisplayMenuOpen((open) => !open)}
            >
              <Monitor size={17} />
              <span>表示画面</span>
              <ChevronDown size={15} />
            </button>
            {mobileDisplayMenuOpen ? <div className="store-display-nav-list">
              {visibleDisplayTabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <a className={tab.href === activeHref ? "is-active" : ""} href={tab.href} key={tab.href} onClick={() => setMobileDisplayMenuOpen(false)}>
                    <Icon size={16} />
                    <span>{tab.label}</span>
                  </a>
                );
              })}
            </div> : null}
          </div>
          {canSwitchStore ? (
            <label className="store-nav-store-switch is-mobile" title={selectedStoreName ? `現在: ${selectedStoreName}` : "店舗切替"}>
              <Store size={17} />
              <span>店舗切替</span>
              <select value={selectedStoreId} onChange={(event) => handleStoreSwitch(event.target.value)} aria-label="店舗切替">
                {storeOptions.map((store) => (
                  <option value={store.id} key={store.id}>{store.name}</option>
                ))}
              </select>
            </label>
          ) : null}
        </nav>
      </details>
    </div>
  );
}
