"use client";

import { BellRing, BookOpen, ChefHat, ChevronDown, Clock3, ClipboardList, Home, Lightbulb, Menu, MessageSquareWarning, Monitor, PackageCheck, PackageSearch, Settings, ShoppingCart, Store, Tags, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { UserBadge } from "../../os/components/UserBadge";
import { useCloseOnOutside } from "../../os/components/useCloseOnOutside";
import { defaultStoreModuleSettings, type StoreModuleSettings } from "../../../lib/module-setting-defaults";
import { getStoredStoreSelection, setStoredStoreSelection } from "./store-selection";
import { rememberStoreBusinessHours, storeOrderAlertEventName } from "../../../lib/store-polling-client";

type StoreContextResponse = {
  access?: {
    role: string;
    canUseAllStoreView: boolean;
    stores: Array<{ id: string; name: string; businessHours?: unknown }>;
  };
  selectedStoreId?: string;
};

const tabs = [
  { label: "ホーム", href: "/store", icon: Home },
  { label: "客席", href: "/store/seats", icon: Users },
  { label: "注文", href: "/store/orders", icon: ClipboardList },
  { label: "注文通知", href: "/store/notifications", icon: BellRing },
  { label: "販売状態", href: "/store/menu", icon: Tags },
  { label: "店舗設備", href: "/store/devices", icon: Lightbulb },
  { label: "POS", href: "/store/pos", icon: ShoppingCart },
  { label: "在庫確認", href: "/store/inventory", icon: PackageSearch },
  { label: "納品・入庫", href: "/store/receiving", icon: PackageCheck },
  { label: "タイムカード", href: "/store/timecard", icon: Clock3 },
  { label: "SNS素材作成", href: "/store/sns", icon: Tags },
  { label: "手順書", href: "/store/procedures", icon: BookOpen },
  { label: "問題報告", href: "/store/feedback", icon: MessageSquareWarning },
  { label: "OS", href: "/os", icon: Settings }
];

const displayTabs = [
  { label: "キッチン", href: "/store/display/kitchen", icon: ChefHat },
  { label: "受取表示", href: "/store/display/pickup", icon: Monitor },
  { label: "Pick Up表示", href: "/store/display/courier", icon: Monitor },
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

export function StoreNavTabs({ active, storeId }: { storeId?: string; active: "home" | "seats" | "orders" | "notifications" | "kitchen" | "pickup-display" | "menu" | "procedures" | "timecard" | "pos" | "receiving" | "inventory" | "feedback" | "devices" | "sns" }) {
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
  const [canUseInventory, setCanUseInventory] = useState(false);
  const [storeContext, setStoreContext] = useState<StoreContextResponse | null>(null);
  const [hasPendingOrderAlert, setHasPendingOrderAlert] = useState(false);
  const [displayMenuOpen, setDisplayMenuOpen] = useState(false);
  const [mobileDisplayMenuOpen, setMobileDisplayMenuOpen] = useState(false);
  const storeMenuRef = useRef<HTMLDetailsElement | null>(null);
  const displayMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileDisplayMenuRef = useRef<HTMLDivElement | null>(null);
  const clock = now ? formatStoreClock(now) : { dateText: "--/--", timeText: "--:--:--" };
  const shouldFlashOrdersTab = active !== "orders" && hasPendingOrderAlert;
  const [snsAvailable, setSnsAvailable] = useState(false);
  useEffect(() => { let alive = true; fetch("/api/sns").then(r => r.ok ? r.json() : null).then(d => { if (alive) setSnsAvailable(Boolean(d?.stores?.length)); }).catch(() => {}); return () => { alive = false; }; }, [storeContext?.selectedStoreId]);
  const authorizedTabs = tabs.filter(tab => (tab.href !== "/store/sns" || snsAvailable) && (!["/store/inventory", "/store/receiving"].includes(tab.href) || canUseInventory));
  const restricted = employeeRole === null || ["staff", "store_owner", "store_manager"].includes(employeeRole);
  const visibleTabs = restricted
    ? [...authorizedTabs.filter(tab => ["/store/inventory", "/store/receiving"].includes(tab.href)), ...(employeeRole === "staff" ? [{ label: "個人アプリ", href: "/staff", icon: Users }] : employeeRole ? [authorizedTabs.find(tab => tab.href === "/os")!] : [])]
    : employeeRole === "store_terminal" ? authorizedTabs.filter(tab => tab.href !== "/os") : authorizedTabs;
  const visibleDisplayTabs = restricted ? [] : displayTabs;
  const isDisplayActive = visibleDisplayTabs.some((tab) => tab.href === activeHref);
  const storeOptions = storeContext?.access?.stores ?? [];
  const selectedStoreId = storeContext?.selectedStoreId ?? "";
  const selectedStoreName = storeOptions.find((store) => store.id === selectedStoreId)?.name ?? "";
  const canSwitchStore = Boolean(
    storeOptions.length > 1 &&
    storeContext?.access &&
    (storeContext.access.canUseAllStoreView || !["staff", "store_terminal"].includes(storeContext.access.role) ||
      (canUseInventory && ["inventory", "receiving"].includes(active) && storeContext.access.role === "staff"))
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
      const storedStoreId = storeId || getStoredStoreSelection();
      const params = storedStoreId ? `?storeId=${encodeURIComponent(storedStoreId)}` : "";
      const response = await fetch(`/api/store/context${params}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as StoreContextResponse;
      if (!isMounted) return;
      setStoreContext(body);
      rememberStoreBusinessHours(body.access?.stores);
      if (body.selectedStoreId) setStoredStoreSelection(body.selectedStoreId);
    }
    void loadStoreContext();
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
    const handleOrderAlert = () => markOrderAlert();
    window.addEventListener(storeOrderAlertEventName, handleOrderAlert);
    return () => {
      window.removeEventListener(storeOrderAlertEventName, handleOrderAlert);
    };
  }, [active]);

  function handleStoreSwitch(storeId: string) {
    if (!storeId || storeId === selectedStoreId) return;
    setStoredStoreSelection(storeId);
    if (active === "inventory" || active === "receiving") { const url = new URL(window.location.href); url.searchParams.set("storeId", storeId); window.location.assign(url.toString()); } else window.location.reload();
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
        <UserBadge showNotifications={settings.header.showNotifications} showLanguagePicker={settings.header.showLanguagePicker} showStorePicker={false} logoutHref="/store/logout" />
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
        {visibleDisplayTabs.length > 0 ? <div className="store-display-nav-menu" data-open={displayMenuOpen ? "true" : "false"} ref={displayMenuRef}>
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
        </div> : null}
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
          {visibleDisplayTabs.length > 0 ? <div className="store-display-nav-menu is-mobile" data-open={mobileDisplayMenuOpen ? "true" : "false"} ref={mobileDisplayMenuRef}>
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
          </div> : null}
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
