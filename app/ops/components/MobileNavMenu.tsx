"use client";

import { Menu } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { UserBadge } from "./UserBadge";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export function MobileNavMenu({ navItems }: { navItems: NavItem[] }) {
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
        {navItems.map(({ label, href, icon: Icon }) => (
          <a href={href} key={label}>
            <Icon size={17} />
            <span>{label}</span>
          </a>
        ))}
      </nav>
    </details>
  );
}
