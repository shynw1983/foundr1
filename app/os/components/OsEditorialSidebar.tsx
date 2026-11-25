"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  ChevronDown,
  ClipboardList,
  ExternalLink,
  PanelLeftClose,
  PanelLeftOpen,
  Store
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { OsLanguagePicker } from "./OsTranslationProvider";
import { canonicalNavItems, type OsNavModuleWithChildren } from "./OsNavList";
import { OsStoreContextPicker } from "./OsStoreContextPicker";
import { UserBadge } from "./UserBadge";

const SIDEBAR_COLLAPSE_KEY = "foundr1_os_ed_sidebar_collapsed";

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
  const [collapsed, setCollapsed] = useState(false);
  const [openModuleId, setOpenModuleId] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1") {
        setCollapsed(true);
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

  function toggleCollapsed(next: boolean) {
    setCollapsed(next);
    if (next) setOpenModuleId(null);
    else if (activeModuleId) setOpenModuleId(activeModuleId);
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      // Ignore storage access errors
    }
  }

  return (
    <aside
      className={`os-ed-sidebar${collapsed ? " is-collapsed" : ""}`}
      aria-label="管理画面ナビゲーション"
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
              className="os-ed-collapse-btn"
              onClick={() => toggleCollapsed(true)}
              aria-label="サイドバーを折りたたむ"
              title="サイドバーを折りたたむ"
            >
              <PanelLeftClose size={15} />
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
        {collapsed ? (
          <button
            type="button"
            className="os-ed-nav-link os-ed-expand-btn"
            onClick={() => toggleCollapsed(false)}
            aria-label="サイドバーを展開"
            title="サイドバーを展開"
          >
            <PanelLeftOpen size={16} />
          </button>
        ) : (
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
        )}
      </div>
    </aside>
  );
}

export { canonicalNavItems };
