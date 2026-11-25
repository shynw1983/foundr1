"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  ChevronDown,
  ClipboardList,
  ExternalLink,
  Pin,
  PinOff,
  Store
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { OsLanguagePicker } from "./OsTranslationProvider";
import { canonicalNavItems, type OsNavModuleWithChildren } from "./OsNavList";
import { OsStoreContextPicker } from "./OsStoreContextPicker";
import { UserBadge } from "./UserBadge";

const SIDEBAR_PIN_KEY = "foundr1_os_ed_sidebar_pinned";

function isHrefActive(pathname: string, href: string) {
  if (href === "/os") return pathname === "/os";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function OsEditorialSidebar({
  modules,
  badges
}: {
  modules: OsNavModuleWithChildren[];
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();
  const asideRef = useRef<HTMLElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const [openModuleId, setOpenModuleId] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SIDEBAR_PIN_KEY) === "1") {
        setPinned(true);
      }
    } catch {
      // Ignore storage access errors
    }
  }, []);

  const activeModuleId = modules.find(
    (module) =>
      (module.href && isHrefActive(pathname, module.href))
      || module.children.some((child) => isHrefActive(pathname, child.href))
  )?.id ?? null;

  useEffect(() => {
    if (activeModuleId) {
      setOpenModuleId(activeModuleId);
    }
  }, [activeModuleId]);

  // Collapse hover overlay cleanly after route change
  useEffect(() => {
    setHoverExpanded(false);
  }, [pathname]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    clearCloseTimer();
    if (!pinned) setHoverExpanded(true);
  }, [clearCloseTimer, pinned]);

  const scheduleCollapse = useCallback(() => {
    if (pinned) return;
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      const aside = asideRef.current;
      if (!aside) {
        setHoverExpanded(false);
        return;
      }
      // Keep open while user is interacting with a native <select> or open popover (<details open>)
      const activeEl = document.activeElement;
      const hasOpenDetails = Boolean(aside.querySelector("details[open]"));
      const hasFocusedControl = Boolean(
        activeEl
        && aside.contains(activeEl)
        && (activeEl.tagName === "SELECT" || activeEl.tagName === "INPUT")
      );
      if (!hasOpenDetails && !hasFocusedControl && !aside.matches(":hover")) {
        setHoverExpanded(false);
      }
    }, 180);
  }, [clearCloseTimer, pinned]);

  const handleFocusCapture = useCallback(() => {
    clearCloseTimer();
    if (!pinned) setHoverExpanded(true);
  }, [clearCloseTimer, pinned]);

  const handleBlurCapture = useCallback(() => {
    scheduleCollapse();
  }, [scheduleCollapse]);

  function togglePinned() {
    const next = !pinned;
    clearCloseTimer();
    setPinned(next);
    setHoverExpanded(false);
    if (next && activeModuleId) setOpenModuleId(activeModuleId);
    try {
      window.localStorage.setItem(SIDEBAR_PIN_KEY, next ? "1" : "0");
    } catch {
      // Ignore storage access errors
    }
  }

  const isExpanded = pinned || hoverExpanded;
  const collapsed = !isExpanded;

  return (
    <div className={`os-ed-sidebar-rail${pinned ? " is-pinned" : ""}`}>
      <aside
        ref={asideRef}
        className={`os-ed-sidebar${collapsed ? " is-collapsed" : ""}${!pinned && hoverExpanded ? " is-hover-expanded" : ""}`}
        aria-label="管理画面ナビゲーション"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={scheduleCollapse}
        onFocusCapture={handleFocusCapture}
        onBlurCapture={handleBlurCapture}
      >
        <div className="os-ed-sidebar-top">
          <div className="os-ed-sidebar-brand-row">
            <Link className="os-ed-brand" href="/os" aria-label="Foundr1 OS ホーム">
              <span className="os-ed-brand-mark">F1</span>
              {!collapsed ? (
                <span className="os-ed-brand-text">
                  <strong>Foundr1</strong>
                  <small>OS</small>
                </span>
              ) : null}
            </Link>
            {!collapsed ? (
              <button
                type="button"
                className={`os-ed-collapse-btn${pinned ? " is-pinned" : ""}`}
                onClick={togglePinned}
                aria-label={pinned ? "自動折りたたみに戻す" : "サイドバーを固定表示"}
                title={pinned ? "自動折りたたみに戻す" : "サイドバーを固定表示"}
              >
                {pinned ? <PinOff size={15} /> : <Pin size={15} />}
              </button>
            ) : null}
          </div>

          {/* Global Store Switcher + Language Switcher near top of sidebar */}
          {!collapsed ? (
            <div className="os-ed-sidebar-store">
              <OsStoreContextPicker />
            </div>
          ) : null}

          <div className="os-ed-sidebar-lang">
            <OsLanguagePicker />
          </div>

          <nav className="os-ed-nav" aria-label="OS メニュー">
            <Link
              href="/os"
              className={`os-ed-nav-link${pathname === "/os" ? " is-active" : ""}`}
              title="OS ホーム"
            >
              <ClipboardList size={16} />
              {!collapsed ? <span>OS ホーム</span> : null}
            </Link>

            {modules.map((module) => {
              const Icon = module.icon;
              const badgeCount = badges?.[module.id] ?? 0;
              const isModuleActive = activeModuleId === module.id;
              const isOpen = !collapsed && openModuleId === module.id;
              const firstHref = module.href ?? module.children[0]?.href ?? "/os";

              if (collapsed) {
                return (
                  <Link
                    key={module.id}
                    href={firstHref}
                    className={`os-ed-nav-link${isModuleActive ? " is-active" : ""}`}
                    title={module.label}
                    aria-label={module.label}
                  >
                    <Icon size={16} />
                  </Link>
                );
              }

              if (module.href && module.children.length <= 1) {
                return (
                  <Link
                    key={module.id}
                    href={module.href}
                    className={`os-ed-nav-link${isModuleActive ? " is-active" : ""}`}
                  >
                    <Icon size={16} />
                    <span>{module.label}</span>
                    {badgeCount > 0 ? <em className="os-ed-nav-count">{badgeCount}</em> : null}
                  </Link>
                );
              }

              return (
                <div className={`os-ed-nav-group${isOpen ? " is-open" : ""}`} key={module.id}>
                  <button
                    type="button"
                    className={`os-ed-nav-link${isModuleActive && !isOpen ? " is-active" : ""}`}
                    aria-expanded={isOpen}
                    onClick={() => setOpenModuleId((current) => (current === module.id ? null : module.id))}
                  >
                    <Icon size={16} />
                    <span>{module.label}</span>
                    {badgeCount > 0 ? <em className="os-ed-nav-count">{badgeCount}</em> : null}
                    <ChevronDown size={13} className="os-ed-nav-chevron" aria-hidden="true" />
                  </button>
                  {isOpen ? (
                    <div className="os-ed-nav-children">
                      {module.children.map((child) => (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={`os-ed-nav-sublink${isHrefActive(pathname, child.href) ? " is-active" : ""}`}
                        >
                          <span>{child.label}</span>
                          {child.beta ? <em className="nav-beta-badge">Beta</em> : null}
                          {child.isShortcut ? <ExternalLink size={11} aria-hidden="true" /> : null}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </nav>
        </div>

        <div className="os-ed-sidebar-bottom">
          {!collapsed ? (
            <>
              <Link href="/store" className="os-ed-store-shortcut">
                <Store size={14} />
                <span>店舗ワークベンチ</span>
                <ArrowUpRight size={13} className="os-ed-store-arrow" aria-hidden="true" />
              </Link>
              <div className="os-ed-sidebar-user">
                <UserBadge showLanguagePicker={false} showStorePicker={false} showQuickActions={false} />
              </div>
            </>
          ) : (
            <Link
              href="/store"
              className="os-ed-nav-link"
              title="店舗ワークベンチ"
              aria-label="店舗ワークベンチ"
            >
              <Store size={16} />
            </Link>
          )}
        </div>
      </aside>
    </div>
  );
}

export { canonicalNavItems };
