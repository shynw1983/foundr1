"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { useRef } from "react";
import { usePathname } from "next/navigation";
import { NotificationMenu } from "./NotificationMenu";
import { type OsNavItem, usePermittedNavModules } from "./OsNavList";
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
        <summary>
          <span className="hamburger-button" aria-hidden="true">
            <Menu size={18} />
          </span>
          <span>メニュー</span>
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
                  {module.children.map(({ label, href, icon: Icon }) => {
                    const isActive = pathname === href || pathname.startsWith(`${href}/`);
                    return (
                      <Link href={href} className={isActive ? "is-active" : ""} key={href}>
                        <Icon size={16} />
                        <span>{label}</span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </nav>
      </details>
    </div>
  );
}
