"use client";

import Link from "next/link";
import { ChevronDown, ExternalLink, Menu } from "lucide-react";
import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { type OsNavItem, usePermittedNavModules } from "./OsNavList";
import { UserBadge } from "./UserBadge";
import { useCloseOnOutside } from "./useCloseOnOutside";

export function MobileNavMenu({ navItems }: { navItems: OsNavItem[] }) {
  const pathname = usePathname();
  const permittedNavModules = usePermittedNavModules(navItems);
  const mobileMenuRef = useRef<HTMLDetailsElement | null>(null);
  const [openModuleId, setOpenModuleId] = useState<string | null>(null);

  useCloseOnOutside(mobileMenuRef, () => {
    if (mobileMenuRef.current) mobileMenuRef.current.open = false;
    setOpenModuleId(null);
  });

  return (
    <div className="mobile-nav-actions">
      <details
        className="mobile-nav-menu"
        ref={mobileMenuRef}
        onToggle={() => {
          if (!mobileMenuRef.current?.open) setOpenModuleId(null);
        }}
      >
        <summary aria-label="メニュー">
          <span className="hamburger-button" aria-hidden="true">
            <Menu size={18} />
          </span>
          <span className="mobile-nav-menu-label">メニュー</span>
        </summary>
        <nav className="mobile-nav-list" aria-label="モバイルナビゲーション">
          {permittedNavModules.map((module) => {
            const ModuleIcon = module.icon;

            if (module.href && module.children.length <= 1) {
              const isActive = pathname === module.href;
              return (
                <Link href={module.href} className={`mobile-nav-module-link${isActive ? " is-active" : ""}`.trim()} key={module.id}>
                  <ModuleIcon size={17} />
                  <span>{module.label}</span>
                  {module.children.some((child) => child.href === module.href && child.beta) ? <span className="nav-beta-badge">Beta</span> : null}
                </Link>
              );
            }

            const isOpen = openModuleId === module.id;
            const isActive = module.children.some((child) => pathname === child.href || pathname.startsWith(`${child.href}/`));

            return (
              <section className={`mobile-nav-section${isOpen ? " is-open" : ""}${isActive ? " is-active" : ""}`} key={module.id}>
                <button
                  className="mobile-nav-section-heading"
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenModuleId((current) => current === module.id ? null : module.id)}
                >
                  <ModuleIcon size={16} />
                  <span>{module.label}</span>
                  <ChevronDown className="mobile-nav-section-chevron" size={15} aria-hidden="true" />
                </button>
                {isOpen ? (
                  <div className="mobile-nav-section-links">
                    {module.children.map(({ label, href, icon: Icon, isShortcut, beta }) => {
                      const isChildActive = pathname === href || pathname.startsWith(`${href}/`);
                      return (
                        <Link href={href} className={`${isChildActive ? "is-active" : ""}${isShortcut ? " is-shortcut" : ""}`.trim()} key={href}>
                          <Icon size={16} />
                          <span>{label}</span>
                          {beta ? <span className="nav-beta-badge">Beta</span> : null}
                          {isShortcut ? <ExternalLink className="nav-shortcut-icon" size={12} aria-label="快捷リンク" /> : null}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
          <div className="mobile-nav-user">
            <UserBadge showNotifications={false} />
          </div>
        </nav>
      </details>
    </div>
  );
}
