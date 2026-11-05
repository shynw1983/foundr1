"use client";

import { ChevronDown, Clock3, FlaskConical, Menu, Palette, Store } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { UserBadge } from "../../os/components/UserBadge";
import { useCloseOnOutside } from "../../os/components/useCloseOnOutside";
import { defaultStoreModuleSettings, type StoreModuleSettings } from "../../../lib/module-setting-defaults";
import { getStoredStoreSelection, setStoredStoreSelection } from "./store-selection";
import { getScopedInventorySyncNotificationStore } from "../../../lib/inventory-sync-alert-client";
import { rememberStoreBusinessHours, storeOrderAlertEventName } from "../../../lib/store-polling-client";
import { useStoreTheme } from "./StoreThemeProvider";
import { canUseFullStoreWorkbench } from "../../../lib/store-inventory-policy";

import { getVisibleStoreNavigation, storeNavigationGroups, type StoreNavigationItem } from "./store-navigation";

type StoreContextResponse = {
  access?: {
    role: string;
    canUseAllStoreView: boolean;
    stores: Array<{ id: string; name: string; businessHours?: unknown }>;
  };
  selectedStoreId?: string;
};

type StoreNavigationAction = { label: string; onSelect: () => void };

function StoreNavigationGroup({ group, items, activeHref, alert, clearOrderAlert, action }: {
  group: typeof storeNavigationGroups[number]; items: StoreNavigationItem[];
  activeHref: string; alert: boolean; clearOrderAlert: () => void; action?: StoreNavigationAction;
}) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  const close = () => { if (ref.current) ref.current.open = false; };
  useCloseOnOutside(ref, close);
  const Icon = group.icon;
  const isActive = items.some(item => item.href === activeHref || (item.href !== "/store" && activeHref.startsWith(`${item.href}/`)));
  return <details className="store-group-menu" ref={ref}>
    <summary className={`${isActive ? "is-active" : ""} ${alert ? "has-order-alert" : ""}`}>
      <Icon size={17} /><span>{group.label}</span><ChevronDown size={15} />
      {alert ? <span className="store-order-alert-dot" aria-label="新規注文あり" /> : null}
    </summary>
    <div className="store-group-list">
      {items.map(item => {
        const ItemIcon = item.icon;
        return <a href={item.href} key={item.href} aria-current={item.href === activeHref ? "page" : undefined}
          className={item.href === activeHref ? "is-active" : ""}
          onClick={() => { if (item.href === "/store/orders") clearOrderAlert(); close(); }}>
          <ItemIcon size={17} /><span>{item.label}</span>
          {item.href === "/store/orders" && alert ? <span className="store-order-alert-dot" aria-label="新規注文あり" /> : null}
        </a>;
      })}
      {action ? <button type="button" className="store-group-action" data-pos-debug-entry onClick={() => { close(); action.onSelect(); }}>
        <FlaskConical size={17} aria-hidden="true" /><span>{action.label}</span>
      </button> : null}
    </div>
  </details>;
}

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

