"use client";

import Link from "next/link";
import {
  ChevronRight,
  Clock3,
  ExternalLink,
  Home,
  LayoutGrid,
  LogOut,
  PackageCheck,
  ReceiptText,
  ShoppingCart,
  Store,
  X
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { canonicalNavItems, usePermittedNavModules } from "./OsNavList";
import { OsLanguagePicker } from "./OsTranslationProvider";
import { getCachedCurrentEmployee, loadCurrentEmployee, type CurrentEmployee } from "./currentEmployeeStore";

const roleLabels: Record<string, string> = {
  owner: "本部オーナー",
  manager: "本部マネージャー",
  store_owner: "加盟店オーナー",
  store_manager: "店長",
  store_terminal: "店舗Pad",
  staff: "Staff",
  buyer: "購入担当"
};

export function OsMobileBottomNav() {
  const pathname = usePathname();
  const permittedModules = usePermittedNavModules(canonicalNavItems);
  const [moreOpen, setMoreOpen] = useState(false);
  const [employee, setEmployee] = useState<CurrentEmployee | null>(() => getCachedCurrentEmployee());

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    let active = true;
    void loadCurrentEmployee().then((emp) => {
      if (active) setEmployee(emp);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  // Hide on auth/logout screens
  if (
    pathname === "/os/login"
    || pathname.startsWith("/os/login/")
    || pathname === "/os/logout"
    || pathname === "/os/store-terminal-login"
    || pathname === "/os/privacy-consent"
  ) {
    return null;
  }

  const ordersModule = permittedModules.find((m) => m.id === "orders");
  const posModule = permittedModules.find((m) => m.id === "pos") ?? permittedModules.find((m) => m.id === "analytics");
  const timecardModule = permittedModules.find((m) => m.id === "timecard");

  const ordersHref = ordersModule?.children[0]?.href ?? "/os/orders";
  const salesHref = permittedModules.find((m) => m.id === "analytics")?.children.find((c) => c.href === "/os/analytics/sales")?.href
    ?? posModule?.children[0]?.href
    ?? "/os/pos";
  const timecardHref = timecardModule?.children[0]?.href ?? "/os/timecard";

  const isHomeActive = !moreOpen && pathname === "/os";
  const isOrdersActive = !moreOpen && (
    pathname.startsWith("/os/orders")
    || pathname.startsWith("/os/procurement")
    || pathname.startsWith("/os/replenishment")
    || pathname.startsWith("/os/history")
    || pathname.startsWith("/os/vouchers")
    || pathname.startsWith("/os/suppliers")
    || pathname.startsWith("/os/supply-orders")
    || pathname.startsWith("/os/product-comparisons")
  );
  const isSalesActive = !moreOpen && (
    pathname.startsWith("/os/pos")
    || pathname.startsWith("/os/analytics")
    || pathname.startsWith("/os/sales")
    || pathname.startsWith("/os/menus")
    || pathname.startsWith("/os/loyalty")
    || pathname.startsWith("/os/brand-sites")
  );
  const isTimecardActive = !moreOpen && (
    pathname.startsWith("/os/timecard")
    || pathname.startsWith("/os/staff")
  );

  return (
    <>
      {/* Full-Screen Native-Style "その他" Menu Sheet */}
      {moreOpen ? (
        <div className="os-f1-more-sheet" role="dialog" aria-modal="true" aria-label="メニュー一覧">
          <div className="os-f1-more-header">
            <div className="os-f1-more-brand">
              <span className="os-ed-brand-mark" aria-hidden="true">F1</span>
              <div>
                <strong>Foundr1 OS</strong>
                {employee ? (
                  <small data-i18n-ignore>
                    {employee.name} · {roleLabels[employee.role] ?? employee.role}
                  </small>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              className="os-f1-more-close"
              onClick={() => setMoreOpen(false)}
              aria-label="閉じる"
            >
              <X size={18} />
            </button>
          </div>

          <div className="os-f1-more-body">
            <div className="os-f1-more-top-controls">
              <div className="os-f1-more-lang">
                <OsLanguagePicker />
              </div>
            </div>

            <div className="os-f1-more-section">
              <h2 className="os-f1-more-section-title">クイックアクション</h2>
              <div className="os-f1-more-quick-grid">
                <Link href="/os/orders" className="os-f1-more-quick-card" onClick={() => setMoreOpen(false)}>
                  <PackageCheck size={20} />
                  <span>新規発注</span>
                </Link>
                <Link href="/os/history" className="os-f1-more-quick-card" onClick={() => setMoreOpen(false)}>
                  <ReceiptText size={20} />
                  <span>レシート確認</span>
                </Link>
                <Link href="/store" className="os-f1-more-quick-card" onClick={() => setMoreOpen(false)}>
                  <Store size={20} />
                  <span>店舗画面 (/store)</span>
                </Link>
                <a href="/os/logout" className="os-f1-more-quick-card is-subtle" onClick={() => setMoreOpen(false)}>
                  <LogOut size={20} />
                  <span>ログアウト</span>
                </a>
              </div>
            </div>

            {permittedModules.map((module) => (
              <div className="os-f1-more-section" key={module.id}>
                <h2 className="os-f1-more-section-title">{module.label}</h2>
                <div className="os-f1-more-list">
                  {module.children.map((child) => {
                    const ChildIcon = child.icon;
                    const active = pathname === child.href || pathname.startsWith(`${child.href}/`);
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={`os-f1-more-row${active ? " is-active" : ""}`}
                        onClick={() => setMoreOpen(false)}
                      >
                        <span className="os-f1-more-row-icon" aria-hidden="true">
                          <ChildIcon size={18} />
                        </span>
                        <span className="os-f1-more-row-label">
                          {child.label}
                          {child.beta ? <em className="nav-beta-badge">Beta</em> : null}
                        </span>
                        {child.isShortcut ? (
                          <ExternalLink size={14} className="os-f1-more-row-chevron" aria-hidden="true" />
                        ) : (
                          <ChevronRight size={15} className="os-f1-more-row-chevron" aria-hidden="true" />
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Bottom 5-Tab Navigation Bar (Mobile & Compact Tablet Only) */}
      <nav className="os-f1-bottom-nav" aria-label="メインナビゲーション">
        <Link href="/os" className={`os-f1-tab${isHomeActive ? " is-active" : ""}`}>
          <span className="os-f1-tab-icon"><Home size={19} /></span>
          <span>ホーム</span>
        </Link>
        <Link href={ordersHref} className={`os-f1-tab${isOrdersActive ? " is-active" : ""}`}>
          <span className="os-f1-tab-icon"><PackageCheck size={19} /></span>
          <span>発注・購入</span>
        </Link>
        <Link href={salesHref} className={`os-f1-tab${isSalesActive ? " is-active" : ""}`}>
          <span className="os-f1-tab-icon"><ShoppingCart size={19} /></span>
          <span>売上・POS</span>
        </Link>
        <Link href={timecardHref} className={`os-f1-tab${isTimecardActive ? " is-active" : ""}`}>
          <span className="os-f1-tab-icon"><Clock3 size={19} /></span>
          <span>勤怠</span>
        </Link>
        <button
          type="button"
          className={`os-f1-tab${moreOpen ? " is-active" : ""}`}
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
        >
          <span className="os-f1-tab-icon"><LayoutGrid size={19} /></span>
          <span>その他</span>
        </button>
      </nav>
    </>
  );
}
