"use client";

import Link from "next/link";
import { Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getCachedCurrentEmployee, loadCurrentEmployee } from "./currentEmployeeStore";

export type OsNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

const masterRoles = new Set(["owner", "manager", "buyer"]);
const productViewerRoles = new Set(["owner", "manager", "buyer", "store_owner"]);
const orderModulePaths = new Set([
  "/os/orders",
  "/os/procurement",
  "/os/history",
  "/os/suppliers",
  "/os/field-notes",
  "/os/product-comparisons",
  "/os/reports"
]);
const procedureModulePaths = new Set(["/os/procedures", "/os/menus"]);
const timecardModulePaths = new Set(["/os/timecard", "/os/timecard/schedule", "/os/timecard/payroll", "/os/staff", "/os/stores"]);
const sharedDataPaths = new Set(["/os/products", "/os/stores", "/os/staff", "/os/menus"]);
const settingsNavItem: OsNavItem = { label: "システム設定", href: "/os/settings", icon: Settings };

function getModuleNavPaths(pathname: string) {
  if (pathname === "/os/procedures" || pathname.startsWith("/os/procedures/")) {
    return procedureModulePaths;
  }

  if (pathname === "/os/menus" || pathname.startsWith("/os/menus/")) {
    return sharedDataPaths;
  }

  if (pathname === "/os/timecard" || pathname.startsWith("/os/timecard/")) {
    return timecardModulePaths;
  }

  if (pathname === "/os/products" || pathname === "/os/stores" || pathname === "/os/staff") {
    return sharedDataPaths;
  }

  return orderModulePaths;
}

function canShowInCurrentModule(pathname: string, item: OsNavItem) {
  if (item.href === "/os/logout") return false;
  if (item.href === "/os") return true;
  if (item.href === "/os/settings") return true;
  return getModuleNavPaths(pathname).has(item.href);
}

function canShowNavItem(role: string, item: OsNavItem) {
  if (item.href === "/os/logout") return false;
  if (item.href === "/os/settings") return masterRoles.has(role);
  if (item.href === "/os/staff") return role === "owner";
  if (item.href === "/os/field-notes") return true;
  if (item.href === "/os/procedures") return ["owner", "manager"].includes(role);
  if (item.href === "/os/menus") return ["owner", "manager"].includes(role);
  if (item.href === "/os/products") return productViewerRoles.has(role);
  if (["/os/stores", "/os/suppliers", "/os/product-comparisons"].includes(item.href)) return masterRoles.has(role);

  return true;
}

export function usePermittedNavItems(navItems: OsNavItem[]) {
  const pathname = usePathname();
  const [role, setRole] = useState(() => getCachedCurrentEmployee()?.role ?? "");

  useEffect(() => {
    let isMounted = true;

    async function loadCurrentRole() {
      const employee = await loadCurrentEmployee();
      if (isMounted) setRole(employee?.role ?? "");
    }

    void loadCurrentRole();

    return () => {
      isMounted = false;
    };
  }, []);

  return useMemo(() => {
    const availableNavItems = navItems.some((item) => item.href === "/os/settings") ? navItems : [...navItems, settingsNavItem];
    const currentModuleItems = availableNavItems.filter((item) => canShowInCurrentModule(pathname, item));
    if (!role) return [];
    return currentModuleItems.filter((item) => canShowNavItem(role, item));
  }, [navItems, pathname, role]);
}

export function OsNavList({ navItems }: { navItems: OsNavItem[] }) {
  const permittedNavItems = usePermittedNavItems(navItems);

  return (
    <nav className="nav-list">
      {permittedNavItems.map(({ label, href, icon: Icon }, index) => {
        const isHome = href === "/os";
        const followsHome = index > 0 && permittedNavItems[index - 1]?.href === "/os";
        const content = (
          <>
            <Icon size={18} />
            <span>{label}</span>
          </>
        );

        return (
          <Link href={href} className={`nav-item${isHome ? " is-home" : ""}${followsHome ? " follows-home" : ""}`} key={label}>
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