export function StoreNavTabs({ active, storeId, posDebugAction }: { storeId?: string; posDebugAction?: StoreNavigationAction; active: "home" | "seats" | "orders" | "notifications" | "kitchen" | "pickup-display" | "menu" | "procedures" | "timecard" | "pos" | "receiving" | "inventory" | "replenishment" | "feedback" | "devices" | "sns" | "appearance" }) {
  const { context: themeContext } = useStoreTheme();
  const activeHref = active === "home"
    ? "/store"
    : active === "appearance"
      ? "/store/settings/appearance"
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
  const [canUseInventory, setCanUseInventory] = useState(false);
  const [storeContext, setStoreContext] = useState<StoreContextResponse | null>(null);
  const [hasPendingOrderAlert, setHasPendingOrderAlert] = useState(false);
  const storeMenuRef = useRef<HTMLDetailsElement | null>(null);
  const clock = now ? formatStoreClock(now) : { dateText: "--/--", timeText: "--:--:--" };
  const shouldFlashOrdersTab = active !== "orders" && hasPendingOrderAlert;
  const [snsAvailable, setSnsAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!canUseFullStoreWorkbench(employeeRole ?? "")) return;
    void fetch("/api/sns").then(response => response.ok ? response.json() : null)
      .then(body => { if (alive) setSnsAvailable(Boolean(body?.stores?.length)); })
      .catch(() => { if (alive) setSnsAvailable(false); });
    return () => { alive = false; };
  }, [employeeRole, storeContext?.selectedStoreId]);
  const visibleItems = getVisibleStoreNavigation(employeeRole, canUseInventory).filter(item => item.href !== "/store/sns" || snsAvailable);
  const storeOptions = storeContext?.access?.stores ?? [];
  const selectedStoreId = storeContext?.selectedStoreId ?? "";
  const selectedStoreName = storeOptions.find((store) => store.id === selectedStoreId)?.name ?? "";
  const canSwitchStore = Boolean(
    storeOptions.length > 1 &&
    storeContext?.access &&
    (storeContext.access.canUseAllStoreView || !["staff", "store_terminal"].includes(storeContext.access.role) ||
      (canUseInventory && ["inventory", "replenishment", "receiving"].includes(active) && storeContext.access.role === "staff"))
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
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function loadStoreContext() {
      const initialStoreId = getStoredStoreSelection();
      const notificationStoreId = await getScopedInventorySyncNotificationStore();
      if (!isMounted) return;
      const currentStoreId = getStoredStoreSelection();
      const scopedNotificationStoreId = notificationStoreId && (!currentStoreId || currentStoreId === initialStoreId || currentStoreId === notificationStoreId)
        ? notificationStoreId : "";
      const storedStoreId = storeId || scopedNotificationStoreId || currentStoreId;
      if (scopedNotificationStoreId && !storeId && scopedNotificationStoreId !== currentStoreId) setStoredStoreSelection(scopedNotificationStoreId);
      const params = storedStoreId ? `?storeId=${encodeURIComponent(storedStoreId)}` : "";
      const response = await fetch(`/api/store/context${params}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as StoreContextResponse;
      if (!isMounted || (storedStoreId && getStoredStoreSelection() !== storedStoreId)) return;
      setStoreContext(body);
      rememberStoreBusinessHours(body.access?.stores);
      if (body.selectedStoreId) setStoredStoreSelection(body.selectedStoreId);
    }
    // Offline POS recovery owns its saved menu/register context. Navigation reads
    // may fail without widening roles or replacing that independently validated state.
    void loadStoreContext().catch(() => undefined);
    return () => {
      isMounted = false;
    };
  }, [storeId]);

  useEffect(() => {
    let isMounted = true;
    async function loadCurrentEmployee() {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as { employee?: { role?: string; isTimecardEmployee?: boolean; permissions?: string[]; permittedNavPaths?: string[] } | null };
      if (isMounted) {
        setEmployeeRole(String(body.employee?.role ?? ""));
        setCanUseInventory(Boolean(body.employee?.permissions?.includes("store.inventory") || body.employee?.permittedNavPaths?.includes("/store/inventory")));
      }
    }
    void loadCurrentEmployee().catch(() => undefined);
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
    void loadSettings().catch(() => undefined);
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (active === "orders") return;
    const handleOrderAlert = () => markOrderAlert();
    window.addEventListener(storeOrderAlertEventName, handleOrderAlert);
    return () => {
      window.removeEventListener(storeOrderAlertEventName, handleOrderAlert);
    };
  }, [active]);

  function handleStoreSwitch(storeId: string) {
    if (!storeId || storeId === selectedStoreId) return;
    setStoredStoreSelection(storeId);
    if (active === "inventory" || active === "replenishment" || active === "receiving" || active === "appearance") { const url = new URL(window.location.href); url.searchParams.set("storeId", storeId); window.location.assign(url.toString()); } else window.location.reload();
  }

  const navigation = <>
    {visibleItems.filter(item => item.group === "home" || item.group === "pos").map(item => {
      const Icon = item.icon;
      return <a href={item.href} key={item.href} className={item.href === activeHref ? "is-active" : ""} aria-current={item.href === activeHref ? "page" : undefined}><Icon size={17} /><span>{item.label}</span></a>;
    })}
    {storeNavigationGroups.map(group => {
      const items = visibleItems.filter(item => item.group === group.id);
      return items.length ? <StoreNavigationGroup key={group.id} group={group} items={items} activeHref={activeHref}
        alert={group.id === "orders" && shouldFlashOrdersTab} clearOrderAlert={clearOrderAlert}
        action={active === "pos" && group.id === "operations" ? posDebugAction && { ...posDebugAction, onSelect: () => { if (storeMenuRef.current) storeMenuRef.current.open = false; posDebugAction.onSelect(); } } : undefined} /> : null;
    })}
    {themeContext?.canManageTheme ? <a href="/store/settings/appearance" className={active === "appearance" ? "is-active" : ""} aria-current={active === "appearance" ? "page" : undefined}><Palette size={17} /><span>表示設定</span></a> : null}
    {employeeRole === "staff" ? <a href="/staff">個人アプリ</a> : null}
  </>;

  return (
    <div className="store-nav-cluster">
      {settings.header.showClock ? <div className="store-live-clock" aria-label="現在時刻"><Clock3 size={17} /><span>{clock.dateText}</span><strong>{clock.timeText}</strong></div> : null}
      <div className={`store-user-tools is-user-${settings.header.userDisplay}`}>
        {canSwitchStore ? <label className="store-nav-store-switch" title={selectedStoreName ? `現在: ${selectedStoreName}` : "店舗切替"}>
          <Store size={17} /><span>店舗切替</span>
          <select value={selectedStoreId} onChange={event => handleStoreSwitch(event.target.value)} aria-label="店舗切替">
            {storeOptions.map(store => <option value={store.id} key={store.id}>{store.name}</option>)}
          </select>
        </label> : null}
        <UserBadge showNotifications={settings.header.showNotifications} showLanguagePicker={settings.header.showLanguagePicker} logoutHref="/store/logout"
          showOsLink={Boolean(employeeRole && employeeRole !== "staff" && employeeRole !== "store_terminal")} />
      </div>
      <nav className="store-nav-tabs" aria-label="店舗ワークベンチ">{navigation}</nav>
      <details className="mobile-nav-menu store-nav-menu" ref={storeMenuRef}>
        <summary aria-label="メニュー">
          <span className="hamburger-button" aria-hidden="true"><Menu size={18} /></span>
          <span className="mobile-nav-menu-label">メニュー</span>
          {shouldFlashOrdersTab ? <span className="store-order-alert-dot" aria-label="新規注文あり" /> : null}
        </summary>
        <nav className="mobile-nav-list store-nav-list" aria-label="店舗ワークベンチメニュー">{navigation}</nav>
      </details>
    </div>
  );
}
