"use client";

import Link from "next/link";
import { ExternalLink, Menu } from "lucide-react";
import { useRef } from "react";
import { usePathname } from "next/navigation";
import { NotificationMenu } from "./NotificationMenu";
import { type OsNavItem, usePermittedNavModules } from "./OsNavList";
import { UserBadge } from "./UserBadge";
import { useCloseOnOutside } from "./useCloseOnOutside";

export function MobileNavMenu({ navItems }: { navItems: OsNavItem[] }) {
  const pathname = usePathname();
  const permittedNavModules = usePermittedNavModules(navItems);
  const mobileMenuRef = useRef<HTMLDetailsElement | null>(null);

  useCloseOnOutside(mobileMenuRef, () => {
    if (mobileMenuRef.current) mobileMenuRef.current.open = false;
  });

  return (
    <div className="mobile-nav-actions">
      <NotificationMenu className="mobile-visible-notification" />
      <details className="mobile-nav-menu" ref={mobileMenuRef}>
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
                </Link>
              );
            }

            return (
              <section className="mobile-nav-section" key={module.id}>
                <div className="mobile-nav-section-heading">
                  <ModuleIcon size={16} />
                  <span>{module.label}</span>
                </div>
                <div className="mobile-nav-section-links">
                  {module.children.map(({ label, href, icon: Icon, isShortcut }) => {
                    const isActive = pathname === href || pathname.startsWith(`${href}/`);
                    return (
                      <Link href={href} className={`${isActive ? "is-active" : ""}${isShortcut ? " is-shortcut" : ""}`.trim()} key={href}>
                        <Icon size={16} />
                        <span>{label}</span>
                        {isShortcut ? <ExternalLink className="nav-shortcut-icon" size={12} aria-label="快捷リンク" /> : null}
                      </Link>
                    );
                  })}
                </div>
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
