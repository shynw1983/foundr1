"use client";

import { Menu } from "lucide-react";
import { UserBadge } from "./UserBadge";
import { type OpsNavItem, usePermittedNavItems } from "./OpsNavList";

export function MobileNavMenu({ navItems }: { navItems: OpsNavItem[] }) {
  const permittedNavItems = usePermittedNavItems(navItems);

  return (
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
        {permittedNavItems.map(({ label, href, icon: Icon }) => (
          <a href={href} key={label}>
            <Icon size={17} />
            <span>{label}</span>
          </a>
        ))}
      </nav>
    </details>
  );
}
