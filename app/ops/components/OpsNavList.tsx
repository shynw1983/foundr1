"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getCachedCurrentEmployee, loadCurrentEmployee } from "./currentEmployeeStore";

export type OpsNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

const masterRoles = new Set(["owner", "manager", "buyer"]);
const productViewerRoles = new Set(["owner", "manager", "buyer", "store_owner"]);

function canShowNavItem(role: string, item: OpsNavItem) {
  if (item.href === "/ops/logout") return true;
  if (item.href === "/ops/staff") return role === "owner";
  if (item.href === "/ops/field-notes") return true;
  if (item.href === "/ops/procedures") return ["owner", "manager"].includes(role);
  if (item.href === "/ops/products") return productViewerRoles.has(role);
  if (["/ops/stores", "/ops/suppliers", "/ops/product-comparisons"].includes(item.href)) return masterRoles.has(role);

  return true;
}

export function usePermittedNavItems(navItems: OpsNavItem[]) {
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
    if (!role) return navItems.filter((item) => item.href === "/ops/logout");
    return navItems.filter((item) => canShowNavItem(role, item));
  }, [navItems, role]);
}

export function OpsNavList({ navItems }: { navItems: OpsNavItem[] }) {
  const permittedNavItems = usePermittedNavItems(navItems);

  return (
    <nav className="nav-list">
      {permittedNavItems.map(({ label, href, icon: Icon }) => {
        const content = (
          <>
            <Icon size={18} />
            <span>{label}</span>
          </>
        );

        return href === "/ops/logout" ? (
          <a href={href} className="nav-item" key={label}>
            {content}
          </a>
        ) : (
          <Link href={href} className="nav-item" key={label}>
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
