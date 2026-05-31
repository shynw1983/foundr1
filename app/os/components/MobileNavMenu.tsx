"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { NotificationMenu } from "./NotificationMenu";
import { UserBadge } from "./UserBadge";
import { type OsNavItem, usePermittedNavItems } from "./OsNavList";

export function MobileNavMenu({ navItems }: { navItems: OsNavItem[] }) {
  const permittedNavItems = usePermittedNavItems(navItems);

  return (
    <div className="mobile-nav-actions">
      <NotificationMenu className="mobile-visible-notification" />
      <details className="mobile-nav-menu">
        <summary>
          <span className="hamburger-button" aria-hidden="true">
            <Menu size={18} />
          </span>
          <span>メニュー</span>
        </summary>
        <nav className="mobile-nav-list" aria-label="モバイルナビゲーション">
          <div className="mobile-nav-user">
            <UserBadge />
          </div>
          {permittedNavItems.map(({ label, href, icon: Icon }, index) => {
            const isHome = href === "/os";
            const followsHome = index > 0 && permittedNavItems[index - 1]?.href === "/os";
            const content = (
              <>
                <Icon size={17} />
                <span>{label}</span>
              </>
            );

            return (
              <Link href={href} className={`${isHome ? "is-home" : ""}${followsHome ? " follows-home" : ""}`.trim()} key={label}>
                {content}
              </Link>
            );
          })}
        </nav>
      </details>
    </div>
  );
}
