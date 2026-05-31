"use client";

import { BookOpen, Clock3, ClipboardList, Home, ShoppingCart, Tags } from "lucide-react";
import { useEffect, useState } from "react";
import { UserBadge } from "../../os/components/UserBadge";
import { defaultStoreModuleSettings, type StoreModuleSettings } from "../../../lib/module-setting-defaults";

const tabs = [
  { label: "ホーム", href: "/store", icon: Home },
  { label: "注文", href: "/store/orders", icon: ClipboardList },
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

export function StoreNavTabs({ active }: { active: "home" | "orders" | "menu" | "procedures" | "timecard" | "pos" }) {
  const activeHref = active === "home" ? "/store" : `/store/${active}`;
  const [now, setNow] = useState<Date | null>(null);
  const [settings, setSettings] = useState<StoreModuleSettings>(defaultStoreModuleSettings);
  const clock = now ? formatStoreClock(now) : { dateText: "--/--", timeText: "--:--:--" };

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <a className={tab.href === activeHref ? "is-active" : ""} href={tab.href} key={tab.href}>
              <Icon size={17} />
              {tab.label}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
